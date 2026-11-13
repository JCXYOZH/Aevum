/**
 * MrHua 3D灵体渲染引擎 - orb-constants
 * 常量定义与光照/相机/材质/后处理系统
 * 从 orb-renderer-main.js 拆分 (原行 L4144-L12064)
 * @module orb-constants
 */
'use strict';

/* ===== 光照系统 ===== */
const LightType = { DIRECTIONAL: 0, POINT: 1, SPOT: 2, HEMISPHERE: 3, AREA: 4 };
function createLight(type, options){
  const opt = options || {};
  const light = {
    type: type,
    color: opt.color || [1,1,1],
    intensity: opt.intensity !== undefined ? opt.intensity : 1,
    position: opt.position || [0,0,0],
    direction: opt.direction || [0,-1,0],
    range: opt.range || 100,
    innerAngle: opt.innerAngle || 0.5,
    outerAngle: opt.outerAngle || 0.7,
    castShadow: opt.castShadow || false,
    shadowMapSize: opt.shadowMapSize || 1024,
    shadowBias: opt.shadowBias || 0.001,
    shadowNormalBias: opt.shadowNormalBias || 0.02,
    shadowCameraNear: opt.shadowCameraNear || 0.1,
    shadowCameraFar: opt.shadowCameraFar || 1000,
    shadowCameraLeft: opt.shadowCameraLeft || -50,
    shadowCameraRight: opt.shadowCameraRight || 50,
    shadowCameraTop: opt.shadowCameraTop || 50,
    shadowCameraBottom: opt.shadowCameraBottom || -50,
    enabled: opt.enabled !== false,
    _shadowTexture: null,
    _shadowFramebuffer: null,
    _shadowDepthBuffer: null,
    _shadowViewMatrix: new Float32Array(16),
    _shadowProjMatrix: new Float32Array(16),
  };
  const dl = Math.sqrt(light.direction[0]**2+light.direction[1]**2+light.direction[2]**2)||1;
  light.direction[0]/=dl; light.direction[1]/=dl; light.direction[2]/=dl;
  return light;
}
function createDirectionalLight(color, intensity, direction){ return createLight(LightType.DIRECTIONAL, {color, intensity, direction}); }
function createPointLight(color, intensity, position, range){ return createLight(LightType.POINT, {color, intensity, position, range}); }
function createSpotLight(color, intensity, position, direction, innerAngle, outerAngle, range){ return createLight(LightType.SPOT, {color, intensity, position, direction, innerAngle, outerAngle, range}); }
function createHemisphereLight(skyColor, groundColor, intensity){ return createLight(LightType.HEMISPHERE, {color: skyColor, intensity, groundColor: groundColor || [0.2,0.2,0.2]}); }
function lightAttenuation(light, distance){
  if(light.type === LightType.DIRECTIONAL || light.type === LightType.HEMISPHERE) return 1;
  const r = light.range;
  if(distance >= r) return 0;
  const t = distance / r;
  return Math.max(0, 1 - t*t) / (1 + distance*distance*0.01);
}
function lightSpotFactor(light, toLightDir){
  if(light.type !== LightType.SPOT) return 1;
  const cosAngle = toLightDir[0]*light.direction[0]+toLightDir[1]*light.direction[1]+toLightDir[2]*light.direction[2];
  const cosOuter = Math.cos(light.outerAngle);
  const cosInner = Math.cos(light.innerAngle);
  if(cosAngle <= cosOuter) return 0;
  if(cosAngle >= cosInner) return 1;
  return (cosAngle-cosOuter)/(cosInner-cosOuter);
}
function initShadowMap(gl, light){
  if(light._shadowTexture) return;
  const size = light.shadowMapSize;
  light._shadowTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, light._shadowTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  light._shadowFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, light._shadowFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, light._shadowTexture, 0);
  light._shadowDepthBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, light._shadowDepthBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, light._shadowDepthBuffer);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  console.log('[Light] 阴影贴图初始化完成 size=' + size);
}
function updateShadowMatrices(light, target){
  const t = target || [0,0,0];
  const pos = light.type === LightType.DIRECTIONAL ? [t[0]-light.direction[0]*100, t[1]-light.direction[1]*100, t[2]-light.direction[2]*100] : light.position;
  M4.lookAt(light._shadowViewMatrix, pos, t, [0,1,0]);
  if(light.type === LightType.DIRECTIONAL){
    const l=light.shadowCameraLeft, r=light.shadowCameraRight, t2=light.shadowCameraTop, b=light.shadowCameraBottom;
    const n=light.shadowCameraNear, f=light.shadowCameraFar;
    M4.identity(light._shadowProjMatrix);
    light._shadowProjMatrix[0]=2/(r-l); light._shadowProjMatrix[5]=2/(t2-b); light._shadowProjMatrix[10]=-2/(f-n);
    light._shadowProjMatrix[12]=-(r+l)/(r-l); light._shadowProjMatrix[13]=-(t2+b)/(t2-b); light._shadowProjMatrix[14]=-(f+n)/(f-n);
  } else {
    M4.perspective(light._shadowProjMatrix, light.outerAngle*2, 1, light.shadowCameraNear, light.shadowCameraFar);
  }
}
function disposeShadowMap(gl, light){
  if(light._shadowTexture) gl.deleteTexture(light._shadowTexture);
  if(light._shadowFramebuffer) gl.deleteFramebuffer(light._shadowFramebuffer);
  if(light._shadowDepthBuffer) gl.deleteRenderbuffer(light._shadowDepthBuffer);
  light._shadowTexture = light._shadowFramebuffer = light._shadowDepthBuffer = null;
}

/* ===== 相机系统 ===== */
const CameraType = { PERSPECTIVE: 0, ORTHOGRAPHIC: 1 };
function createCamera(type, options){
  const opt = options || {};
  const cam = {
    type: type,
    position: opt.position || [0,0,10],
    target: opt.target || [0,0,0],
    up: opt.up || [0,1,0],
    fov: opt.fov || 45,
    aspect: opt.aspect || 1,
    near: opt.near || 0.1,
    far: opt.far || 1000,
    left: opt.left || -10,
    right: opt.right || 10,
    top: opt.top || 10,
    bottom: opt.bottom || -10,
    zoom: opt.zoom || 1,
    _viewMatrix: new Float32Array(16),
    _projMatrix: new Float32Array(16),
    _viewProjMatrix: new Float32Array(16),
    _frustumPlanes: [new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4)],
    _dirty: true,
  };
  return cam;
}
function createPerspectiveCamera(fov, aspect, near, far){ return createCamera(CameraType.PERSPECTIVE, {fov, aspect, near, far}); }
function createOrthographicCamera(left, right, top, bottom, near, far){ return createCamera(CameraType.ORTHOGRAPHIC, {left, right, top, bottom, near, far}); }
function cameraUpdateMatrices(cam){
  M4.lookAt(cam._viewMatrix, cam.position, cam.target, cam.up);
  if(cam.type === CameraType.PERSPECTIVE){
    M4.perspective(cam._projMatrix, cam.fov*Math.PI/180, cam.aspect, cam.near, cam.far);
  } else {
    const dx=(cam.right-cam.left)/(2*cam.zoom), dy=(cam.top-cam.bottom)/(2*cam.zoom);
    const cx=(cam.right+cam.left)/2, cy=(cam.top+cam.bottom)/2;
    M4.identity(cam._projMatrix);
    cam._projMatrix[0]=1/dx; cam._projMatrix[5]=1/dy; cam._projMatrix[10]=-2/(cam.far-cam.near);
    cam._projMatrix[12]=-cx/dx; cam._projMatrix[13]=-cy/dy; cam._projMatrix[14]=-(cam.far+cam.near)/(cam.far-cam.near);
  }
  M4.mult(cam._viewProjMatrix, cam._projMatrix, cam._viewMatrix);
  cameraExtractFrustum(cam);
  cam._dirty = false;
}
function cameraExtractFrustum(cam){
  const m = cam._viewProjMatrix;
  const planes = cam._frustumPlanes;
  planes[0][0]=m[3]-m[0]; planes[0][1]=m[7]-m[4]; planes[0][2]=m[11]-m[8]; planes[0][3]=m[15]-m[12];
  planes[1][0]=m[3]+m[0]; planes[1][1]=m[7]+m[4]; planes[1][2]=m[11]+m[8]; planes[1][3]=m[15]+m[12];
  planes[2][0]=m[3]+m[1]; planes[2][1]=m[7]+m[5]; planes[2][2]=m[11]+m[9]; planes[2][3]=m[15]+m[13];
  planes[3][0]=m[3]-m[1]; planes[3][1]=m[7]-m[5]; planes[3][2]=m[11]-m[9]; planes[3][3]=m[15]-m[13];
  planes[4][0]=m[3]-m[2]; planes[4][1]=m[7]-m[6]; planes[4][2]=m[11]-m[10]; planes[4][3]=m[15]-m[14];
  planes[5][0]=m[3]+m[2]; planes[5][1]=m[7]+m[6]; planes[5][2]=m[11]+m[10]; planes[5][3]=m[15]+m[14];
  for(let i=0;i<6;i++){
    const p=planes[i], l=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])||1;
    p[0]/=l;p[1]/=l;p[2]/=l;p[3]/=l;
  }
}
function cameraPointInFrustum(cam, point){
  for(let i=0;i<6;i++){
    const p=cam._frustumPlanes[i];
    if(p[0]*point[0]+p[1]*point[1]+p[2]*point[2]+p[3] < 0) return false;
  }
  return true;
}
function cameraSphereInFrustum(cam, center, radius){
  for(let i=0;i<6;i++){
    const p=cam._frustumPlanes[i];
    if(p[0]*center[0]+p[1]*center[1]+p[2]*center[2]+p[3] < -radius) return false;
  }
  return true;
}
function cameraAABBInFrustum(cam, min, max){
  for(let i=0;i<6;i++){
    const p=cam._frustumPlanes[i];
    let px=p[0]>0?max[0]:min[0], py=p[1]>0?max[1]:min[1], pz=p[2]>0?max[2]:min[2];
    if(p[0]*px+p[1]*py+p[2]*pz+p[3] < 0) return false;
  }
  return true;
}
function cameraForward(cam, out){
  out[0]=cam.target[0]-cam.position[0]; out[1]=cam.target[1]-cam.position[1]; out[2]=cam.target[2]-cam.position[2];
  const l=Math.sqrt(out[0]*out[0]+out[1]*out[1]+out[2]*out[2])||1;
  out[0]/=l;out[1]/=l;out[2]/=l; return out;
}
function cameraRight(cam, out){
  const f=[0,0,0]; cameraForward(cam,f);
  out[0]=f[1]*cam.up[2]-f[2]*cam.up[1]; out[1]=f[2]*cam.up[0]-f[0]*cam.up[2]; out[2]=f[0]*cam.up[1]-f[1]*cam.up[0];
  const l=Math.sqrt(out[0]*out[0]+out[1]*out[1]+out[2]*out[2])||1;
  out[0]/=l;out[1]/=l;out[2]/=l; return out;
}
function cameraLookAt(cam, target){ cam.target[0]=target[0];cam.target[1]=target[1];cam.target[2]=target[2]; cam._dirty=true; }
function cameraMoveTo(cam, position){ cam.position[0]=position[0];cam.position[1]=position[1];cam.position[2]=position[2]; cam._dirty=true; }
function cameraTranslate(cam, offset){ cam.position[0]+=offset[0];cam.position[1]+=offset[1];cam.position[2]+=offset[2]; cam.target[0]+=offset[0];cam.target[1]+=offset[1];cam.target[2]+=offset[2]; cam._dirty=true; }

/* ===== 轨道相机控制器 ===== */
function createOrbitCameraController(camera, domElement){
  const ctrl = {
    camera: camera,
    domElement: domElement,
    target: camera.target.slice(),
    minDistance: 0.5,
    maxDistance: 1000,
    minPolarAngle: 0,
    maxPolarAngle: Math.PI,
    minAzimuthAngle: -Infinity,
    maxAzimuthAngle: Infinity,
    enableDamping: true,
    dampingFactor: 0.05,
    enableZoom: true,
    zoomSpeed: 1,
    enableRotate: true,
    rotateSpeed: 1,
    enablePan: true,
    panSpeed: 1,
    _spherical: { radius: 0, theta: 0, phi: 0 },
    _sphericalDelta: { radius: 0, theta: 0, phi: 0 },
    _panOffset: [0,0,0],
    _scale: 1,
    _isDragging: false,
    _lastX: 0, _lastY: 0,
    _button: -1,
  };
  function updateSpherical(){
    const offset = [camera.position[0]-ctrl.target[0], camera.position[1]-ctrl.target[1], camera.position[2]-ctrl.target[2]];
    ctrl._spherical.radius = Math.sqrt(offset[0]*offset[0]+offset[1]*offset[1]+offset[2]*offset[2]);
    ctrl._spherical.theta = Math.atan2(offset[0], offset[2]);
    ctrl._spherical.phi = Math.acos(Math.max(-1,Math.min(1,offset[1]/(ctrl._spherical.radius||1))));
  }
  updateSpherical();
  function onMouseDown(e){
    ctrl._isDragging = true;
    ctrl._lastX = e.clientX;
    ctrl._lastY = e.clientY;
    ctrl._button = e.button;
    if(domElement) domElement.style.cursor = e.button===0?'grabbing':e.button===2?'move':'default';
  }
  function onMouseMove(e){
    if(!ctrl._isDragging) return;
    const dx = e.clientX - ctrl._lastX;
    const dy = e.clientY - ctrl._lastY;
    ctrl._lastX = e.clientX;
    ctrl._lastY = e.clientY;
    if(ctrl._button === 0 && ctrl.enableRotate){
      const el = domElement || {clientWidth:1,clientHeight:1};
      ctrl._sphericalDelta.theta -= (2*Math.PI*dx/(el.clientWidth||1))*ctrl.rotateSpeed;
      ctrl._sphericalDelta.phi -= (2*Math.PI*dy/(el.clientHeight||1))*ctrl.rotateSpeed;
    } else if(ctrl._button === 2 && ctrl.enablePan){
      const offset=[0,0,0]; cameraForward(camera,offset);
      const right=[0,0,0]; cameraRight(camera,right);
      const up=[0,1,0];
      const targetDistance = V3.dist(camera.position, ctrl.target) * Math.tan((camera.fov||45)*0.5*Math.PI/180);
      const el = domElement || {clientHeight:1};
      const panX = 2*dx*targetDistance/(el.clientHeight||1);
      const panY = 2*dy*targetDistance/(el.clientHeight||1);
      ctrl._panOffset[0] += right[0]*panX*ctrl.panSpeed + up[0]*(-panY)*ctrl.panSpeed;
      ctrl._panOffset[1] += right[1]*panX*ctrl.panSpeed + up[1]*(-panY)*ctrl.panSpeed;
      ctrl._panOffset[2] += right[2]*panX*ctrl.panSpeed + up[2]*(-panY)*ctrl.panSpeed;
    }
  }
  function onMouseUp(){
    ctrl._isDragging = false;
    ctrl._button = -1;
    if(domElement) domElement.style.cursor = 'grab';
  }
  function onWheel(e){
    if(!ctrl.enableZoom) return;
    e.preventDefault();
    if(e.deltaY < 0) ctrl._scale /= Math.pow(0.95, ctrl.zoomSpeed);
    else ctrl._scale *= Math.pow(0.95, ctrl.zoomSpeed);
  }
  function onContextMenu(e){ e.preventDefault(); }
  if(domElement){
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mousemove', onMouseMove);
    domElement.addEventListener('mouseup', onMouseUp);
    domElement.addEventListener('mouseleave', onMouseUp);
    domElement.addEventListener('wheel', onWheel, {passive:false});
    domElement.addEventListener('contextmenu', onContextMenu);
    domElement.style.cursor = 'grab';
  }
  function update(){
    const s = ctrl._spherical;
    const sd = ctrl._sphericalDelta;
    if(ctrl.enableDamping){
      s.theta += sd.theta * ctrl.dampingFactor;
      s.phi += sd.phi * ctrl.dampingFactor;
      s.radius *= ctrl._scale;
      sd.theta *= (1-ctrl.dampingFactor);
      sd.phi *= (1-ctrl.dampingFactor);
    } else {
      s.theta += sd.theta;
      s.phi += sd.phi;
      s.radius *= ctrl._scale;
      sd.theta = 0; sd.phi = 0;
    }
    s.theta = Math.max(ctrl.minAzimuthAngle, Math.min(ctrl.maxAzimuthAngle, s.theta));
    s.phi = Math.max(ctrl.minPolarAngle, Math.min(ctrl.maxPolarAngle, s.phi));
    s.radius = Math.max(ctrl.minDistance, Math.min(ctrl.maxDistance, s.radius));
    ctrl.target[0] += ctrl._panOffset[0];
    ctrl.target[1] += ctrl._panOffset[1];
    ctrl.target[2] += ctrl._panOffset[2];
    if(ctrl.enableDamping){
      ctrl._panOffset[0] *= (1-ctrl.dampingFactor);
      ctrl._panOffset[1] *= (1-ctrl.dampingFactor);
      ctrl._panOffset[2] *= (1-ctrl.dampingFactor);
    } else {
      ctrl._panOffset[0]=0;ctrl._panOffset[1]=0;ctrl._panOffset[2]=0;
    }
    ctrl._scale = 1;
    const sinPhiRadius = s.radius * Math.sin(Math.max(0.001, s.phi));
    camera.position[0] = ctrl.target[0] + sinPhiRadius * Math.sin(s.theta);
    camera.position[1] = ctrl.target[1] + s.radius * Math.cos(s.phi);
    camera.position[2] = ctrl.target[2] + sinPhiRadius * Math.cos(s.theta);
    camera.target[0] = ctrl.target[0];
    camera.target[1] = ctrl.target[1];
    camera.target[2] = ctrl.target[2];
    camera._dirty = true;
  }
  function dispose(){
    if(domElement){
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('mousemove', onMouseMove);
      domElement.removeEventListener('mouseup', onMouseUp);
      domElement.removeEventListener('mouseleave', onMouseUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
    }
  }
  return { update, dispose, get target(){return ctrl.target;}, set target(v){ctrl.target=v;} };
}
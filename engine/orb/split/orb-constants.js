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

/* ===== 后处理系统 ===== */
const PostProcessType = { BLOOM: 0, SSAO: 1, DOF: 2, TONEMAP: 3, FXAA: 4, VIGNETTE: 5, COLOR_GRADE: 6 };
function createPostProcess(gl, type, width, height, options){
  const opt = options || {};
  const pp = {
    type: type,
    width: width,
    height: height,
    enabled: opt.enabled !== false,
    intensity: opt.intensity !== undefined ? opt.intensity : 1,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.8,
    radius: opt.radius !== undefined ? opt.radius : 4,
    _framebuffer: null,
    _texture: null,
    _depthBuffer: null,
    _program: null,
    _quadBuffer: null,
  };
  function createFramebuffer(w, h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const db = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, db);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, db);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: fb, texture: tex, depthBuffer: db};
  }
  const fb = createFramebuffer(width, height);
  pp._framebuffer = fb.framebuffer;
  pp._texture = fb.texture;
  pp._depthBuffer = fb.depthBuffer;
  const quadVerts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
  pp._quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pp._quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  const vsSrc = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  let fsSrc = '';
  if(type === PostProcessType.BLOOM){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; uniform float uIntensity; uniform vec2 uTexel; void main(){ vec4 c=texture2D(uTex,vUV); float b=max(c.r,max(c.g,c.b)); if(b>uThreshold){ gl_FragColor=c*uIntensity; } else { gl_FragColor=vec4(0.0); } }';
  } else if(type === PostProcessType.TONEMAP){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uExposure; void main(){ vec3 c=texture2D(uTex,vUV).rgb*uExposure; c=c/(c*0.8+vec3(1.0)); c=pow(max(c,0.0),vec3(0.4545)); gl_FragColor=vec4(c,1.0); }';
  } else if(type === PostProcessType.VIGNETTE){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; void main(){ vec4 c=texture2D(uTex,vUV); vec2 d=vUV-0.5; float v=1.0-dot(d,d)*uIntensity*2.0; gl_FragColor=vec4(c.rgb*v,1.0); }';
  } else if(type === PostProcessType.FXAA){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; void main(){ vec3 c=texture2D(uTex,vUV).rgb; vec3 nw=texture2D(uTex,vUV+vec2(-uTexel.x,-uTexel.y)).rgb; vec3 ne=texture2D(uTex,vUV+vec2(uTexel.x,-uTexel.y)).rgb; vec3 sw=texture2D(uTex,vUV+vec2(-uTexel.x,uTexel.y)).rgb; vec3 se=texture2D(uTex,vUV+vec2(uTexel.x,uTexel.y)).rgb; float l=c.r*0.299+c.g*0.587+c.b*0.114; float ln=nw.r*0.299+nw.g*0.587+nw.b*0.114; float le=ne.r*0.299+ne.g*0.587+ne.b*0.114; float ls=sw.r*0.299+sw.g*0.587+sw.b*0.114; float lse=se.r*0.299+se.g*0.587+se.b*0.114; float minL=min(l,min(ln,min(le,min(ls,lse)))); float maxL=max(l,max(ln,max(le,max(ls,lse)))); if(maxL-minL<0.05){gl_FragColor=vec4(c,1.0);return;} vec2 dir=vec2((ls+lse)-(ln+le),(le+lse)-(ln+ls)); float d=max(abs(dir.x),abs(dir.y)); dir/=d; vec3 r1=texture2D(uTex,vUV+dir*uTexel*0.5).rgb; vec3 r2=texture2D(uTex,vUV-dir*uTexel*0.5).rgb; gl_FragColor=vec4((r1+r2+c)*0.333,1.0); }';
  } else if(type === PostProcessType.COLOR_GRADE){
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform vec3 uSaturation; uniform vec3 uContrast; uniform vec3 uBrightness; void main(){ vec3 c=texture2D(uTex,vUV).rgb; float l=dot(c,vec3(0.299,0.587,0.114)); c=mix(vec3(l),c,uSaturation); c=(c-0.5)*uContrast+0.5+uBrightness; gl_FragColor=vec4(c,1.0); }';
  } else {
    fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; void main(){ gl_FragColor=texture2D(uTex,vUV); }';
  }
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.log('[PostProcess] 着色器编译失败:', gl.getShaderInfoLog(s));
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  pp._program = gl.createProgram();
  gl.attachShader(pp._program, vs);
  gl.attachShader(pp._program, fs);
  gl.linkProgram(pp._program);
  pp._uTex = gl.getUniformLocation(pp._program, 'uTex');
  pp._uIntensity = gl.getUniformLocation(pp._program, 'uIntensity');
  pp._uThreshold = gl.getUniformLocation(pp._program, 'uThreshold');
  pp._uTexel = gl.getUniformLocation(pp._program, 'uTexel');
  pp._uExposure = gl.getUniformLocation(pp._program, 'uExposure');
  pp._uSaturation = gl.getUniformLocation(pp._program, 'uSaturation');
  pp._uContrast = gl.getUniformLocation(pp._program, 'uContrast');
  pp._uBrightness = gl.getUniformLocation(pp._program, 'uBrightness');
  pp._aPos = gl.getAttribLocation(pp._program, 'aPos');
  function render(inputTexture){
    if(!pp.enabled) return inputTexture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pp._framebuffer);
    gl.viewport(0,0,pp.width,pp.height);
    gl.useProgram(pp._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(pp._uTex, 0);
    if(pp._uIntensity) gl.uniform1f(pp._uIntensity, pp.intensity);
    if(pp._uThreshold) gl.uniform1f(pp._uThreshold, pp.threshold);
    if(pp._uTexel) gl.uniform2f(pp._uTexel, 1/pp.width, 1/pp.height);
    if(pp._uExposure) gl.uniform1f(pp._uExposure, opt.exposure || 1);
    if(pp._uSaturation) gl.uniform3f(pp._uSaturation, opt.saturation||1, opt.saturation||1, opt.saturation||1);
    if(pp._uContrast) gl.uniform3f(pp._uContrast, opt.contrast||1, opt.contrast||1, opt.contrast||1);
    if(pp._uBrightness) gl.uniform3f(pp._uBrightness, opt.brightness||0, opt.brightness||0, opt.brightness||0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pp._quadBuffer);
    gl.enableVertexAttribArray(pp._aPos);
    gl.vertexAttribPointer(pp._aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return pp._texture;
  }
  function resize(w, h){
    pp.width = w; pp.height = h;
    gl.bindTexture(gl.TEXTURE_2D, pp._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, pp._depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  }
  function dispose(){
    gl.deleteFramebuffer(pp._framebuffer);
    gl.deleteTexture(pp._texture);
    gl.deleteRenderbuffer(pp._depthBuffer);
    gl.deleteBuffer(pp._quadBuffer);
    gl.deleteProgram(pp._program);
  }
  console.log('[PostProcess] 创建完成 type=' + type + ' size=' + width + 'x' + height);
  return { render, resize, dispose, get texture(){return pp._texture;}, get framebuffer(){return pp._framebuffer;}, pp };
}
function createPostProcessChain(gl, width, height){
  const chain = { passes: [], _readBuffer: null, _writeBuffer: null, width, height };
  function createReadWriteBuffer(w, h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer: fb, texture: tex};
  }
  chain._readBuffer = createReadWriteBuffer(width, height);
  chain._writeBuffer = createReadWriteBuffer(width, height);
  function addPass(type, options){
    const pp = createPostProcess(gl, type, width, height, options);
    chain.passes.push(pp);
    return pp;
  }
  function begin(){
    gl.bindFramebuffer(gl.FRAMEBUFFER, chain._readBuffer.framebuffer);
    gl.viewport(0,0,width,height);
  }
  function end(){
    let tex = chain._readBuffer.texture;
    for(let i=0;i<chain.passes.length;i++){
      if(!chain.passes[i].pp.enabled) continue;
      tex = chain.passes[i].render(tex);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0,0,width,height);
    return tex;
  }
  function resize(w, h){
    chain.width = w; chain.height = h;
    for(const buf of [chain._readBuffer, chain._writeBuffer]){
      gl.bindTexture(gl.TEXTURE_2D, buf.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    for(const pp of chain.passes) pp.resize(w, h);
  }
  function dispose(){
    for(const pp of chain.passes) pp.dispose();
    gl.deleteFramebuffer(chain._readBuffer.framebuffer);
    gl.deleteTexture(chain._readBuffer.texture);
    gl.deleteFramebuffer(chain._writeBuffer.framebuffer);
    gl.deleteTexture(chain._writeBuffer.texture);
  }
  return { addPass, begin, end, resize, dispose, chain };
}

/* ===== 调试渲染系统 ===== */
const DebugMode = { NONE: 0, WIREFRAME: 1, NORMALS: 2, UV: 3, POSITION: 4, BONE_WEIGHT: 5, DEPTH: 6, ALBEDO: 7, LIGHTING: 8 };
function createDebugRenderer(gl){
  const dr = {
    mode: DebugMode.NONE,
    enabled: false,
    _lineProgram: null,
    _lineBuffer: null,
    _lineCount: 0,
    _aPos: null,
    _aColor: null,
    _uViewProj: null,
  };
  const vsSrc = 'attribute vec3 aPos; attribute vec3 aColor; uniform mat4 uViewProj; varying vec3 vColor; void main(){ vColor=aColor; gl_Position=uViewProj*vec4(aPos,1.0); }';
  const fsSrc = 'precision highp float; varying vec3 vColor; void main(){ gl_FragColor=vec4(vColor,1.0); }';
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  dr._lineProgram = gl.createProgram();
  gl.attachShader(dr._lineProgram, vs);
  gl.attachShader(dr._lineProgram, fs);
  gl.linkProgram(dr._lineProgram);
  dr._aPos = gl.getAttribLocation(dr._lineProgram, 'aPos');
  dr._aColor = gl.getAttribLocation(dr._lineProgram, 'aColor');
  dr._uViewProj = gl.getUniformLocation(dr._lineProgram, 'uViewProj');
  dr._lineBuffer = gl.createBuffer();
  function drawLines(vertices, viewProj, color){
    if(vertices.length === 0) return;
    const data = new Float32Array(vertices.length * 6);
    for(let i=0;i<vertices.length;i++){
      data[i*6]=vertices[i][0]; data[i*6+1]=vertices[i][1]; data[i*6+2]=vertices[i][2];
      data[i*6+3]=color[0]; data[i*6+4]=color[1]; data[i*6+5]=color[2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.useProgram(dr._lineProgram);
    gl.uniformMatrix4fv(dr._uViewProj, false, viewProj);
    gl.enableVertexAttribArray(dr._aPos);
    gl.vertexAttribPointer(dr._aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(dr._aColor);
    gl.vertexAttribPointer(dr._aColor, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.LINES, 0, vertices.length);
  }
  function drawAABB(aabb, viewProj, color){
    const c = color || [1,1,0];
    const v = [];
    const corners = AABB.corners(aabb);
    const edges = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    for(const e of edges){ v.push(corners[e[0]], corners[e[1]]); }
    drawLines(v, viewProj, c);
  }
  function drawSphere(sphere, viewProj, color, segments){
    const c = color || [0,1,1];
    const seg = segments || 16;
    const v = [];
    for(let i=0;i<seg;i++){
      const a1 = (i/seg)*Math.PI*2, a2 = ((i+1)/seg)*Math.PI*2;
      v.push([sphere.center[0]+Math.cos(a1)*sphere.radius, sphere.center[1], sphere.center[2]+Math.sin(a1)*sphere.radius]);
      v.push([sphere.center[0]+Math.cos(a2)*sphere.radius, sphere.center[1], sphere.center[2]+Math.sin(a2)*sphere.radius]);
      v.push([sphere.center[0]+Math.cos(a1)*sphere.radius, sphere.center[1]+Math.sin(a1)*sphere.radius, sphere.center[2]]);
      v.push([sphere.center[0]+Math.cos(a2)*sphere.radius, sphere.center[1]+Math.sin(a2)*sphere.radius, sphere.center[2]]);
    }
    drawLines(v, viewProj, c);
  }
  function drawBone(boneSystem, boneIndex, viewProj, color){
    const b = boneSystem.bones[boneIndex];
    if(!b) return;
    const c = color || [1,0,0];
    const pos = b.position;
    const v = [pos];
    if(b.parent >= 0 && boneSystem.bones[b.parent]){
      v.push(boneSystem.bones[b.parent].position);
    } else {
      v.push([pos[0], pos[1]+0.5, pos[2]]);
    }
    drawLines(v, viewProj, c);
  }
  function drawSkeleton(boneSystem, viewProj){
    for(let i=0;i<boneSystem.bones.length;i++){
      const hue = i / boneSystem.bones.length;
      const r = Math.sin(hue*6.28)*0.5+0.5;
      const g = Math.sin(hue*6.28+2.09)*0.5+0.5;
      const b = Math.sin(hue*6.28+4.18)*0.5+0.5;
      drawBone(boneSystem, i, viewProj, [r,g,b]);
    }
  }
  function drawNormals(modelInstance, viewProj, length, color){
    const c = color || [0,1,0];
    const len = length || 0.1;
    const v = [];
    const step = Math.max(1, Math.floor(modelInstance.model.vertexCount / 500));
    for(let i=0;i<modelInstance.model.vertexCount;i+=step){
      const px=modelInstance.model.positions[i*3], py=modelInstance.model.positions[i*3+1], pz=modelInstance.model.positions[i*3+2];
      const nx=modelInstance.model.normals[i*3], ny=modelInstance.model.normals[i*3+1], nz=modelInstance.model.normals[i*3+2];
      v.push([px,py,pz], [px+nx*len, py+ny*len, pz+nz*len]);
    }
    drawLines(v, viewProj, c);
  }
  function drawGrid(viewProj, size, divisions, color){
    const s = size || 10, d = divisions || 10;
    const c = color || [0.3,0.3,0.3];
    const v = [];
    const step = s/d;
    for(let i=0;i<=d;i++){
      const p = -s/2 + i*step;
      v.push([p,0,-s/2],[p,0,s/2]);
      v.push([-s/2,0,p],[s/2,0,p]);
    }
    drawLines(v, viewProj, c);
  }
  function dispose(){
    gl.deleteBuffer(dr._lineBuffer);
    gl.deleteProgram(dr._lineProgram);
  }
  console.log('[DebugRenderer] 创建完成');
  return { drawLines, drawAABB, drawSphere, drawBone, drawSkeleton, drawNormals, drawGrid, dispose, dr };
}

/* ===== 场景图系统 ===== */
const NodeType = { ROOT: 0, MESH: 1, LIGHT: 2, CAMERA: 3, GROUP: 4, PARTICLE: 5, EMPTY: 6 };
function createSceneNode(type, name){
  const node = {
    type: type,
    name: name || 'node',
    parent: null,
    children: [],
    position: [0,0,0],
    rotation: [0,0,0,1],
    scale: [1,1,1],
    _localMatrix: new Float32Array(16),
    _worldMatrix: new Float32Array(16),
    _worldDirty: true,
    visible: true,
    castShadow: true,
    receiveShadow: true,
    userData: {},
    mesh: null,
    light: null,
    camera: null,
    boundingBox: null,
    boundingSphere: null,
  };
  M4.identity(node._localMatrix);
  M4.identity(node._worldMatrix);
  return node;
}
function nodeAddChild(parent, child){
  if(child.parent) nodeRemoveChild(child.parent, child);
  parent.children.push(child);
  child.parent = parent;
  child._worldDirty = true;
  return child;
}
function nodeRemoveChild(parent, child){
  const idx = parent.children.indexOf(child);
  if(idx >= 0){ parent.children.splice(idx,1); child.parent = null; child._worldDirty = true; }
  return child;
}
function nodeUpdateLocalMatrix(node){
  M4.fromTRS(node._localMatrix, node.position, node.rotation, node.scale);
  node._worldDirty = true;
}
function nodeUpdateWorldMatrix(node, parentWorldMatrix){
  if(node._worldDirty || parentWorldMatrix){
    nodeUpdateLocalMatrix(node);
    if(parentWorldMatrix){
      M4.mult(node._worldMatrix, parentWorldMatrix, node._localMatrix);
    } else {
      M4.copy(node._worldMatrix, node._localMatrix);
    }
    node._worldDirty = false;
  }
  for(let i=0;i<node.children.length;i++){
    nodeUpdateWorldMatrix(node.children[i], node._worldMatrix);
  }
}
function nodeGetWorldPosition(node, out){
  out[0]=node._worldMatrix[12]; out[1]=node._worldMatrix[13]; out[2]=node._worldMatrix[14]; return out;
}
function nodeGetWorldRotation(node, out){
  const m=node._worldMatrix;
  const trace=m[0]+m[5]+m[10];
  if(trace>0){ const s=0.5/Math.sqrt(trace+1); out[3]=0.25/s; out[0]=(m[6]-m[9])*s; out[1]=(m[8]-m[2])*s; out[2]=(m[1]-m[4])*s; }
  else if(m[0]>m[5]&&m[0]>m[10]){ const s=2*Math.sqrt(1+m[0]-m[5]-m[10]); out[3]=(m[6]-m[9])/s; out[0]=0.25*s; out[1]=(m[1]+m[4])/s; out[2]=(m[8]+m[2])/s; }
  else if(m[5]>m[10]){ const s=2*Math.sqrt(1+m[5]-m[0]-m[10]); out[3]=(m[8]-m[2])/s; out[0]=(m[1]+m[4])/s; out[1]=0.25*s; out[2]=(m[6]+m[9])/s; }
  else { const s=2*Math.sqrt(1+m[10]-m[0]-m[5]); out[3]=(m[1]-m[4])/s; out[0]=(m[8]+m[2])/s; out[1]=(m[6]+m[9])/s; out[2]=0.25*s; }
  return out;
}
function nodeGetWorldScale(node, out){
  const m=node._worldMatrix;
  out[0]=Math.sqrt(m[0]*m[0]+m[1]*m[1]+m[2]*m[2]);
  out[1]=Math.sqrt(m[4]*m[4]+m[5]*m[5]+m[6]*m[6]);
  out[2]=Math.sqrt(m[8]*m[8]+m[9]*m[9]+m[10]*m[10]);
  return out;
}
function nodeTraverse(node, callback, order){
  if(order === 'postorder'){
    for(let i=0;i<node.children.length;i++) nodeTraverse(node.children[i], callback, order);
    callback(node);
  } else {
    callback(node);
    for(let i=0;i<node.children.length;i++) nodeTraverse(node.children[i], callback, order);
  }
}
function nodeFindByName(root, name){
  let result = null;
  nodeTraverse(root, (n)=>{ if(n.name===name && !result) result=n; });
  return result;
}
function nodeFindByType(root, type){
  const result = [];
  nodeTraverse(root, (n)=>{ if(n.type===type) result.push(n); });
  return result;
}
function nodeComputeBoundingBox(node){
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  nodeTraverse(node, (n)=>{
    if(n.boundingBox){
      const wp=[0,0,0]; nodeGetWorldPosition(n, wp);
      min[0]=Math.min(min[0], wp[0]+n.boundingBox.min[0]);
      min[1]=Math.min(min[1], wp[1]+n.boundingBox.min[1]);
      min[2]=Math.min(min[2], wp[2]+n.boundingBox.min[2]);
      max[0]=Math.max(max[0], wp[0]+n.boundingBox.max[0]);
      max[1]=Math.max(max[1], wp[1]+n.boundingBox.max[1]);
      max[2]=Math.max(max[2], wp[2]+n.boundingBox.max[2]);
    }
  });
  return {min, max};
}
function createScene(){
  const scene = createSceneNode(NodeType.ROOT, 'scene');
  scene.ambientLight = [0.3,0.3,0.3];
  scene.fog = { enabled: false, color: [0,0,0], near: 1, far: 100, density: 0.01 };
  scene.background = [0,0,0,0];
  scene._lights = [];
  scene._cameras = [];
  scene._meshes = [];
  function add(node){ nodeAddChild(scene, node); if(node.type===NodeType.LIGHT) scene._lights.push(node); if(node.type===NodeType.CAMERA) scene._cameras.push(node); if(node.type===NodeType.MESH) scene._meshes.push(node); return node; }
  function remove(node){ nodeRemoveChild(scene, node); const li=scene._lights.indexOf(node); if(li>=0)scene._lights.splice(li,1); const ci=scene._cameras.indexOf(node); if(ci>=0)scene._cameras.splice(ci,1); const mi=scene._meshes.indexOf(node); if(mi>=0)scene._meshes.splice(mi,1); return node; }
  function update(){ nodeUpdateWorldMatrix(scene, null); }
  function getLights(){ return scene._lights; }
  function getCameras(){ return scene._cameras; }
  function getMeshes(){ return scene._meshes; }
  return { scene, add, remove, update, getLights, getCameras, getMeshes, root: scene };
}

/* ===== 资源管理系统 ===== */
function createResourceManager(){
  const rm = {
    _cache: new Map(),
    _loading: new Map(),
    _loaders: {},
    _baseUrl: '',
    maxCacheSize: 100,
  };
  function registerLoader(type, loader){ rm._loaders[type] = loader; }
  function setBaseUrl(url){ rm._baseUrl = url; }
  function getCacheKey(type, url){ return type + ':' + url; }
  async function load(type, url, options){
    const key = getCacheKey(type, url);
    if(rm._cache.has(key)) return rm._cache.get(key);
    if(rm._loading.has(key)) return rm._loading.get(key);
    const loader = rm._loaders[type];
    if(!loader) throw new Error('未知资源类型: ' + type);
    const fullUrl = rm._baseUrl + url;
    const promise = loader(fullUrl, options).then((resource)=>{
      rm._cache.set(key, resource);
      rm._loading.delete(key);
      if(rm._cache.size > rm.maxCacheSize){
        const firstKey = rm._cache.keys().next().value;
        rm._cache.delete(firstKey);
      }
      return resource;
    }).catch((e)=>{
      rm._loading.delete(key);
      throw e;
    });
    rm._loading.set(key, promise);
    return promise;
  }
  function get(type, url){
    const key = getCacheKey(type, url);
    return rm._cache.get(key) || null;
  }
  function has(type, url){
    const key = getCacheKey(type, url);
    return rm._cache.has(key);
  }
  function release(type, url){
    const key = getCacheKey(type, url);
    const resource = rm._cache.get(key);
    if(resource && resource.dispose) resource.dispose();
    rm._cache.delete(key);
  }
  function clear(){
    for(const [key, resource] of rm._cache){
      if(resource && resource.dispose) resource.dispose();
    }
    rm._cache.clear();
    rm._loading.clear();
  }
  function getCacheInfo(){
    return {
      cached: rm._cache.size,
      loading: rm._loading.size,
      maxSize: rm.maxCacheSize,
      types: Object.keys(rm._loaders),
    };
  }
  registerLoader('pmx', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('PMX加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parsePMX(buf);
  });
  registerLoader('pmd', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('PMD加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parsePMD(buf);
  });
  registerLoader('vmd', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('VMD加载失败: '+resp.status);
    const buf = await resp.arrayBuffer();
    return parseVMD(buf);
  });
  registerLoader('texture', async (url, gl)=>{
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = ()=>{
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        resolve(tex);
      };
      img.onerror = ()=>reject(new Error('纹理加载失败: '+url));
      img.src = url;
    });
  });
  registerLoader('json', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('JSON加载失败: '+resp.status);
    return resp.json();
  });
  registerLoader('text', async (url)=>{
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('文本加载失败: '+resp.status);
    return resp.text();
  });
  console.log('[ResourceManager] 创建完成 内置加载器: pmx,pmd,vmd,texture,json,text');
  return { load, get, has, release, clear, registerLoader, setBaseUrl, getCacheInfo, rm };
}

/* ===== 物理系统（简化刚体动力学） ===== */
const BodyType = { STATIC: 0, DYNAMIC: 1, KINEMATIC: 2 };
const ShapeType = { SPHERE: 0, BOX: 1, CAPSULE: 2, PLANE: 3, MESH: 4 };
function createRigidBody(options){
  const opt = options || {};
  return {
    type: opt.type !== undefined ? opt.type : BodyType.DYNAMIC,
    shape: opt.shape || ShapeType.SPHERE,
    position: opt.position ? opt.position.slice() : [0,0,0],
    rotation: opt.rotation ? opt.rotation.slice() : [0,0,0,1],
    linearVelocity: [0,0,0],
    angularVelocity: [0,0,0],
    force: [0,0,0],
    torque: [0,0,0],
    mass: opt.mass !== undefined ? opt.mass : 1,
    invMass: opt.mass ? 1/opt.mass : 0,
    inertia: opt.inertia ? opt.inertia.slice() : [1,1,1],
    invInertia: opt.inertia ? [1/opt.inertia[0],1/opt.inertia[1],1/opt.inertia[2]] : [0,0,0],
    restitution: opt.restitution !== undefined ? opt.restitution : 0.5,
    friction: opt.friction !== undefined ? opt.friction : 0.5,
    linearDamping: opt.linearDamping !== undefined ? opt.linearDamping : 0.01,
    angularDamping: opt.angularDamping !== undefined ? opt.angularDamping : 0.01,
    radius: opt.radius || 0.5,
    halfExtents: opt.halfExtents ? opt.halfExtents.slice() : [0.5,0.5,0.5],
    height: opt.height || 1,
    awake: true,
    sleepThreshold: 0.1,
    sleepTimer: 0,
    userData: {},
    _collisionFilter: opt.collisionFilter || 0xFFFF,
    _collisionMask: opt.collisionMask || 0xFFFF,
  };
}
function createPhysicsWorld(options){
  const opt = options || {};
  const world = {
    bodies: [],
    gravity: opt.gravity ? opt.gravity.slice() : [0,-9.8,0],
    timeStep: opt.timeStep || 1/60,
    maxSubSteps: opt.maxSubSteps || 4,
    _accumulator: 0,
    _broadphase: 'brute',
    _contactPairs: [],
  };
  function addBody(body){ world.bodies.push(body); return body; }
  function removeBody(body){
    const idx = world.bodies.indexOf(body);
    if(idx >= 0) world.bodies.splice(idx,1);
    return body;
  }
  function applyForce(body, force, point){
    if(body.type !== BodyType.DYNAMIC) return;
    body.force[0] += force[0]; body.force[1] += force[1]; body.force[2] += force[2];
    if(point){
      const r=[point[0]-body.position[0],point[1]-body.position[1],point[2]-body.position[2]];
      body.torque[0] += r[1]*force[2]-r[2]*force[1];
      body.torque[1] += r[2]*force[0]-r[0]*force[2];
      body.torque[2] += r[0]*force[1]-r[1]*force[0];
    }
    body.awake = true;
  }
  function applyImpulse(body, impulse, point){
    if(body.type !== BodyType.DYNAMIC) return;
    body.linearVelocity[0] += impulse[0]*body.invMass;
    body.linearVelocity[1] += impulse[1]*body.invMass;
    body.linearVelocity[2] += impulse[2]*body.invMass;
    if(point){
      const r=[point[0]-body.position[0],point[1]-body.position[1],point[2]-body.position[2]];
      const t=[r[1]*impulse[2]-r[2]*impulse[1], r[2]*impulse[0]-r[0]*impulse[2], r[0]*impulse[1]-r[1]*impulse[0]];
      body.angularVelocity[0] += t[0]*body.invInertia[0];
      body.angularVelocity[1] += t[1]*body.invInertia[1];
      body.angularVelocity[2] += t[2]*body.invInertia[2];
    }
    body.awake = true;
  }
  function sphereSphereCollision(a, b){
    const dx=b.position[0]-a.position[0], dy=b.position[1]-a.position[1], dz=b.position[2]-a.position[2];
    const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
    const minDist=a.radius+b.radius;
    if(dist >= minDist) return null;
    const nx=dist>0?dx/dist:1, ny=dist>0?dy/dist:0, nz=dist>0?dz/dist:0;
    return { normal:[nx,ny,nz], penetration:minDist-dist, contactPoint:[a.position[0]+nx*a.radius, a.position[1]+ny*a.radius, a.position[2]+nz*a.radius] };
  }
  function boxBoxCollision(a, b){
    const dx=b.position[0]-a.position[0], dy=b.position[1]-a.position[1], dz=b.position[2]-a.position[2];
    const overlapX=a.halfExtents[0]+b.halfExtents[0]-Math.abs(dx);
    const overlapY=a.halfExtents[1]+b.halfExtents[1]-Math.abs(dy);
    const overlapZ=a.halfExtents[2]+b.halfExtents[2]-Math.abs(dz);
    if(overlapX<=0||overlapY<=0||overlapZ<=0) return null;
    let normal=[0,0,0], penetration=0;
    if(overlapX<overlapY&&overlapX<overlapZ){ normal=[dx>0?1:-1,0,0]; penetration=overlapX; }
    else if(overlapY<overlapZ){ normal=[0,dy>0?1:-1,0]; penetration=overlapY; }
    else { normal=[0,0,dz>0?1:-1]; penetration=overlapZ; }
    return { normal, penetration, contactPoint:[(a.position[0]+b.position[0])/2,(a.position[1]+b.position[1])/2,(a.position[2]+b.position[2])/2] };
  }
  function detectCollision(a, b){
    if(a.shape===ShapeType.SPHERE && b.shape===ShapeType.SPHERE) return sphereSphereCollision(a,b);
    if(a.shape===ShapeType.BOX && b.shape===ShapeType.BOX) return boxBoxCollision(a,b);
    if(a.shape===ShapeType.SPHERE && b.shape===ShapeType.BOX){
      const closest=[Math.max(b.position[0]-b.halfExtents[0],Math.min(a.position[0],b.position[0]+b.halfExtents[0])),
                     Math.max(b.position[1]-b.halfExtents[1],Math.min(a.position[1],b.position[1]+b.halfExtents[1])),
                     Math.max(b.position[2]-b.halfExtents[2],Math.min(a.position[2],b.position[2]+b.halfExtents[2]))];
      const dx=a.position[0]-closest[0], dy=a.position[1]-closest[1], dz=a.position[2]-closest[2];
      const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(dist>=a.radius) return null;
      const nx=dist>0?dx/dist:0, ny=dist>0?dy/dist:1, nz=dist>0?dz/dist:0;
      return { normal:[nx,ny,nz], penetration:a.radius-dist, contactPoint:closest };
    }
    if(a.shape===ShapeType.BOX && b.shape===ShapeType.SPHERE){
      const c = detectCollision(b,a);
      if(c) c.normal = [-c.normal[0],-c.normal[1],-c.normal[2]];
      return c;
    }
    return null;
  }
  function resolveCollision(a, b, contact){
    if(a.type===BodyType.STATIC && b.type===BodyType.STATIC) return;
    const rv=[b.linearVelocity[0]-a.linearVelocity[0], b.linearVelocity[1]-a.linearVelocity[1], b.linearVelocity[2]-a.linearVelocity[2]];
    const velAlongNormal=rv[0]*contact.normal[0]+rv[1]*contact.normal[1]+rv[2]*contact.normal[2];
    if(velAlongNormal > 0) return;
    const e=Math.min(a.restitution, b.restitution);
    const j=-(1+e)*velAlongNormal/(a.invMass+b.invMass);
    const impulse=[j*contact.normal[0], j*contact.normal[1], j*contact.normal[2]];
    if(a.type===BodyType.DYNAMIC){ a.linearVelocity[0]-=impulse[0]*a.invMass; a.linearVelocity[1]-=impulse[1]*a.invMass; a.linearVelocity[2]-=impulse[2]*a.invMass; a.awake=true; }
    if(b.type===BodyType.DYNAMIC){ b.linearVelocity[0]+=impulse[0]*b.invMass; b.linearVelocity[1]+=impulse[1]*b.invMass; b.linearVelocity[2]+=impulse[2]*b.invMass; b.awake=true; }
    const percent=0.8, slop=0.01;
    const correction=Math.max(contact.penetration-slop,0)/(a.invMass+b.invMass)*percent;
    if(a.type===BodyType.DYNAMIC){ a.position[0]-=correction*contact.normal[0]*a.invMass; a.position[1]-=correction*contact.normal[1]*a.invMass; a.position[2]-=correction*contact.normal[2]*a.invMass; }
    if(b.type===BodyType.DYNAMIC){ b.position[0]+=correction*contact.normal[0]*b.invMass; b.position[1]+=correction*contact.normal[1]*b.invMass; b.position[2]+=correction*contact.normal[2]*b.invMass; }
  }
  function step(dt){
    world._accumulator += dt;
    let steps = 0;
    while(world._accumulator >= world.timeStep && steps < world.maxSubSteps){
      stepInternal(world.timeStep);
      world._accumulator -= world.timeStep;
      steps++;
    }
  }
  function stepInternal(dt){
    for(const body of world.bodies){
      if(body.type !== BodyType.DYNAMIC || !body.awake) continue;
      body.force[0] += world.gravity[0]*body.mass;
      body.force[1] += world.gravity[1]*body.mass;
      body.force[2] += world.gravity[2]*body.mass;
      body.linearVelocity[0] += body.force[0]*body.invMass*dt;
      body.linearVelocity[1] += body.force[1]*body.invMass*dt;
      body.linearVelocity[2] += body.force[2]*body.invMass*dt;
      body.angularVelocity[0] += body.torque[0]*body.invInertia[0]*dt;
      body.angularVelocity[1] += body.torque[1]*body.invInertia[1]*dt;
      body.angularVelocity[2] += body.torque[2]*body.invInertia[2]*dt;
      const ld=1-body.linearDamping, ad=1-body.angularDamping;
      body.linearVelocity[0]*=ld; body.linearVelocity[1]*=ld; body.linearVelocity[2]*=ld;
      body.angularVelocity[0]*=ad; body.angularVelocity[1]*=ad; body.angularVelocity[2]*=ad;
      body.position[0]+=body.linearVelocity[0]*dt;
      body.position[1]+=body.linearVelocity[1]*dt;
      body.position[2]+=body.linearVelocity[2]*dt;
      body.force[0]=body.force[1]=body.force[2]=0;
      body.torque[0]=body.torque[1]=body.torque[2]=0;
      const speed=Math.sqrt(body.linearVelocity[0]**2+body.linearVelocity[1]**2+body.linearVelocity[2]**2);
      if(speed < body.sleepThreshold){ body.sleepTimer += dt; if(body.sleepTimer > 0.5) body.awake = false; }
      else { body.sleepTimer = 0; body.awake = true; }
    }
    for(let i=0;i<world.bodies.length;i++){
      for(let j=i+1;j<world.bodies.length;j++){
        const a=world.bodies[i], b=world.bodies[j];
        if(a.type===BodyType.STATIC && b.type===BodyType.STATIC) continue;
        if((a._collisionFilter & b._collisionMask)===0) continue;
        const contact = detectCollision(a,b);
        if(contact) resolveCollision(a,b,contact);
      }
    }
  }
  function clear(){ world.bodies.length = 0; world._accumulator = 0; }
  console.log('[PhysicsWorld] 创建完成 bodies=' + world.bodies.length + ' gravity=' + world.gravity);
  return { addBody, removeBody, applyForce, applyImpulse, step, clear, detectCollision, world };
}

/* ===== IK 反向运动学系统 ===== */
function createIKSolver(boneSystem){
  const solver = {
    boneSystem: boneSystem,
    iterations: 20,
    tolerance: 0.001,
    damping: 0.5,
    _chains: [],
  };
  function createChain(rootBoneIndex, endBoneIndex, targetPosition){
    const bones = [];
    let idx = endBoneIndex;
    while(idx >= 0 && idx !== rootBoneIndex){
      bones.unshift(idx);
      idx = boneSystem.bones[idx].parent;
    }
    if(idx === rootBoneIndex) bones.unshift(rootBoneIndex);
    return {
      root: rootBoneIndex,
      end: endBoneIndex,
      bones: bones,
      target: targetPosition ? targetPosition.slice() : [0,0,0],
      poleTarget: null,
      enabled: true,
      weight: 1,
    };
  }
  function addChain(rootBoneIndex, endBoneIndex, targetPosition){
    const chain = createChain(rootBoneIndex, endBoneIndex, targetPosition);
    solver._chains.push(chain);
    return chain;
  }
  function removeChain(chain){
    const idx = solver._chains.indexOf(chain);
    if(idx >= 0) solver._chains.splice(idx,1);
  }
  function getBoneWorldPosition(boneIndex, palette, out){
    const m = palette;
    const off = boneIndex*16;
    out[0] = m[off+12];
    out[1] = m[off+13];
    out[2] = m[off+14];
    return out;
  }
  function solveFABRIK(chain, palette){
    const bones = chain.bones;
    const n = bones.length;
    if(n < 2) return;
    const positions = new Array(n);
    const lengths = new Array(n-1);
    for(let i=0;i<n;i++){
      positions[i] = getBoneWorldPosition(bones[i], palette, [0,0,0]);
    }
    for(let i=0;i<n-1;i++){
      lengths[i] = V3.dist(positions[i], positions[i+1]);
    }
    const target = chain.target;
    const origin = positions[0].slice();
    for(let iter=0; iter<solver.iterations; iter++){
      let dist = V3.dist(positions[n-1], target);
      if(dist < solver.tolerance) break;
      positions[n-1] = target.slice();
      for(let i=n-2;i>=0;i--){
        const dir = [positions[i][0]-positions[i+1][0], positions[i][1]-positions[i+1][1], positions[i][2]-positions[i+1][2]];
        const l = Math.sqrt(dir[0]**2+dir[1]**2+dir[2]**2)||1;
        positions[i] = [positions[i+1][0]+dir[0]/l*lengths[i], positions[i+1][1]+dir[1]/l*lengths[i], positions[i+1][2]+dir[2]/l*lengths[i]];
      }
      positions[0] = origin.slice();
      for(let i=1;i<n;i++){
        const dir = [positions[i][0]-positions[i-1][0], positions[i][1]-positions[i-1][1], positions[i][2]-positions[i-1][2]];
        const l = Math.sqrt(dir[0]**2+dir[1]**2+dir[2]**2)||1;
        positions[i] = [positions[i-1][0]+dir[0]/l*lengths[i-1], positions[i-1][1]+dir[1]/l*lengths[i-1], positions[i-1][2]+dir[2]/l*lengths[i-1]];
      }
    }
    return positions;
  }
  function solveCCD(chain, poseRotations){
    const bones = chain.bones;
    const n = bones.length;
    if(n < 2) return;
    const target = chain.target;
    for(let iter=0; iter<solver.iterations; iter++){
      const endPos = getBoneWorldPosition(bones[n-1], boneSystem.palette, [0,0,0]);
      let dist = V3.dist(endPos, target);
      if(dist < solver.tolerance) break;
      for(let i=n-2;i>=0;i--){
        const bonePos = getBoneWorldPosition(bones[i], boneSystem.palette, [0,0,0]);
        const toEnd = [endPos[0]-bonePos[0], endPos[1]-bonePos[1], endPos[2]-bonePos[2]];
        const toTarget = [target[0]-bonePos[0], target[1]-bonePos[1], target[2]-bonePos[2]];
        const cross = [toEnd[1]*toTarget[2]-toEnd[2]*toTarget[1], toEnd[2]*toTarget[0]-toEnd[0]*toTarget[2], toEnd[0]*toTarget[1]-toEnd[1]*toTarget[0]];
        const dot = toEnd[0]*toTarget[0]+toEnd[1]*toTarget[1]+toEnd[2]*toTarget[2];
        const l1=Math.sqrt(toEnd[0]**2+toEnd[1]**2+toEnd[2]**2)||1;
        const l2=Math.sqrt(toTarget[0]**2+toTarget[1]**2+toTarget[2]**2)||1;
        const cosAngle = Math.max(-1, Math.min(1, dot/(l1*l2)));
        const angle = Math.acos(cosAngle) * solver.damping;
        if(angle < 0.0001) continue;
        const cl=Math.sqrt(cross[0]**2+cross[1]**2+cross[2]**2)||1;
        const axis=[cross[0]/cl, cross[1]/cl, cross[2]/cl];
        const halfAngle=angle*0.5;
        const s=Math.sin(halfAngle);
        const deltaQ=[axis[0]*s, axis[1]*s, axis[2]*s, Math.cos(halfAngle)];
        const curQ = poseRotations[bones[i]] || [0,0,0,1];
        const newQ=[0,0,0,1];
        Q.mult(newQ, deltaQ, curQ);
        poseRotations[bones[i]] = newQ;
        boneSystem.computePalette(poseRotations, null);
      }
    }
  }
  function solve(poseRotations){
    for(const chain of solver._chains){
      if(!chain.enabled) continue;
      solveCCD(chain, poseRotations);
    }
  }
  function clear(){ solver._chains.length = 0; }
  console.log('[IKSolver] 创建完成 bones=' + boneSystem.bones.length);
  return { addChain, removeChain, solve, clear, solver };
}

/* ===== 粒子系统 ===== */
const EmitterType = { POINT: 0, SPHERE: 1, BOX: 2, CONE: 3, CIRCLE: 4 };
function createParticleSystem(gl, maxParticles, options){
  const opt = options || {};
  const ps = {
    gl: gl,
    maxParticles: maxParticles,
    particles: [],
    _positionData: new Float32Array(maxParticles*3),
    _colorData: new Float32Array(maxParticles*4),
    _sizeData: new Float32Array(maxParticles),
    _positionBuffer: null,
    _colorBuffer: null,
    _sizeBuffer: null,
    _program: null,
    _texture: opt.texture || null,
    emitters: [],
    gravity: opt.gravity ? opt.gravity.slice() : [0,-9.8,0],
    wind: opt.wind ? opt.wind.slice() : [0,0,0],
    globalDamping: opt.globalDamping !== undefined ? opt.globalDamping : 0.98,
    blending: opt.blending !== undefined ? opt.blending : true,
    depthWrite: opt.depthWrite !== undefined ? opt.depthWrite : false,
    _activeCount: 0,
  };
  ps._positionBuffer = gl.createBuffer();
  ps._colorBuffer = gl.createBuffer();
  ps._sizeBuffer = gl.createBuffer();
  const vsSrc = 'attribute vec3 aPos; attribute vec4 aColor; attribute float aSize; uniform mat4 uViewProj; varying vec4 vColor; void main(){ vColor=aColor; vec4 p=uViewProj*vec4(aPos,1.0); gl_Position=p; gl_PointSize=aSize/p.w*100.0; }';
  const fsSrc = 'precision highp float; varying vec4 vColor; uniform sampler2D uTex; uniform int uHasTex; void main(){ if(uHasTex==1){ vec4 t=texture2D(uTex,gl_PointCoord); gl_FragColor=vColor*t; if(gl_FragColor.a<0.01) discard; } else { vec2 d=gl_PointCoord-0.5; float r=dot(d,d); if(r>0.25) discard; gl_FragColor=vColor; } }';
  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }
  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
  ps._program = gl.createProgram();
  gl.attachShader(ps._program, vs);
  gl.attachShader(ps._program, fs);
  gl.linkProgram(ps._program);
  ps._aPos = gl.getAttribLocation(ps._program, 'aPos');
  ps._aColor = gl.getAttribLocation(ps._program, 'aColor');
  ps._aSize = gl.getAttribLocation(ps._program, 'aSize');
  ps._uViewProj = gl.getUniformLocation(ps._program, 'uViewProj');
  ps._uTex = gl.getUniformLocation(ps._program, 'uTex');
  ps._uHasTex = gl.getUniformLocation(ps._program, 'uHasTex');
  function createParticle(position, velocity, color, size, life){
    return {
      position: position ? position.slice() : [0,0,0],
      velocity: velocity ? velocity.slice() : [0,0,0],
      color: color ? color.slice() : [1,1,1,1],
      size: size || 1,
      life: life || 1,
      maxLife: life || 1,
      alive: true,
    };
  }
  function createEmitter(type, position, options){
    const opt = options || {};
    return {
      type: type,
      position: position ? position.slice() : [0,0,0],
      rotation: opt.rotation ? opt.rotation.slice() : [0,0,0],
      rate: opt.rate || 10,
      _accumulator: 0,
      life: opt.life || 1,
      size: opt.size || 1,
      sizeVariation: opt.sizeVariation || 0,
      speed: opt.speed || 1,
      speedVariation: opt.speedVariation || 0,
      color: opt.color ? opt.color.slice() : [1,1,1,1],
      colorVariation: opt.colorVariation || 0,
      spread: opt.spread || 0.5,
      radius: opt.radius || 1,
      halfExtents: opt.halfExtents ? opt.halfExtents.slice() : [1,1,1],
      angle: opt.angle || Math.PI/4,
      enabled: true,
    };
  }
  function addEmitter(emitter){ ps.emitters.push(emitter); return emitter; }
  function removeEmitter(emitter){
    const idx = ps.emitters.indexOf(emitter);
    if(idx >= 0) ps.emitters.splice(idx,1);
  }
  function emitParticle(emitter){
    let pos = [0,0,0], vel = [0,0,0];
    if(emitter.type === EmitterType.POINT){
      pos = emitter.position.slice();
      const theta = Math.random()*Math.PI*2;
      const phi = Math.acos(2*Math.random()-1);
      vel = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
    } else if(emitter.type === EmitterType.SPHERE){
      const theta = Math.random()*Math.PI*2;
      const phi = Math.acos(2*Math.random()-1);
      const r = emitter.radius*Math.cbrt(Math.random());
      pos = [emitter.position[0]+r*Math.sin(phi)*Math.cos(theta), emitter.position[1]+r*Math.cos(phi), emitter.position[2]+r*Math.sin(phi)*Math.sin(theta)];
      vel = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
    } else if(emitter.type === EmitterType.BOX){
      pos = [emitter.position[0]+(Math.random()*2-1)*emitter.halfExtents[0], emitter.position[1]+(Math.random()*2-1)*emitter.halfExtents[1], emitter.position[2]+(Math.random()*2-1)*emitter.halfExtents[2]];
      vel = [0,1,0];
    } else if(emitter.type === EmitterType.CONE){
      const theta = Math.random()*Math.PI*2;
      const r = Math.random()*emitter.radius;
      pos = [emitter.position[0]+r*Math.cos(theta), emitter.position[1], emitter.position[2]+r*Math.sin(theta)];
      const spread = emitter.spread;
      vel = [(Math.random()*2-1)*spread, 1, (Math.random()*2-1)*spread];
    } else if(emitter.type === EmitterType.CIRCLE){
      const theta = Math.random()*Math.PI*2;
      pos = [emitter.position[0]+Math.cos(theta)*emitter.radius, emitter.position[1], emitter.position[2]+Math.sin(theta)*emitter.radius];
      vel = [0,1,0];
    }
    const speed = emitter.speed + (Math.random()*2-1)*emitter.speedVariation;
    vel[0]*=speed; vel[1]*=speed; vel[2]*=speed;
    const vl=Math.sqrt(vel[0]**2+vel[1]**2+vel[2]**2)||1;
    vel[0]/=vl; vel[1]/=vl; vel[2]/=vl;
    vel[0]*=speed; vel[1]*=speed; vel[2]*=speed;
    const color = [
      emitter.color[0]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[1]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[2]+(Math.random()*2-1)*emitter.colorVariation,
      emitter.color[3],
    ];
    const size = emitter.size + (Math.random()*2-1)*emitter.sizeVariation;
    const life = emitter.life;
    if(ps.particles.length < ps.maxParticles){
      ps.particles.push(createParticle(pos, vel, color, size, life));
    }
  }
  function update(dt){
    for(const emitter of ps.emitters){
      if(!emitter.enabled) continue;
      emitter._accumulator += emitter.rate * dt;
      while(emitter._accumulator >= 1){
        emitParticle(emitter);
        emitter._accumulator -= 1;
      }
    }
    for(let i=ps.particles.length-1;i>=0;i--){
      const p = ps.particles[i];
      p.life -= dt;
      if(p.life <= 0){ ps.particles.splice(i,1); continue; }
      p.velocity[0] += ps.gravity[0]*dt;
      p.velocity[1] += ps.gravity[1]*dt;
      p.velocity[2] += ps.gravity[2]*dt;
      p.velocity[0] += ps.wind[0]*dt;
      p.velocity[1] += ps.wind[1]*dt;
      p.velocity[2] += ps.wind[2]*dt;
      p.velocity[0] *= ps.globalDamping;
      p.velocity[1] *= ps.globalDamping;
      p.velocity[2] *= ps.globalDamping;
      p.position[0] += p.velocity[0]*dt;
      p.position[1] += p.velocity[1]*dt;
      p.position[2] += p.velocity[2]*dt;
      p.color[3] = (p.life/p.maxLife) * (p.color[3] || 1);
    }
    ps._activeCount = ps.particles.length;
  }
  function render(viewProj){
    if(ps._activeCount === 0) return;
    gl.useProgram(ps._program);
    gl.uniformMatrix4fv(ps._uViewProj, false, viewProj);
    gl.uniform1i(ps._uHasTex, ps._texture ? 1 : 0);
    if(ps._texture){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ps._texture); gl.uniform1i(ps._uTex, 0); }
    for(let i=0;i<ps._activeCount;i++){
      const p = ps.particles[i];
      ps._positionData[i*3]=p.position[0]; ps._positionData[i*3+1]=p.position[1]; ps._positionData[i*3+2]=p.position[2];
      ps._colorData[i*4]=p.color[0]; ps._colorData[i*4+1]=p.color[1]; ps._colorData[i*4+2]=p.color[2]; ps._colorData[i*4+3]=p.color[3];
      ps._sizeData[i]=p.size;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._positionData.subarray(0,ps._activeCount*3), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aPos);
    gl.vertexAttribPointer(ps._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._colorData.subarray(0,ps._activeCount*4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aColor);
    gl.vertexAttribPointer(ps._aColor, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ps._sizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ps._sizeData.subarray(0,ps._activeCount), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ps._aSize);
    gl.vertexAttribPointer(ps._aSize, 1, gl.FLOAT, false, 0, 0);
    if(ps.blending){ gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    if(!ps.depthWrite) gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, ps._activeCount);
    if(!ps.depthWrite) gl.depthMask(true);
  }
  function clear(){ ps.particles.length = 0; ps._activeCount = 0; }
  function dispose(){
    gl.deleteBuffer(ps._positionBuffer);
    gl.deleteBuffer(ps._colorBuffer);
    gl.deleteBuffer(ps._sizeBuffer);
    gl.deleteProgram(ps._program);
  }
  console.log('[ParticleSystem] 创建完成 maxParticles=' + maxParticles);
  return { update, render, addEmitter, removeEmitter, createEmitter, createParticle, clear, dispose, get activeCount(){return ps._activeCount;}, ps };
}

/* ===== 几何生成系统 ===== */
function createPlaneGeometry(width, height, segmentsW, segmentsH){
  const sw = segmentsW || 1, sh = segmentsH || 1;
  const positions = [], normals = [], uvs = [], indices = [];
  for(let y=0;y<=sh;y++){
    for(let x=0;x<=sw;x++){
      const u=x/sw, v=y/sh;
      positions.push((u-0.5)*width, 0, (v-0.5)*height);
      normals.push(0,1,0);
      uvs.push(u, v);
    }
  }
  for(let y=0;y<sh;y++){
    for(let x=0;x<sw;x++){
      const a=y*(sw+1)+x, b=a+1, c=a+(sw+1), d=c+1;
      indices.push(a,c,b, b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createBoxGeometry(width, height, depth, segmentsW, segmentsH, segmentsD){
  const sw=segmentsW||1, sh=segmentsH||1, sd=segmentsD||1;
  const positions=[], normals=[], uvs=[], indices=[];
  function buildFace(nx,ny,nz, ux,uy,uz, vx,vy,vz, w,h,d, segU, segV){
    const start = positions.length/3;
    for(let y=0;y<=segV;y++){
      for(let x=0;x<=segU;x++){
        const u=x/segU, v=y/segV;
        positions.push(nx*w/2+ux*(u-0.5)*w+vx*(v-0.5)*h, ny*h/2+uy*(u-0.5)*w+vy*(v-0.5)*h, nz*d/2+uz*(u-0.5)*w+vz*(v-0.5)*h);
        normals.push(nx,ny,nz);
        uvs.push(u,v);
      }
    }
    for(let y=0;y<segV;y++){
      for(let x=0;x<segU;x++){
        const a=start+y*(segU+1)+x, b=a+1, c=a+(segU+1), d=c+1;
        indices.push(a,c,b,b,c,d);
      }
    }
  }
  buildFace(0,1,0, 1,0,0, 0,0,1, width,height,depth, sw,sd);
  buildFace(0,-1,0, 1,0,0, 0,0,-1, width,height,depth, sw,sd);
  buildFace(1,0,0, 0,0,1, 0,1,0, width,height,depth, sd,sh);
  buildFace(-1,0,0, 0,0,-1, 0,1,0, width,height,depth, sd,sh);
  buildFace(0,0,1, 1,0,0, 0,1,0, width,height,depth, sw,sh);
  buildFace(0,0,-1, -1,0,0, 0,1,0, width,height,depth, sw,sh);
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createSphereGeometry(radius, widthSegments, heightSegments){
  const ws=widthSegments||32, hs=heightSegments||16;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let y=0;y<=hs;y++){
    const v=y/hs, theta=v*Math.PI;
    for(let x=0;x<=ws;x++){
      const u=x/ws, phi=u*Math.PI*2;
      const px=-radius*Math.sin(theta)*Math.cos(phi), py=radius*Math.cos(theta), pz=radius*Math.sin(theta)*Math.sin(phi);
      positions.push(px,py,pz);
      normals.push(px/radius,py/radius,pz/radius);
      uvs.push(u,v);
    }
  }
  for(let y=0;y<hs;y++){
    for(let x=0;x<ws;x++){
      const a=y*(ws+1)+x, b=a+1, c=a+(ws+1), d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createCylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded){
  const rs=radialSegments||32, hs=heightSegments||1;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let y=0;y<=hs;y++){
    const v=y/hs, r=radiusTop+(radiusBottom-radiusTop)*v;
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(r*Math.cos(theta), (v-0.5)*height, r*Math.sin(theta));
      normals.push(Math.cos(theta),0,Math.sin(theta));
      uvs.push(u,v);
    }
  }
  for(let y=0;y<hs;y++){
    for(let x=0;x<rs;x++){
      const a=y*(rs+1)+x, b=a+1, c=a+(rs+1), d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  if(!openEnded){
    const topStart=positions.length/3;
    positions.push(0,height/2,0); normals.push(0,1,0); uvs.push(0.5,0.5);
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(radiusTop*Math.cos(theta),height/2,radiusTop*Math.sin(theta));
      normals.push(0,1,0); uvs.push(Math.cos(theta)*0.5+0.5,Math.sin(theta)*0.5+0.5);
    }
    for(let x=0;x<rs;x++) indices.push(topStart,topStart+x+2,topStart+x+1);
    const bottomStart=positions.length/3;
    positions.push(0,-height/2,0); normals.push(0,-1,0); uvs.push(0.5,0.5);
    for(let x=0;x<=rs;x++){
      const u=x/rs, theta=u*Math.PI*2;
      positions.push(radiusBottom*Math.cos(theta),-height/2,radiusBottom*Math.sin(theta));
      normals.push(0,-1,0); uvs.push(Math.cos(theta)*0.5+0.5,Math.sin(theta)*0.5+0.5);
    }
    for(let x=0;x<rs;x++) indices.push(bottomStart,bottomStart+x+1,bottomStart+x+2);
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function createTorusGeometry(radius, tube, radialSegments, tubularSegments, arc){
  const rs=radialSegments||16, ts=tubularSegments||100, a=arc||Math.PI*2;
  const positions=[], normals=[], uvs=[], indices=[];
  for(let j=0;j<=rs;j++){
    for(let i=0;i<=ts;i++){
      const u=i/ts*a, v=j/rs*Math.PI*2;
      const x=(radius+tube*Math.cos(v))*Math.cos(u), y=tube*Math.sin(v), z=(radius+tube*Math.cos(v))*Math.sin(u);
      positions.push(x,y,z);
      const cx=radius*Math.cos(u), cz=radius*Math.sin(u);
      const nx=x-cx, ny=y, nz=z-cz;
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      normals.push(nx/nl,ny/nl,nz/nl);
      uvs.push(i/ts,j/rs);
    }
  }
  for(let j=1;j<=rs;j++){
    for(let i=1;i<=ts;i++){
      const a=(ts+1)*j+i-1, b=(ts+1)*(j-1)+i-1, c=(ts+1)*(j-1)+i, d=(ts+1)*j+i;
      indices.push(a,b,d,b,c,d);
    }
  }
  return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
}
function computeGeometryNormals(geometry){
  const positions=geometry.positions, indices=geometry.indices;
  const normals=new Float32Array(positions.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const ax=positions[ib]-positions[ia], ay=positions[ib+1]-positions[ia+1], az=positions[ib+2]-positions[ia+2];
    const bx=positions[ic]-positions[ia], by=positions[ic+1]-positions[ia+1], bz=positions[ic+2]-positions[ia+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    normals[ia]+=nx; normals[ia+1]+=ny; normals[ia+2]+=nz;
    normals[ib]+=nx; normals[ib+1]+=ny; normals[ib+2]+=nz;
    normals[ic]+=nx; normals[ic+1]+=ny; normals[ic+2]+=nz;
  }
  for(let i=0;i<normals.length;i+=3){
    const l=Math.sqrt(normals[i]**2+normals[i+1]**2+normals[i+2]**2)||1;
    normals[i]/=l; normals[i+1]/=l; normals[i+2]/=l;
  }
  geometry.normals = normals;
  return geometry;
}
function mergeGeometry(geometries){
  let totalVerts=0, totalIndices=0;
  for(const g of geometries){ totalVerts+=g.vertexCount; totalIndices+=g.indexCount; }
  const positions=new Float32Array(totalVerts*3), normals=new Float32Array(totalVerts*3), uvs=new Float32Array(totalVerts*2), indices=new Uint32Array(totalIndices);
  let vo=0, io=0;
  for(const g of geometries){
    positions.set(g.positions, vo*3);
    if(g.normals) normals.set(g.normals, vo*3);
    if(g.uvs) uvs.set(g.uvs, vo*2);
    for(let i=0;i<g.indexCount;i++) indices[io+i]=g.indices[i]+vo;
    vo+=g.vertexCount; io+=g.indexCount;
  }
  return { positions, normals, uvs, indices, vertexCount:totalVerts, indexCount:totalIndices };
}

/* ===== 动画混合系统 ===== */
const BlendMode = { OVERRIDE: 0, ADDITIVE: 1, MULTIPLY: 2, LERP: 3 };
function createAnimationClip(name, duration, tracks){
  return {
    name: name,
    duration: duration || 0,
    tracks: tracks || [],
    loop: true,
    speed: 1,
    _cache: {},
  };
}
function createAnimationTrack(boneName, type, keyframes){
  return {
    boneName: boneName,
    type: type || 'rotation',
    keyframes: keyframes || [],
    _sorted: false,
  };
}
function createAnimationMixer(boneSystem){
  const bones = boneSystem.bones;
  const boneCount = bones.length;
  const mixer = {
    boneSystem: boneSystem,
    clips: [],
    activeActions: [],
    _poseRotations: new Array(boneCount),
    _posePositions: new Array(boneCount),
    _tempQ: [0,0,0,1],
    _tempPos: [0,0,0],
    time: 0,
  };
  const _identQ = [0,0,0,1];
  for(let i=0;i<boneCount;i++){ mixer._poseRotations[i]=_identQ; mixer._posePositions[i]=bones[i].position; }
  function addClip(clip){ mixer.clips.push(clip); return clip; }
  function removeClip(clip){
    const idx = mixer.clips.indexOf(clip);
    if(idx >= 0) mixer.clips.splice(idx,1);
  }
  function play(clipName, options){
    const opt = options || {};
    const clip = mixer.clips.find(c=>c.name===clipName);
    if(!clip) return null;
    const action = {
      clip: clip,
      time: opt.startTime || 0,
      weight: opt.weight !== undefined ? opt.weight : 1,
      blendMode: opt.blendMode || BlendMode.OVERRIDE,
      loop: opt.loop !== undefined ? opt.loop : clip.loop,
      speed: opt.speed || clip.speed,
      enabled: true,
      _boneMap: {},
    };
    for(const track of clip.tracks){
      const boneIdx = bones.findIndex(b=>b.name===track.boneName);
      if(boneIdx >= 0) action._boneMap[track.boneName] = boneIdx;
    }
    mixer.activeActions.push(action);
    return action;
  }
  function stop(clipName){
    for(let i=mixer.activeActions.length-1;i>=0;i--){
      if(mixer.activeActions[i].clip.name===clipName) mixer.activeActions.splice(i,1);
    }
  }
  function stopAll(){ mixer.activeActions.length = 0; }
  function sampleTrack(track, time, out){
    if(!track._sorted){ track.keyframes.sort((a,b)=>a.time-b.time); track._sorted=true; }
    const kfs = track.keyframes;
    if(kfs.length===0) return null;
    if(time <= kfs[0].time){ if(track.type==='rotation'){out[0]=kfs[0].value[0];out[1]=kfs[0].value[1];out[2]=kfs[0].value[2];out[3]=kfs[0].value[3];} else {out[0]=kfs[0].value[0];out[1]=kfs[0].value[1];out[2]=kfs[0].value[2];} return out; }
    if(time >= kfs[kfs.length-1].time){ const v=kfs[kfs.length-1].value; if(track.type==='rotation'){out[0]=v[0];out[1]=v[1];out[2]=v[2];out[3]=v[3];} else {out[0]=v[0];out[1]=v[1];out[2]=v[2];} return out; }
    let lo=0, hi=kfs.length-1;
    while(lo<=hi){ const mid=(lo+hi)>>1; if(kfs[mid].time===time){ const v=kfs[mid].value; if(track.type==='rotation'){out[0]=v[0];out[1]=v[1];out[2]=v[2];out[3]=v[3];} else {out[0]=v[0];out[1]=v[1];out[2]=v[2];} return out; } if(kfs[mid].time<time) lo=mid+1; else hi=mid-1; }
    const i0=Math.max(0,lo-1), i1=Math.min(kfs.length-1,lo);
    const t=(time-kfs[i0].time)/(kfs[i1].time-kfs[i0].time||1);
    if(track.type==='rotation'){ Q.slerp(out, kfs[i0].value, kfs[i1].value, t); }
    else { out[0]=kfs[i0].value[0]+(kfs[i1].value[0]-kfs[i0].value[0])*t; out[1]=kfs[i0].value[1]+(kfs[i1].value[1]-kfs[i0].value[1])*t; out[2]=kfs[i0].value[2]+(kfs[i1].value[2]-kfs[i0].value[2])*t; }
    return out;
  }
  function update(dt){
    mixer.time += dt;
    for(let i=0;i<boneCount;i++){ mixer._poseRotations[i]=_identQ; mixer._posePositions[i]=bones[i].position; }
    for(const action of mixer.activeActions){
      if(!action.enabled) continue;
      action.time += dt * action.speed;
      if(action.loop && action.clip.duration>0) action.time %= action.clip.duration;
      else if(!action.loop && action.time >= action.clip.duration){ action.enabled=false; continue; }
      for(const track of action.clip.tracks){
        const boneIdx = action._boneMap[track.boneName];
        if(boneIdx === undefined) continue;
        if(track.type==='rotation'){
          const q = sampleTrack(track, action.time, mixer._tempQ);
          if(q){
            if(action.blendMode===BlendMode.OVERRIDE){ mixer._poseRotations[boneIdx] = [q[0],q[1],q[2],q[3]]; }
            else if(action.blendMode===BlendMode.LERP){ const cur=mixer._poseRotations[boneIdx]; Q.slerp(mixer._tempQ, cur, q, action.weight); mixer._poseRotations[boneIdx]=[mixer._tempQ[0],mixer._tempQ[1],mixer._tempQ[2],mixer._tempQ[3]]; }
            else if(action.blendMode===BlendMode.ADDITIVE){ const cur=mixer._poseRotations[boneIdx]; Q.mult(mixer._tempQ, q, cur); mixer._poseRotations[boneIdx]=[mixer._tempQ[0],mixer._tempQ[1],mixer._tempQ[2],mixer._tempQ[3]]; }
          }
        } else if(track.type==='position'){
          const p = sampleTrack(track, action.time, mixer._tempPos);
          if(p){
            if(action.blendMode===BlendMode.OVERRIDE){ mixer._posePositions[boneIdx] = [p[0],p[1],p[2]]; }
            else if(action.blendMode===BlendMode.LERP){ const cur=mixer._posePositions[boneIdx]; mixer._posePositions[boneIdx]=[cur[0]+(p[0]-cur[0])*action.weight, cur[1]+(p[1]-cur[1])*action.weight, cur[2]+(p[2]-cur[2])*action.weight]; }
            else if(action.blendMode===BlendMode.ADDITIVE){ const cur=mixer._posePositions[boneIdx]; mixer._posePositions[boneIdx]=[cur[0]+p[0]*action.weight, cur[1]+p[1]*action.weight, cur[2]+p[2]*action.weight]; }
          }
        }
      }
    }
  }
  function getPose(){ return { rotations: mixer._poseRotations, positions: mixer._posePositions }; }
  function crossFade(fromClipName, toClipName, duration){
    const fromAction = mixer.activeActions.find(a=>a.clip.name===fromClipName);
    if(!fromAction) return play(toClipName);
    const toAction = play(toClipName, {weight:0});
    if(!toAction) return null;
    const startTime = mixer.time;
    const fadeAction = { update: function(dt){ const t=Math.min(1,(mixer.time-startTime)/duration); fromAction.weight=1-t; toAction.weight=t; if(t>=1){ stop(fromClipName); return true; } return false; } };
    mixer._fadeActions = mixer._fadeActions || [];
    mixer._fadeActions.push(fadeAction);
    return toAction;
  }
  console.log('[AnimationMixer] 创建完成 bones=' + boneCount);
  return { addClip, removeClip, play, stop, stopAll, update, getPose, crossFade, mixer };
}

/* ===== 数学工具扩展（噪声、曲线、插值） ===== */
const MathUtil = {
  clamp: (v,min,max)=>Math.max(min,Math.min(max,v)),
  lerp: (a,b,t)=>a+(b-a)*t,
  inverseLerp: (a,b,v)=>(v-a)/(b-a||1),
  remap: (v,a,b,c,d)=>MathUtil.lerp(c,d,MathUtil.inverseLerp(a,b,v)),
  smoothstep: (a,b,x)=>{ const t=MathUtil.clamp((x-a)/(b-a||1),0,1); return t*t*(3-2*t); },
  smootherstep: (a,b,x)=>{ const t=MathUtil.clamp((x-a)/(b-a||1),0,1); return t*t*t*(t*(t*6-15)+10); },
  pingpong: (t,length)=>{ length=length||1; const m=t%(length*2); return m<length?m:length*2-m; },
  deltaAngle: (a,b)=>{ let d=(b-a)%(Math.PI*2); if(d>Math.PI) d-=Math.PI*2; if(d<-Math.PI) d+=Math.PI*2; return d; },
  lerpAngle: (a,b,t)=>a+MathUtil.deltaAngle(a,b)*t,
  moveTowards: (current,target,maxDelta)=>{ if(Math.abs(target-current)<=maxDelta) return target; return current+Math.sign(target-current)*maxDelta; },
  moveTowardsAngle: (current,target,maxDelta)=>{ const d=MathUtil.deltaAngle(current,target); if(Math.abs(d)<=maxDelta) return target; return current+Math.sign(d)*maxDelta; },
  damp: (current,target,lambda,dt)=>MathUtil.lerp(current,target,1-Math.exp(-lambda*dt)),
  dampAngle: (current,target,lambda,dt)=>MathUtil.lerpAngle(current,target,1-Math.exp(-lambda*dt)),
  approach: (current,target,rate)=>current+(target-current)*rate,
  sign: (v)=>v>0?1:v<0?-1:0,
  fract: (v)=>v-Math.floor(v),
  mod: (a,b)=>((a%b)+b)%b,
  wrap: (v,min,max)=>min+MathUtil.mod(v-min,max-min),
  shortestRotation: (a,b)=>{ let d=(b-a)%(Math.PI*2); if(d>Math.PI)d-=Math.PI*2; if(d<-Math.PI)d+=Math.PI*2; return d; },
  bezier: (p0,p1,p2,p3,t)=>{ const u=1-t, tt=t*t, uu=u*u, uuu=uu*u, ttt=tt*t; return uuu*p0+3*uu*t*p1+3*u*tt*p2+ttt*p3; },
  bezierDerivative: (p0,p1,p2,p3,t)=>{ const u=1-t; return 3*u*u*(p1-p0)+6*u*t*(p2-p1)+3*t*t*(p3-p2); },
  quadraticBezier: (p0,p1,p2,t)=>{ const u=1-t; return u*u*p0+2*u*t*p1+t*t*p2; },
  catmullRom: (p0,p1,p2,p3,t)=>{ const t2=t*t,t3=t2*t; return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3); },
  hermite: (p0,t0,p1,t1,t)=>{ const t2=t*t,t3=t2*t; return (2*t3-3*t2+1)*p0+(t3-2*t2+t)*t0+(-2*t3+3*t2)*p1+(t3-t2)*t1; },
  easeInQuad: (t)=>t*t,
  easeOutQuad: (t)=>t*(2-t),
  easeInOutQuad: (t)=>t<0.5?2*t*t:-1+(4-2*t)*t,
  easeInCubic: (t)=>t*t*t,
  easeOutCubic: (t)=>(--t)*t*t+1,
  easeInOutCubic: (t)=>t<0.5?4*t*t*t:(t-1)*(2*t-2)*(2*t-2)+1,
  easeInQuart: (t)=>t*t*t*t,
  easeOutQuart: (t)=>1-(--t)*t*t*t,
  easeInOutQuart: (t)=>t<0.5?8*t*t*t*t:1-8*(--t)*t*t*t,
  easeInQuint: (t)=>t*t*t*t*t,
  easeOutQuint: (t)=>1+(--t)*t*t*t*t,
  easeInOutQuint: (t)=>t<0.5?16*t*t*t*t*t:1+16*(--t)*t*t*t*t,
  easeInSine: (t)=>1-Math.cos(t*Math.PI/2),
  easeOutSine: (t)=>Math.sin(t*Math.PI/2),
  easeInOutSine: (t)=>-(Math.cos(Math.PI*t)-1)/2,
  easeInExpo: (t)=>t===0?0:Math.pow(2,10*(t-1)),
  easeOutExpo: (t)=>t===1?1:1-Math.pow(2,-10*t),
  easeInOutExpo: (t)=>t===0?0:t===1?1:t<0.5?Math.pow(2,20*t-10)/2:(2-Math.pow(2,-20*t+10))/2,
  easeInCirc: (t)=>1-Math.sqrt(1-t*t),
  easeOutCirc: (t)=>Math.sqrt(1-(--t)*t),
  easeInOutCirc: (t)=>t<0.5?(1-Math.sqrt(1-4*t*t))/2:(Math.sqrt(1-(-2*t+2)*(-2*t+2))+1)/2,
  easeInElastic: (t)=>{ if(t===0||t===1)return t; return -Math.pow(2,10*(t-1))*Math.sin((t-1.1)*5*Math.PI); },
  easeOutElastic: (t)=>{ if(t===0||t===1)return t; return Math.pow(2,-10*t)*Math.sin((t-0.1)*5*Math.PI)+1; },
  easeInOutElastic: (t)=>{ if(t===0||t===1)return t; if(t<0.5)return -(Math.pow(2,20*t-10)*Math.sin((20*t-11.125)*Math.PI/4.5))/2; return (Math.pow(2,-20*t+10)*Math.sin((20*t-11.125)*Math.PI/4.5))/2+1; },
  easeInBack: (t)=>{ const s=1.70158; return t*t*((s+1)*t-s); },
  easeOutBack: (t)=>{ const s=1.70158; return (--t)*t*((s+1)*t+s)+1; },
  easeInOutBack: (t)=>{ const s=1.70158*1.525; return t<0.5?(4*t*t*((s+1)*2*t-s))/2:((2*t-2)*(2*t-2)*((s+1)*(t*2-2)+s)+2)/2; },
  easeInBounce: (t)=>1-MathUtil.easeOutBounce(1-t),
  easeOutBounce: (t)=>{ if(t<1/2.75)return 7.5625*t*t; else if(t<2/2.75)return 7.5625*(t-=1.5/2.75)*t+0.75; else if(t<2.5/2.75)return 7.5625*(t-=2.25/2.75)*t+0.9375; else return 7.5625*(t-=2.625/2.75)*t+0.984375; },
  easeInOutBounce: (t)=>t<0.5?(1-MathUtil.easeOutBounce(1-2*t))/2:(1+MathUtil.easeOutBounce(2*t-1))/2,
  randomRange: (min,max)=>min+Math.random()*(max-min),
  randomInt: (min,max)=>Math.floor(min+Math.random()*(max-min+1)),
  randomChoice: (arr)=>arr[Math.floor(Math.random()*arr.length)],
  randomWeighted: (weights)=>{ const total=weights.reduce((a,b)=>a+b,0); let r=Math.random()*total; for(let i=0;i<weights.length;i++){r-=weights[i]; if(r<=0)return i;} return weights.length-1; },
  shuffle: (arr)=>{ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp; } return arr; },
  degToRad: (d)=>d*Math.PI/180,
  radToDeg: (r)=>r*180/Math.PI,
  distance2D: (x1,y1,x2,y2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2),
  distance3D: (x1,y1,z1,x2,y2,z2)=>Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2),
  lerpColor: (c1,c2,t)=>[c1[0]+(c2[0]-c1[0])*t, c1[1]+(c2[1]-c1[1])*t, c1[2]+(c2[2]-c1[2])*t, c1[3]!==undefined?c1[3]+(c2[3]-c1[3])*t:1],
  colorToHex: (r,g,b)=>'#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1),
  hexToColor: (hex)=>{ const n=parseInt(hex.replace('#',''),16); return [(n>>16)&255, (n>>8)&255, n&255]; },
};

/* ===== 噪声函数 ===== */
const Noise = {
  _perm: null,
  _initPerm: function(){
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for(let i=0;i<256;i++) perm[i]=i;
    for(let i=255;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const tmp=perm[i]; perm[i]=perm[j]; perm[j]=tmp; }
    for(let i=0;i<512;i++) p[i]=perm[i&255];
    Noise._perm = p;
  },
  _fade: function(t){ return t*t*t*(t*(t*6-15)+10); },
  _lerp: function(a,b,t){ return a+(b-a)*t; },
  _grad: function(hash,x,y,z){
    const h=hash&15;
    const u=h<8?x:y;
    const v=h<4?y:h===12||h===14?x:z;
    return ((h&1)===0?u:-u)+((h&2)===0?v:-v);
  },
  perlin2: function(x,y){
    if(!Noise._perm) Noise._initPerm();
    const p=Noise._perm;
    const X=Math.floor(x)&255, Y=Math.floor(y)&255;
    x-=Math.floor(x); y-=Math.floor(y);
    const u=Noise._fade(x), v=Noise._fade(y);
    const A=p[X]+Y, B=p[X+1]+Y;
    return Noise._lerp(Noise._lerp(Noise._grad(p[A],x,y,0), Noise._grad(p[B],x-1,y,0), u), Noise._lerp(Noise._grad(p[A+1],x,y-1,0), Noise._grad(p[B+1],x-1,y-1,0), u), v);
  },
  perlin3: function(x,y,z){
    if(!Noise._perm) Noise._initPerm();
    const p=Noise._perm;
    const X=Math.floor(x)&255, Y=Math.floor(y)&255, Z=Math.floor(z)&255;
    x-=Math.floor(x); y-=Math.floor(y); z-=Math.floor(z);
    const u=Noise._fade(x), v=Noise._fade(y), w=Noise._fade(z);
    const A=p[X]+Y, AA=p[A]+Z, AB=p[A+1]+Z, B=p[X+1]+Y, BA=p[B]+Z, BB=p[B+1]+Z;
    return Noise._lerp(Noise._lerp(Noise._lerp(Noise._grad(p[AA],x,y,z), Noise._grad(p[BA],x-1,y,z), u), Noise._lerp(Noise._grad(p[AB],x,y-1,z), Noise._grad(p[BB],x-1,y-1,z), u), v), Noise._lerp(Noise._lerp(Noise._grad(p[AA+1],x,y,z-1), Noise._grad(p[BA+1],x-1,y,z-1), u), Noise._lerp(Noise._grad(p[AB+1],x,y-1,z-1), Noise._grad(p[BB+1],x-1,y-1,z-1), u), v), w);
  },
  fbm2: function(x,y,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ sum+=amp*Noise.perlin2(x*freq,y*freq); norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  fbm3: function(x,y,z,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ sum+=amp*Noise.perlin3(x*freq,y*freq,z*freq); norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  ridged2: function(x,y,octaves,lacunarity,gain){
    octaves=octaves||4; lacunarity=lacunarity||2; gain=gain||0.5;
    let amp=1, freq=1, sum=0, norm=0;
    for(let i=0;i<octaves;i++){ const n=1-Math.abs(Noise.perlin2(x*freq,y*freq)); sum+=amp*n*n; norm+=amp; amp*=gain; freq*=lacunarity; }
    return sum/norm;
  },
  value2: function(x,y){
    const xi=Math.floor(x), yi=Math.floor(y);
    const xf=x-xi, yf=y-yi;
    const u=Noise._fade(xf), v=Noise._fade(yf);
    const a=MathUtil.fract(Math.sin(xi*127.1+yi*311.7)*43758.5453);
    const b=MathUtil.fract(Math.sin((xi+1)*127.1+yi*311.7)*43758.5453);
    const c=MathUtil.fract(Math.sin(xi*127.1+(yi+1)*311.7)*43758.5453);
    const d=MathUtil.fract(Math.sin((xi+1)*127.1+(yi+1)*311.7)*43758.5453);
    return Noise._lerp(Noise._lerp(a,b,u), Noise._lerp(c,d,u), v);
  },
  cellular2: function(x,y){
    const xi=Math.floor(x), yi=Math.floor(y);
    let d1=Infinity, d2=Infinity;
    for(let i=-1;i<=1;i++){
      for(let j=-1;j<=1;j++){
        const cx=xi+i+MathUtil.fract(Math.sin((xi+i)*127.1+(yi+j)*311.7)*43758.5453);
        const cy=yi+j+MathUtil.fract(Math.sin((xi+i)*269.5+(yi+j)*183.3)*43758.5453);
        const dx=x-cx, dy=y-cy, d=dx*dx+dy*dy;
        if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
      }
    }
    return { f1:Math.sqrt(d1), f2:Math.sqrt(d2) };
  },
};

/* ===== 纹理解码扩展（BMP、DDS） ===== */
function decodeBMP(buffer){
  const view = new DataView(buffer);
  if(view.getUint16(0, true) !== 0x4D42) throw new Error('BMP: 无效文件头');
  const fileSize = view.getUint32(2, true);
  const dataOffset = view.getUint34(10, true);
  const headerSize = view.getUint32(14, true);
  let width, height, bitCount, compression;
  if(headerSize === 12){
    width = view.getInt16(18, true);
    height = view.getInt16(20, true);
    bitCount = view.getUint16(24, true);
    compression = 0;
  } else {
    width = view.getInt32(18, true);
    height = view.getInt32(22, true);
    bitCount = view.getUint16(28, true);
    compression = view.getUint32(30, true);
  }
  const topDown = height < 0;
  height = Math.abs(height);
  const pixels = new Uint8Array(width*height*4);
  const rowSize = Math.floor((bitCount*width+31)/32)*4;
  let pos = dataOffset;
  for(let y=0;y<height;y++){
    const rowY = topDown ? y : height-1-y;
    const rowOffset = rowY*width*4;
    if(bitCount === 24){
      for(let x=0;x<width;x++){
        const b=view.getUint8(pos), g=view.getUint8(pos+1), r=view.getUint8(pos+2);
        pixels[rowOffset+x*4]=r; pixels[rowOffset+x*4+1]=g; pixels[rowOffset+x*4+2]=b; pixels[rowOffset+x*4+3]=255;
        pos+=3;
      }
    } else if(bitCount === 32){
      for(let x=0;x<width;x++){
        const b=view.getUint8(pos), g=view.getUint8(pos+1), r=view.getUint8(pos+2), a=view.getUint8(pos+3);
        pixels[rowOffset+x*4]=r; pixels[rowOffset+x*4+1]=g; pixels[rowOffset+x*4+2]=b; pixels[rowOffset+x*4+3]=a;
        pos+=4;
      }
    } else if(bitCount === 16){
      for(let x=0;x<width;x++){
        const v=view.getUint16(pos, true);
        const r=(v&0x7C00)>>10, g=(v&0x03E0)>>5, b=v&0x001F;
        pixels[rowOffset+x*4]=(r<<3)|(r>>2); pixels[rowOffset+x*4+1]=(g<<3)|(g>>2); pixels[rowOffset+x*4+2]=(b<<3)|(b>>2); pixels[rowOffset+x*4+3]=255;
        pos+=2;
      }
    } else if(bitCount === 8){
      const paletteOffset = headerSize === 12 ? 26 : 54;
      const palette = [];
      for(let i=0;i<256;i++){
        const b=view.getUint8(paletteOffset+i*4), g=view.getUint8(paletteOffset+i*4+1), r=view.getUint8(paletteOffset+i*4+2);
        palette.push([r,g,b,255]);
      }
      for(let x=0;x<width;x++){
        const idx=view.getUint8(pos++);
        const c=palette[idx];
        pixels[rowOffset+x*4]=c[0]; pixels[rowOffset+x*4+1]=c[1]; pixels[rowOffset+x*4+2]=c[2]; pixels[rowOffset+x*4+3]=c[3];
      }
    }
    pos += rowSize - (bitCount/8)*width;
  }
  console.log('[BMP] 解码完成 ' + width + 'x' + height + ' bit=' + bitCount);
  return { width, height, data: pixels, hasAlpha: bitCount===32 };
}
function decodeDDS(buffer){
  const view = new DataView(buffer);
  if(view.getUint32(0, true) !== 0x20534444) throw new Error('DDS: 无效文件头');
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const pitch = view.getUint32(20, true);
  const depth = view.getUint32(24, true);
  const mipMapCount = view.getUint32(28, true);
  const pixelFormatSize = view.getUint32(76, true);
  const flags = view.getUint32(80, true);
  const fourCC = view.getUint32(84, true);
  const rgbBitCount = view.getUint32(88, true);
  const rBitMask = view.getUint32(92, true);
  const gBitMask = view.getUint32(96, true);
  const bBitMask = view.getUint32(100, true);
  const aBitMask = view.getUint32(104, true);
  const isCompressed = (flags & 0x4) !== 0;
  let format = 'unknown';
  if(isCompressed){
    if(fourCC === 0x31545844) format = 'DXT1';
    else if(fourCC === 0x33545844) format = 'DXT3';
    else if(fourCC === 0x35545844) format = 'DXT5';
    else if(fourCC === 0x30315844) format = 'DX10';
  }
  const blockSize = format === 'DXT1' ? 8 : 16;
  const dataOffset = 128;
  const data = new Uint8Array(buffer, dataOffset);
  const mipmaps = [];
  let offset = 0;
  let w = width, h = height;
  for(let m=0;m<Math.max(1,mipMapCount);m++){
    const bw = Math.max(1, Math.floor((w+3)/4));
    const bh = Math.max(1, Math.floor((h+3)/4));
    const size = isCompressed ? bw*bh*blockSize : w*h*(rgbBitCount/8);
    mipmaps.push({ width:w, height:h, data: data.slice(offset, offset+size), offset, size });
    offset += size;
    w = Math.max(1, w>>1); h = Math.max(1, h>>1);
  }
  console.log('[DDS] 解码完成 ' + width + 'x' + height + ' format=' + format + ' mipmaps=' + mipmaps.length);
  return { width, height, format, mipmaps, isCompressed, hasAlpha: format!=='DXT1' };
}
function decodePNG(buffer){
  return new Promise((resolve,reject)=>{
    const blob = new Blob([buffer], {type:'image/png'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0,0,img.width,img.height);
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height, data: imageData.data, hasAlpha: true });
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('PNG解码失败')); };
    img.src = url;
  });
}
function decodeJPEG(buffer){
  return new Promise((resolve,reject)=>{
    const blob = new Blob([buffer], {type:'image/jpeg'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0,0,img.width,img.height);
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height, data: imageData.data, hasAlpha: false });
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('JPEG解码失败')); };
    img.src = url;
  });
}
function createTextureFromDecoded(gl, decoded, options){
  const opt = options || {};
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opt.flipY !== false);
  if(decoded.format && decoded.format.startsWith('DXT')){
    const ext = gl.getExtension('WEBGL_compressed_texture_s3tc');
    if(ext){
      const glFormat = decoded.format==='DXT1' ? ext.COMPRESSED_RGB_S3TC_DXT1_EXT : decoded.format==='DXT3' ? ext.COMPRESSED_RGBA_S3TC_DXT3_EXT : ext.COMPRESSED_RGBA_S3TC_DXT5_EXT;
      for(const mip of decoded.mipmaps){
        gl.compressedTexImage2D(gl.TEXTURE_2D, decoded.mipmaps.indexOf(mip), glFormat, mip.width, mip.height, 0, mip.data);
      }
    }
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, decoded.width, decoded.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, decoded.data);
    if(opt.generateMipmaps !== false && (decoded.width & (decoded.width-1))===0 && (decoded.height & (decoded.height-1))===0){
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opt.wrapS || gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opt.wrapT || gl.CLAMP_TO_EDGE);
  return tex;
}

/* ===== LOD 细节层次系统 ===== */
function createLODGroup(center, radius){
  return {
    levels: [],
    center: center ? center.slice() : [0,0,0],
    radius: radius || 1,
    currentLevel: 0,
    _lastDistance: 0,
  };
}
function addLODLevel(group, distance, mesh, material){
  group.levels.push({ distance: distance, mesh: mesh, material: material });
  group.levels.sort((a,b)=>a.distance-b.distance);
  return group;
}
function updateLOD(group, cameraPosition){
  const dx=cameraPosition[0]-group.center[0], dy=cameraPosition[1]-group.center[1], dz=cameraPosition[2]-group.center[2];
  const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
  group._lastDistance = dist;
  let level = 0;
  for(let i=0;i<group.levels.length;i++){
    if(dist >= group.levels[i].distance) level = i;
  }
  group.currentLevel = level;
  return group.levels[level];
}
function getLODLevel(group){ return group.levels[group.currentLevel]; }
function createBillboard(center, size, texture, options){
  const opt = options || {};
  return {
    center: center ? center.slice() : [0,0,0],
    size: size || [1,1],
    texture: texture || null,
    color: opt.color ? opt.color.slice() : [1,1,1,1],
    enabled: true,
    _positionData: new Float32Array([-0.5,-0.5,0, 0.5,-0.5,0, -0.5,0.5,0, 0.5,0.5,0]),
    _uvData: new Float32Array([0,0, 1,0, 0,1, 1,1]),
    _indexData: new Uint16Array([0,1,2, 2,1,3]),
    _positionBuffer: null,
    _uvBuffer: null,
    _indexBuffer: null,
    _program: null,
  };
}
function initBillboard(gl, billboard){
  billboard._positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, billboard._positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, billboard._positionData, gl.STATIC_DRAW);
  billboard._uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, billboard._uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, billboard._uvData, gl.STATIC_DRAW);
  billboard._indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, billboard._indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, billboard._indexData, gl.STATIC_DRAW);
  const vsSrc = 'attribute vec3 aPos; attribute vec2 aUV; uniform mat4 uViewProj; uniform vec3 uCenter; uniform vec2 uSize; uniform vec3 uRight; uniform vec3 uUp; varying vec2 vUV; void main(){ vec3 p=uCenter+aPos.x*uRight*uSize.x+aPos.y*uUp*uSize.y; vUV=aUV; gl_Position=uViewProj*vec4(p,1.0); }';
  const fsSrc = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uColor; void main(){ vec4 c=texture2D(uTex,vUV)*uColor; if(c.a<0.01) discard; gl_FragColor=c; }';
  function compileShader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs=compileShader(gl.FRAGMENT_SHADER, fsSrc);
  billboard._program = gl.createProgram();
  gl.attachShader(billboard._program, vs);
  gl.attachShader(billboard._program, fs);
  gl.linkProgram(billboard._program);
  billboard._aPos = gl.getAttribLocation(billboard._program, 'aPos');
  billboard._aUV = gl.getAttribLocation(billboard._program, 'aUV');
  billboard._uViewProj = gl.getUniformLocation(billboard._program, 'uViewProj');
  billboard._uCenter = gl.getUniformLocation(billboard._program, 'uCenter');
  billboard._uSize = gl.getUniformLocation(billboard._program, 'uSize');
  billboard._uRight = gl.getUniformLocation(billboard._program, 'uRight');
  billboard._uUp = gl.getUniformLocation(billboard._program, 'uUp');
  billboard._uTex = gl.getUniformLocation(billboard._program, 'uTex');
  billboard._uColor = gl.getUniformLocation(billboard._program, 'uColor');
}
function renderBillboard(gl, billboard, viewProj, cameraRight, cameraUp){
  if(!billboard.enabled) return;
  if(!billboard._program) initBillboard(gl, billboard);
  gl.useProgram(billboard._program);
  gl.uniformMatrix4fv(billboard._uViewProj, false, viewProj);
  gl.uniform3fv(billboard._uCenter, billboard.center);
  gl.uniform2fv(billboard._uSize, billboard.size);
  gl.uniform3fv(billboard._uRight, cameraRight);
  gl.uniform3fv(billboard._uUp, cameraUp);
  gl.uniform4fv(billboard._uColor, billboard.color);
  if(billboard.texture){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, billboard.texture); gl.uniform1i(billboard._uTex, 0); }
  gl.bindBuffer(gl.ARRAY_BUFFER, billboard._positionBuffer);
  gl.enableVertexAttribArray(billboard._aPos);
  gl.vertexAttribPointer(billboard._aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, billboard._uvBuffer);
  gl.enableVertexAttribArray(billboard._aUV);
  gl.vertexAttribPointer(billboard._aUV, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, billboard._indexBuffer);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

/* ===== 渲染统计系统 ===== */
function createRenderStats(){
  return {
    frames: 0,
    fps: 0,
    _fpsFrames: 0,
    _fpsTime: 0,
    drawCalls: 0,
    triangles: 0,
    vertices: 0,
    texturesBound: 0,
    programsSwitched: 0,
    buffersBound: 0,
    uniformsUpdated: 0,
    culledObjects: 0,
    totalObjects: 0,
    shadowMapPasses: 0,
    postProcessPasses: 0,
    gpuMemory: 0,
    _lastProgram: null,
    _lastTexture: null,
    reset: function(){
      this.drawCalls=0; this.triangles=0; this.vertices=0; this.texturesBound=0;
      this.programsSwitched=0; this.buffersBound=0; this.uniformsUpdated=0;
      this.culledObjects=0; this.totalObjects=0; this.shadowMapPasses=0; this.postProcessPasses=0;
    },
    beginFrame: function(time){
      this.reset();
      this.frames++;
      this._fpsFrames++;
      if(time - this._fpsTime >= 1000){
        this.fps = Math.round(this._fpsFrames * 1000 / (time - this._fpsTime));
        this._fpsFrames = 0;
        this._fpsTime = time;
      }
    },
    endFrame: function(){},
    recordDrawCall: function(primitiveCount){
      this.drawCalls++;
      if(primitiveCount) this.triangles += primitiveCount;
    },
    recordTextureBind: function(tex){
      if(tex !== this._lastTexture){ this.texturesBound++; this._lastTexture=tex; }
    },
    recordProgramSwitch: function(prog){
      if(prog !== this._lastProgram){ this.programsSwitched++; this._lastProgram=prog; }
    },
    recordBufferBind: function(){ this.buffersBound++; },
    recordUniformUpdate: function(){ this.uniformsUpdated++; },
    recordCull: function(){ this.culledObjects++; },
    recordObject: function(){ this.totalObjects++; },
    getSummary: function(){
      return {
        fps: this.fps,
        drawCalls: this.drawCalls,
        triangles: this.triangles,
        vertices: this.vertices,
        texturesBound: this.texturesBound,
        programsSwitched: this.programsSwitched,
        buffersBound: this.buffersBound,
        uniformsUpdated: this.uniformsUpdated,
        cullRate: this.totalObjects>0 ? (this.culledObjects/this.totalObjects*100).toFixed(1)+'%' : '0%',
        shadowPasses: this.shadowMapPasses,
        postProcessPasses: this.postProcessPasses,
      };
    },
  };
}

/* ===== 音频系统（简化版） ===== */
function createAudioSystem(options){
  const opt = options || {};
  const sys = {
    ctx: null,
    masterGain: null,
    _initialized: false,
    _sounds: new Map(),
    _music: null,
    _musicGain: null,
    _sfxGain: null,
    masterVolume: opt.masterVolume !== undefined ? opt.masterVolume : 0.8,
    musicVolume: opt.musicVolume !== undefined ? opt.musicVolume : 0.5,
    sfxVolume: opt.sfxVolume !== undefined ? opt.sfxVolume : 0.7,
    muted: false,
  };
  function init(){
    if(sys._initialized) return;
    try {
      sys.ctx = new (window.AudioContext || window.webkitAudioContext)();
      sys.masterGain = sys.ctx.createGain();
      sys.masterGain.gain.value = sys.muted ? 0 : sys.masterVolume;
      sys.masterGain.connect(sys.ctx.destination);
      sys._musicGain = sys.ctx.createGain();
      sys._musicGain.gain.value = sys.musicVolume;
      sys._musicGain.connect(sys.masterGain);
      sys._sfxGain = sys.ctx.createGain();
      sys._sfxGain.gain.value = sys.sfxVolume;
      sys._sfxGain.connect(sys.masterGain);
      sys._initialized = true;
      console.log('[AudioSystem] 初始化完成');
    } catch(e){ console.log('[AudioSystem] 初始化失败:', e); }
  }
  function resume(){ if(sys.ctx && sys.ctx.state==='suspended') sys.ctx.resume(); }
  function setMasterVolume(v){ sys.masterVolume=v; if(sys.masterGain) sys.masterGain.gain.value=sys.muted?0:v; }
  function setMusicVolume(v){ sys.musicVolume=v; if(sys._musicGain) sys._musicGain.gain.value=v; }
  function setSfxVolume(v){ sys.sfxVolume=v; if(sys._sfxGain) sys._sfxGain.gain.value=v; }
  function setMuted(m){ sys.muted=m; if(sys.masterGain) sys.masterGain.gain.value=m?0:sys.masterVolume; }
  async function loadSound(name, url){
    if(!sys._initialized) init();
    if(sys._sounds.has(name)) return sys._sounds.get(name);
    try {
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      const audioBuf = await sys.ctx.decodeAudioData(buf);
      sys._sounds.set(name, audioBuf);
      return audioBuf;
    } catch(e){ console.log('[AudioSystem] 加载失败:', name, e); return null; }
  }
  function playSound(name, options){
    if(!sys._initialized || !sys._sounds.has(name)) return null;
    const opt = options || {};
    const src = sys.ctx.createBufferSource();
    src.buffer = sys._sounds.get(name);
    const gain = sys.ctx.createGain();
    gain.gain.value = opt.volume !== undefined ? opt.volume : 1;
    if(opt.loop) src.loop = true;
    src.connect(gain);
    gain.connect(sys._sfxGain);
    if(opt.pitch) src.playbackRate.value = opt.pitch;
    src.start(0, opt.offset || 0);
    return { source: src, gain: gain, stop: function(t){ src.stop(t||0); } };
  }
  function playMusic(url, options){
    if(!sys._initialized) init();
    const opt = options || {};
    stopMusic();
    const src = sys.ctx.createBufferSource();
    const gain = sys.ctx.createGain();
    gain.gain.value = opt.volume !== undefined ? opt.volume : 1;
    src.loop = opt.loop !== false;
    src.connect(gain);
    gain.connect(sys._musicGain);
    fetch(url).then(r=>r.arrayBuffer()).then(buf=>sys.ctx.decodeAudioData(buf)).then(audioBuf=>{
      src.buffer = audioBuf;
      src.start(0);
      sys._music = { source: src, gain: gain };
    }).catch(e=>console.log('[AudioSystem] 音乐加载失败:', e));
    return src;
  }
  function stopMusic(){ if(sys._music){ sys._music.source.stop(0); sys._music=null; } }
  function pauseMusic(){ if(sys._music && sys.ctx.state==='running') sys.ctx.suspend(); }
  function resumeMusic(){ if(sys._music && sys.ctx.state==='suspended') sys.ctx.resume(); }
  function createOscillator(type, frequency, duration, options){
    if(!sys._initialized) init();
    const opt = options || {};
    const osc = sys.ctx.createOscillator();
    const gain = sys.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = frequency || 440;
    gain.gain.setValueAtTime(0, sys.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(opt.volume||0.3, sys.ctx.currentTime+0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, sys.ctx.currentTime+(duration||1));
    osc.connect(gain);
    gain.connect(sys._sfxGain);
    osc.start();
    osc.stop(sys.ctx.currentTime+(duration||1));
    return osc;
  }
  function createNoise(duration, options){
    if(!sys._initialized) init();
    const opt = options || {};
    const bufferSize = sys.ctx.sampleRate * (duration||1);
    const buffer = sys.ctx.createBuffer(1, bufferSize, sys.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = Math.random()*2-1;
    const src = sys.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = sys.ctx.createGain();
    gain.gain.value = opt.volume || 0.3;
    if(opt.filter){
      const filter = sys.ctx.createBiquadFilter();
      filter.type = opt.filterType || 'lowpass';
      filter.frequency.value = opt.filterFrequency || 1000;
      src.connect(filter);
      filter.connect(gain);
    } else {
      src.connect(gain);
    }
    gain.connect(sys._sfxGain);
    src.start();
    return src;
  }
  console.log('[AudioSystem] 创建完成');
  return { init, resume, loadSound, playSound, playMusic, stopMusic, pauseMusic, resumeMusic, createOscillator, createNoise, setMasterVolume, setMusicVolume, setSfxVolume, setMuted, sys };
}

/* ===== 输入系统 ===== */
function createInputSystem(canvas){
  const sys = {
    canvas: canvas,
    keys: {},
    mouse: { x:0, y:0, dx:0, dy:0, wheel:0, buttons:[false,false,false], down:false, inside:false },
    touches: [],
    _listeners: { keydown:[], keyup:[], mousedown:[], mouseup:[], mousemove:[], wheel:[], touchstart:[], touchmove:[], touchend:[] },
    _enabled: true,
    _pointerLocked: false,
  };
  function on(event, callback){
    if(sys._listeners[event]) sys._listeners[event].push(callback);
    return callback;
  }
  function off(event, callback){
    if(sys._listeners[event]){
      const idx = sys._listeners[event].indexOf(callback);
      if(idx >= 0) sys._listeners[event].splice(idx,1);
    }
  }
  function emit(event, data){
    if(sys._listeners[event]){
      for(const cb of sys._listeners[event]){
        try { cb(data); } catch(e){ console.log('[InputSystem] 事件处理错误:', e); }
      }
    }
  }
  function getMousePosition(e){
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX-rect.left, y: e.clientY-rect.top };
  }
  function handleKeyDown(e){
    if(!sys._enabled) return;
    sys.keys[e.code] = true;
    sys.keys[e.key.toLowerCase()] = true;
    emit('keydown', { code:e.code, key:e.key, repeat:e.repeat });
  }
  function handleKeyUp(e){
    sys.keys[e.code] = false;
    sys.keys[e.key.toLowerCase()] = false;
    emit('keyup', { code:e.code, key:e.key });
  }
  function handleMouseDown(e){
    if(!sys._enabled) return;
    const pos = getMousePosition(e);
    sys.mouse.x = pos.x; sys.mouse.y = pos.y;
    sys.mouse.buttons[e.button] = true;
    sys.mouse.down = true;
    emit('mousedown', { x:pos.x, y:pos.y, button:e.button });
  }
  function handleMouseUp(e){
    const pos = getMousePosition(e);
    sys.mouse.buttons[e.button] = false;
    sys.mouse.down = sys.mouse.buttons.some(b=>b);
    emit('mouseup', { x:pos.x, y:pos.y, button:e.button });
  }
  function handleMouseMove(e){
    const pos = getMousePosition(e);
    sys.mouse.dx = pos.x - sys.mouse.x;
    sys.mouse.dy = pos.y - sys.mouse.y;
    sys.mouse.x = pos.x; sys.mouse.y = pos.y;
    emit('mousemove', { x:pos.x, y:pos.y, dx:sys.mouse.dx, dy:sys.mouse.dy });
  }
  function handleWheel(e){
    e.preventDefault();
    sys.mouse.wheel += e.deltaY;
    emit('wheel', { deltaY:e.deltaY, deltaX:e.deltaX });
  }
  function handleTouchStart(e){
    e.preventDefault();
    sys.touches = [];
    for(const t of e.touches){
      const pos = getMousePosition(t);
      sys.touches.push({ id:t.identifier, x:pos.x, y:pos.y });
    }
    emit('touchstart', { touches: sys.touches.slice() });
  }
  function handleTouchMove(e){
    e.preventDefault();
    sys.touches = [];
    for(const t of e.touches){
      const pos = getMousePosition(t);
      sys.touches.push({ id:t.identifier, x:pos.x, y:pos.y });
    }
    emit('touchmove', { touches: sys.touches.slice() });
  }
  function handleTouchEnd(e){
    e.preventDefault();
    sys.touches = [];
    for(const t of e.touches){
      const pos = getMousePosition(t);
      sys.touches.push({ id:t.identifier, x:pos.x, y:pos.y });
    }
    emit('touchend', { touches: sys.touches.slice() });
  }
  function isKeyDown(key){ return !!sys.keys[key]; }
  function isMouseDown(button){ return !!sys.mouse.buttons[button||0]; }
  function getMouseDelta(){ const d={dx:sys.mouse.dx, dy:sys.mouse.dy}; sys.mouse.dx=0; sys.mouse.dy=0; return d; }
  function getWheelDelta(){ const w=sys.mouse.wheel; sys.mouse.wheel=0; return w; }
  function setEnabled(e){ sys._enabled=e; }
  function requestPointerLock(){ canvas.requestPointerLock(); }
  function exitPointerLock(){ document.exitPointerLock(); }
  function attach(){
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('wheel', handleWheel, {passive:false});
    canvas.addEventListener('touchstart', handleTouchStart, {passive:false});
    canvas.addEventListener('touchmove', handleTouchMove, {passive:false});
    canvas.addEventListener('touchend', handleTouchEnd, {passive:false});
    canvas.addEventListener('mouseenter', ()=>{sys.mouse.inside=true;});
    canvas.addEventListener('mouseleave', ()=>{sys.mouse.inside=false;});
  }
  function detach(){
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    canvas.removeEventListener('mousedown', handleMouseDown);
    window.removeEventListener('mouseup', handleMouseUp);
    canvas.removeEventListener('mousemove', handleMouseMove);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('touchstart', handleTouchStart);
    canvas.removeEventListener('touchmove', handleTouchMove);
    canvas.removeEventListener('touchend', handleTouchEnd);
  }
  console.log('[InputSystem] 创建完成');
  return { on, off, isKeyDown, isMouseDown, getMouseDelta, getWheelDelta, setEnabled, requestPointerLock, exitPointerLock, attach, detach, sys };
}

/* ===== 时间系统 ===== */
function createTimeSystem(){
  return {
    startTime: performance.now(),
    lastTime: performance.now(),
    deltaTime: 0,
    elapsedTime: 0,
    timeScale: 1,
    fixedDeltaTime: 1/60,
    _accumulator: 0,
    frameCount: 0,
    update: function(){
      const now = performance.now();
      this.deltaTime = (now - this.lastTime) / 1000 * this.timeScale;
      this.lastTime = now;
      this.elapsedTime = (now - this.startTime) / 1000;
      this.frameCount++;
      this._accumulator += this.deltaTime;
    },
    shouldFixedUpdate: function(){
      if(this._accumulator >= this.fixedDeltaTime){
        this._accumulator -= this.fixedDeltaTime;
        return true;
      }
      return false;
    },
    getAlpha: function(){ return this._accumulator / this.fixedDeltaTime; },
    reset: function(){
      this.startTime = performance.now();
      this.lastTime = performance.now();
      this.deltaTime = 0;
      this.elapsedTime = 0;
      this._accumulator = 0;
      this.frameCount = 0;
    },
    sleep: function(ms){ return new Promise(r=>setTimeout(r, ms)); },
  };
}

/* ===== 事件系统 ===== */
function createEventSystem(){
  const sys = {
    _events: new Map(),
    _onceEvents: new Map(),
    _maxListeners: 100,
  };
  function on(event, listener){
    if(!sys._events.has(event)) sys._events.set(event, []);
    const listeners = sys._events.get(event);
    if(listeners.length >= sys._maxListeners) console.log('[EventSystem] 事件监听器数量超过上限:', event);
    listeners.push(listener);
    return ()=>off(event, listener);
  }
  function once(event, listener){
    if(!sys._onceEvents.has(event)) sys._onceEvents.set(event, []);
    sys._onceEvents.get(event).push(listener);
    return ()=>off(event, listener);
  }
  function off(event, listener){
    if(sys._events.has(event)){
      const listeners = sys._events.get(event);
      const idx = listeners.indexOf(listener);
      if(idx >= 0) listeners.splice(idx,1);
    }
    if(sys._onceEvents.has(event)){
      const listeners = sys._onceEvents.get(event);
      const idx = listeners.indexOf(listener);
      if(idx >= 0) listeners.splice(idx,1);
    }
  }
  function emit(event, ...args){
    let handled = false;
    if(sys._events.has(event)){
      for(const listener of sys._events.get(event)){
        try { listener(...args); handled = true; } catch(e){ console.log('[EventSystem] 事件处理错误:', event, e); }
      }
    }
    if(sys._onceEvents.has(event)){
      const listeners = sys._onceEvents.get(event).slice();
      sys._onceEvents.delete(event);
      for(const listener of listeners){
        try { listener(...args); handled = true; } catch(e){ console.log('[EventSystem] 一次性事件处理错误:', event, e); }
      }
    }
    return handled;
  }
  function listenerCount(event){
    let count = 0;
    if(sys._events.has(event)) count += sys._events.get(event).length;
    if(sys._onceEvents.has(event)) count += sys._onceEvents.get(event).length;
    return count;
  }
  function removeAllListeners(event){
    if(event){ sys._events.delete(event); sys._onceEvents.delete(event); }
    else { sys._events.clear(); sys._onceEvents.clear(); }
  }
  function setMaxListeners(n){ sys._maxListeners = n; }
  function eventNames(){ return Array.from(new Set([...sys._events.keys(), ...sys._onceEvents.keys()])); }
  return { on, once, off, emit, listenerCount, removeAllListeners, setMaxListeners, eventNames, sys };
}

/* ===== 材质系统扩展 ===== */
const MaterialType = { STANDARD: 0, PHONG: 1, LAMBERT: 2, TOON: 3, PBR: 4, UNLIT: 5, TRANSPARENT: 6, ADDITIVE: 7, SKYBOX: 8 };
const CullMode = { NONE: 0, FRONT: 1, BACK: 2 };
function createMaterial(type, options){
  const opt = options || {};
  return {
    type: type !== undefined ? type : MaterialType.STANDARD,
    name: opt.name || 'material',
    color: opt.color ? opt.color.slice() : [1,1,1,1],
    ambient: opt.ambient ? opt.ambient.slice() : [0.5,0.5,0.5],
    diffuse: opt.diffuse ? opt.diffuse.slice() : [1,1,1,1],
    specular: opt.specular ? opt.specular.slice() : [0.5,0.5,0.5],
    emissive: opt.emissive ? opt.emissive.slice() : [0,0,0],
    shininess: opt.shininess !== undefined ? opt.shininess : 32,
    metalness: opt.metalness !== undefined ? opt.metalness : 0,
    roughness: opt.roughness !== undefined ? opt.roughness : 0.5,
    opacity: opt.opacity !== undefined ? opt.opacity : 1,
    transparent: opt.transparent || false,
    alphaTest: opt.alphaTest || 0,
    blendMode: opt.blendMode !== undefined ? opt.blendMode : BlendMode.NORMAL,
    cullMode: opt.cullMode !== undefined ? opt.cullMode : CullMode.BACK,
    depthWrite: opt.depthWrite !== false,
    depthTest: opt.depthTest !== false,
    side: opt.side || 'front',
    map: opt.map || null,
    normalMap: opt.normalMap || null,
    specularMap: opt.specularMap || null,
    emissiveMap: opt.emissiveMap || null,
    roughnessMap: opt.roughnessMap || null,
    metalnessMap: opt.metalnessMap || null,
    aoMap: opt.aoMap || null,
    envMap: opt.envMap || null,
    toonGradient: opt.toonGradient || null,
    userData: {},
    _program: null,
    _uniformCache: {},
    clone: function(){
      return createMaterial(this.type, {
        name: this.name+'_copy',
        color: this.color.slice(),
        ambient: this.ambient.slice(),
        diffuse: this.diffuse.slice(),
        specular: this.specular.slice(),
        emissive: this.emissive.slice(),
        shininess: this.shininess,
        metalness: this.metalness,
        roughness: this.roughness,
        opacity: this.opacity,
        transparent: this.transparent,
        alphaTest: this.alphaTest,
        blendMode: this.blendMode,
        cullMode: this.cullMode,
        depthWrite: this.depthWrite,
        depthTest: this.depthTest,
        map: this.map,
        normalMap: this.normalMap,
      });
    },
  };
}
function applyMaterialState(gl, material){
  if(material.transparent || material.opacity < 1){
    gl.enable(gl.BLEND);
    if(material.blendMode === BlendMode.ADDITIVE) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else if(material.blendMode === BlendMode.MULTIPLY) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else if(material.blendMode === BlendMode.SCREEN) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.disable(gl.BLEND);
  }
  if(material.cullMode !== CullMode.NONE){
    gl.enable(gl.CULL_FACE);
    gl.cullFace(material.cullMode === CullMode.FRONT ? gl.FRONT : gl.BACK);
  } else {
    gl.disable(gl.CULL_FACE);
  }
  if(material.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  gl.depthMask(material.depthWrite);
}
function createMaterialLibrary(){
  const lib = { materials: new Map(), _default: null };
  function add(name, material){ material.name = name; lib.materials.set(name, material); return material; }
  function get(name){ return lib.materials.get(name) || lib._default; }
  function remove(name){ lib.materials.delete(name); }
  function has(name){ return lib.materials.has(name); }
  function clear(){ lib.materials.clear(); }
  function clone(){
    const newLib = createMaterialLibrary();
    for(const [name, mat] of lib.materials) newLib.add(name, mat.clone());
    return newLib;
  }
  lib._default = createMaterial(MaterialType.STANDARD, {name:'default'});
  return { add, get, remove, has, clear, clone, lib };
}

/* ===== 着色器管理系统 ===== */
function createShaderManager(gl){
  const mgr = {
    gl: gl,
    _programs: new Map(),
    _shaders: new Map(),
    _cache: new Map(),
    _activeProgram: null,
  };
  function compileShader(type, source){
    const key = type + ':' + source.length + ':' + source.substring(0,100);
    if(mgr._shaders.has(key)) return mgr._shaders.get(key);
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(shader);
      console.log('[ShaderManager] 着色器编译失败:', log);
      console.log('[ShaderManager] 源码:', source);
      return null;
    }
    mgr._shaders.set(key, shader);
    return shader;
  }
  function createProgram(vsSource, fsSource, defines){
    const defStr = defines ? Object.entries(defines).map(([k,v])=>'#define '+k+' '+v).join('\n') : '';
    const vsFull = defStr + '\n' + vsSource;
    const fsFull = defStr + '\n' + fsSource;
    const key = vsFull.length + ':' + fsFull.length + ':' + vsFull.substring(0,50) + fsFull.substring(0,50);
    if(mgr._programs.has(key)) return mgr._programs.get(key);
    const vs = compileShader(gl.VERTEX_SHADER, vsFull);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsFull);
    if(!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
      console.log('[ShaderManager] 程序链接失败:', gl.getProgramInfoLog(program));
      return null;
    }
    const info = {
      program: program,
      attributes: {},
      uniforms: {},
      _uniformCache: {},
    };
    const attrCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for(let i=0;i<attrCount;i++){
      const attr = gl.getActiveAttrib(program, i);
      info.attributes[attr.name] = gl.getAttribLocation(program, attr.name);
    }
    const uniCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<uniCount;i++){
      const uni = gl.getActiveUniform(program, i);
      const name = uni.name.replace(/\[0\]$/, '');
      info.uniforms[name] = gl.getUniformLocation(program, name);
    }
    mgr._programs.set(key, info);
    return info;
  }
  function useProgram(info){
    if(mgr._activeProgram !== info.program){
      gl.useProgram(info.program);
      mgr._activeProgram = info.program;
      return true;
    }
    return false;
  }
  function setUniform(info, name, value){
    const loc = info.uniforms[name];
    if(!loc) return false;
    const cacheKey = name + ':' + (Array.isArray(value) ? value.join(',') : value);
    if(info._uniformCache[cacheKey]) return false;
    info._uniformCache[cacheKey] = true;
    if(typeof value === 'number') gl.uniform1f(loc, value);
    else if(value instanceof Float32Array && value.length === 16) gl.uniformMatrix4fv(loc, false, value);
    else if(value instanceof Float32Array && value.length === 9) gl.uniformMatrix3fv(loc, false, value);
    else if(Array.isArray(value)){
      if(value.length === 2) gl.uniform2fv(loc, value);
      else if(value.length === 3) gl.uniform3fv(loc, value);
      else if(value.length === 4) gl.uniform4fv(loc, value);
    }
    return true;
  }
  function setUniform1i(info, name, value){
    const loc = info.uniforms[name];
    if(loc) gl.uniform1i(loc, value);
  }
  function invalidateCache(info){ info._uniformCache = {}; }
  function dispose(){
    for(const [key, info] of mgr._programs) gl.deleteProgram(info.program);
    for(const [key, shader] of mgr._shaders) gl.deleteShader(shader);
    mgr._programs.clear();
    mgr._shaders.clear();
  }
  console.log('[ShaderManager] 创建完成');
  return { compileShader, createProgram, useProgram, setUniform, setUniform1i, invalidateCache, dispose, mgr };
}

/* ===== 帧缓冲系统 ===== */
function createFramebuffer(gl, width, height, options){
  const opt = options || {};
  const fb = {
    gl: gl,
    width: width,
    height: height,
    framebuffer: gl.createFramebuffer(),
    colorTexture: null,
    depthTexture: null,
    depthRenderbuffer: null,
    stencilRenderbuffer: null,
    _colorAttachments: [],
  };
  function createColorTexture(attachment){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opt.minFilter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opt.magFilter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opt.wrapS || gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opt.wrapT || gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment || gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return tex;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer);
  if(opt.colorAttachments && opt.colorAttachments > 1){
    const ext = gl.getExtension('WEBGL_draw_buffers');
    if(ext){
      for(let i=0;i<opt.colorAttachments;i++){
        const tex = createColorTexture(ext['COLOR_ATTACHMENT'+i+'_WEBGL']);
        fb._colorAttachments.push(tex);
      }
      ext.drawBuffersWEBGL(fb._colorAttachments.map((_,i)=>ext['COLOR_ATTACHMENT'+i+'_WEBGL']));
    }
  } else {
    fb.colorTexture = createColorTexture(gl.COLOR_ATTACHMENT0);
  }
  if(opt.depthTexture){
    const ext = gl.getExtension('WEBGL_depth_texture');
    if(ext){
      fb.depthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, fb.depthTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, fb.depthTexture, 0);
    }
  } else if(opt.depth !== false){
    fb.depthRenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, fb.depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fb.depthRenderbuffer);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if(status !== gl.FRAMEBUFFER_COMPLETE) console.log('[Framebuffer] 不完整:', status);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  function bind(){ gl.bindFramebuffer(gl.FRAMEBUFFER, fb.framebuffer); gl.viewport(0,0,width,height); }
  function unbind(){ gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
  function resize(w, h){
    fb.width = w; fb.height = h;
    if(fb.colorTexture){ gl.bindTexture(gl.TEXTURE_2D, fb.colorTexture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    for(const tex of fb._colorAttachments){ gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
    if(fb.depthTexture){ gl.bindTexture(gl.TEXTURE_2D, fb.depthTexture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null); }
    if(fb.depthRenderbuffer){ gl.bindRenderbuffer(gl.RENDERBUFFER, fb.depthRenderbuffer); gl.renderbufferStorage(gl.RENDERBUFFER, opt.depthStencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16, w, h); }
  }
  function clear(r,g,b,a){
    bind();
    gl.clearColor(r||0, g||0, b||0, a!==undefined?a:1);
    gl.clear(gl.COLOR_BUFFER_BIT | (fb.depthRenderbuffer||fb.depthTexture ? gl.DEPTH_BUFFER_BIT : 0));
  }
  function dispose(){
    gl.deleteFramebuffer(fb.framebuffer);
    if(fb.colorTexture) gl.deleteTexture(fb.colorTexture);
    if(fb.depthTexture) gl.deleteTexture(fb.depthTexture);
    if(fb.depthRenderbuffer) gl.deleteRenderbuffer(fb.depthRenderbuffer);
    for(const tex of fb._colorAttachments) gl.deleteTexture(tex);
  }
  console.log('[Framebuffer] 创建完成 ' + width + 'x' + height);
  return { bind, unbind, resize, clear, dispose, fb };
}
function createRenderTarget(gl, width, height, options){
  const opt = options || {};
  return {
    framebuffer: createFramebuffer(gl, width, height, opt),
    width: width,
    height: height,
    samples: opt.samples || 1,
    get texture(){ return this.framebuffer.fb.colorTexture; },
    get depthTexture(){ return this.framebuffer.fb.depthTexture; },
  };
}

/* ===== 视锥剔除系统 ===== */
function createFrustum(){
  return { planes: [new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4),new Float32Array(4)] };
}
function extractFrustumFromMatrix(frustum, m){
  const planes = frustum.planes;
  planes[0][0]=m[3]-m[0]; planes[0][1]=m[7]-m[4]; planes[0][2]=m[11]-m[8]; planes[0][3]=m[15]-m[12];
  planes[1][0]=m[3]+m[0]; planes[1][1]=m[7]+m[4]; planes[1][2]=m[11]+m[8]; planes[1][3]=m[15]+m[12];
  planes[2][0]=m[3]+m[1]; planes[2][1]=m[7]+m[5]; planes[2][2]=m[11]+m[9]; planes[2][3]=m[15]+m[13];
  planes[3][0]=m[3]-m[1]; planes[3][1]=m[7]-m[5]; planes[3][2]=m[11]-m[9]; planes[3][3]=m[15]-m[13];
  planes[4][0]=m[3]-m[2]; planes[4][1]=m[7]-m[6]; planes[4][2]=m[11]-m[10]; planes[4][3]=m[15]-m[14];
  planes[5][0]=m[3]+m[2]; planes[5][1]=m[7]+m[6]; planes[5][2]=m[11]+m[10]; planes[5][3]=m[15]+m[14];
  for(let i=0;i<6;i++){
    const p=planes[i], len=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]);
    p[0]/=len; p[1]/=len; p[2]/=len; p[3]/=len;
  }
  return frustum;
}
function pointInFrustum(frustum, x, y, z){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    if(p[0]*x+p[1]*y+p[2]*z+p[3] < 0) return false;
  }
  return true;
}
function sphereInFrustum(frustum, center, radius){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    if(p[0]*center[0]+p[1]*center[1]+p[2]*center[2]+p[3] < -radius) return false;
  }
  return true;
}
function aabbInFrustum(frustum, min, max){
  for(let i=0;i<6;i++){
    const p=frustum.planes[i];
    const vx=p[0]>0?max[0]:min[0], vy=p[1]>0?max[1]:min[1], vz=p[2]>0?max[2]:min[2];
    if(p[0]*vx+p[1]*vy+p[2]*vz+p[3] < 0) return false;
  }
  return true;
}
function createFrustumCuller(){
  return {
    frustum: createFrustum(),
    _culled: 0,
    _total: 0,
    update: function(viewProjMatrix){ extractFrustumFromMatrix(this.frustum, viewProjMatrix); this._culled=0; this._total=0; },
    testSphere: function(center, radius){ this._total++; if(!sphereInFrustum(this.frustum, center, radius)){ this._culled++; return false; } return true; },
    testAABB: function(min, max){ this._total++; if(!aabbInFrustum(this.frustum, min, max)){ this._culled++; return false; } return true; },
    testPoint: function(x,y,z){ this._total++; if(!pointInFrustum(this.frustum,x,y,z)){ this._culled++; return false; } return true; },
    getStats: function(){ return { culled: this._culled, total: this._total, rate: this._total>0 ? (this._culled/this._total*100).toFixed(1)+'%' : '0%' }; },
  };
}

/* ===== 八叉树空间分区 ===== */
function createOctree(min, max, maxDepth, maxObjects){
  return {
    min: min ? min.slice() : [-Infinity,-Infinity,-Infinity],
    max: max ? max.slice() : [Infinity,Infinity,Infinity],
    maxDepth: maxDepth || 8,
    maxObjects: maxObjects || 8,
    depth: 0,
    objects: [],
    children: null,
    _objectCount: 0,
  };
}
function octreeGetCenter(node){ return [(node.min[0]+node.max[0])/2, (node.min[1]+node.max[1])/2, (node.min[2]+node.max[2])/2]; }
function octreeContains(node, min, max){
  return min[0]>=node.min[0] && max[0]<=node.max[0] &&
         min[1]>=node.min[1] && max[1]<=node.max[1] &&
         min[2]>=node.min[2] && max[2]<=node.max[2];
}
function octreeIntersects(node, min, max){
  return min[0]<=node.max[0] && max[0]>=node.min[0] &&
         min[1]<=node.max[1] && max[1]>=node.min[1] &&
         min[2]<=node.max[2] && max[2]>=node.min[2];
}
function octreeSubdivide(node){
  const center = octreeGetCenter(node);
  node.children = [];
  for(let i=0;i<8;i++){
    const min = [
      (i&1)?center[0]:node.min[0],
      (i&2)?center[1]:node.min[1],
      (i&4)?center[2]:node.min[2],
    ];
    const max = [
      (i&1)?node.max[0]:center[0],
      (i&2)?node.max[1]:center[1],
      (i&4)?node.max[2]:center[2],
    ];
    const child = createOctree(min, max, node.maxDepth, node.maxObjects);
    child.depth = node.depth + 1;
    node.children.push(child);
  }
}
function octreeInsert(node, object, min, max){
  if(!octreeContains(node, min, max)){
    if(node.depth === 0){
      node.objects.push({object, min, max});
      node._objectCount++;
      return true;
    }
    return false;
  }
  if(node.children){
    for(const child of node.children){
      if(octreeInsert(child, object, min, max)) return true;
    }
  }
  node.objects.push({object, min, max});
  node._objectCount++;
  if(!node.children && node.objects.length > node.maxObjects && node.depth < node.maxDepth){
    octreeSubdivide(node);
    const oldObjects = node.objects;
    node.objects = [];
    for(const obj of oldObjects) octreeInsert(node, obj.object, obj.min, obj.max);
  }
  return true;
}
function octreeQuery(node, min, max, results){
  results = results || [];
  if(!octreeIntersects(node, min, max)) return results;
  for(const obj of node.objects){
    if(obj.min[0]<=max[0] && obj.max[0]>=min[0] &&
       obj.min[1]<=max[1] && obj.max[1]>=min[1] &&
       obj.min[2]<=max[2] && obj.max[2]>=min[2]){
      results.push(obj.object);
    }
  }
  if(node.children){
    for(const child of node.children) octreeQuery(child, min, max, results);
  }
  return results;
}
function octreeQuerySphere(node, center, radius, results){
  results = results || [];
  const min=[center[0]-radius,center[1]-radius,center[2]-radius];
  const max=[center[0]+radius,center[1]+radius,center[2]+radius];
  if(!octreeIntersects(node, min, max)) return results;
  for(const obj of node.objects){
    const cx=Math.max(obj.min[0],Math.min(center[0],obj.max[0]));
    const cy=Math.max(obj.min[1],Math.min(center[1],obj.max[1]));
    const cz=Math.max(obj.min[2],Math.min(center[2],obj.max[2]));
    const dx=center[0]-cx, dy=center[1]-cy, dz=center[2]-cz;
    if(dx*dx+dy*dy+dz*dz <= radius*radius) results.push(obj.object);
  }
  if(node.children){
    for(const child of node.children) octreeQuerySphere(child, center, radius, results);
  }
  return results;
}
function octreeClear(node){
  node.objects = [];
  node.children = null;
  node._objectCount = 0;
}
function octreeGetAllObjects(node, results){
  results = results || [];
  for(const obj of node.objects) results.push(obj.object);
  if(node.children) for(const child of node.children) octreeGetAllObjects(child, results);
  return results;
}

/* ===== 网格优化系统 ===== */
function computeMeshBounds(geometry){
  const pos = geometry.positions;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<pos.length;i+=3){
    minX=Math.min(minX,pos[i]); minY=Math.min(minY,pos[i+1]); minZ=Math.min(minZ,pos[i+2]);
    maxX=Math.max(maxX,pos[i]); maxY=Math.max(maxY,pos[i+1]); maxZ=Math.max(maxZ,pos[i+2]);
  }
  return { min:[minX,minY,minZ], max:[maxX,maxY,maxZ], center:[(minX+maxX)/2,(minY+maxY)/2,(minZ+maxZ)/2], size:[maxX-minX,maxY-minY,maxZ-minZ] };
}
function computeMeshBoundingSphere(geometry){
  const bounds = computeMeshBounds(geometry);
  const center = bounds.center;
  let maxDist = 0;
  const pos = geometry.positions;
  for(let i=0;i<pos.length;i+=3){
    const dx=pos[i]-center[0], dy=pos[i+1]-center[1], dz=pos[i+2]-center[2];
    maxDist = Math.max(maxDist, dx*dx+dy*dy+dz*dz);
  }
  return { center, radius: Math.sqrt(maxDist) };
}
function mergeVertices(geometry, tolerance){
  const tol = tolerance || 0.0001;
  const pos = geometry.positions, normals = geometry.normals, uvs = geometry.uvs;
  const indices = geometry.indices;
  const newPositions = [], newNormals = [], newUVs = [], newIndices = [];
  const vertexMap = new Map();
  function hashVertex(i){
    const x=Math.round(pos[i*3]/tol), y=Math.round(pos[i*3+1]/tol), z=Math.round(pos[i*3+2]/tol);
    const nx=normals?Math.round(normals[i*3]/tol):0, ny=normals?Math.round(normals[i*3+1]/tol):0, nz=normals?Math.round(normals[i*3+2]/tol):0;
    const u=uvs?Math.round(uvs[i*2]/tol):0, v=uvs?Math.round(uvs[i*2+1]/tol):0;
    return x+','+y+','+z+','+nx+','+ny+','+nz+','+u+','+v;
  }
  for(let i=0;i<indices.length;i++){
    const idx = indices[i];
    const hash = hashVertex(idx);
    if(vertexMap.has(hash)){
      newIndices.push(vertexMap.get(hash));
    } else {
      const newIdx = newPositions.length/3;
      vertexMap.set(hash, newIdx);
      newPositions.push(pos[idx*3], pos[idx*3+1], pos[idx*3+2]);
      if(normals) newNormals.push(normals[idx*3], normals[idx*3+1], normals[idx*3+2]);
      if(uvs) newUVs.push(uvs[idx*2], uvs[idx*2+1]);
      newIndices.push(newIdx);
    }
  }
  return {
    positions: new Float32Array(newPositions),
    normals: normals ? new Float32Array(newNormals) : null,
    uvs: uvs ? new Float32Array(newUVs) : null,
    indices: new Uint32Array(newIndices),
    vertexCount: newPositions.length/3,
    indexCount: newIndices.length,
  };
}
function computeVertexNormals(geometry){
  const pos = geometry.positions, indices = geometry.indices;
  const normals = new Float32Array(pos.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const ax=pos[ib]-pos[ia], ay=pos[ib+1]-pos[ia+1], az=pos[ib+2]-pos[ia+2];
    const bx=pos[ic]-pos[ia], by=pos[ic+1]-pos[ia+1], bz=pos[ic+2]-pos[ia+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    normals[ia]+=nx; normals[ia+1]+=ny; normals[ia+2]+=nz;
    normals[ib]+=nx; normals[ib+1]+=ny; normals[ib+2]+=nz;
    normals[ic]+=nx; normals[ic+1]+=ny; normals[ic+2]+=nz;
  }
  for(let i=0;i<normals.length;i+=3){
    const l=Math.sqrt(normals[i]**2+normals[i+1]**2+normals[i+2]**2)||1;
    normals[i]/=l; normals[i+1]/=l; normals[i+2]/=l;
  }
  geometry.normals = normals;
  return geometry;
}
function computeTangents(geometry){
  const pos = geometry.positions, normals = geometry.normals, uvs = geometry.uvs, indices = geometry.indices;
  if(!uvs) return geometry;
  const tangents = new Float32Array(pos.length/3*4);
  const tan1 = new Float32Array(pos.length), tan2 = new Float32Array(pos.length);
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i], ib=indices[i+1], ic=indices[i+2];
    const x1=pos[ib*3]-pos[ia*3], y1=pos[ib*3+1]-pos[ia*3+1], z1=pos[ib*3+2]-pos[ia*3+2];
    const x2=pos[ic*3]-pos[ia*3], y2=pos[ic*3+1]-pos[ia*3+1], z2=pos[ic*3+2]-pos[ia*3+2];
    const s1=uvs[ib*2]-uvs[ia*2], t1=uvs[ib*2+1]-uvs[ia*2+1];
    const s2=uvs[ic*2]-uvs[ia*2], t2=uvs[ic*2+1]-uvs[ia*2+1];
    const r=1/(s1*t2-s2*t1);
    const sx=(t2*x1-t1*x2)*r, sy=(t2*y1-t1*y2)*r, sz=(t2*z1-t1*z2)*r;
    const tx=(s1*x2-s2*x1)*r, ty=(s1*y2-s2*y1)*r, tz=(s1*z2-s2*z1)*r;
    tan1[ia*3]+=sx; tan1[ia*3+1]+=sy; tan1[ia*3+2]+=sz;
    tan1[ib*3]+=sx; tan1[ib*3+1]+=sy; tan1[ib*3+2]+=sz;
    tan1[ic*3]+=sx; tan1[ic*3+1]+=sy; tan1[ic*3+2]+=sz;
    tan2[ia*3]+=tx; tan2[ia*3+1]+=ty; tan2[ia*3+2]+=tz;
    tan2[ib*3]+=tx; tan2[ib*3+1]+=ty; tan2[ib*3+2]+=tz;
    tan2[ic*3]+=tx; tan2[ic*3+1]+=ty; tan2[ic*3+2]+=tz;
  }
  for(let i=0;i<pos.length/3;i++){
    const n=[normals[i*3],normals[i*3+1],normals[i*3+2]];
    const t=[tan1[i*3],tan1[i*3+1],tan1[i*3+2]];
    const dot=n[0]*t[0]+n[1]*t[1]+n[2]*t[2];
    const tangent=[t[0]-n[0]*dot, t[1]-n[1]*dot, t[2]-n[2]*dot];
    const tl=Math.sqrt(tangent[0]**2+tangent[1]**2+tangent[2]**2)||1;
    tangent[0]/=tl; tangent[1]/=tl; tangent[2]/=tl;
    const b=[n[1]*t[2]-n[2]*t[1], n[2]*t[0]-n[0]*t[2], n[0]*t[1]-n[1]*t[0]];
    const hand = (b[0]*tan2[i*3]+b[1]*tan2[i*3+1]+b[2]*tan2[i*3+2]) < 0 ? -1 : 1;
    tangents[i*4]=tangent[0]; tangents[i*4+1]=tangent[1]; tangents[i*4+2]=tangent[2]; tangents[i*4+3]=hand;
  }
  geometry.tangents = tangents;
  return geometry;
}
function simplifyMesh(geometry, targetRatio){
  const ratio = targetRatio || 0.5;
  const targetCount = Math.floor(geometry.indexCount * ratio / 3) * 3;
  if(targetCount >= geometry.indexCount) return geometry;
  const pos = geometry.positions, indices = geometry.indices;
  const errors = [];
  for(let i=0;i<indices.length;i+=3){
    const ia=indices[i]*3, ib=indices[i+1]*3, ic=indices[i+2]*3;
    const area = Math.abs((pos[ib]-pos[ia])*(pos[ic+1]-pos[ia+1])-(pos[ib+1]-pos[ia+1])*(pos[ic]-pos[ia]))*0.5;
    errors.push({index:i, area:area});
  }
  errors.sort((a,b)=>a.area-b.area);
  const removeCount = (geometry.indexCount - targetCount) / 3;
  const removeSet = new Set();
  for(let i=0;i<removeCount && i<errors.length;i++) removeSet.add(errors[i].index);
  const newIndices = [];
  for(let i=0;i<indices.length;i+=3){
    if(!removeSet.has(i)) newIndices.push(indices[i], indices[i+1], indices[i+2]);
  }
  return {
    positions: geometry.positions,
    normals: geometry.normals,
    uvs: geometry.uvs,
    indices: new Uint32Array(newIndices),
    vertexCount: geometry.vertexCount,
    indexCount: newIndices.length,
  };
}

/* ===== 变形目标系统 ===== */
function createMorphTarget(name, positions, normals){
  return {
    name: name,
    positions: positions || null,
    normals: normals || null,
    weight: 0,
  };
}
function createMorphController(geometry, targets){
  const ctrl = {
    basePositions: geometry.positions.slice(),
    baseNormals: geometry.normals ? geometry.normals.slice() : null,
    targets: targets || [],
    weights: new Float32Array((targets||[]).length),
    _currentPositions: geometry.positions,
    _currentNormals: geometry.normals,
    _dirty: true,
  };
  function setWeight(index, weight){
    ctrl.weights[index] = weight;
    ctrl.targets[index].weight = weight;
    ctrl._dirty = true;
  }
  function setWeightByName(name, weight){
    const idx = ctrl.targets.findIndex(t=>t.name===name);
    if(idx >= 0) setWeight(idx, weight);
  }
  function getWeight(index){ return ctrl.weights[index]; }
  function getWeightByName(name){
    const idx = ctrl.targets.findIndex(t=>t.name===name);
    return idx >= 0 ? ctrl.weights[idx] : 0;
  }
  function addTarget(target){
    ctrl.targets.push(target);
    const newWeights = new Float32Array(ctrl.weights.length+1);
    newWeights.set(ctrl.weights);
    ctrl.weights = newWeights;
    ctrl._dirty = true;
  }
  function removeTarget(index){
    ctrl.targets.splice(index,1);
    const newWeights = new Float32Array(ctrl.weights.length-1);
    for(let i=0,j=0;i<ctrl.weights.length;i++){ if(i!==index) newWeights[j++]=ctrl.weights[i]; }
    ctrl.weights = newWeights;
    ctrl._dirty = true;
  }
  function update(){
    if(!ctrl._dirty) return;
    const pos = ctrl._currentPositions;
    const base = ctrl.basePositions;
    for(let i=0;i<pos.length;i++) pos[i] = base[i];
    for(let t=0;t<ctrl.targets.length;t++){
      const w = ctrl.weights[t];
      if(w === 0 || !ctrl.targets[t].positions) continue;
      const tp = ctrl.targets[t].positions;
      for(let i=0;i<pos.length;i++) pos[i] += (tp[i]-base[i]) * w;
    }
    if(ctrl._currentNormals && ctrl.baseNormals){
      const nrm = ctrl._currentNormals;
      const baseN = ctrl.baseNormals;
      for(let i=0;i<nrm.length;i++) nrm[i] = baseN[i];
      for(let t=0;t<ctrl.targets.length;t++){
        const w = ctrl.weights[t];
        if(w === 0 || !ctrl.targets[t].normals) continue;
        const tn = ctrl.targets[t].normals;
        for(let i=0;i<nrm.length;i++) nrm[i] += (tn[i]-baseN[i]) * w;
      }
    }
    ctrl._dirty = false;
  }
  function reset(){
    for(let i=0;i<ctrl.weights.length;i++) ctrl.weights[i]=0;
    ctrl._dirty = true;
    update();
  }
  function getTargetNames(){ return ctrl.targets.map(t=>t.name); }
  console.log('[MorphController] 创建完成 targets=' + ctrl.targets.length);
  return { setWeight, setWeightByName, getWeight, getWeightByName, addTarget, removeTarget, update, reset, getTargetNames, ctrl };
}

/* ===== 骨骼重定向系统 ===== */
function createBoneMapper(sourceBones, targetBones){
  const mapper = {
    sourceBones: sourceBones,
    targetBones: targetBones,
    _map: new Map(),
    _sourceRoot: -1,
    _targetRoot: -1,
  };
  function findBoneByName(bones, name){
    for(let i=0;i<bones.length;i++){
      if(bones[i].name === name) return i;
    }
    return -1;
  }
  function autoMap(){
    const nameMap = {
      '全ての親':'root', '操作中心':'center', 'センター':'center',
      '上半身':'spine', '下半身':'hips',
      '首':'neck', '頭':'head',
      '左目':'leftEye', '右目':'rightEye',
      '左肩':'leftShoulder', '左腕':'leftArm', '左ひじ':'leftElbow', '左手首':'leftWrist', '左手':'leftHand',
      '右肩':'rightShoulder', '右腕':'rightArm', '右ひじ':'rightElbow', '右手首':'rightWrist', '右手':'rightHand',
      '左足':'leftLeg', '左ひざ':'leftKnee', '左足首':'leftAnkle', '左足先':'leftToe',
      '右足':'rightLeg', '右ひざ':'rightKnee', '右足首':'rightAnkle', '右足先':'rightToe',
    };
    for(const [srcName, stdName] of Object.entries(nameMap)){
      const srcIdx = findBoneByName(sourceBones, srcName);
      if(srcIdx < 0) continue;
      for(const [tgtName, tgtStd] of Object.entries(nameMap)){
        if(tgtStd === stdName){
          const tgtIdx = findBoneByName(targetBones, tgtName);
          if(tgtIdx >= 0){ mapper._map.set(srcIdx, tgtIdx); break; }
        }
      }
    }
    mapper._sourceRoot = findBoneByName(sourceBones, '全ての親');
    mapper._targetRoot = findBoneByName(targetBones, '全ての親');
    console.log('[BoneMapper] 自动映射完成 ' + mapper._map.size + '/' + sourceBones.length);
  }
  function mapBone(sourceIndex){ return mapper._map.get(sourceIndex) || -1; }
  function setMapping(sourceIndex, targetIndex){ mapper._map.set(sourceIndex, targetIndex); }
  function clearMapping(){ mapper._map.clear(); }
  function getMappingCount(){ return mapper._map.size; }
  function retargetPose(sourceRotations, sourcePositions){
    const targetRotations = new Array(targetBones.length);
    const targetPositions = new Array(targetBones.length);
    for(let i=0;i<targetBones.length;i++){
      targetRotations[i] = [0,0,0,1];
      targetPositions[i] = targetBones[i].position.slice();
    }
    for(const [srcIdx, tgtIdx] of mapper._map){
      if(sourceRotations[srcIdx]) targetRotations[tgtIdx] = sourceRotations[srcIdx].slice();
      if(sourcePositions && sourcePositions[srcIdx]) targetPositions[tgtIdx] = sourcePositions[srcIdx].slice();
    }
    return { rotations: targetRotations, positions: targetPositions };
  }
  function retargetAnimation(sourceClip){
    const targetTracks = [];
    for(const track of sourceClip.tracks){
      const srcBoneIdx = findBoneByName(sourceBones, track.boneName);
      if(srcBoneIdx < 0) continue;
      const tgtBoneIdx = mapBone(srcBoneIdx);
      if(tgtBoneIdx < 0) continue;
      targetTracks.push({
        boneName: targetBones[tgtBoneIdx].name,
        type: track.type,
        keyframes: track.keyframes.map(kf=>({time:kf.time, value:kf.value.slice()})),
      });
    }
    return createAnimationClip(sourceClip.name + '_retargeted', sourceClip.duration, targetTracks);
  }
  console.log('[BoneMapper] 创建完成 source=' + sourceBones.length + ' target=' + targetBones.length);
  return { autoMap, mapBone, setMapping, clearMapping, getMappingCount, retargetPose, retargetAnimation, mapper };
}

/* ===== 动画压缩系统 ===== */
function compressAnimationClip(clip, options){
  const opt = options || {};
  const positionTolerance = opt.positionTolerance || 0.001;
  const rotationTolerance = opt.rotationTolerance || 0.001;
  const scaleTolerance = opt.scaleTolerance || 0.001;
  const compressedTracks = [];
  for(const track of clip.tracks){
    if(track.keyframes.length <= 2){
      compressedTracks.push({...track, keyframes: track.keyframes.slice()});
      continue;
    }
    const tol = track.type === 'rotation' ? rotationTolerance : track.type === 'position' ? positionTolerance : scaleTolerance;
    const compressed = [track.keyframes[0]];
    for(let i=1;i<track.keyframes.length-1;i++){
      const prev = compressed[compressed.length-1];
      const curr = track.keyframes[i];
      const next = track.keyframes[i+1];
      const interpolated = interpolateKeyframe(prev, next, curr.time, track.type);
      if(!keyframeClose(curr, interpolated, tol)){
        compressed.push(curr);
      }
    }
    compressed.push(track.keyframes[track.keyframes.length-1]);
    compressedTracks.push({...track, keyframes: compressed});
  }
  const originalCount = clip.tracks.reduce((sum,t)=>sum+t.keyframes.length,0);
  const compressedCount = compressedTracks.reduce((sum,t)=>sum+t.keyframes.length,0);
  console.log('[AnimationCompressor] 压缩完成 ' + originalCount + ' -> ' + compressedCount + ' (' + (100-compressedCount/originalCount*100).toFixed(1) + '% 减少)');
  return createAnimationClip(clip.name + '_compressed', clip.duration, compressedTracks);
}
function interpolateKeyframe(a, b, time, type){
  const t = (time - a.time) / (b.time - a.time || 1);
  if(type === 'rotation'){
    const q = [0,0,0,1];
    Q.slerp(q, a.value, b.value, t);
    return {time, value:q};
  } else {
    return {time, value:[a.value[0]+(b.value[0]-a.value[0])*t, a.value[1]+(b.value[1]-a.value[1])*t, a.value[2]+(b.value[2]-a.value[2])*t]};
  }
}
function keyframeClose(a, b, tol){
  if(a.value.length !== b.value.length) return false;
  for(let i=0;i<a.value.length;i++){
    if(Math.abs(a.value[i]-b.value[i]) > tol) return false;
  }
  return true;
}
function quantizeAnimationClip(clip, bits){
  bits = bits || 16;
  const maxVal = (1 << bits) - 1;
  const quantizedTracks = [];
  for(const track of clip.tracks){
    const quantized = track.keyframes.map(kf=>({
      time: Math.round(kf.time * 1000) / 1000,
      value: kf.value.map(v=>Math.round(v * maxVal) / maxVal),
    }));
    quantizedTracks.push({...track, keyframes: quantized});
  }
  return createAnimationClip(clip.name + '_quantized', clip.duration, quantizedTracks);
}
function serializeAnimationClip(clip){
  return JSON.stringify({
    name: clip.name,
    duration: clip.duration,
    loop: clip.loop,
    tracks: clip.tracks.map(t=>({
      boneName: t.boneName,
      type: t.type,
      keyframes: t.keyframes.map(kf=>({time:kf.time, value:Array.from(kf.value)})),
    })),
  });
}
function deserializeAnimationClip(json){
  const data = JSON.parse(json);
  const tracks = data.tracks.map(t=>({
    boneName: t.boneName,
    type: t.type,
    keyframes: t.keyframes.map(kf=>({time:kf.time, value:new Float32Array(kf.value)})),
  }));
  const clip = createAnimationClip(data.name, data.duration, tracks);
  clip.loop = data.loop;
  return clip;
}

/* ===== 渲染管线系统 ===== */
const RenderPassType = { SHADOW: 0, OPAQUE: 1, TRANSPARENT: 2, OVERLAY: 3, POST_PROCESS: 4 };
function createRenderPipeline(gl, options){
  const opt = options || {};
  const pipeline = {
    gl: gl,
    passes: [],
    _activePass: null,
    width: opt.width || 800,
    height: opt.height || 600,
    _stats: { drawCalls:0, triangles:0, passes:0 },
  };
  function createPass(type, name, options){
    const opt = options || {};
    return {
      type: type,
      name: name || 'pass',
      enabled: true,
      clearColor: opt.clearColor || [0,0,0,0],
      clearDepth: opt.clearDepth !== undefined ? opt.clearDepth : 1,
      clearStencil: opt.clearStencil || 0,
      framebuffer: opt.framebuffer || null,
      viewport: opt.viewport || null,
      cullFace: opt.cullFace !== undefined ? opt.cullFace : true,
      depthTest: opt.depthTest !== undefined ? opt.depthTest : true,
      depthWrite: opt.depthWrite !== undefined ? opt.depthWrite : true,
      blending: opt.blending || false,
      blendFunc: opt.blendFunc || null,
      objects: [],
      _stats: { drawCalls:0, triangles:0 },
    };
  }
  function addPass(pass){ pipeline.passes.push(pass); return pass; }
  function removePass(pass){
    const idx = pipeline.passes.indexOf(pass);
    if(idx >= 0) pipeline.passes.splice(idx,1);
  }
  function getPass(name){ return pipeline.passes.find(p=>p.name===name); }
  function beginPass(pass){
    pipeline._activePass = pass;
    pipeline._stats.passes++;
    if(pass.framebuffer) pass.framebuffer.bind();
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,pipeline.width,pipeline.height); }
    if(pass.viewport) gl.viewport(pass.viewport[0], pass.viewport[1], pass.viewport[2], pass.viewport[3]);
    gl.clearColor(pass.clearColor[0], pass.clearColor[1], pass.clearColor[2], pass.clearColor[3]);
    let clearBits = 0;
    if(pass.clearColor) clearBits |= gl.COLOR_BUFFER_BIT;
    if(pass.clearDepth !== false) clearBits |= gl.DEPTH_BUFFER_BIT;
    if(clearBits) gl.clear(clearBits);
    if(pass.cullFace) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    if(pass.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(pass.depthWrite);
    if(pass.blending){ gl.enable(gl.BLEND); if(pass.blendFunc) gl.blendFunc(pass.blendFunc[0], pass.blendFunc[1]); }
    else gl.disable(gl.BLEND);
  }
  function endPass(){
    pipeline._activePass = null;
  }
  function renderObject(object, program, uniforms){
    if(!pipeline._activePass) return;
    pipeline._stats.drawCalls++;
    pipeline._activePass._stats.drawCalls++;
    if(object.triangleCount) pipeline._stats.triangles += object.triangleCount;
  }
  function execute(camera, scene){
    pipeline._stats = { drawCalls:0, triangles:0, passes:0 };
    for(const pass of pipeline.passes){
      if(!pass.enabled) continue;
      beginPass(pass);
      for(const obj of pass.objects){
        if(obj.render) obj.render(camera, pass);
      }
      endPass();
    }
    return pipeline._stats;
  }
  function resize(w, h){
    pipeline.width = w; pipeline.height = h;
    for(const pass of pipeline.passes){
      if(pass.framebuffer) pass.framebuffer.resize(w, h);
    }
  }
  function getStats(){ return {...pipeline._stats}; }
  console.log('[RenderPipeline] 创建完成 passes=' + pipeline.passes.length);
  return { createPass, addPass, removePass, getPass, beginPass, endPass, renderObject, execute, resize, getStats, pipeline };
}

/* ===== 天空盒系统 ===== */
function createSkybox(gl, texture, options){
  const opt = options || {};
  const sb = {
    gl: gl,
    texture: texture || null,
    size: opt.size || 500,
    rotation: opt.rotation || 0,
    _geometry: null,
    _program: null,
    _positionBuffer: null,
    _indexBuffer: null,
  };
  function createCubeGeometry(size){
    const s = size/2;
    const positions = new Float32Array([
      -s,-s, s,  s,-s, s,  s, s, s, -s, s, s,
      -s,-s,-s, -s, s,-s,  s, s,-s,  s,-s,-s,
      -s, s,-s, -s, s, s,  s, s, s,  s, s,-s,
      -s,-s,-s,  s,-s,-s,  s,-s, s, -s,-s, s,
       s,-s,-s,  s, s,-s,  s, s, s,  s,-s, s,
      -s,-s,-s, -s,-s, s, -s, s, s, -s, s,-s,
    ]);
    const indices = new Uint16Array([
      0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11,
      12,13,14, 12,14,15, 16,17,18, 16,18,19, 20,21,22, 20,22,23,
    ]);
    return { positions, indices };
  }
  const geo = createCubeGeometry(sb.size);
  sb._geometry = geo;
  sb._positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sb._positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geo.positions, gl.STATIC_DRAW);
  sb._indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sb._indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
  const vsSrc = 'attribute vec3 aPos; uniform mat4 uViewProj; uniform float uRotation; varying vec3 vDir; void main(){ float c=cos(uRotation), s=sin(uRotation); vec3 p=vec3(aPos.x*c+aPos.z*s, aPos.y, -aPos.x*s+aPos.z*c); vDir=p; gl_Position=(uViewProj*vec4(p,1.0)).xyww; }';
  const fsSrc = 'precision highp float; varying vec3 vDir; uniform samplerCube uTex; uniform vec3 uColor; uniform int uHasTex; void main(){ if(uHasTex==1){ gl_FragColor=textureCube(uTex, normalize(vDir)); } else { vec3 d=normalize(vDir); float t=d.y*0.5+0.5; vec3 sky=mix(vec3(0.4,0.6,0.9), vec3(0.8,0.9,1.0), t); gl_FragColor=vec4(sky*uColor,1.0); } }';
  function compileShader(type, src){ const sh=gl.createShader(type); gl.shaderSource(sh,src); gl.compileShader(sh); return sh; }
  const vs=compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs=compileShader(gl.FRAGMENT_SHADER, fsSrc);
  sb._program = gl.createProgram();
  gl.attachShader(sb._program, vs);
  gl.attachShader(sb._program, fs);
  gl.linkProgram(sb._program);
  sb._aPos = gl.getAttribLocation(sb._program, 'aPos');
  sb._uViewProj = gl.getUniformLocation(sb._program, 'uViewProj');
  sb._uRotation = gl.getUniformLocation(sb._program, 'uRotation');
  sb._uTex = gl.getUniformLocation(sb._program, 'uTex');
  sb._uColor = gl.getUniformLocation(sb._program, 'uColor');
  sb._uHasTex = gl.getUniformLocation(sb._program, 'uHasTex');
  function render(viewProj){
    gl.useProgram(sb._program);
    gl.uniformMatrix4fv(sb._uViewProj, false, viewProj);
    gl.uniform1f(sb._uRotation, sb.rotation);
    gl.uniform3f(sb._uColor, 1,1,1);
    gl.uniform1i(sb._uHasTex, sb.texture ? 1 : 0);
    if(sb.texture){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, sb.texture); gl.uniform1i(sb._uTex, 0); }
    gl.bindBuffer(gl.ARRAY_BUFFER, sb._positionBuffer);
    gl.enableVertexAttribArray(sb._aPos);
    gl.vertexAttribPointer(sb._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sb._indexBuffer);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, sb._geometry.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
  }
  function dispose(){
    gl.deleteBuffer(sb._positionBuffer);
    gl.deleteBuffer(sb._indexBuffer);
    gl.deleteProgram(sb._program);
  }
  console.log('[Skybox] 创建完成 size=' + sb.size);
  return { render, dispose, sb };
}
function createGradientSkybox(gl, topColor, bottomColor, options){
  const sb = createSkybox(gl, null, options);
  sb.sb._topColor = topColor || [0.4,0.6,0.9];
  sb.sb._bottomColor = bottomColor || [0.8,0.9,1.0];
  const origRender = sb.render;
  sb.render = function(viewProj){
    gl.useProgram(sb.sb._program);
    gl.uniformMatrix4fv(sb.sb._uViewProj, false, viewProj);
    gl.uniform1f(sb.sb._uRotation, sb.sb.rotation);
    gl.uniform3fv(sb.sb._uColor, [1,1,1]);
    gl.uniform1i(sb.sb._uHasTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, sb.sb._positionBuffer);
    gl.enableVertexAttribArray(sb.sb._aPos);
    gl.vertexAttribPointer(sb.sb._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sb.sb._indexBuffer);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, sb.sb._geometry.indices.length, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
  };
  return sb;
}

/* ===== 雾效系统 ===== */
const FogType = { LINEAR: 0, EXPONENTIAL: 1, EXPONENTIAL2: 2 };
function createFog(type, color, near, far, density){
  return {
    type: type !== undefined ? type : FogType.LINEAR,
    color: color ? color.slice() : [0.5,0.5,0.5],
    near: near || 1,
    far: far || 100,
    density: density || 0.01,
    enabled: true,
  };
}
function applyFogUniforms(program, fog, cameraPosition){
  if(!fog || !fog.enabled) return;
  const uType = program.uniforms ? program.uniforms.uFogType : null;
  if(uType) gl.uniform1i(uType, fog.type);
  const uColor = program.uniforms ? program.uniforms.uFogColor : null;
  if(uColor) gl.uniform3fv(uColor, fog.color);
  const uNear = program.uniforms ? program.uniforms.uFogNear : null;
  if(uNear) gl.uniform1f(uNear, fog.near);
  const uFar = program.uniforms ? program.uniforms.uFogFar : null;
  if(uFar) gl.uniform1f(uFar, fog.far);
  const uDensity = program.uniforms ? program.uniforms.uFogDensity : null;
  if(uDensity) gl.uniform1f(uDensity, fog.density);
}
function getFogShaderCode(){
  return `
    uniform int uFogType;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uFogDensity;
    float computeFog(float dist){
      if(uFogType == 0) return clamp((uFogFar - dist) / (uFogFar - uFogNear), 0.0, 1.0);
      else if(uFogType == 1) return exp(-uFogDensity * dist);
      else return exp(-uFogDensity * uFogDensity * dist * dist);
    }
    vec3 applyFog(vec3 color, float dist){
      float f = computeFog(dist);
      return mix(uFogColor, color, f);
    }
  `;
}

/* ===== 后期处理扩展（SSAO、景深、运动模糊） ===== */
function createSSAO(gl, width, height, options){
  const opt = options || {};
  const ssao = {
    gl: gl,
    width: width,
    height: height,
    radius: opt.radius || 0.5,
    bias: opt.bias || 0.025,
    power: opt.power || 1,
    samples: opt.samples || 32,
    enabled: true,
    _kernel: [],
    _noiseTexture: null,
    _framebuffer: null,
    _blurFramebuffer: null,
    _program: null,
    _blurProgram: null,
  };
  for(let i=0;i<ssao.samples;i++){
    let sample = [Math.random()*2-1, Math.random()*2-1, Math.random()];
    const len = Math.sqrt(sample[0]**2+sample[1]**2+sample[2]**2);
    sample = [sample[0]/len, sample[1]/len, sample[2]/len];
    const scale = i/ssao.samples;
    const lerpScale = 0.1 + scale*scale*0.9;
    ssao._kernel.push([sample[0]*lerpScale, sample[1]*lerpScale, sample[2]*lerpScale]);
  }
  const noiseData = new Float32Array(16*3);
  for(let i=0;i<16;i++){ noiseData[i*3]=Math.random()*2-1; noiseData[i*3+1]=Math.random()*2-1; noiseData[i*3+2]=0; }
  ssao._noiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ssao._noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 4, 4, 0, gl.RGB, gl.FLOAT, noiseData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  function createFB(w,h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {framebuffer:fb, texture:tex};
  }
  ssao._framebuffer = createFB(width, height);
  ssao._blurFramebuffer = createFB(width, height);
  const vsSrc = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const ssaoFs = 'precision highp float; varying vec2 vUV; uniform sampler2D uPosition; uniform sampler2D uNormal; uniform sampler2D uNoise; uniform vec3 uKernel[32]; uniform mat4 uProjection; uniform float uRadius; uniform float uBias; uniform float uPower; uniform vec2 uNoiseScale; void main(){ vec3 fragPos=texture2D(uPosition,vUV).xyz; vec3 normal=normalize(texture2D(uNormal,vUV).xyz); vec3 randomVec=normalize(texture2D(uNoise,vUV*uNoiseScale).xyz); vec3 tangent=normalize(randomVec-normal*dot(randomVec,normal)); vec3 bitangent=cross(normal,tangent); mat3 TBN=mat3(tangent,bitangent,normal); float occlusion=0.0; for(int i=0;i<32;i++){ vec3 samplePos=TBN*uKernel[i]; samplePos=fragPos+samplePos*uRadius; vec4 offset=uProjection*vec4(samplePos,1.0); offset.xyz/=offset.w; offset.xyz=offset.xyz*0.5+0.5; float sampleDepth=texture2D(uPosition,offset.xy).z; occlusion+=(sampleDepth>=samplePos.z+uBias?1.0:0.0); } occlusion=1.0-(occlusion/32.0); gl_FragColor=vec4(vec3(pow(occlusion,uPower)),1.0); }';
  const blurFs = 'precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; void main(){ float result=0.0; for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){ vec2 offset=vec2(float(x),float(y))*uTexel; result+=texture2D(uTex,vUV+offset).r; } } gl_FragColor=vec4(vec3(result/25.0),1.0); }';
  function compileShader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER, vsSrc);
  ssao._program = gl.createProgram();
  gl.attachShader(ssao._program, vs);
  gl.attachShader(ssao._program, compileShader(gl.FRAGMENT_SHADER, ssaoFs));
  gl.linkProgram(ssao._program);
  ssao._blurProgram = gl.createProgram();
  gl.attachShader(ssao._blurProgram, vs);
  gl.attachShader(ssao._blurProgram, compileShader(gl.FRAGMENT_SHADER, blurFs));
  gl.linkProgram(ssao._blurProgram);
  function render(positionTexture, normalTexture, projectionMatrix){
    if(!ssao.enabled) return null;
    const quad = new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qbuf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssao._framebuffer.framebuffer);
    gl.viewport(0,0,ssao.width,ssao.height);
    gl.useProgram(ssao._program);
    const aPos = gl.getAttribLocation(ssao._program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, positionTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uPosition'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, normalTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNormal'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ssao._noiseTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNoise'),2);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssao._program,'uProjection'), false, projectionMatrix);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uRadius'), ssao.radius);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uBias'), ssao.bias);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uPower'), ssao.power);
    gl.uniform2f(gl.getUniformLocation(ssao._program,'uNoiseScale'), ssao.width/4, ssao.height/4);
    const kernelLoc = gl.getUniformLocation(ssao._program, 'uKernel[0]');
    const kernelFlat = new Float32Array(ssao.samples*3);
    for(let i=0;i<ssao.samples;i++){ kernelFlat[i*3]=ssao._kernel[i][0]; kernelFlat[i*3+1]=ssao._kernel[i][1]; kernelFlat[i*3+2]=ssao._kernel[i][2]; }
    gl.uniform3fv(kernelLoc, kernelFlat);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssao._blurFramebuffer.framebuffer);
    gl.useProgram(ssao._blurProgram);
    const bPos = gl.getAttribLocation(ssao._blurProgram, 'aPos');
    gl.enableVertexAttribArray(bPos);
    gl.vertexAttribPointer(bPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ssao._framebuffer.texture); gl.uniform1i(gl.getUniformLocation(ssao._blurProgram,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(ssao._blurProgram,'uTexel'), 1/ssao.width, 1/ssao.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.deleteBuffer(qbuf);
    return ssao._blurFramebuffer.texture;
  }
  function resize(w,h){ ssao.width=w; ssao.height=h; }
  function dispose(){
    gl.deleteTexture(ssao._noiseTexture);
    gl.deleteFramebuffer(ssao._framebuffer.framebuffer);
    gl.deleteTexture(ssao._framebuffer.texture);
    gl.deleteFramebuffer(ssao._blurFramebuffer.framebuffer);
    gl.deleteTexture(ssao._blurFramebuffer.texture);
    gl.deleteProgram(ssao._program);
    gl.deleteProgram(ssao._blurProgram);
  }
  console.log('[SSAO] 创建完成 ' + width + 'x' + height + ' samples=' + ssao.samples);
  return { render, resize, dispose, ssao };
}
function createDepthOfField(gl, width, height, options){
  const opt = options || {};
  const dof = {
    gl: gl, width, height,
    focus: opt.focus || 10,
    aperture: opt.aperture || 0.025,
    maxBlur: opt.maxBlur || 0.01,
    enabled: true,
    _program: null, _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  dof._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc='precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uDepth; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur; uniform vec2 uTexel; void main(){ float depth=texture2D(uDepth,vUV).r; float blur=abs(depth-uFocus)*uAperture; blur=min(blur,uMaxBlur); vec4 color=vec4(0.0); float total=0.0; for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ vec2 offset=vec2(float(x),float(y))*uTexel*blur*10.0; float w=1.0-length(vec2(float(x),float(y)))*0.1; color+=texture2D(uColor,vUV+offset)*w; total+=w; } } gl_FragColor=color/total; }';
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  dof._program=gl.createProgram();
  gl.attachShader(dof._program,vs);
  gl.attachShader(dof._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(dof._program);
  function render(colorTexture, depthTexture){
    if(!dof.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dof._framebuffer.framebuffer);
    gl.viewport(0,0,dof.width,dof.height);
    gl.useProgram(dof._program);
    const aPos=gl.getAttribLocation(dof._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,depthTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uDepth'),1);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uFocus'),dof.focus);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uAperture'),dof.aperture);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uMaxBlur'),dof.maxBlur);
    gl.uniform2f(gl.getUniformLocation(dof._program,'uTexel'),1/dof.width,1/dof.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return dof._framebuffer.texture;
  }
  function resize(w,h){ dof.width=w; dof.height=h; }
  function dispose(){ gl.deleteFramebuffer(dof._framebuffer.framebuffer); gl.deleteTexture(dof._framebuffer.texture); gl.deleteProgram(dof._program); }
  console.log('[DepthOfField] 创建完成 ' + width + 'x' + height);
  return { render, resize, dispose, dof };
}
function createMotionBlur(gl, width, height, options){
  const opt = options || {};
  const mb = {
    gl: gl, width, height,
    strength: opt.strength || 0.5,
    samples: opt.samples || 16,
    enabled: true,
    _program: null, _framebuffer: null, _velocityTexture: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mb._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc='precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uVelocity; uniform float uStrength; uniform int uSamples; void main(){ vec2 velocity=texture2D(uVelocity,vUV).xy*uStrength; vec4 color=vec4(0.0); for(int i=0;i<16;i++){ if(i>=uSamples) break; float t=float(i)/float(uSamples); vec2 offset=velocity*(t-0.5); color+=texture2D(uColor,vUV+offset); } gl_FragColor=color/float(uSamples); }';
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mb._program=gl.createProgram();
  gl.attachShader(mb._program,vs);
  gl.attachShader(mb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mb._program);
  function render(colorTexture, velocityTexture){
    if(!mb.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mb._framebuffer.framebuffer);
    gl.viewport(0,0,mb.width,mb.height);
    gl.useProgram(mb._program);
    const aPos=gl.getAttribLocation(mb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,velocityTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uVelocity'),1);
    gl.uniform1f(gl.getUniformLocation(mb._program,'uStrength'),mb.strength);
    gl.uniform1i(gl.getUniformLocation(mb._program,'uSamples'),mb.samples);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mb._framebuffer.texture;
  }
  function resize(w,h){ mb.width=w; mb.height=h; }
  function dispose(){ gl.deleteFramebuffer(mb._framebuffer.framebuffer); gl.deleteTexture(mb._framebuffer.texture); gl.deleteProgram(mb._program); }
  console.log('[MotionBlur] 创建完成 ' + width + 'x' + height + ' samples=' + mb.samples);
  return { render, resize, dispose, mb };
}

/* ===== 地形生成系统 ===== */
function createTerrain(width, depth, segmentsW, segmentsD, options){
  const opt = options || {};
  const terrain = {
    width: width,
    depth: depth,
    segmentsW: segmentsW || 64,
    segmentsD: segmentsD || 64,
    heightScale: opt.heightScale || 10,
    noiseScale: opt.noiseScale || 0.05,
    octaves: opt.octaves || 4,
    seed: opt.seed || Math.random()*10000,
    heights: null,
    geometry: null,
  };
  function generateHeights(){
    const heights = new Float32Array((terrain.segmentsW+1)*(terrain.segmentsD+1));
    for(let z=0;z<=terrain.segmentsD;z++){
      for(let x=0;x<=terrain.segmentsW;x++){
        const wx = (x/terrain.segmentsW-0.5)*terrain.width;
        const wz = (z/terrain.segmentsD-0.5)*terrain.depth;
        let h = 0, amp = 1, freq = terrain.noiseScale, maxAmp = 0;
        for(let o=0;o<terrain.octaves;o++){
          h += Noise.perlin2(wx*freq+terrain.seed, wz*freq+terrain.seed) * amp;
          maxAmp += amp;
          amp *= 0.5;
          freq *= 2;
        }
        heights[z*(terrain.segmentsW+1)+x] = (h/maxAmp) * terrain.heightScale;
      }
    }
    terrain.heights = heights;
    return heights;
  }
  function generateGeometry(){
    if(!terrain.heights) generateHeights();
    const positions = [], normals = [], uvs = [], indices = [];
    for(let z=0;z<=terrain.segmentsD;z++){
      for(let x=0;x<=terrain.segmentsW;x++){
        const wx = (x/terrain.segmentsW-0.5)*terrain.width;
        const wz = (z/terrain.segmentsD-0.5)*terrain.depth;
        const h = terrain.heights[z*(terrain.segmentsW+1)+x];
        positions.push(wx, h, wz);
        uvs.push(x/terrain.segmentsW, z/terrain.segmentsD);
      }
    }
    for(let z=0;z<terrain.segmentsD;z++){
      for(let x=0;x<terrain.segmentsW;x++){
        const a=z*(terrain.segmentsW+1)+x, b=a+1, c=a+(terrain.segmentsW+1), d=c+1;
        indices.push(a,c,b, b,c,d);
      }
    }
    const geo = { positions:new Float32Array(positions), normals:new Float32Array(positions.length), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
    computeVertexNormals(geo);
    terrain.geometry = geo;
    return geo;
  }
  function getHeightAt(x, z){
    if(!terrain.heights) return 0;
    const fx = (x/terrain.width+0.5)*terrain.segmentsW;
    const fz = (z/terrain.depth+0.5)*terrain.segmentsD;
    const ix = Math.max(0, Math.min(terrain.segmentsW-1, Math.floor(fx)));
    const iz = Math.max(0, Math.min(terrain.segmentsD-1, Math.floor(fz)));
    const tx = fx - ix, tz = fz - iz;
    const h00 = terrain.heights[iz*(terrain.segmentsW+1)+ix];
    const h10 = terrain.heights[iz*(terrain.segmentsW+1)+ix+1];
    const h01 = terrain.heights[(iz+1)*(terrain.segmentsW+1)+ix];
    const h11 = terrain.heights[(iz+1)*(terrain.segmentsW+1)+ix+1];
    return h00*(1-tx)*(1-tz) + h10*tx*(1-tz) + h01*(1-tx)*tz + h11*tx*tz;
  }
  function getNormalAt(x, z){
    const eps = 0.1;
    const hL = getHeightAt(x-eps, z);
    const hR = getHeightAt(x+eps, z);
    const hD = getHeightAt(x, z-eps);
    const hU = getHeightAt(x, z+eps);
    const nx = hL-hR, ny = 2*eps, nz = hD-hU;
    const len = Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    return [nx/len, ny/len, nz/len];
  }
  function applyHeightMap(imageData){
    const heights = new Float32Array((terrain.segmentsW+1)*(terrain.segmentsD+1));
    const imgW = imageData.width, imgH = imageData.height;
    for(let z=0;z<=terrain.segmentsD;z++){
      for(let x=0;x<=terrain.segmentsW;x++){
        const ix = Math.floor(x/terrain.segmentsW*imgW);
        const iz = Math.floor(z/terrain.segmentsD*imgH);
        const idx = (iz*imgW+ix)*4;
        const gray = (imageData.data[idx]+imageData.data[idx+1]+imageData.data[idx+2])/3/255;
        heights[z*(terrain.segmentsW+1)+x] = (gray-0.5)*2*terrain.heightScale;
      }
    }
    terrain.heights = heights;
    return generateGeometry();
  }
  console.log('[Terrain] 创建完成 ' + terrain.segmentsW + 'x' + terrain.segmentsD);
  return { generateHeights, generateGeometry, getHeightAt, getNormalAt, applyHeightMap, terrain };
}

/* ===== 水体渲染系统 ===== */
function createWater(gl, width, depth, segments, options){
  const opt = options || {};
  const water = {
    gl: gl,
    width: width,
    depth: depth,
    segments: segments || 32,
    waveHeight: opt.waveHeight || 0.5,
    waveSpeed: opt.waveSpeed || 1,
    waveFrequency: opt.waveFrequency || 0.1,
    color: opt.color ? opt.color.slice() : [0.2,0.4,0.6,0.8],
    transparency: opt.transparency !== undefined ? opt.transparency : 0.7,
    reflectivity: opt.reflectivity !== undefined ? opt.reflectivity : 0.5,
    _geometry: null,
    _program: null,
    _positionBuffer: null,
    _indexBuffer: null,
    _normalBuffer: null,
    _time: 0,
  };
  function createGeometry(){
    const positions = [], normals = [], indices = [];
    for(let z=0;z<=water.segments;z++){
      for(let x=0;x<=water.segments;x++){
        const wx = (x/water.segments-0.5)*water.width;
        const wz = (z/water.segments-0.5)*water.depth;
        positions.push(wx, 0, wz);
        normals.push(0,1,0);
      }
    }
    for(let z=0;z<water.segments;z++){
      for(let x=0;x<water.segments;x++){
        const a=z*(water.segments+1)+x, b=a+1, c=a+(water.segments+1), d=c+1;
        indices.push(a,c,b, b,c,d);
      }
    }
    return { positions:new Float32Array(positions), normals:new Float32Array(normals), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
  }
  water._geometry = createGeometry();
  water._positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, water._positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, water._geometry.positions, gl.DYNAMIC_DRAW);
  water._normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, water._normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, water._geometry.normals, gl.DYNAMIC_DRAW);
  water._indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, water._indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, water._geometry.indices, gl.STATIC_DRAW);
  const vsSrc = 'attribute vec3 aPos; attribute vec3 aNormal; uniform mat4 uViewProj; uniform float uTime; uniform float uWaveHeight; uniform float uWaveSpeed; uniform float uWaveFrequency; varying vec3 vNormal; varying vec3 vWorldPos; varying float vHeight; void main(){ float wave1=sin(aPos.x*uWaveFrequency+uTime*uWaveSpeed)*uWaveHeight; float wave2=sin(aPos.z*uWaveFrequency*1.3+uTime*uWaveSpeed*0.8)*uWaveHeight*0.5; float wave3=sin((aPos.x+aPos.z)*uWaveFrequency*0.7+uTime*uWaveSpeed*1.2)*uWaveHeight*0.3; float h=wave1+wave2+wave3; vec3 pos=aPos; pos.y=h; vHeight=h; vWorldPos=pos; vNormal=aNormal; gl_Position=uViewProj*vec4(pos,1.0); }';
  const fsSrc = 'precision highp float; varying vec3 vNormal; varying vec3 vWorldPos; varying float vHeight; uniform vec3 uColor; uniform float uTransparency; uniform float uReflectivity; uniform vec3 uCameraPos; uniform vec3 uLightDir; void main(){ vec3 viewDir=normalize(uCameraPos-vWorldPos); vec3 normal=normalize(vNormal); float fresnel=pow(1.0-max(dot(viewDir,normal),0.0),3.0); vec3 reflectDir=reflect(-viewDir,normal); float spec=pow(max(dot(reflectDir,uLightDir),0.0),64.0); vec3 deepColor=uColor*0.5; vec3 shallowColor=uColor*1.2; vec3 waterColor=mix(deepColor,shallowColor,smoothstep(-1.0,1.0,vHeight)); vec3 finalColor=mix(waterColor,vec3(0.8,0.9,1.0),fresnel*uReflectivity); finalColor+=vec3(1.0)*spec*0.5; gl_FragColor=vec4(finalColor,uTransparency*(0.7+fresnel*0.3)); }';
  function compileShader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs=compileShader(gl.FRAGMENT_SHADER, fsSrc);
  water._program = gl.createProgram();
  gl.attachShader(water._program, vs);
  gl.attachShader(water._program, fs);
  gl.linkProgram(water._program);
  water._aPos = gl.getAttribLocation(water._program, 'aPos');
  water._aNormal = gl.getAttribLocation(water._program, 'aNormal');
  water._uViewProj = gl.getUniformLocation(water._program, 'uViewProj');
  water._uTime = gl.getUniformLocation(water._program, 'uTime');
  water._uWaveHeight = gl.getUniformLocation(water._program, 'uWaveHeight');
  water._uWaveSpeed = gl.getUniformLocation(water._program, 'uWaveSpeed');
  water._uWaveFrequency = gl.getUniformLocation(water._program, 'uWaveFrequency');
  water._uColor = gl.getUniformLocation(water._program, 'uColor');
  water._uTransparency = gl.getUniformLocation(water._program, 'uTransparency');
  water._uReflectivity = gl.getUniformLocation(water._program, 'uReflectivity');
  water._uCameraPos = gl.getUniformLocation(water._program, 'uCameraPos');
  water._uLightDir = gl.getUniformLocation(water._program, 'uLightDir');
  function update(dt){ water._time += dt; }
  function render(viewProj, cameraPosition, lightDirection){
    gl.useProgram(water._program);
    gl.uniformMatrix4fv(water._uViewProj, false, viewProj);
    gl.uniform1f(water._uTime, water._time);
    gl.uniform1f(water._uWaveHeight, water.waveHeight);
    gl.uniform1f(water._uWaveSpeed, water.waveSpeed);
    gl.uniform1f(water._uWaveFrequency, water.waveFrequency);
    gl.uniform3fv(water._uColor, water.color);
    gl.uniform1f(water._uTransparency, water.transparency);
    gl.uniform1f(water._uReflectivity, water.reflectivity);
    gl.uniform3fv(water._uCameraPos, cameraPosition);
    gl.uniform3fv(water._uLightDir, lightDirection);
    gl.bindBuffer(gl.ARRAY_BUFFER, water._positionBuffer);
    gl.enableVertexAttribArray(water._aPos);
    gl.vertexAttribPointer(water._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, water._normalBuffer);
    gl.enableVertexAttribArray(water._aNormal);
    gl.vertexAttribPointer(water._aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, water._indexBuffer);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, water._geometry.indexCount, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
  }
  function getHeightAt(x, z, time){
    const t = time !== undefined ? time : water._time;
    const wave1=Math.sin(x*water.waveFrequency+t*water.waveSpeed)*water.waveHeight;
    const wave2=Math.sin(z*water.waveFrequency*1.3+t*water.waveSpeed*0.8)*water.waveHeight*0.5;
    const wave3=Math.sin((x+z)*water.waveFrequency*0.7+t*water.waveSpeed*1.2)*water.waveHeight*0.3;
    return wave1+wave2+wave3;
  }
  function dispose(){
    gl.deleteBuffer(water._positionBuffer);
    gl.deleteBuffer(water._normalBuffer);
    gl.deleteBuffer(water._indexBuffer);
    gl.deleteProgram(water._program);
  }
  console.log('[Water] 创建完成 ' + water.segments + 'x' + water.segments);
  return { update, render, getHeightAt, dispose, water };
}

/* ===== 植被系统 ===== */
function createVegetationSystem(gl, options){
  const opt = options || {};
  const veg = {
    gl: gl,
    instances: [],
    _instanceData: null,
    _positionBuffer: null,
    _normalBuffer: null,
    _uvBuffer: null,
    _indexBuffer: null,
    _instanceBuffer: null,
    _program: null,
    _geometry: null,
    maxInstances: opt.maxInstances || 10000,
    windStrength: opt.windStrength || 0.1,
    windSpeed: opt.windSpeed || 1,
    _time: 0,
  };
  function createTreeGeometry(){
    const positions = [], normals = [], uvs = [], indices = [];
    const trunkH = 2, trunkR = 0.15, trunkSeg = 6;
    for(let i=0;i<=trunkSeg;i++){
      const a = i/trunkSeg*Math.PI*2;
      const x = Math.cos(a)*trunkR, z = Math.sin(a)*trunkR;
      positions.push(x,0,z, x,trunkH,z);
      normals.push(Math.cos(a),0,Math.sin(a), Math.cos(a),0,Math.sin(a));
      uvs.push(i/trunkSeg,0, i/trunkSeg,1);
    }
    for(let i=0;i<trunkSeg;i++){
      const a=i*2, b=a+1, c=a+2, d=a+3;
      indices.push(a,c,b, b,c,d);
    }
    const coneH = 1.5, coneR = 0.8, coneSeg = 8, coneLayers = 3;
    for(let l=0;l<coneLayers;l++){
      const baseY = trunkH + l*coneH*0.5;
      const topY = baseY + coneH;
      const baseR = coneR * (1-l*0.2);
      const topR = coneR * 0.3 * (1-l*0.2);
      for(let i=0;i<=coneSeg;i++){
        const a = i/coneSeg*Math.PI*2;
        positions.push(Math.cos(a)*baseR, baseY, Math.sin(a)*baseR);
        positions.push(Math.cos(a)*topR, topY, Math.sin(a)*topR);
        normals.push(Math.cos(a),0.5,Math.sin(a), Math.cos(a),0.5,Math.sin(a));
        uvs.push(i/coneSeg,l/coneLayers, i/coneSeg,(l+0.5)/coneLayers);
      }
      const baseIdx = positions.length/3 - (coneSeg+1)*2;
      for(let i=0;i<coneSeg;i++){
        const a=baseIdx+i*2, b=a+1, c=a+2, d=a+3;
        indices.push(a,c,b, b,c,d);
      }
    }
    return { positions:new Float32Array(positions), normals:new Float32Array(normals), uvs:new Float32Array(uvs), indices:new Uint32Array(indices), vertexCount:positions.length/3, indexCount:indices.length };
  }
  veg._geometry = createTreeGeometry();
  veg._positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, veg._positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, veg._geometry.positions, gl.STATIC_DRAW);
  veg._normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, veg._normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, veg._geometry.normals, gl.STATIC_DRAW);
  veg._uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, veg._uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, veg._geometry.uvs, gl.STATIC_DRAW);
  veg._indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, veg._indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, veg._geometry.indices, gl.STATIC_DRAW);
  veg._instanceData = new Float32Array(veg.maxInstances*4);
  veg._instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, veg._instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, veg._instanceData, gl.DYNAMIC_DRAW);
  const vsSrc = 'attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUV; attribute vec4 aInstance; uniform mat4 uViewProj; uniform float uTime; uniform float uWindStrength; uniform float uWindSpeed; varying vec2 vUV; varying vec3 vNormal; void main(){ vec3 pos=aPos; float wind=sin(uTime*uWindSpeed+aInstance.x*0.1+aInstance.z*0.1)*uWindStrength*pos.y*0.3; pos.x+=wind; pos.z+=wind*0.5; pos+=aInstance.xyz; vUV=aUV; vNormal=aNormal; gl_Position=uViewProj*vec4(pos,1.0); }';
  const fsSrc = 'precision highp float; varying vec2 vUV; varying vec3 vNormal; uniform vec3 uLightDir; void main(){ vec3 trunkColor=vec3(0.4,0.25,0.1); vec3 leafColor=vec3(0.15,0.4,0.1); vec3 color=vUV.y<0.3?trunkColor:leafColor; float diff=max(dot(normalize(vNormal),normalize(uLightDir)),0.0)*0.5+0.5; gl_FragColor=vec4(color*diff,1.0); }';
  function compileShader(type, src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER, vsSrc);
  const fs=compileShader(gl.FRAGMENT_SHADER, fsSrc);
  veg._program = gl.createProgram();
  gl.attachShader(veg._program, vs);
  gl.attachShader(veg._program, fs);
  gl.linkProgram(veg._program);
  veg._aPos = gl.getAttribLocation(veg._program, 'aPos');
  veg._aNormal = gl.getAttribLocation(veg._program, 'aNormal');
  veg._aUV = gl.getAttribLocation(veg._program, 'aUV');
  veg._aInstance = gl.getAttribLocation(veg._program, 'aInstance');
  veg._uViewProj = gl.getUniformLocation(veg._program, 'uViewProj');
  veg._uTime = gl.getUniformLocation(veg._program, 'uTime');
  veg._uWindStrength = gl.getUniformLocation(veg._program, 'uWindStrength');
  veg._uWindSpeed = gl.getUniformLocation(veg._program, 'uWindSpeed');
  veg._uLightDir = gl.getUniformLocation(veg._program, 'uLightDir');
  function addInstance(x, y, z, scale){
    if(veg.instances.length >= veg.maxInstances) return false;
    veg.instances.push([x, y, z, scale || 1]);
    return true;
  }
  function generateForest(terrain, count, areaWidth, areaDepth){
    for(let i=0;i<count;i++){
      const x = (Math.random()-0.5)*areaWidth;
      const z = (Math.random()-0.5)*areaDepth;
      const y = terrain ? terrain.getHeightAt(x, z) : 0;
      const scale = 0.8 + Math.random()*0.6;
      addInstance(x, y, z, scale);
    }
    updateInstanceBuffer();
  }
  function updateInstanceBuffer(){
    for(let i=0;i<veg.instances.length;i++){
      const inst = veg.instances[i];
      veg._instanceData[i*4]=inst[0];
      veg._instanceData[i*4+1]=inst[1];
      veg._instanceData[i*4+2]=inst[2];
      veg._instanceData[i*4+3]=inst[3];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, veg._instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, veg._instanceData.subarray(0, veg.instances.length*4));
  }
  function update(dt){ veg._time += dt; }
  function render(viewProj, lightDirection){
    if(veg.instances.length === 0) return;
    gl.useProgram(veg._program);
    gl.uniformMatrix4fv(veg._uViewProj, false, viewProj);
    gl.uniform1f(veg._uTime, veg._time);
    gl.uniform1f(veg._uWindStrength, veg.windStrength);
    gl.uniform1f(veg._uWindSpeed, veg.windSpeed);
    gl.uniform3fv(veg._uLightDir, lightDirection);
    gl.bindBuffer(gl.ARRAY_BUFFER, veg._positionBuffer);
    gl.enableVertexAttribArray(veg._aPos);
    gl.vertexAttribPointer(veg._aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, veg._normalBuffer);
    gl.enableVertexAttribArray(veg._aNormal);
    gl.vertexAttribPointer(veg._aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, veg._uvBuffer);
    gl.enableVertexAttribArray(veg._aUV);
    gl.vertexAttribPointer(veg._aUV, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, veg._instanceBuffer);
    gl.enableVertexAttribArray(veg._aInstance);
    gl.vertexAttribPointer(veg._aInstance, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(veg._aInstance, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, veg._indexBuffer);
    gl.drawElementsInstanced(gl.TRIANGLES, veg._geometry.indexCount, gl.UNSIGNED_INT, 0, veg.instances.length);
    gl.vertexAttribDivisor(veg._aInstance, 0);
  }
  function clear(){ veg.instances.length = 0; }
  function dispose(){
    gl.deleteBuffer(veg._positionBuffer);
    gl.deleteBuffer(veg._normalBuffer);
    gl.deleteBuffer(veg._uvBuffer);
    gl.deleteBuffer(veg._indexBuffer);
    gl.deleteBuffer(veg._instanceBuffer);
    gl.deleteProgram(veg._program);
  }
  console.log('[Vegetation] 创建完成 maxInstances=' + veg.maxInstances);
  return { addInstance, generateForest, updateInstanceBuffer, update, render, clear, dispose, veg };
}

/* ===== 光照探针系统 ===== */
function createLightProbe(position, options){
  const opt = options || {};
  return {
    position: position ? position.slice() : [0,0,0],
    radius: opt.radius || 10,
    intensity: opt.intensity !== undefined ? opt.intensity : 1,
    color: opt.color ? opt.color.slice() : [1,1,1],
    _sh: [
      [0,0,0], [0,0,0], [0,0,0], [0,0,0],
      [0,0,0], [0,0,0], [0,0,0], [0,0,0], [0,0,0],
    ],
    _dirty: true,
  };
}
function createLightProbeVolume(min, max, resolution, options){
  const opt = options || {};
  const volume = {
    min: min ? min.slice() : [-10,-10,-10],
    max: max ? max.slice() : [10,10,10],
    resolution: resolution || [4,4,4],
    probes: [],
    _data: null,
    _texture: null,
  };
  const count = volume.resolution[0]*volume.resolution[1]*volume.resolution[2];
  volume._data = new Float32Array(count*9*3);
  for(let z=0;z<volume.resolution[2];z++){
    for(let y=0;y<volume.resolution[1];y++){
      for(let x=0;x<volume.resolution[0];x++){
        const px = volume.min[0] + (x/(volume.resolution[0]-1))*(volume.max[0]-volume.min[0]);
        const py = volume.min[1] + (y/(volume.resolution[1]-1))*(volume.max[1]-volume.min[1]);
        const pz = volume.min[2] + (z/(volume.resolution[2]-1))*(volume.max[2]-volume.min[2]);
        const probe = createLightProbe([px,py,pz], opt);
        volume.probes.push(probe);
      }
    }
  }
  function updateProbeData(){
    for(let i=0;i<volume.probes.length;i++){
      const probe = volume.probes[i];
      for(let j=0;j<9;j++){
        volume._data[i*27+j*3]=probe._sh[j][0];
        volume._data[i*27+j*3+1]=probe._sh[j][1];
        volume._data[i*27+j*3+2]=probe._sh[j][2];
      }
    }
  }
  function sample(position){
    const fx = ((position[0]-volume.min[0])/(volume.max[0]-volume.min[0]))*(volume.resolution[0]-1);
    const fy = ((position[1]-volume.min[1])/(volume.max[1]-volume.min[1]))*(volume.resolution[1]-1);
    const fz = ((position[2]-volume.min[2])/(volume.max[2]-volume.min[2]))*(volume.resolution[2]-1);
    const ix = Math.max(0, Math.min(volume.resolution[0]-2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(volume.resolution[1]-2, Math.floor(fy)));
    const iz = Math.max(0, Math.min(volume.resolution[2]-2, Math.floor(fz)));
    const tx = fx-ix, ty=fy-iy, tz=fz-iz;
    const result = new Array(9).fill(null).map(()=>[0,0,0]);
    const indices = [
      [ix,iy,iz], [ix+1,iy,iz], [ix,iy+1,iz], [ix+1,iy+1,iz],
      [ix,iy,iz+1], [ix+1,iy,iz+1], [ix,iy+1,iz+1], [ix+1,iy+1,iz+1],
    ];
    const weights = [
      (1-tx)*(1-ty)*(1-tz), tx*(1-ty)*(1-tz), (1-tx)*ty*(1-tz), tx*ty*(1-tz),
      (1-tx)*(1-ty)*tz, tx*(1-ty)*tz, (1-tx)*ty*tz, tx*ty*tz,
    ];
    for(let c=0;c<8;c++){
      const idx = indices[c][2]*volume.resolution[0]*volume.resolution[1] + indices[c][1]*volume.resolution[0] + indices[c][0];
      const probe = volume.probes[idx];
      for(let j=0;j<9;j++){
        result[j][0] += probe._sh[j][0]*weights[c];
        result[j][1] += probe._sh[j][1]*weights[c];
        result[j][2] += probe._sh[j][2]*weights[c];
      }
    }
    return result;
  }
  function getProbeCount(){ return volume.probes.length; }
  console.log('[LightProbeVolume] 创建完成 ' + volume.resolution[0] + 'x' + volume.resolution[1] + 'x' + volume.resolution[2] + ' = ' + volume.probes.length + ' probes');
  return { updateProbeData, sample, getProbeCount, volume };
}
function evaluateSH(sh, normal){
  const x=normal[0], y=normal[1], z=normal[2];
  const c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
  const result = [0,0,0];
  for(let i=0;i<3;i++){
    result[i] = c4*sh[0][i] + c2*y*sh[1][i] + c2*z*sh[2][i] + c2*x*sh[3][i] +
                c1*x*y*sh[4][i] + c1*y*z*sh[5][i] + c3*z*z*sh[6][i] + c1*x*z*sh[7][i] + c5*(x*x-y*y)*sh[8][i];
  }
  return result;
}

/* ===== 反射探针系统 ===== */
function createReflectionProbe(position, options){
  const opt = options || {};
  return {
    position: position ? position.slice() : [0,0,0],
    radius: opt.radius || 20,
    intensity: opt.intensity !== undefined ? opt.intensity : 1,
    boxProjection: opt.boxProjection || false,
    boxMin: opt.boxMin ? opt.boxMin.slice() : [-10,-10,-10],
    boxMax: opt.boxMax ? opt.boxMax.slice() : [10,10,10],
    _cubemap: null,
    _irradianceMap: null,
    _prefilterMap: null,
    _brdfLUT: null,
    _dirty: true,
  };
}
function createReflectionProbeVolume(min, max, resolution, options){
  const opt = options || {};
  const volume = {
    min: min ? min.slice() : [-50,-50,-50],
    max: max ? max.slice() : [50,50,50],
    resolution: resolution || [3,3,3],
    probes: [],
  };
  for(let z=0;z<volume.resolution[2];z++){
    for(let y=0;y<volume.resolution[1];y++){
      for(let x=0;x<volume.resolution[0];x++){
        const px = volume.min[0] + (x/(volume.resolution[0]-1))*(volume.max[0]-volume.min[0]);
        const py = volume.min[1] + (y/(volume.resolution[1]-1))*(volume.max[1]-volume.min[1]);
        const pz = volume.min[2] + (z/(volume.resolution[2]-1))*(volume.max[2]-volume.min[2]);
        volume.probes.push(createReflectionProbe([px,py,pz], opt));
      }
    }
  }
  function sample(position){
    const fx = ((position[0]-volume.min[0])/(volume.max[0]-volume.min[0]))*(volume.resolution[0]-1);
    const fy = ((position[1]-volume.min[1])/(volume.max[1]-volume.min[1]))*(volume.resolution[1]-1);
    const fz = ((position[2]-volume.min[2])/(volume.max[2]-volume.min[2]))*(volume.resolution[2]-1);
    const ix = Math.max(0, Math.min(volume.resolution[0]-2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(volume.resolution[1]-2, Math.floor(fy)));
    const iz = Math.max(0, Math.min(volume.resolution[2]-2, Math.floor(fz)));
    const tx = fx-ix, ty=fy-iy, tz=fz-iz;
    const indices = [
      [ix,iy,iz], [ix+1,iy,iz], [ix,iy+1,iz], [ix+1,iy+1,iz],
      [ix,iy,iz+1], [ix+1,iy,iz+1], [ix,iy+1,iz+1], [ix+1,iy+1,iz+1],
    ];
    const weights = [
      (1-tx)*(1-ty)*(1-tz), tx*(1-ty)*(1-tz), (1-tx)*ty*(1-tz), tx*ty*(1-tz),
      (1-tx)*(1-ty)*tz, tx*(1-ty)*tz, (1-tx)*ty*tz, tx*ty*tz,
    ];
    let result = null;
    let maxWeight = 0;
    for(let c=0;c<8;c++){
      if(weights[c] > maxWeight){
        maxWeight = weights[c];
        const idx = indices[c][2]*volume.resolution[0]*volume.resolution[1] + indices[c][1]*volume.resolution[0] + indices[c][0];
        result = volume.probes[idx];
      }
    }
    return result;
  }
  function getProbeCount(){ return volume.probes.length; }
  console.log('[ReflectionProbeVolume] 创建完成 ' + volume.resolution[0] + 'x' + volume.resolution[1] + 'x' + volume.resolution[2] + ' = ' + volume.probes.length + ' probes');
  return { sample, getProbeCount, volume };
}

/* ===== 全局光照系统 ===== */
function createGlobalIllumination(options){
  const opt = options || {};
  const gi = {
    enabled: opt.enabled !== false,
    ambientIntensity: opt.ambientIntensity !== undefined ? opt.ambientIntensity : 0.3,
    ambientColor: opt.ambientColor ? opt.ambientColor.slice() : [0.5,0.5,0.5],
    bounceCount: opt.bounceCount || 2,
    rayCount: opt.rayCount || 256,
    maxRayDistance: opt.maxRayDistance || 100,
    indirectIntensity: opt.indirectIntensity !== undefined ? opt.indirectIntensity : 0.5,
    skyLightIntensity: opt.skyLightIntensity !== undefined ? opt.skyLightIntensity : 0.8,
    skyColor: opt.skyColor ? opt.skyColor.slice() : [0.6,0.7,0.9],
    groundColor: opt.groundColor ? opt.groundColor.slice() : [0.3,0.25,0.2],
    _lightProbes: [],
    _reflectionProbes: [],
    _voxelGrid: null,
    _voxelSize: opt.voxelSize || 0.5,
    _voxelGridSize: opt.voxelGridSize || 64,
  };
  function addLightProbe(probe){ gi._lightProbes.push(probe); return probe; }
  function addReflectionProbe(probe){ gi._reflectionProbes.push(probe); return probe; }
  function sampleIndirectLight(position, normal){
    if(!gi.enabled) return [0,0,0];
    let result = [
      gi.ambientColor[0]*gi.ambientIntensity,
      gi.ambientColor[1]*gi.ambientIntensity,
      gi.ambientColor[2]*gi.ambientIntensity,
    ];
    const skyFactor = Math.max(0, normal[1]) * gi.skyLightIntensity;
    const groundFactor = Math.max(0, -normal[1]) * 0.3;
    result[0] += gi.skyColor[0]*skyFactor + gi.groundColor[0]*groundFactor;
    result[1] += gi.skyColor[1]*skyFactor + gi.groundColor[1]*groundFactor;
    result[2] += gi.skyColor[2]*skyFactor + gi.groundColor[2]*groundFactor;
    for(const probe of gi._lightProbes){
      const dx = position[0]-probe.position[0];
      const dy = position[1]-probe.position[1];
      const dz = position[2]-probe.position[2];
      const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(dist < probe.radius){
        const attenuation = 1 - dist/probe.radius;
        const shResult = evaluateSH(probe._sh, normal);
        result[0] += shResult[0]*probe.intensity*attenuation*gi.indirectIntensity;
        result[1] += shResult[1]*probe.intensity*attenuation*gi.indirectIntensity;
        result[2] += shResult[2]*probe.intensity*attenuation*gi.indirectIntensity;
      }
    }
    return result;
  }
  function sampleReflection(position, normal, viewDir){
    if(!gi.enabled || gi._reflectionProbes.length === 0) return null;
    let nearest = null, nearestDist = Infinity;
    for(const probe of gi._reflectionProbes){
      const dx = position[0]-probe.position[0];
      const dy = position[1]-probe.position[1];
      const dz = position[2]-probe.position[2];
      const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(dist < probe.radius && dist < nearestDist){
        nearestDist = dist;
        nearest = probe;
      }
    }
    return nearest;
  }
  function initVoxelGrid(){
    gi._voxelGrid = new Uint8Array(gi._voxelGridSize*gi._voxelGridSize*gi._voxelGridSize);
    console.log('[GI] 体素网格初始化 ' + gi._voxelGridSize + '^3 size=' + gi._voxelSize);
  }
  function voxelizeScene(scene){
    if(!gi._voxelGrid) initVoxelGrid();
    gi._voxelGrid.fill(0);
    const half = gi._voxelGridSize*gi._voxelSize/2;
    function voxelizeNode(node){
      if(!node.mesh) return;
      const pos = node.mesh.positions;
      const idx = node.mesh.indices;
      for(let i=0;i<idx.length;i+=3){
        const ia=idx[i]*3, ib=idx[i+1]*3, ic=idx[i+2]*3;
        const minX=Math.min(pos[ia],pos[ib],pos[ic]), maxX=Math.max(pos[ia],pos[ib],pos[ic]);
        const minY=Math.min(pos[ia+1],pos[ib+1],pos[ic+1]), maxY=Math.max(pos[ia+1],pos[ib+1],pos[ic+1]);
        const minZ=Math.min(pos[ia+2],pos[ib+2],pos[ic+2]), maxZ=Math.max(pos[ia+2],pos[ib+2],pos[ic+2]);
        const ix0=Math.max(0,Math.floor((minX+half)/gi._voxelSize));
        const iy0=Math.max(0,Math.floor((minY+half)/gi._voxelSize));
        const iz0=Math.max(0,Math.floor((minZ+half)/gi._voxelSize));
        const ix1=Math.min(gi._voxelGridSize-1,Math.floor((maxX+half)/gi._voxelSize));
        const iy1=Math.min(gi._voxelGridSize-1,Math.floor((maxY+half)/gi._voxelSize));
        const iz1=Math.min(gi._voxelGridSize-1,Math.floor((maxZ+half)/gi._voxelSize));
        for(let ix=ix0;ix<=ix1;ix++){
          for(let iy=iy0;iy<=iy1;iy++){
            for(let iz=iz0;iz<=iz1;iz++){
              gi._voxelGrid[iz*gi._voxelGridSize*gi._voxelGridSize+iy*gi._voxelGridSize+ix] = 1;
            }
          }
        }
      }
    }
    if(scene.root) nodeTraverse(scene.root, voxelizeNode);
  }
  function getGIUniforms(){
    return {
      uGIEnabled: gi.enabled ? 1 : 0,
      uGIAmbientIntensity: gi.ambientIntensity,
      uGIAmbientColor: gi.ambientColor,
      uGIIndirectIntensity: gi.indirectIntensity,
      uGISkyColor: gi.skyColor,
      uGISkyIntensity: gi.skyLightIntensity,
      uGIGroundColor: gi.groundColor,
    };
  }
  console.log('[GlobalIllumination] 创建完成 bounces=' + gi.bounceCount + ' rays=' + gi.rayCount);
  return { addLightProbe, addReflectionProbe, sampleIndirectLight, sampleReflection, initVoxelGrid, voxelizeScene, getGIUniforms, gi };
}

/* ===== 后处理色调映射系统 ===== */
const ToneMappingType = { NONE: 0, REINHARD: 1, REINHARD_EXTENDED: 2, ACES: 3, ACES_FILMIC: 4, UNCHARTED2: 5, AGX: 6 };
function createToneMapper(type, options){
  const opt = options || {};
  return {
    type: type !== undefined ? type : ToneMappingType.ACES,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    whitePoint: opt.whitePoint || 11.2,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    enabled: true,
  };
}
function applyToneMapping(color, tm){
  if(!tm.enabled || tm.type === ToneMappingType.NONE) return color;
  let r = color[0]*tm.exposure, g = color[1]*tm.exposure, b = color[2]*tm.exposure;
  if(tm.type === ToneMappingType.REINHARD){
    r = r/(1+r); g = g/(1+g); b = b/(1+b);
  } else if(tm.type === ToneMappingType.REINHARD_EXTENDED){
    const wp = tm.whitePoint*tm.whitePoint;
    r = r*(1+r/wp)/(1+r); g = g*(1+g/wp)/(1+g); b = b*(1+b/wp)/(1+b);
  } else if(tm.type === ToneMappingType.ACES){
    const a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
    r = Math.max(0,(r*(a*r+b))/(r*(c*r+d)+e));
    g = Math.max(0,(g*(a*g+b))/(g*(c*g+d)+e));
    b = Math.max(0,(b*(a*b+b))/(b*(c*b+d)+e));
  } else if(tm.type === ToneMappingType.ACES_FILMIC){
    function acesFilmic(x){
      const a=0.6, b=0.13, c=0.1, d=0.0, e=0.01, f=0.3, w=10;
      return ((x*(a*x+b*c)+d*e)/(x*(a*x+b)+d*f))-e/f;
    }
    const wb = acesFilmic(tm.whitePoint);
    r = acesFilmic(r*1.8)/wb; g = acesFilmic(g*1.8)/wb; b = acesFilmic(b*1.8)/wb;
  } else if(tm.type === ToneMappingType.UNCHARTED2){
    function u2Tonemap(x){
      const a=0.15, b=0.5, c=0.1, d=0.2, e=0.02, f=0.3;
      return ((x*(a*x+c*b)+d*e)/(x*(a*x+b)+d*f))-e/f;
    }
    const wb = u2Tonemap(tm.whitePoint);
    r = u2Tonemap(r*2)/wb; g = u2Tonemap(g*2)/wb; b = u2Tonemap(b*2)/wb;
  } else if(tm.type === ToneMappingType.AGX){
    function agx(x){
      const x2=x*x, x3=x2*x;
      return x*(3.4*x2+1.0)/(3.4*x3+2.1*x2+1.0);
    }
    r = agx(r); g = agx(g); b = agx(b);
  }
  const gray = 0.299*r+0.587*g+0.114*b;
  r = gray+(r-gray)*tm.saturation;
  g = gray+(g-gray)*tm.saturation;
  b = gray+(b-gray)*tm.saturation;
  r = Math.pow(Math.max(0,r), 1/tm.gamma);
  g = Math.pow(Math.max(0,g), 1/tm.gamma);
  b = Math.pow(Math.max(0,b), 1/tm.gamma);
  return [r,g,b,color[3]||1];
}
function getToneMappingShaderCode(tm){
  if(!tm || !tm.enabled || tm.type === ToneMappingType.NONE) return '';
  let code = `
    uniform float uExposure;
    uniform float uWhitePoint;
    uniform float uGamma;
    uniform float uSaturation;
    vec3 applyToneMapping(vec3 color){
      color *= uExposure;
  `;
  if(tm.type === ToneMappingType.REINHARD){
    code += 'color = color/(1.0+color);';
  } else if(tm.type === ToneMappingType.REINHARD_EXTENDED){
    code += 'float wp = uWhitePoint*uWhitePoint; color = color*(1.0+color/wp)/(1.0+color);';
  } else if(tm.type === ToneMappingType.ACES){
    code += 'float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; color=max(vec3(0.0),(color*(a*color+b))/(color*(c*color+d)+e));';
  } else if(tm.type === ToneMappingType.ACES_FILMIC){
    code += `
      float a=0.6,b=0.13,c=0.1,d=0.0,e=0.01,f=0.3;
      vec3 wb=vec3(uWhitePoint);
      wb=((wb*(a*wb+b*c)+d*e)/(wb*(a*wb+b)+d*f))-e/f;
      color=((color*(a*color+b*c)+d*e)/(color*(a*color+b)+d*f))-e/f;
      color/=wb;
    `;
  } else if(tm.type === ToneMappingType.UNCHARTED2){
    code += `
      float a=0.15,b=0.5,c=0.1,d=0.2,e=0.02,f=0.3;
      vec3 wb=vec3(uWhitePoint);
      wb=((wb*(a*wb+c*b)+d*e)/(wb*(a*wb+b)+d*f))-e/f;
      color=((color*(a*color+c*b)+d*e)/(color*(a*color+b)+d*f))-e/f;
      color/=wb;
    `;
  } else if(tm.type === ToneMappingType.AGX){
    code += 'vec3 x2=color*color, x3=x2*color; color=color*(3.4*x2+1.0)/(3.4*x3+2.1*x2+1.0);';
  }
  code += `
      float gray=dot(color,vec3(0.299,0.587,0.114));
      color=mix(vec3(gray),color,uSaturation);
      color=pow(max(color,vec3(0.0)),vec3(1.0/uGamma));
      return color;
    }
  `;
  return code;
}

/* ===== 抗锯齿系统 ===== */
const AAType = { NONE: 0, FXAA: 1, SMAA: 2, MSAA: 3, TAA: 4, DLSS: 5 };
function createAntiAliasing(gl, type, width, height, options){
  const opt = options || {};
  const aa = {
    gl: gl,
    type: type !== undefined ? type : AAType.FXAA,
    width: width,
    height: height,
    quality: opt.quality || 'medium',
    threshold: opt.threshold || 0.125,
    edgeThreshold: opt.edgeThreshold || 0.0625,
    maxSearchSteps: opt.maxSearchSteps || 16,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  aa._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fxaaFs=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThreshold; uniform float uEdgeThreshold; uniform int uMaxSteps;
    #define FXAA_REDUCE_MIN (1.0/128.0)
    #define FXAA_REDUCE_MUL (1.0/8.0)
    #define FXAA_SPAN_MAX 8.0
    void main(){
      vec3 rgbNW=texture2D(uTex,vUV+vec2(-1.0,-1.0)*uTexel).xyz;
      vec3 rgbNE=texture2D(uTex,vUV+vec2(1.0,-1.0)*uTexel).xyz;
      vec3 rgbSW=texture2D(uTex,vUV+vec2(-1.0,1.0)*uTexel).xyz;
      vec3 rgbSE=texture2D(uTex,vUV+vec2(1.0,1.0)*uTexel).xyz;
      vec3 rgbM=texture2D(uTex,vUV).xyz;
      vec3 luma=vec3(0.299,0.587,0.114);
      float lumaNW=dot(rgbNW,luma), lumaNE=dot(rgbNE,luma), lumaSW=dot(rgbSW,luma), lumaSE=dot(rgbSE,luma), lumaM=dot(rgbM,luma);
      float lumaMin=min(lumaM,min(min(lumaNW,lumaNE),min(lumaSW,lumaSE)));
      float lumaMax=max(lumaM,max(max(lumaNW,lumaNE),max(lumaSW,lumaSE)));
      vec2 dir;
      dir.x=-((lumaNW+lumaNE)-(lumaSW+lumaSE));
      dir.y=((lumaNW+lumaSW)-(lumaNE+lumaSE));
      float dirReduce=max((lumaNW+lumaNE+lumaSW+lumaSE)*(0.25*FXAA_REDUCE_MUL),FXAA_REDUCE_MIN);
      float rcpDirMin=1.0/(min(abs(dir.x),abs(dir.y))+dirReduce);
      dir=min(vec2(FXAA_SPAN_MAX),max(vec2(-FXAA_SPAN_MAX),dir*rcpDirMin))*uTexel;
      vec3 rgbA=0.5*(texture2D(uTex,vUV+dir*(1.0/3.0-0.5)).xyz+texture2D(uTex,vUV+dir*(2.0/3.0-0.5)).xyz);
      vec3 rgbB=rgbA*0.5+0.25*(texture2D(uTex,vUV+dir*-0.5).xyz+texture2D(uTex,vUV+dir*0.5).xyz);
      float lumaB=dot(rgbB,luma);
      if((lumaB<lumaMin)||(lumaB>lumaMax)) gl_FragColor=vec4(rgbA,1.0); else gl_FragColor=vec4(rgbB,1.0);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  aa._program=gl.createProgram();
  gl.attachShader(aa._program,vs);
  gl.attachShader(aa._program,compileShader(gl.FRAGMENT_SHADER,fxaaFs));
  gl.linkProgram(aa._program);
  function render(inputTexture){
    if(!aa.enabled || aa.type===AAType.NONE) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,aa._framebuffer.framebuffer);
    gl.viewport(0,0,aa.width,aa.height);
    gl.useProgram(aa._program);
    const aPos=gl.getAttribLocation(aa._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(aa._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(aa._program,'uTexel'),1/aa.width,1/aa.height);
    gl.uniform1f(gl.getUniformLocation(aa._program,'uThreshold'),aa.threshold);
    gl.uniform1f(gl.getUniformLocation(aa._program,'uEdgeThreshold'),aa.edgeThreshold);
    gl.uniform1i(gl.getUniformLocation(aa._program,'uMaxSteps'),aa.maxSearchSteps);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return aa._framebuffer.texture;
  }
  function resize(w,h){ aa.width=w; aa.height=h; }
  function dispose(){ gl.deleteFramebuffer(aa._framebuffer.framebuffer); gl.deleteTexture(aa._framebuffer.texture); gl.deleteProgram(aa._program); }
  console.log('[AntiAliasing] 创建完成 type=' + aa.type + ' ' + width + 'x' + height);
  return { render, resize, dispose, aa };
}

/* ===== 色彩管理系统 ===== */
const ColorSpace = { SRGB: 0, LINEAR: 1, REC709: 2, REC2020: 3, ACES: 4, DISPLAY_P3: 5, ADOBE_RGB: 6 };
function createColorManager(options){
  const opt = options || {};
  return {
    inputColorSpace: opt.inputColorSpace !== undefined ? opt.inputColorSpace : ColorSpace.SRGB,
    outputColorSpace: opt.outputColorSpace !== undefined ? opt.outputColorSpace : ColorSpace.SRGB,
    workingColorSpace: opt.workingColorSpace !== undefined ? opt.workingColorSpace : ColorSpace.LINEAR,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    brightness: opt.brightness !== undefined ? opt.brightness : 0,
    hueShift: opt.hueShift !== undefined ? opt.hueShift : 0,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    tint: opt.tint !== undefined ? opt.tint : 0,
    lut: null,
    lutSize: opt.lutSize || 32,
    enabled: true,
  };
}
function srgbToLinear(c){
  return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
}
function linearToSrgb(c){
  return c <= 0.0031308 ? c*12.92 : 1.055*Math.pow(c, 1/2.4) - 0.055;
}
function convertColorSpace(color, from, to){
  let r=color[0], g=color[1], b=color[2];
  if(from === ColorSpace.SRGB && to === ColorSpace.LINEAR){
    r=srgbToLinear(r); g=srgbToLinear(g); b=srgbToLinear(b);
  } else if(from === ColorSpace.LINEAR && to === ColorSpace.SRGB){
    r=linearToSrgb(r); g=linearToSrgb(g); b=linearToSrgb(b);
  }
  return [r,g,b,color[3]||1];
}
function applyColorGrading(color, cm){
  if(!cm.enabled) return color;
  let r=color[0]*cm.exposure, g=color[1]*cm.exposure, b=color[2]*cm.exposure;
  r = (r-0.5)*cm.contrast+0.5+cm.brightness;
  g = (g-0.5)*cm.contrast+0.5+cm.brightness;
  b = (b-0.5)*cm.contrast+0.5+cm.brightness;
  const gray = 0.299*r+0.587*g+0.114*b;
  r = gray+(r-gray)*cm.saturation;
  g = gray+(g-gray)*cm.saturation;
  b = gray+(b-gray)*cm.saturation;
  const tempR = cm.temperature*0.01, tempB = -cm.temperature*0.01;
  r += tempR; b += tempB;
  const tintG = cm.tint*0.01, tintRB = -cm.tint*0.005;
  g += tintG; r += tintRB; b += tintRB;
  if(cm.hueShift !== 0){
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h=0, s=0, l=(max+min)/2;
    if(max !== min){
      const d = max-min;
      s = l > 0.5 ? d/(2-max-min) : d/(max+min);
      if(max === r) h = ((g-b)/d + (g<b?6:0))/6;
      else if(max === g) h = ((b-r)/d+2)/6;
      else h = ((r-g)/d+4)/6;
    }
    h = (h+cm.hueShift/360)%1;
    const hue2rgb = (p,q,t)=>{ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
    const q = l<0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  return [Math.max(0,Math.min(1,r)), Math.max(0,Math.min(1,g)), Math.max(0,Math.min(1,b)), color[3]||1];
}
function createLUT(size){
  const lut = new Float32Array(size*size*size*3);
  for(let b=0;b<size;b++){
    for(let g=0;g<size;g++){
      for(let r=0;r<size;r++){
        const idx = (b*size*size+g*size+r)*3;
        lut[idx] = r/(size-1);
        lut[idx+1] = g/(size-1);
        lut[idx+2] = b/(size-1);
      }
    }
  }
  return lut;
}
function applyLUT(color, lut, size){
  const r = Math.min(size-1, Math.max(0, Math.floor(color[0]*(size-1))));
  const g = Math.min(size-1, Math.max(0, Math.floor(color[1]*(size-1))));
  const b = Math.min(size-1, Math.max(0, Math.floor(color[2]*(size-1))));
  const idx = (b*size*size+g*size+r)*3;
  return [lut[idx], lut[idx+1], lut[idx+2], color[3]||1];
}
function getColorManagementShaderCode(cm){
  if(!cm || !cm.enabled) return '';
  return `
    uniform float uExposure;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uBrightness;
    uniform float uGamma;
    vec3 applyColorManagement(vec3 color){
      color *= uExposure;
      color = (color-0.5)*uContrast+0.5+uBrightness;
      float gray=dot(color,vec3(0.299,0.587,0.114));
      color=mix(vec3(gray),color,uSaturation);
      color=pow(max(color,vec3(0.0)),vec3(1.0/uGamma));
      return color;
    }
  `;
}

/* ===== 后期处理泛光系统 ===== */
function createBloom(gl, width, height, options){
  const opt = options || {};
  const bloom = {
    gl: gl,
    width: width,
    height: height,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.8,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.5,
    radius: opt.radius || 4,
    passes: opt.passes || 3,
    enabled: true,
    _extractProgram: null,
    _blurProgram: null,
    _combineProgram: null,
    _extractFB: null,
    _blurFBs: [],
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  bloom._extractFB = createFB(width/2, height/2);
  for(let i=0;i<bloom.passes;i++) bloom._blurFBs.push(createFB(width/2, height/2));
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const extractFs='precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uThreshold; void main(){ vec4 c=texture2D(uTex,vUV); float brightness=max(c.r,max(c.g,c.b)); if(brightness>uThreshold){ float contribution=(brightness-uThreshold)/(1.0-uThreshold); gl_FragColor=vec4(c.rgb*contribution,1.0); } else gl_FragColor=vec4(0.0); }';
  const blurFs='precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDirection; void main(){ vec4 color=vec4(0.0); float weights[5]; weights[0]=0.227027; weights[1]=0.1945946; weights[2]=0.1216216; weights[3]=0.054054; weights[4]=0.016216; color+=texture2D(uTex,vUV)*weights[0]; for(int i=1;i<5;i++){ color+=texture2D(uTex,vUV+uDirection*uTexel*float(i))*weights[i]; color+=texture2D(uTex,vUV-uDirection*uTexel*float(i))*weights[i]; } gl_FragColor=color; }';
  const combineFs='precision highp float; varying vec2 vUV; uniform sampler2D uScene; uniform sampler2D uBloom; uniform float uIntensity; void main(){ vec4 scene=texture2D(uScene,vUV); vec4 bloom=texture2D(uBloom,vUV); gl_FragColor=vec4(scene.rgb+bloom.rgb*uIntensity,scene.a); }';
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  bloom._extractProgram=gl.createProgram();
  gl.attachShader(bloom._extractProgram,vs);
  gl.attachShader(bloom._extractProgram,compileShader(gl.FRAGMENT_SHADER,extractFs));
  gl.linkProgram(bloom._extractProgram);
  bloom._blurProgram=gl.createProgram();
  gl.attachShader(bloom._blurProgram,vs);
  gl.attachShader(bloom._blurProgram,compileShader(gl.FRAGMENT_SHADER,blurFs));
  gl.linkProgram(bloom._blurProgram);
  bloom._combineProgram=gl.createProgram();
  gl.attachShader(bloom._combineProgram,vs);
  gl.attachShader(bloom._combineProgram,compileShader(gl.FRAGMENT_SHADER,combineFs));
  gl.linkProgram(bloom._combineProgram);
  function render(sceneTexture){
    if(!bloom.enabled) return sceneTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,bloom._extractFB.framebuffer);
    gl.viewport(0,0,bloom.width/2,bloom.height/2);
    gl.useProgram(bloom._extractProgram);
    const aPos=gl.getAttribLocation(bloom._extractProgram,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
    gl.uniform1i(gl.getUniformLocation(bloom._extractProgram,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(bloom._extractProgram,'uThreshold'),bloom.threshold);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    let currentTex = bloom._extractFB.texture;
    for(let p=0;p<bloom.passes;p++){
      const fb = bloom._blurFBs[p];
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb.framebuffer);
      gl.useProgram(bloom._blurProgram);
      const bp=gl.getAttribLocation(bloom._blurProgram,'aPos');
      gl.enableVertexAttribArray(bp);
      gl.vertexAttribPointer(bp,2,gl.FLOAT,false,0,0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,currentTex);
      gl.uniform1i(gl.getUniformLocation(bloom._blurProgram,'uTex'),0);
      gl.uniform2f(gl.getUniformLocation(bloom._blurProgram,'uTexel'),2/bloom.width,2/bloom.height);
      gl.uniform2f(gl.getUniformLocation(bloom._blurProgram,'uDirection'),1,0);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      currentTex = fb.texture;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,bloom.width,bloom.height);
    gl.useProgram(bloom._combineProgram);
    const cp=gl.getAttribLocation(bloom._combineProgram,'aPos');
    gl.enableVertexAttribArray(cp);
    gl.vertexAttribPointer(cp,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture);
    gl.uniform1i(gl.getUniformLocation(bloom._combineProgram,'uScene'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,currentTex);
    gl.uniform1i(gl.getUniformLocation(bloom._combineProgram,'uBloom'),1);
    gl.uniform1f(gl.getUniformLocation(bloom._combineProgram,'uIntensity'),bloom.intensity);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ bloom.width=w; bloom.height=h; }
  function dispose(){
    gl.deleteFramebuffer(bloom._extractFB.framebuffer); gl.deleteTexture(bloom._extractFB.texture);
    for(const fb of bloom._blurFBs){ gl.deleteFramebuffer(fb.framebuffer); gl.deleteTexture(fb.texture); }
    gl.deleteProgram(bloom._extractProgram); gl.deleteProgram(bloom._blurProgram); gl.deleteProgram(bloom._combineProgram);
  }
  console.log('[Bloom] 创建完成 ' + width + 'x' + height + ' passes=' + bloom.passes);
  return { render, resize, dispose, bloom };
}

/* ===== 后期处理色彩分级系统 ===== */
function createColorGrading(gl, width, height, options){
  const opt = options || {};
  const cg = {
    gl: gl, width, height,
    lift: opt.lift ? opt.lift.slice() : [0,0,0],
    gamma: opt.gamma ? opt.gamma.slice() : [1,1,1],
    gain: opt.gain ? opt.gain.slice() : [1,1,1],
    offset: opt.offset ? opt.offset.slice() : [0,0,0],
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    hue: opt.hue !== undefined ? opt.hue : 0,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    tint: opt.tint !== undefined ? opt.tint : 0,
    shadows: opt.shadows ? opt.shadows.slice() : [0,0,0],
    midtones: opt.midtones ? opt.midtones.slice() : [1,1,1],
    highlights: opt.highlights ? opt.highlights.slice() : [1,1,1],
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cg._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex;
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform vec3 uOffset;
    uniform float uContrast; uniform float uSaturation; uniform float uHue;
    uniform float uTemperature; uniform float uTint;
    uniform vec3 uShadows; uniform vec3 uMidtones; uniform vec3 uHighlights;
    vec3 rgbToHsv(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float d=mx-mn; vec3 hsv=vec3(0.0,0.0,mx); if(d!=0.0){ hsv.y=d/mx; if(c.r==mx) hsv.x=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) hsv.x=(c.b-c.r)/d+2.0; else hsv.x=(c.r-c.g)/d+4.0; hsv.x/=6.0; } return hsv; }
    vec3 hsvToRgb(vec3 hsv){ vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(hsv.xxx+K.xyz)*6.0-K.www); return hsv.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),hsv.y); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb;
      c = (c-0.5)*uContrast+0.5;
      c = pow(max(c,vec3(0.0)),1.0/uGamma);
      c = c*uGain+uLift+uOffset;
      float luma=dot(c,vec3(0.299,0.587,0.114));
      c=mix(vec3(luma),c,uSaturation);
      vec3 hsv=rgbToHsv(c); hsv.x=fract(hsv.x+uHue/360.0); c=hsvToRgb(hsv);
      c.r+=uTemperature*0.01; c.b-=uTemperature*0.01;
      c.g+=uTint*0.01; c.r-=uTint*0.005; c.b-=uTint*0.005;
      float shadow=smoothstep(0.0,0.3,luma);
      float highlight=smoothstep(0.7,1.0,luma);
      float mid=1.0-shadow-highlight;
      c=c*(uShadows*shadow+uMidtones*mid+uHighlights*highlight);
      gl_FragColor=vec4(clamp(c,0.0,1.0),color.a);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cg._program=gl.createProgram();
  gl.attachShader(cg._program,vs);
  gl.attachShader(cg._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cg._program);
  function render(inputTexture){
    if(!cg.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cg._framebuffer.framebuffer);
    gl.viewport(0,0,cg.width,cg.height);
    gl.useProgram(cg._program);
    const aPos=gl.getAttribLocation(cg._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(cg._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uLift'),cg.lift);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uGamma'),cg.gamma);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uGain'),cg.gain);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uOffset'),cg.offset);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uContrast'),cg.contrast);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uSaturation'),cg.saturation);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uHue'),cg.hue);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uTemperature'),cg.temperature);
    gl.uniform1f(gl.getUniformLocation(cg._program,'uTint'),cg.tint);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uShadows'),cg.shadows);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uMidtones'),cg.midtones);
    gl.uniform3fv(gl.getUniformLocation(cg._program,'uHighlights'),cg.highlights);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cg._framebuffer.texture;
  }
  function resize(w,h){ cg.width=w; cg.height=h; }
  function dispose(){ gl.deleteFramebuffer(cg._framebuffer.framebuffer); gl.deleteTexture(cg._framebuffer.texture); gl.deleteProgram(cg._program); }
  console.log('[ColorGrading] 创建完成 ' + width + 'x' + height);
  return { render, resize, dispose, cg };
}

/* ===== 后期处理色差系统 ===== */
function createChromaticAberration(gl, width, height, options){
  const opt = options || {};
  const ca = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.002,
    radial: opt.radial !== false,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ca._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform int uRadial;
    void main(){ vec2 dir = uRadial==1 ? normalize(vUV-0.5) : vec2(1.0,0.0);
      float r=texture2D(uTex,vUV+dir*uStrength).r;
      float g=texture2D(uTex,vUV).g;
      float b=texture2D(uTex,vUV-dir*uStrength).b;
      gl_FragColor=vec4(r,g,b,1.0);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ca._program=gl.createProgram();
  gl.attachShader(ca._program,vs);
  gl.attachShader(ca._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ca._program);
  function render(inputTexture){
    if(!ca.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ca._framebuffer.framebuffer);
    gl.viewport(0,0,ca.width,ca.height);
    gl.useProgram(ca._program);
    const aPos=gl.getAttribLocation(ca._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(ca._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ca._program,'uStrength'),ca.strength);
    gl.uniform1i(gl.getUniformLocation(ca._program,'uRadial'),ca.radial?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ca._framebuffer.texture;
  }
  function resize(w,h){ ca.width=w; ca.height=h; }
  function dispose(){ gl.deleteFramebuffer(ca._framebuffer.framebuffer); gl.deleteTexture(ca._framebuffer.texture); gl.deleteProgram(ca._program); }
  console.log('[ChromaticAberration] 创建完成 strength=' + ca.strength);
  return { render, resize, dispose, ca };
}

/* ===== 后期处理晕影系统 ===== */
function createVignette(gl, width, height, options){
  const opt = options || {};
  const v = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 0.8,
    softness: opt.softness !== undefined ? opt.softness : 0.5,
    color: opt.color ? opt.color.slice() : [0,0,0],
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform float uRadius; uniform float uSoftness; uniform vec3 uColor;
    void main(){ vec4 color=texture2D(uTex,vUV); vec2 pos=vUV-0.5; float dist=length(pos); float vignette=smoothstep(uRadius,uRadius-uSoftness,dist); color.rgb=mix(uColor,color.rgb,vignette*uStrength+(1.0-uStrength)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  v._program=gl.createProgram();
  gl.attachShader(v._program,vs);
  gl.attachShader(v._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(v._program);
  function render(inputTexture){
    if(!v.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(v._program);
    const aPos=gl.getAttribLocation(v._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(v._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(v._program,'uStrength'),v.strength);
    gl.uniform1f(gl.getUniformLocation(v._program,'uRadius'),v.radius);
    gl.uniform1f(gl.getUniformLocation(v._program,'uSoftness'),v.softness);
    gl.uniform3fv(gl.getUniformLocation(v._program,'uColor'),v.color);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ v.width=w; v.height=h; }
  function dispose(){ gl.deleteProgram(v._program); }
  console.log('[Vignette] 创建完成 strength=' + v.strength);
  return { render, resize, dispose, v };
}

/* ===== 后期处理颗粒系统 ===== */
function createFilmGrain(gl, width, height, options){
  const opt = options || {};
  const fg = {
    gl: gl, width, height,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.05,
    animated: opt.animated !== false,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uTime; uniform vec2 uResolution;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453); }
    void main(){ vec4 color=texture2D(uTex,vUV); float grain=rand(vUV*uResolution+uTime)*2.0-1.0; color.rgb+=grain*uIntensity; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  fg._program=gl.createProgram();
  gl.attachShader(fg._program,vs);
  gl.attachShader(fg._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(fg._program);
  function update(dt){ if(fg.animated) fg._time += dt; }
  function render(inputTexture){
    if(!fg.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(fg._program);
    const aPos=gl.getAttribLocation(fg._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(fg._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(fg._program,'uIntensity'),fg.intensity);
    gl.uniform1f(gl.getUniformLocation(fg._program,'uTime'),fg._time);
    gl.uniform2f(gl.getUniformLocation(fg._program,'uResolution'),fg.width,fg.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ fg.width=w; fg.height=h; }
  function dispose(){ gl.deleteProgram(fg._program); }
  console.log('[FilmGrain] 创建完成 intensity=' + fg.intensity);
  return { update, render, resize, dispose, fg };
}

/* ===== 后期处理扫描线系统 ===== */
function createScanlines(gl, width, height, options){
  const opt = options || {};
  const sl = {
    gl: gl, width, height,
    intensity: opt.intensity !== undefined ? opt.intensity : 0.1,
    thickness: opt.thickness || 2,
    speed: opt.speed || 0,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uIntensity; uniform float uThickness; uniform float uTime; uniform vec2 uResolution;
    void main(){ vec4 color=texture2D(uTex,vUV); float y=vUV.y*uResolution.y+uTime*100.0; float scanline=mod(floor(y),uThickness); float factor=scanline<1.0?1.0-uIntensity:1.0; color.rgb*=factor; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sl._program=gl.createProgram();
  gl.attachShader(sl._program,vs);
  gl.attachShader(sl._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sl._program);
  function update(dt){ sl._time += dt*sl.speed; }
  function render(inputTexture){
    if(!sl.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(sl._program);
    const aPos=gl.getAttribLocation(sl._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(sl._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uIntensity'),sl.intensity);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uThickness'),sl.thickness);
    gl.uniform1f(gl.getUniformLocation(sl._program,'uTime'),sl._time);
    gl.uniform2f(gl.getUniformLocation(sl._program,'uResolution'),sl.width,sl.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ sl.width=w; sl.height=h; }
  function dispose(){ gl.deleteProgram(sl._program); }
  console.log('[Scanlines] 创建完成 intensity=' + sl.intensity);
  return { update, render, resize, dispose, sl };
}

/* ===== 后期处理CRT效果系统 ===== */
function createCRTEffect(gl, width, height, options){
  const opt = options || {};
  const crt = {
    gl: gl, width, height,
    curvature: opt.curvature !== undefined ? opt.curvature : 0.1,
    scanlineIntensity: opt.scanlineIntensity !== undefined ? opt.scanlineIntensity : 0.15,
    vignetteIntensity: opt.vignetteIntensity !== undefined ? opt.vignetteIntensity : 0.3,
    chromaticAberration: opt.chromaticAberration !== undefined ? opt.chromaticAberration : 0.003,
    noiseIntensity: opt.noiseIntensity !== undefined ? opt.noiseIntensity : 0.02,
    _time: 0,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTime; uniform vec2 uResolution;
    uniform float uCurvature; uniform float uScanline; uniform float uVignette; uniform float uCA; uniform float uNoise;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453); }
    vec2 curve(vec2 uv){ uv=uv*2.0-1.0; uv*=1.0+uCurvature*dot(uv,uv); return uv*0.5+0.5; }
    void main(){ vec2 uv=curve(vUV); if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor=vec4(0.0,0.0,0.0,1.0); return; }
      vec2 dir=normalize(uv-0.5);
      float r=texture2D(uTex,uv+dir*uCA).r;
      float g=texture2D(uTex,uv).g;
      float b=texture2D(uTex,uv-dir*uCA).b;
      vec3 color=vec3(r,g,b);
      float scanline=sin(uv.y*uResolution.y*3.14159)*0.5+0.5;
      color*=1.0-scanline*uScanline;
      float dist=length(uv-0.5);
      color*=1.0-smoothstep(0.3,0.8,dist)*uVignette;
      float noise=rand(uv*uResolution+uTime)*2.0-1.0;
      color+=noise*uNoise;
      gl_FragColor=vec4(color,1.0);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  crt._program=gl.createProgram();
  gl.attachShader(crt._program,vs);
  gl.attachShader(crt._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(crt._program);
  function update(dt){ crt._time += dt; }
  function render(inputTexture){
    if(!crt.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(crt._program);
    const aPos=gl.getAttribLocation(crt._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(crt._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uTime'),crt._time);
    gl.uniform2f(gl.getUniformLocation(crt._program,'uResolution'),crt.width,crt.height);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uCurvature'),crt.curvature);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uScanline'),crt.scanlineIntensity);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uVignette'),crt.vignetteIntensity);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uCA'),crt.chromaticAberration);
    gl.uniform1f(gl.getUniformLocation(crt._program,'uNoise'),crt.noiseIntensity);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ crt.width=w; crt.height=h; }
  function dispose(){ gl.deleteProgram(crt._program); }
  console.log('[CRTEffect] 创建完成 curvature=' + crt.curvature);
  return { update, render, resize, dispose, crt };
}

/* ===== 后期处理像素化系统 ===== */
function createPixelation(gl, width, height, options){
  const opt = options || {};
  const px = {
    gl: gl, width, height,
    pixelSize: opt.pixelSize || 4,
    enabled: true,
    _program: null,
  };
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uPixelSize; uniform vec2 uResolution;
    void main(){ vec2 pixel=vec2(uPixelSize)/uResolution; vec2 uv=floor(vUV/pixel)*pixel+pixel*0.5; gl_FragColor=texture2D(uTex,uv); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  px._program=gl.createProgram();
  gl.attachShader(px._program,vs);
  gl.attachShader(px._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(px._program);
  function render(inputTexture){
    if(!px.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.useProgram(px._program);
    const aPos=gl.getAttribLocation(px._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(px._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(px._program,'uPixelSize'),px.pixelSize);
    gl.uniform2f(gl.getUniformLocation(px._program,'uResolution'),px.width,px.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return null;
  }
  function resize(w,h){ px.width=w; px.height=h; }
  function dispose(){ gl.deleteProgram(px._program); }
  console.log('[Pixelation] 创建完成 pixelSize=' + px.pixelSize);
  return { render, resize, dispose, px };
}

/* ===== 后期处理模糊系统 ===== */
function createBlur(gl, width, height, options){
  const opt = options || {};
  const blur = {
    gl: gl, width, height,
    radius: opt.radius || 4,
    direction: opt.direction || [1,1],
    quality: opt.quality || 'medium',
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  blur._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform vec2 uDirection; uniform float uRadius;
    void main(){ vec4 color=vec4(0.0); float total=0.0; for(float x=-10.0;x<=10.0;x+=1.0){ if(abs(x)>uRadius) continue; float weight=exp(-x*x/(2.0*uRadius*uRadius/3.0)); color+=texture2D(uTex,vUV+uDirection*uTexel*x)*weight; total+=weight; } gl_FragColor=color/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  blur._program=gl.createProgram();
  gl.attachShader(blur._program,vs);
  gl.attachShader(blur._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(blur._program);
  function render(inputTexture){
    if(!blur.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,blur._framebuffer.framebuffer);
    gl.viewport(0,0,blur.width,blur.height);
    gl.useProgram(blur._program);
    const aPos=gl.getAttribLocation(blur._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(blur._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(blur._program,'uTexel'),1/blur.width,1/blur.height);
    gl.uniform2f(gl.getUniformLocation(blur._program,'uDirection'),blur.direction[0],blur.direction[1]);
    gl.uniform1f(gl.getUniformLocation(blur._program,'uRadius'),blur.radius);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return blur._framebuffer.texture;
  }
  function resize(w,h){ blur.width=w; blur.height=h; }
  function dispose(){ gl.deleteFramebuffer(blur._framebuffer.framebuffer); gl.deleteTexture(blur._framebuffer.texture); gl.deleteProgram(blur._program); }
  console.log('[Blur] 创建完成 radius=' + blur.radius);
  return { render, resize, dispose, blur };
}

/* ===== 后期处理锐化系统 ===== */
function createSharpen(gl, width, height, options){
  const opt = options || {};
  const sh = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  sh._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uStrength;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); blur+=texture2D(uTex,vUV+vec2(-1.0,-1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(1.0,-1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(-1.0,1.0)*uTexel); blur+=texture2D(uTex,vUV+vec2(1.0,1.0)*uTexel); blur/=4.0; gl_FragColor=center+(center-blur)*uStrength; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sh._program=gl.createProgram();
  gl.attachShader(sh._program,vs);
  gl.attachShader(sh._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sh._program);
  function render(inputTexture){
    if(!sh.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,sh._framebuffer.framebuffer);
    gl.viewport(0,0,sh.width,sh.height);
    gl.useProgram(sh._program);
    const aPos=gl.getAttribLocation(sh._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(sh._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(sh._program,'uTexel'),1/sh.width,1/sh.height);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uStrength'),sh.strength);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sh._framebuffer.texture;
  }
  function resize(w,h){ sh.width=w; sh.height=h; }
  function dispose(){ gl.deleteFramebuffer(sh._framebuffer.framebuffer); gl.deleteTexture(sh._framebuffer.texture); gl.deleteProgram(sh._program); }
  console.log('[Sharpen] 创建完成 strength=' + sh.strength);
  return { render, resize, dispose, sh };
}

/* ===== 后期处理边缘检测系统 ===== */
function createEdgeDetection(gl, width, height, options){
  const opt = options || {};
  const ed = {
    gl: gl, width, height,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.2,
    strength: opt.strength !== undefined ? opt.strength : 1,
    color: opt.color ? opt.color.slice() : [0,0,0],
    mode: opt.mode || 'sobel',
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ed._framebuffer = createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThreshold; uniform float uStrength; uniform vec3 uEdgeColor;
    float luma(vec3 c){ return dot(c,vec3(0.299,0.587,0.114)); }
    void main(){ vec4 color=texture2D(uTex,vUV);
      float tl=luma(texture2D(uTex,vUV+vec2(-1.0,-1.0)*uTexel).rgb);
      float t=luma(texture2D(uTex,vUV+vec2(0.0,-1.0)*uTexel).rgb);
      float tr=luma(texture2D(uTex,vUV+vec2(1.0,-1.0)*uTexel).rgb);
      float l=luma(texture2D(uTex,vUV+vec2(-1.0,0.0)*uTexel).rgb);
      float r=luma(texture2D(uTex,vUV+vec2(1.0,0.0)*uTexel).rgb);
      float bl=luma(texture2D(uTex,vUV+vec2(-1.0,1.0)*uTexel).rgb);
      float b=luma(texture2D(uTex,vUV+vec2(0.0,1.0)*uTexel).rgb);
      float br=luma(texture2D(uTex,vUV+vec2(1.0,1.0)*uTexel).rgb);
      float gx=(-tl-2.0*l-bl)+(tr+2.0*r+br);
      float gy=(-tl-2.0*t-tr)+(bl+2.0*b+br);
      float edge=sqrt(gx*gx+gy*gy);
      if(edge>uThreshold){ gl_FragColor=vec4(mix(color.rgb,uEdgeColor,edge*uStrength),color.a); }
      else gl_FragColor=color;
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ed._program=gl.createProgram();
  gl.attachShader(ed._program,vs);
  gl.attachShader(ed._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ed._program);
  function render(inputTexture){
    if(!ed.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ed._framebuffer.framebuffer);
    gl.viewport(0,0,ed.width,ed.height);
    gl.useProgram(ed._program);
    const aPos=gl.getAttribLocation(ed._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture);
    gl.uniform1i(gl.getUniformLocation(ed._program,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(ed._program,'uTexel'),1/ed.width,1/ed.height);
    gl.uniform1f(gl.getUniformLocation(ed._program,'uThreshold'),ed.threshold);
    gl.uniform1f(gl.getUniformLocation(ed._program,'uStrength'),ed.strength);
    gl.uniform3fv(gl.getUniformLocation(ed._program,'uEdgeColor'),ed.color);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ed._framebuffer.texture;
  }
  function resize(w,h){ ed.width=w; ed.height=h; }
  function dispose(){ gl.deleteFramebuffer(ed._framebuffer.framebuffer); gl.deleteTexture(ed._framebuffer.texture); gl.deleteProgram(ed._program); }
  console.log('[EdgeDetection] 创建完成 threshold=' + ed.threshold);
  return { render, resize, dispose, ed };
}

/* ===== 后期处理屏幕空间反射系统 ===== */
function createScreenSpaceReflection(gl, width, height, options){
  const opt = options || {};
  const ssr = {
    gl: gl, width, height,
    steps: opt.steps || 64,
    thickness: opt.thickness || 0.1,
    maxDistance: opt.maxDistance || 100,
    resolutionScale: opt.resolutionScale || 0.5,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  const rw = Math.floor(width*ssr.resolutionScale);
  const rh = Math.floor(height*ssr.resolutionScale);
  ssr._framebuffer = createFB(rw,rh);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uScene; uniform sampler2D uDepth; uniform sampler2D uNormal; uniform mat4 uProjection; uniform mat4 uInverseProjection; uniform int uSteps; uniform float uThickness; uniform float uMaxDistance; uniform vec2 uResolution;
    vec3 getViewPos(vec2 uv, float depth){ vec4 clip=vec4(uv*2.0-1.0, depth*2.0-1.0, 1.0); vec4 view=uInverseProjection*clip; return view.xyz/view.w; }
    vec2 getScreenPos(vec3 viewPos){ vec4 clip=uProjection*vec4(viewPos,1.0); return (clip.xy/clip.w)*0.5+0.5; }
    void main(){ vec4 sceneColor=texture2D(uScene,vUV); float depth=texture2D(uDepth,vUV).r; if(depth>=1.0){ gl_FragColor=sceneColor; return; } vec3 viewPos=getViewPos(vUV,depth); vec3 normal=normalize(texture2D(uNormal,vUV).xyz*2.0-1.0); vec3 viewDir=normalize(viewPos); vec3 reflectDir=reflect(viewDir,normal); vec3 rayPos=viewPos+normal*0.1; vec3 rayStep=reflectDir*(uMaxDistance/float(uSteps)); vec3 ray=rayPos; vec2 hitUV=vec2(-1.0); for(int i=0;i<128;i++){ if(i>=uSteps) break; ray+=rayStep; vec2 screenUV=getScreenPos(ray); if(screenUV.x<0.0||screenUV.x>1.0||screenUV.y<0.0||screenUV.y>1.0) break; float sampleDepth=texture2D(uDepth,screenUV).r; if(sampleDepth>=1.0) continue; vec3 sampleViewPos=getViewPos(screenUV,sampleDepth); float rayDepth=ray.z; float sampleViewDepth=sampleViewPos.z; if(abs(rayDepth-sampleViewDepth)<uThickness && rayDepth<sampleViewDepth){ hitUV=screenUV; break; } } if(hitUV.x>=0.0){ vec4 reflectColor=texture2D(uScene,hitUV); float fresnel=pow(1.0-max(dot(-viewDir,normal),0.0),3.0); gl_FragColor=vec4(mix(sceneColor.rgb,reflectColor.rgb,fresnel*0.5),sceneColor.a); } else gl_FragColor=sceneColor; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ssr._program=gl.createProgram();
  gl.attachShader(ssr._program,vs);
  gl.attachShader(ssr._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ssr._program);
  function render(sceneTexture, depthTexture, normalTexture, projectionMatrix, inverseProjectionMatrix){
    if(!ssr.enabled) return sceneTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssr._framebuffer.framebuffer);
    gl.viewport(0,0,rw,rh);
    gl.useProgram(ssr._program);
    const aPos=gl.getAttribLocation(ssr._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,sceneTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uScene'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,depthTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uDepth'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,normalTexture); gl.uniform1i(gl.getUniformLocation(ssr._program,'uNormal'),2);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssr._program,'uProjection'),false,projectionMatrix);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssr._program,'uInverseProjection'),false,inverseProjectionMatrix);
    gl.uniform1i(gl.getUniformLocation(ssr._program,'uSteps'),ssr.steps);
    gl.uniform1f(gl.getUniformLocation(ssr._program,'uThickness'),ssr.thickness);
    gl.uniform1f(gl.getUniformLocation(ssr._program,'uMaxDistance'),ssr.maxDistance);
    gl.uniform2f(gl.getUniformLocation(ssr._program,'uResolution'),rw,rh);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ssr._framebuffer.texture;
  }
  function resize(w,h){ ssr.width=w; ssr.height=h; }
  function dispose(){ gl.deleteFramebuffer(ssr._framebuffer.framebuffer); gl.deleteTexture(ssr._framebuffer.texture); gl.deleteProgram(ssr._program); }
  console.log('[SSR] 创建完成 steps=' + ssr.steps + ' resolution=' + rw + 'x' + rh);
  return { render, resize, dispose, ssr };
}

/* ===== 后期处理屏幕空间环境光遮蔽系统 ===== */
function createSSAOEffect(gl, width, height, options){
  const opt = options || {};
  const ssao = {
    gl: gl, width, height,
    radius: opt.radius || 0.5,
    bias: opt.bias || 0.025,
    power: opt.power || 1,
    samples: opt.samples || 32,
    enabled: true,
    _kernel: [],
    _noiseTexture: null,
    _framebuffer: null,
    _blurFramebuffer: null,
    _program: null,
    _blurProgram: null,
  };
  for(let i=0;i<ssao.samples;i++){
    let sample=[Math.random()*2-1,Math.random()*2-1,Math.random()];
    const len=Math.sqrt(sample[0]**2+sample[1]**2+sample[2]**2);
    sample=[sample[0]/len,sample[1]/len,sample[2]/len];
    const scale=i/ssao.samples;
    const lerpScale=0.1+scale*scale*0.9;
    ssao._kernel.push([sample[0]*lerpScale,sample[1]*lerpScale,sample[2]*lerpScale]);
  }
  const noiseData=new Float32Array(16*3);
  for(let i=0;i<16;i++){ noiseData[i*3]=Math.random()*2-1; noiseData[i*3+1]=Math.random()*2-1; noiseData[i*3+2]=0; }
  ssao._noiseTexture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,ssao._noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,4,4,0,gl.RGB,gl.FLOAT,noiseData);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ssao._framebuffer=createFB(width/2,height/2);
  ssao._blurFramebuffer=createFB(width/2,height/2);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const ssaoFs=`precision highp float; varying vec2 vUV; uniform sampler2D uPosition; uniform sampler2D uNormal; uniform sampler2D uNoise; uniform vec3 uKernel[32]; uniform mat4 uProjection; uniform float uRadius; uniform float uBias; uniform float uPower; uniform vec2 uNoiseScale; void main(){ vec3 fragPos=texture2D(uPosition,vUV).xyz; vec3 normal=normalize(texture2D(uNormal,vUV).xyz); vec3 randomVec=normalize(texture2D(uNoise,vUV*uNoiseScale).xyz); vec3 tangent=normalize(randomVec-normal*dot(randomVec,normal)); vec3 bitangent=cross(normal,tangent); mat3 TBN=mat3(tangent,bitangent,normal); float occlusion=0.0; for(int i=0;i<32;i++){ vec3 samplePos=TBN*uKernel[i]; samplePos=fragPos+samplePos*uRadius; vec4 offset=uProjection*vec4(samplePos,1.0); offset.xyz/=offset.w; offset.xyz=offset.xyz*0.5+0.5; float sampleDepth=texture2D(uPosition,offset.xy).z; occlusion+=(sampleDepth>=samplePos.z+uBias?1.0:0.0); } occlusion=1.0-(occlusion/32.0); gl_FragColor=vec4(vec3(pow(occlusion,uPower)),1.0); }`;
  const blurFs=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uTexel; void main(){ float result=0.0; for(int x=-2;x<=2;x++){ for(int y=-2;y<=2;y++){ vec2 offset=vec2(float(x),float(y))*uTexel; result+=texture2D(uTex,vUV+offset).r; } } gl_FragColor=vec4(vec3(result/25.0),1.0); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ssao._program=gl.createProgram();
  gl.attachShader(ssao._program,vs);
  gl.attachShader(ssao._program,compileShader(gl.FRAGMENT_SHADER,ssaoFs));
  gl.linkProgram(ssao._program);
  ssao._blurProgram=gl.createProgram();
  gl.attachShader(ssao._blurProgram,vs);
  gl.attachShader(ssao._blurProgram,compileShader(gl.FRAGMENT_SHADER,blurFs));
  gl.linkProgram(ssao._blurProgram);
  function render(positionTexture, normalTexture, projectionMatrix){
    if(!ssao.enabled) return null;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssao._framebuffer.framebuffer);
    gl.viewport(0,0,width/2,height/2);
    gl.useProgram(ssao._program);
    const aPos=gl.getAttribLocation(ssao._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,positionTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uPosition'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,normalTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNormal'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,ssao._noiseTexture); gl.uniform1i(gl.getUniformLocation(ssao._program,'uNoise'),2);
    gl.uniformMatrix4fv(gl.getUniformLocation(ssao._program,'uProjection'),false,projectionMatrix);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uRadius'),ssao.radius);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uBias'),ssao.bias);
    gl.uniform1f(gl.getUniformLocation(ssao._program,'uPower'),ssao.power);
    gl.uniform2f(gl.getUniformLocation(ssao._program,'uNoiseScale'),width/4,height/4);
    const kernelLoc=gl.getUniformLocation(ssao._program,'uKernel[0]');
    const kernelFlat=new Float32Array(ssao.samples*3);
    for(let i=0;i<ssao.samples;i++){ kernelFlat[i*3]=ssao._kernel[i][0]; kernelFlat[i*3+1]=ssao._kernel[i][1]; kernelFlat[i*3+2]=ssao._kernel[i][2]; }
    gl.uniform3fv(kernelLoc,kernelFlat);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ssao._blurFramebuffer.framebuffer);
    gl.useProgram(ssao._blurProgram);
    const bPos=gl.getAttribLocation(ssao._blurProgram,'aPos');
    gl.enableVertexAttribArray(bPos);
    gl.vertexAttribPointer(bPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,ssao._framebuffer.texture); gl.uniform1i(gl.getUniformLocation(ssao._blurProgram,'uTex'),0);
    gl.uniform2f(gl.getUniformLocation(ssao._blurProgram,'uTexel'),2/width,2/height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ssao._blurFramebuffer.texture;
  }
  function resize(w,h){ ssao.width=w; ssao.height=h; }
  function dispose(){ gl.deleteTexture(ssao._noiseTexture); gl.deleteFramebuffer(ssao._framebuffer.framebuffer); gl.deleteTexture(ssao._framebuffer.texture); gl.deleteFramebuffer(ssao._blurFramebuffer.framebuffer); gl.deleteTexture(ssao._blurFramebuffer.texture); gl.deleteProgram(ssao._program); gl.deleteProgram(ssao._blurProgram); }
  console.log('[SSAOEffect] 创建完成 samples=' + ssao.samples);
  return { render, resize, dispose, ssao };
}

/* ===== 后期处理景深系统 ===== */
function createDepthOfFieldEffect(gl, width, height, options){
  const opt = options || {};
  const dof = {
    gl: gl, width, height,
    focus: opt.focus || 10,
    aperture: opt.aperture || 0.025,
    maxBlur: opt.maxBlur || 0.01,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  dof._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uDepth; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur; uniform vec2 uTexel; void main(){ float depth=texture2D(uDepth,vUV).r; float blur=abs(depth-uFocus)*uAperture; blur=min(blur,uMaxBlur); vec4 color=vec4(0.0); float total=0.0; for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ vec2 offset=vec2(float(x),float(y))*uTexel*blur*10.0; float w=1.0-length(vec2(float(x),float(y)))*0.1; color+=texture2D(uColor,vUV+offset)*w; total+=w; } } gl_FragColor=color/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  dof._program=gl.createProgram();
  gl.attachShader(dof._program,vs);
  gl.attachShader(dof._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(dof._program);
  function render(colorTexture, depthTexture){
    if(!dof.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dof._framebuffer.framebuffer);
    gl.viewport(0,0,dof.width,dof.height);
    gl.useProgram(dof._program);
    const aPos=gl.getAttribLocation(dof._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,depthTexture); gl.uniform1i(gl.getUniformLocation(dof._program,'uDepth'),1);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uFocus'),dof.focus);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uAperture'),dof.aperture);
    gl.uniform1f(gl.getUniformLocation(dof._program,'uMaxBlur'),dof.maxBlur);
    gl.uniform2f(gl.getUniformLocation(dof._program,'uTexel'),1/dof.width,1/dof.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return dof._framebuffer.texture;
  }
  function resize(w,h){ dof.width=w; dof.height=h; }
  function dispose(){ gl.deleteFramebuffer(dof._framebuffer.framebuffer); gl.deleteTexture(dof._framebuffer.texture); gl.deleteProgram(dof._program); }
  console.log('[DOFEffect] 创建完成 focus=' + dof.focus);
  return { render, resize, dispose, dof };
}

/* ===== 后期处理运动模糊系统 ===== */
function createMotionBlurEffect(gl, width, height, options){
  const opt = options || {};
  const mb = {
    gl: gl, width, height,
    strength: opt.strength || 0.5,
    samples: opt.samples || 16,
    enabled: true,
    _program: null,
    _framebuffer: null,
    _velocityTexture: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uColor; uniform sampler2D uVelocity; uniform float uStrength; uniform int uSamples; void main(){ vec2 velocity=texture2D(uVelocity,vUV).xy*uStrength; vec4 color=vec4(0.0); for(int i=0;i<32;i++){ if(i>=uSamples) break; float t=float(i)/float(uSamples); vec2 offset=velocity*(t-0.5); color+=texture2D(uColor,vUV+offset); } gl_FragColor=color/float(uSamples); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mb._program=gl.createProgram();
  gl.attachShader(mb._program,vs);
  gl.attachShader(mb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mb._program);
  function render(colorTexture, velocityTexture){
    if(!mb.enabled) return colorTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mb._framebuffer.framebuffer);
    gl.viewport(0,0,mb.width,mb.height);
    gl.useProgram(mb._program);
    const aPos=gl.getAttribLocation(mb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,colorTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uColor'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,velocityTexture); gl.uniform1i(gl.getUniformLocation(mb._program,'uVelocity'),1);
    gl.uniform1f(gl.getUniformLocation(mb._program,'uStrength'),mb.strength);
    gl.uniform1i(gl.getUniformLocation(mb._program,'uSamples'),mb.samples);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mb._framebuffer.texture;
  }
  function resize(w,h){ mb.width=w; mb.height=h; }
  function dispose(){ gl.deleteFramebuffer(mb._framebuffer.framebuffer); gl.deleteTexture(mb._framebuffer.texture); gl.deleteProgram(mb._program); }
  console.log('[MotionBlurEffect] 创建完成 strength=' + mb.strength + ' samples=' + mb.samples);
  return { render, resize, dispose, mb };
}

/* ===== 后期处理色调映射系统 ===== */
function createToneMappingEffect(gl, width, height, options){
  const opt = options || {};
  const tm = {
    gl: gl, width, height,
    type: opt.type !== undefined ? opt.type : ToneMappingType.ACES,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    whitePoint: opt.whitePoint || 11.2,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  tm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uType; uniform float uExposure; uniform float uWhitePoint; uniform float uContrast; uniform float uSaturation; uniform float uGamma;
    vec3 reinhard(vec3 c){ return c/(1.0+c); }
    vec3 reinhardExtended(vec3 c, float wp){ float w=wp*wp; return c*(1.0+c/w)/(1.0+c); }
    vec3 aces(vec3 c){ float a=2.51,b=0.03,cc=2.43,d=0.59,e=0.14; return max(vec3(0.0),(c*(a*c+b))/(c*(cc*c+d)+e)); }
    vec3 acesFilmic(vec3 c, float wp){ float a=0.6,b=0.13,cc=0.1,d=0.0,e=0.01,f=0.3; vec3 wb=vec3(wp); wb=((wb*(a*wb+b*cc)+d*e)/(wb*(a*wb+b)+d*f))-e/f; c=((c*(a*c+b*cc)+d*e)/(c*(a*c+b)+d*f))-e/f; return c/wb; }
    vec3 uncharted2(vec3 c, float wp){ float a=0.15,b=0.5,cc=0.1,d=0.2,e=0.02,f=0.3; vec3 wb=vec3(wp); wb=((wb*(a*wb+cc*b)+d*e)/(wb*(a*wb+b)+d*f))-e/f; c=((c*(a*c+cc*b)+d*e)/(c*(a*c+b)+d*f))-e/f; return c/wb; }
    vec3 agx(vec3 c){ vec3 x2=c*c, x3=x2*c; return c*(3.4*x2+1.0)/(3.4*x3+2.1*x2+1.0); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb*uExposure;
      if(uType==1) c=reinhard(c);
      else if(uType==2) c=reinhardExtended(c,uWhitePoint);
      else if(uType==3) c=aces(c);
      else if(uType==4) c=acesFilmic(c,uWhitePoint);
      else if(uType==5) c=uncharted2(c,uWhitePoint);
      else if(uType==6) c=agx(c);
      c=(c-0.5)*uContrast+0.5;
      float gray=dot(c,vec3(0.299,0.587,0.114));
      c=mix(vec3(gray),c,uSaturation);
      c=pow(max(c,vec3(0.0)),vec3(1.0/uGamma));
      gl_FragColor=vec4(c,color.a);
    }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  tm._program=gl.createProgram();
  gl.attachShader(tm._program,vs);
  gl.attachShader(tm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(tm._program);
  function render(inputTexture){
    if(!tm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,tm._framebuffer.framebuffer);
    gl.viewport(0,0,tm.width,tm.height);
    gl.useProgram(tm._program);
    const aPos=gl.getAttribLocation(tm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(tm._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(tm._program,'uType'),tm.type);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uExposure'),tm.exposure);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uWhitePoint'),tm.whitePoint);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uContrast'),tm.contrast);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uSaturation'),tm.saturation);
    gl.uniform1f(gl.getUniformLocation(tm._program,'uGamma'),tm.gamma);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return tm._framebuffer.texture;
  }
  function resize(w,h){ tm.width=w; tm.height=h; }
  function dispose(){ gl.deleteFramebuffer(tm._framebuffer.framebuffer); gl.deleteTexture(tm._framebuffer.texture); gl.deleteProgram(tm._program); }
  console.log('[ToneMappingEffect] 创建完成 type=' + tm.type);
  return { render, resize, dispose, tm };
}

/* ===== 后期处理色彩空间转换系统 ===== */
function createColorSpaceConversion(gl, width, height, options){
  const opt = options || {};
  const csc = {
    gl: gl, width, height,
    inputSpace: opt.inputSpace !== undefined ? opt.inputSpace : ColorSpace.LINEAR,
    outputSpace: opt.outputSpace !== undefined ? opt.outputSpace : ColorSpace.SRGB,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  csc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uInput; uniform int uOutput;
    float srgbToLinear(float c){ return c<=0.04045?c/12.92:pow((c+0.055)/1.055,2.4); }
    float linearToSrgb(float c){ return c<=0.0031308?c*12.92:1.055*pow(c,1.0/2.4)-0.055; }
    vec3 convert(vec3 c, int from, int to){
      if(from==to) return c;
      vec3 linear=c;
      if(from==0) linear=vec3(srgbToLinear(c.r),srgbToLinear(c.g),srgbToLinear(c.b));
      if(to==0) return vec3(linearToSrgb(linear.r),linearToSrgb(linear.g),linearToSrgb(linear.b));
      return linear;
    }
    void main(){ vec4 color=texture2D(uTex,vUV); gl_FragColor=vec4(convert(color.rgb,uInput,uOutput),color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  csc._program=gl.createProgram();
  gl.attachShader(csc._program,vs);
  gl.attachShader(csc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(csc._program);
  function render(inputTexture){
    if(!csc.enabled || csc.inputSpace===csc.outputSpace) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,csc._framebuffer.framebuffer);
    gl.viewport(0,0,csc.width,csc.height);
    gl.useProgram(csc._program);
    const aPos=gl.getAttribLocation(csc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(csc._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(csc._program,'uInput'),csc.inputSpace);
    gl.uniform1i(gl.getUniformLocation(csc._program,'uOutput'),csc.outputSpace);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return csc._framebuffer.texture;
  }
  function resize(w,h){ csc.width=w; csc.height=h; }
  function dispose(){ gl.deleteFramebuffer(csc._framebuffer.framebuffer); gl.deleteTexture(csc._framebuffer.texture); gl.deleteProgram(csc._program); }
  console.log('[ColorSpaceConversion] 创建完成 ' + csc.inputSpace + ' -> ' + csc.outputSpace);
  return { render, resize, dispose, csc };
}

/* ===== 后期处理伽马校正系统 ===== */
function createGammaCorrection(gl, width, height, options){
  const opt = options || {};
  const gc = {
    gl: gl, width, height,
    gamma: opt.gamma !== undefined ? opt.gamma : 2.2,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  gc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uGamma; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=pow(max(color.rgb,vec3(0.0)),vec3(1.0/uGamma)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gc._program=gl.createProgram();
  gl.attachShader(gc._program,vs);
  gl.attachShader(gc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gc._program);
  function render(inputTexture){
    if(!gc.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gc._framebuffer.framebuffer);
    gl.viewport(0,0,gc.width,gc.height);
    gl.useProgram(gc._program);
    const aPos=gl.getAttribLocation(gc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gc._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(gc._program,'uGamma'),gc.gamma);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gc._framebuffer.texture;
  }
  function resize(w,h){ gc.width=w; gc.height=h; }
  function dispose(){ gl.deleteFramebuffer(gc._framebuffer.framebuffer); gl.deleteTexture(gc._framebuffer.texture); gl.deleteProgram(gc._program); }
  console.log('[GammaCorrection] 创建完成 gamma=' + gc.gamma);
  return { render, resize, dispose, gc };
}

/* ===== 后期处理曝光系统 ===== */
function createExposure(gl, width, height, options){
  const opt = options || {};
  const exp = {
    gl: gl, width, height,
    exposure: opt.exposure !== undefined ? opt.exposure : 1,
    autoExposure: opt.autoExposure || false,
    minExposure: opt.minExposure || 0.1,
    maxExposure: opt.maxExposure || 10,
    targetLuminance: opt.targetLuminance || 0.5,
    adaptationSpeed: opt.adaptationSpeed || 1,
    _currentExposure: opt.exposure !== undefined ? opt.exposure : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  exp._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uExposure; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb*=uExposure; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  exp._program=gl.createProgram();
  gl.attachShader(exp._program,vs);
  gl.attachShader(exp._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(exp._program);
  function update(dt, inputTexture){
    if(!exp.autoExposure) return;
    exp._currentExposure += (exp.exposure-exp._currentExposure)*Math.min(1,dt*exp.adaptationSpeed);
  }
  function render(inputTexture){
    if(!exp.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,exp._framebuffer.framebuffer);
    gl.viewport(0,0,exp.width,exp.height);
    gl.useProgram(exp._program);
    const aPos=gl.getAttribLocation(exp._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(exp._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(exp._program,'uExposure'),exp.autoExposure?exp._currentExposure:exp.exposure);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return exp._framebuffer.texture;
  }
  function resize(w,h){ exp.width=w; exp.height=h; }
  function dispose(){ gl.deleteFramebuffer(exp._framebuffer.framebuffer); gl.deleteTexture(exp._framebuffer.texture); gl.deleteProgram(exp._program); }
  console.log('[Exposure] 创建完成 exposure=' + exp.exposure);
  return { update, render, resize, dispose, exp };
}

/* ===== 后期处理白平衡系统 ===== */
function createWhiteBalance(gl, width, height, options){
  const opt = options || {};
  const wb = {
    gl: gl, width, height,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    tint: opt.tint !== undefined ? opt.tint : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  wb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTemperature; uniform float uTint;
    vec3 temperatureColor(float t){ vec3 c=vec3(1.0); if(t<0.0){ c.b=1.0+min(0.6,-t*0.01); c.r=1.0+min(0.6,t*0.01); } else { c.r=1.0+min(0.6,t*0.01); c.b=1.0-min(0.6,t*0.01); } return c; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 temp=temperatureColor(uTemperature); color.rgb*=temp; color.g+=uTint*0.01; color.r-=uTint*0.005; color.b-=uTint*0.005; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  wb._program=gl.createProgram();
  gl.attachShader(wb._program,vs);
  gl.attachShader(wb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(wb._program);
  function render(inputTexture){
    if(!wb.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,wb._framebuffer.framebuffer);
    gl.viewport(0,0,wb.width,wb.height);
    gl.useProgram(wb._program);
    const aPos=gl.getAttribLocation(wb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(wb._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(wb._program,'uTemperature'),wb.temperature);
    gl.uniform1f(gl.getUniformLocation(wb._program,'uTint'),wb.tint);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return wb._framebuffer.texture;
  }
  function resize(w,h){ wb.width=w; wb.height=h; }
  function dispose(){ gl.deleteFramebuffer(wb._framebuffer.framebuffer); gl.deleteTexture(wb._framebuffer.texture); gl.deleteProgram(wb._program); }
  console.log('[WhiteBalance] 创建完成 temperature=' + wb.temperature + ' tint=' + wb.tint);
  return { render, resize, dispose, wb };
}

/* ===== 后期处理对比度系统 ===== */
function createContrast(gl, width, height, options){
  const opt = options || {};
  const c = {
    gl: gl, width, height,
    contrast: opt.contrast !== undefined ? opt.contrast : 1,
    brightness: opt.brightness !== undefined ? opt.brightness : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  c._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uContrast; uniform float uBrightness; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=(color.rgb-0.5)*uContrast+0.5+uBrightness; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  c._program=gl.createProgram();
  gl.attachShader(c._program,vs);
  gl.attachShader(c._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(c._program);
  function render(inputTexture){
    if(!c.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,c._framebuffer.framebuffer);
    gl.viewport(0,0,c.width,c.height);
    gl.useProgram(c._program);
    const aPos=gl.getAttribLocation(c._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(c._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(c._program,'uContrast'),c.contrast);
    gl.uniform1f(gl.getUniformLocation(c._program,'uBrightness'),c.brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return c._framebuffer.texture;
  }
  function resize(w,h){ c.width=w; c.height=h; }
  function dispose(){ gl.deleteFramebuffer(c._framebuffer.framebuffer); gl.deleteTexture(c._framebuffer.texture); gl.deleteProgram(c._program); }
  console.log('[Contrast] 创建完成 contrast=' + c.contrast);
  return { render, resize, dispose, c };
}

/* ===== 后期处理饱和度系统 ===== */
function createSaturation(gl, width, height, options){
  const opt = options || {};
  const s = {
    gl: gl, width, height,
    saturation: opt.saturation !== undefined ? opt.saturation : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  s._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uSaturation; void main(){ vec4 color=texture2D(uTex,vUV); float gray=dot(color.rgb,vec3(0.299,0.587,0.114)); color.rgb=mix(vec3(gray),color.rgb,uSaturation); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  s._program=gl.createProgram();
  gl.attachShader(s._program,vs);
  gl.attachShader(s._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(s._program);
  function render(inputTexture){
    if(!s.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,s._framebuffer.framebuffer);
    gl.viewport(0,0,s.width,s.height);
    gl.useProgram(s._program);
    const aPos=gl.getAttribLocation(s._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(s._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(s._program,'uSaturation'),s.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return s._framebuffer.texture;
  }
  function resize(w,h){ s.width=w; s.height=h; }
  function dispose(){ gl.deleteFramebuffer(s._framebuffer.framebuffer); gl.deleteTexture(s._framebuffer.texture); gl.deleteProgram(s._program); }
  console.log('[Saturation] 创建完成 saturation=' + s.saturation);
  return { render, resize, dispose, s };
}

/* ===== 后期处理亮度系统 ===== */
function createBrightness(gl, width, height, options){
  const opt = options || {};
  const b = {
    gl: gl, width, height,
    brightness: opt.brightness !== undefined ? opt.brightness : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  b._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uBrightness; void main(){ vec4 color=texture2D(uTex,vUV); color.rgb+=uBrightness; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  b._program=gl.createProgram();
  gl.attachShader(b._program,vs);
  gl.attachShader(b._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(b._program);
  function render(inputTexture){
    if(!b.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,b._framebuffer.framebuffer);
    gl.viewport(0,0,b.width,b.height);
    gl.useProgram(b._program);
    const aPos=gl.getAttribLocation(b._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(b._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(b._program,'uBrightness'),b.brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return b._framebuffer.texture;
  }
  function resize(w,h){ b.width=w; b.height=h; }
  function dispose(){ gl.deleteFramebuffer(b._framebuffer.framebuffer); gl.deleteTexture(b._framebuffer.texture); gl.deleteProgram(b._program); }
  console.log('[Brightness] 创建完成 brightness=' + b.brightness);
  return { render, resize, dispose, b };
}

/* ===== 后期处理色相系统 ===== */
function createHueShift(gl, width, height, options){
  const opt = options || {};
  const h = {
    gl: gl, width, height,
    hue: opt.hue !== undefined ? opt.hue : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  h._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uHue;
    vec3 rgb2hsv(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float d=mx-mn; vec3 hsv=vec3(0.0,0.0,mx); if(d!=0.0){ hsv.y=d/mx; if(c.r==mx) hsv.x=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) hsv.x=(c.b-c.r)/d+2.0; else hsv.x=(c.r-c.g)/d+4.0; hsv.x/=6.0; } return hsv; }
    vec3 hsv2rgb(vec3 hsv){ vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0); vec3 p=abs(fract(hsv.xxx+K.xyz)*6.0-K.www); return hsv.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),hsv.y); }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 hsv=rgb2hsv(color.rgb); hsv.x=fract(hsv.x+uHue/360.0); color.rgb=hsv2rgb(hsv); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  h._program=gl.createProgram();
  gl.attachShader(h._program,vs);
  gl.attachShader(h._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(h._program);
  function render(inputTexture){
    if(!h.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,h._framebuffer.framebuffer);
    gl.viewport(0,0,h.width,h.height);
    gl.useProgram(h._program);
    const aPos=gl.getAttribLocation(h._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(h._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(h._program,'uHue'),h.hue);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return h._framebuffer.texture;
  }
  function resize(w,h){ h.width=w; h.height=h; }
  function dispose(){ gl.deleteFramebuffer(h._framebuffer.framebuffer); gl.deleteTexture(h._framebuffer.texture); gl.deleteProgram(h._program); }
  console.log('[HueShift] 创建完成 hue=' + h.hue);
  return { render, resize, dispose, h };
}

/* ===== 后期处理色温系统 ===== */
function createColorTemperature(gl, width, height, options){
  const opt = options || {};
  const ct = {
    gl: gl, width, height,
    temperature: opt.temperature !== undefined ? opt.temperature : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ct._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uTemperature;
    vec3 tempColor(float t){ vec3 c=vec3(1.0); if(t<0.0){ c.b=1.0+min(0.6,-t*0.01); c.r=1.0+min(0.6,t*0.01); } else { c.r=1.0+min(0.6,t*0.01); c.b=1.0-min(0.6,t*0.01); } return c; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 temp=tempColor(uTemperature); color.rgb*=temp; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ct._program=gl.createProgram();
  gl.attachShader(ct._program,vs);
  gl.attachShader(ct._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ct._program);
  function render(inputTexture){
    if(!ct.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ct._framebuffer.framebuffer);
    gl.viewport(0,0,ct.width,ct.height);
    gl.useProgram(ct._program);
    const aPos=gl.getAttribLocation(ct._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(ct._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ct._program,'uTemperature'),ct.temperature);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ct._framebuffer.texture;
  }
  function resize(w,h){ ct.width=w; ct.height=h; }
  function dispose(){ gl.deleteFramebuffer(ct._framebuffer.framebuffer); gl.deleteTexture(ct._framebuffer.texture); gl.deleteProgram(ct._program); }
  console.log('[ColorTemperature] 创建完成 temperature=' + ct.temperature);
  return { render, resize, dispose, ct };
}

/* ===== 后期处理色彩平衡系统 ===== */
function createColorBalance(gl, width, height, options){
  const opt = options || {};
  const cb = {
    gl: gl, width, height,
    shadows: opt.shadows ? opt.shadows.slice() : [0,0,0],
    midtones: opt.midtones ? opt.midtones.slice() : [0,0,0],
    highlights: opt.highlights ? opt.highlights.slice() : [0,0,0],
    preserveLuminosity: opt.preserveLuminosity !== undefined ? opt.preserveLuminosity : true,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cb._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec3 uShadows; uniform vec3 uMidtones; uniform vec3 uHighlights; uniform int uPreserveLuminosity;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); float shadowMask=1.0-smoothstep(0.0,0.5,luma); float highlightMask=smoothstep(0.5,1.0,luma); float midtoneMask=1.0-shadowMask-highlightMask; vec3 balance=uShadows*shadowMask+uMidtones*midtoneMask+uHighlights*highlightMask; color.rgb+=balance; if(uPreserveLuminosity==1){ float newLuma=dot(color.rgb,vec3(0.299,0.587,0.114)); color.rgb*=luma/max(newLuma,0.001); } gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cb._program=gl.createProgram();
  gl.attachShader(cb._program,vs);
  gl.attachShader(cb._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cb._program);
  function render(inputTexture){
    if(!cb.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cb._framebuffer.framebuffer);
    gl.viewport(0,0,cb.width,cb.height);
    gl.useProgram(cb._program);
    const aPos=gl.getAttribLocation(cb._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cb._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uShadows'),cb.shadows);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uMidtones'),cb.midtones);
    gl.uniform3fv(gl.getUniformLocation(cb._program,'uHighlights'),cb.highlights);
    gl.uniform1i(gl.getUniformLocation(cb._program,'uPreserveLuminosity'),cb.preserveLuminosity?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cb._framebuffer.texture;
  }
  function resize(w,h){ cb.width=w; cb.height=h; }
  function dispose(){ gl.deleteFramebuffer(cb._framebuffer.framebuffer); gl.deleteTexture(cb._framebuffer.texture); gl.deleteProgram(cb._program); }
  console.log('[ColorBalance] 创建完成');
  return { render, resize, dispose, cb };
}

/* ===== 后期处理曲线系统 ===== */
function createCurves(gl, width, height, options){
  const opt = options || {};
  const cv = {
    gl: gl, width, height,
    redCurve: opt.redCurve ? opt.redCurve.slice() : [0,0.25,0.5,0.75,1],
    greenCurve: opt.greenCurve ? opt.greenCurve.slice() : [0,0.25,0.5,0.75,1],
    blueCurve: opt.blueCurve ? opt.blueCurve.slice() : [0,0.25,0.5,0.75,1],
    rgbCurve: opt.rgbCurve ? opt.rgbCurve.slice() : [0,0.25,0.5,0.75,1],
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cv._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRed[5]; uniform float uGreen[5]; uniform float uBlue[5]; uniform float uRGB[5];
    float sampleCurve(float x, float c[5]){ float t=x*4.0; int i=int(floor(t)); float f=fract(t); if(i>=4) return c[4]; if(i<0) return c[0]; return mix(c[i],c[i+1],f); }
    void main(){ vec4 color=texture2D(uTex,vUV); color.r=sampleCurve(color.r,uRed); color.g=sampleCurve(color.g,uGreen); color.b=sampleCurve(color.b,uBlue); color.rgb=vec3(sampleCurve(color.r,uRGB),sampleCurve(color.g,uRGB),sampleCurve(color.b,uRGB)); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cv._program=gl.createProgram();
  gl.attachShader(cv._program,vs);
  gl.attachShader(cv._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cv._program);
  function render(inputTexture){
    if(!cv.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cv._framebuffer.framebuffer);
    gl.viewport(0,0,cv.width,cv.height);
    gl.useProgram(cv._program);
    const aPos=gl.getAttribLocation(cv._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cv._program,'uTex'),0);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uRed[0]'),cv.redCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uGreen[0]'),cv.greenCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uBlue[0]'),cv.blueCurve);
    gl.uniform1fv(gl.getUniformLocation(cv._program,'uRGB[0]'),cv.rgbCurve);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cv._framebuffer.texture;
  }
  function resize(w,h){ cv.width=w; cv.height=h; }
  function dispose(){ gl.deleteFramebuffer(cv._framebuffer.framebuffer); gl.deleteTexture(cv._framebuffer.texture); gl.deleteProgram(cv._program); }
  console.log('[Curves] 创建完成');
  return { render, resize, dispose, cv };
}

/* ===== 后期处理色阶系统 ===== */
function createLevels(gl, width, height, options){
  const opt = options || {};
  const lv = {
    gl: gl, width, height,
    inputBlack: opt.inputBlack !== undefined ? opt.inputBlack : 0,
    inputWhite: opt.inputWhite !== undefined ? opt.inputWhite : 1,
    gamma: opt.gamma !== undefined ? opt.gamma : 1,
    outputBlack: opt.outputBlack !== undefined ? opt.outputBlack : 0,
    outputWhite: opt.outputWhite !== undefined ? opt.outputWhite : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  lv._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uInputBlack; uniform float uInputWhite; uniform float uGamma; uniform float uOutputBlack; uniform float uOutputWhite;
    void main(){ vec4 color=texture2D(uTex,vUV); color.rgb=(color.rgb-uInputBlack)/(uInputWhite-uInputBlack); color.rgb=pow(max(color.rgb,vec3(0.0)),vec3(1.0/uGamma)); color.rgb=color.rgb*(uOutputWhite-uOutputBlack)+uOutputBlack; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  lv._program=gl.createProgram();
  gl.attachShader(lv._program,vs);
  gl.attachShader(lv._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(lv._program);
  function render(inputTexture){
    if(!lv.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,lv._framebuffer.framebuffer);
    gl.viewport(0,0,lv.width,lv.height);
    gl.useProgram(lv._program);
    const aPos=gl.getAttribLocation(lv._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(lv._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uInputBlack'),lv.inputBlack);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uInputWhite'),lv.inputWhite);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uGamma'),lv.gamma);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uOutputBlack'),lv.outputBlack);
    gl.uniform1f(gl.getUniformLocation(lv._program,'uOutputWhite'),lv.outputWhite);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return lv._framebuffer.texture;
  }
  function resize(w,h){ lv.width=w; lv.height=h; }
  function dispose(){ gl.deleteFramebuffer(lv._framebuffer.framebuffer); gl.deleteTexture(lv._framebuffer.texture); gl.deleteProgram(lv._program); }
  console.log('[Levels] 创建完成 gamma=' + lv.gamma);
  return { render, resize, dispose, lv };
}

/* ===== 后期处理色相饱和度系统 ===== */
function createHueSaturation(gl, width, height, options){
  const opt = options || {};
  const hs = {
    gl: gl, width, height,
    hue: opt.hue !== undefined ? opt.hue : 0,
    saturation: opt.saturation !== undefined ? opt.saturation : 0,
    lightness: opt.lightness !== undefined ? opt.lightness : 0,
    colorize: opt.colorize || false,
    colorizeHue: opt.colorizeHue !== undefined ? opt.colorizeHue : 0,
    colorizeSaturation: opt.colorizeSaturation !== undefined ? opt.colorizeSaturation : 0.5,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  hs._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uHue; uniform float uSaturation; uniform float uLightness; uniform int uColorize; uniform float uColorizeHue; uniform float uColorizeSaturation;
    vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float h=0.0,s=0.0,l=(mx+mn)*0.5; if(mx!=mn){ float d=mx-mn; s=l>0.5?d/(2.0-mx-mn):d/(mx+mn); if(c.r==mx) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(c.g==mx) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; h/=6.0; } return vec3(h,s,l); }
    vec3 hsl2rgb(vec3 hsl){ float h=hsl.x,s=hsl.y,l=hsl.z; if(s==0.0) return vec3(l); float q=l<0.5?l*(1.0+s):l+s-l*s; float p=2.0*l-q; vec3 k=vec3(h+1.0/3.0,h,h-1.0/3.0); for(int i=0;i<3;i++){ if(k[i]<0.0) k[i]+=1.0; if(k[i]>1.0) k[i]-=1.0; } vec3 rgb; for(int i=0;i<3;i++){ if(k[i]<1.0/6.0) rgb[i]=p+(q-p)*6.0*k[i]; else if(k[i]<0.5) rgb[i]=q; else if(k[i]<2.0/3.0) rgb[i]=p+(q-p)*(2.0/3.0-k[i])*6.0; else rgb[i]=p; } return rgb; }
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 hsl=rgb2hsl(color.rgb); if(uColorize==1){ hsl.x=uColorizeHue/360.0; hsl.y=uColorizeSaturation; } else { hsl.x=fract(hsl.x+uHue/360.0); hsl.y=clamp(hsl.y+uSaturation,0.0,1.0); } hsl.z=clamp(hsl.z+uLightness,0.0,1.0); color.rgb=hsl2rgb(hsl); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hs._program=gl.createProgram();
  gl.attachShader(hs._program,vs);
  gl.attachShader(hs._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hs._program);
  function render(inputTexture){
    if(!hs.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hs._framebuffer.framebuffer);
    gl.viewport(0,0,hs.width,hs.height);
    gl.useProgram(hs._program);
    const aPos=gl.getAttribLocation(hs._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hs._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uHue'),hs.hue);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uSaturation'),hs.saturation);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uLightness'),hs.lightness);
    gl.uniform1i(gl.getUniformLocation(hs._program,'uColorize'),hs.colorize?1:0);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uColorizeHue'),hs.colorizeHue);
    gl.uniform1f(gl.getUniformLocation(hs._program,'uColorizeSaturation'),hs.colorizeSaturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hs._framebuffer.texture;
  }
  function resize(w,h){ hs.width=w; hs.height=h; }
  function dispose(){ gl.deleteFramebuffer(hs._framebuffer.framebuffer); gl.deleteTexture(hs._framebuffer.texture); gl.deleteProgram(hs._program); }
  console.log('[HueSaturation] 创建完成 hue=' + hs.hue + ' saturation=' + hs.saturation);
  return { render, resize, dispose, hs };
}

/* ===== 后期处理可选颜色系统 ===== */
function createSelectiveColor(gl, width, height, options){
  const opt = options || {};
  const sc = {
    gl: gl, width, height,
    reds: opt.reds ? opt.reds.slice() : [0,0,0,0],
    yellows: opt.yellows ? opt.yellows.slice() : [0,0,0,0],
    greens: opt.greens ? opt.greens.slice() : [0,0,0,0],
    cyans: opt.cyans ? opt.cyans.slice() : [0,0,0,0],
    blues: opt.blues ? opt.blues.slice() : [0,0,0,0],
    magentas: opt.magentas ? opt.magentas.slice() : [0,0,0,0],
    whites: opt.whites ? opt.whites.slice() : [0,0,0,0],
    neutrals: opt.neutrals ? opt.neutrals.slice() : [0,0,0,0],
    blacks: opt.blacks ? opt.blacks.slice() : [0,0,0,0],
    method: opt.method || 'relative',
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  sc._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uReds; uniform vec4 uYellows; uniform vec4 uGreens; uniform vec4 uCyans; uniform vec4 uBlues; uniform vec4 uMagentas; uniform vec4 uWhites; uniform vec4 uNeutrals; uniform vec4 uBlacks; uniform int uMethod;
    vec4 applyColor(vec4 color, vec4 adj, float amount){ if(uMethod==0){ color.r+=adj.r*color.r*amount; color.g+=adj.g*color.g*amount; color.b+=adj.b*color.b*amount; color.a+=adj.a*(1.0-color.a)*amount; } else { color.r+=adj.r*amount; color.g+=adj.g*amount; color.b+=adj.b*amount; color.a+=adj.a*amount; } return color; }
    void main(){ vec4 color=texture2D(uTex,vUV); float mx=max(color.r,max(color.g,color.b)); float mn=min(color.r,min(color.g,color.b)); float luma=(mx+mn)*0.5; if(color.r>color.g&&color.r>color.b) color=applyColor(color,uReds,1.0); else if(color.g>color.r&&color.g>color.b) color=applyColor(color,uGreens,1.0); else if(color.b>color.r&&color.b>color.g) color=applyColor(color,uBlues,1.0); else if(color.r>color.b&&color.g>color.b) color=applyColor(color,uYellows,1.0); else if(color.g>color.r&&color.b>color.r) color=applyColor(color,uCyans,1.0); else if(color.r>color.g&&color.b>color.g) color=applyColor(color,uMagentas,1.0); if(luma>0.8) color=applyColor(color,uWhites,1.0); else if(luma<0.2) color=applyColor(color,uBlacks,1.0); else color=applyColor(color,uNeutrals,1.0); gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sc._program=gl.createProgram();
  gl.attachShader(sc._program,vs);
  gl.attachShader(sc._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sc._program);
  function render(inputTexture){
    if(!sc.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,sc._framebuffer.framebuffer);
    gl.viewport(0,0,sc.width,sc.height);
    gl.useProgram(sc._program);
    const aPos=gl.getAttribLocation(sc._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(sc._program,'uTex'),0);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uReds'),sc.reds);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uYellows'),sc.yellows);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uGreens'),sc.greens);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uCyans'),sc.cyans);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uBlues'),sc.blues);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uMagentas'),sc.magentas);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uWhites'),sc.whites);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uNeutrals'),sc.neutrals);
    gl.uniform4fv(gl.getUniformLocation(sc._program,'uBlacks'),sc.blacks);
    gl.uniform1i(gl.getUniformLocation(sc._program,'uMethod'),sc.method==='relative'?0:1);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sc._framebuffer.texture;
  }
  function resize(w,h){ sc.width=w; sc.height=h; }
  function dispose(){ gl.deleteFramebuffer(sc._framebuffer.framebuffer); gl.deleteTexture(sc._framebuffer.texture); gl.deleteProgram(sc._program); }
  console.log('[SelectiveColor] 创建完成 method=' + sc.method);
  return { render, resize, dispose, sc };
}

/* ===== 后期处理通道混合器系统 ===== */
function createChannelMixer(gl, width, height, options){
  const opt = options || {};
  const cm = {
    gl: gl, width, height,
    red: opt.red ? opt.red.slice() : [1,0,0,0],
    green: opt.green ? opt.green.slice() : [0,1,0,0],
    blue: opt.blue ? opt.blue.slice() : [0,0,1,0],
    monochrome: opt.monochrome || false,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  cm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uRed; uniform vec4 uGreen; uniform vec4 uBlue; uniform int uMonochrome;
    void main(){ vec4 color=texture2D(uTex,vUV); vec3 c=color.rgb; float r=dot(c,uRed.rgb)+uRed.a; float g=dot(c,uGreen.rgb)+uGreen.a; float b=dot(c,uBlue.rgb)+uBlue.a; if(uMonochrome==1){ float gray=r*0.299+g*0.587+b*0.114; gl_FragColor=vec4(vec3(gray),color.a); } else gl_FragColor=vec4(r,g,b,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  cm._program=gl.createProgram();
  gl.attachShader(cm._program,vs);
  gl.attachShader(cm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(cm._program);
  function render(inputTexture){
    if(!cm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,cm._framebuffer.framebuffer);
    gl.viewport(0,0,cm.width,cm.height);
    gl.useProgram(cm._program);
    const aPos=gl.getAttribLocation(cm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(cm._program,'uTex'),0);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uRed'),cm.red);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uGreen'),cm.green);
    gl.uniform4fv(gl.getUniformLocation(cm._program,'uBlue'),cm.blue);
    gl.uniform1i(gl.getUniformLocation(cm._program,'uMonochrome'),cm.monochrome?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return cm._framebuffer.texture;
  }
  function resize(w,h){ cm.width=w; cm.height=h; }
  function dispose(){ gl.deleteFramebuffer(cm._framebuffer.framebuffer); gl.deleteTexture(cm._framebuffer.texture); gl.deleteProgram(cm._program); }
  console.log('[ChannelMixer] 创建完成 monochrome=' + cm.monochrome);
  return { render, resize, dispose, cm };
}

/* ===== 后期处理渐变映射系统 ===== */
function createGradientMap(gl, width, height, options){
  const opt = options || {};
  const gm = {
    gl: gl, width, height,
    gradient: opt.gradient ? opt.gradient.slice() : [[0,0,0],[1,1,1]],
    enabled: true,
    _program: null,
    _framebuffer: null,
    _gradientTexture: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  gm._framebuffer=createFB(width,height);
  function createGradientTexture(gradient){
    const size=256;
    const data=new Uint8Array(size*4);
    for(let i=0;i<size;i++){
      const t=i/(size-1);
      let r=0,g=0,b=0;
      for(let j=0;j<gradient.length-1;j++){
        const t0=j/(gradient.length-1);
        const t1=(j+1)/(gradient.length-1);
        if(t>=t0&&t<=t1){
          const f=(t-t0)/(t1-t0);
          r=gradient[j][0]*(1-f)+gradient[j+1][0]*f;
          g=gradient[j][1]*(1-f)+gradient[j+1][1]*f;
          b=gradient[j][2]*(1-f)+gradient[j+1][2]*f;
          break;
        }
      }
      data[i*4]=Math.floor(r*255);
      data[i*4+1]=Math.floor(g*255);
      data[i*4+2]=Math.floor(b*255);
      data[i*4+3]=255;
    }
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,1,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return tex;
  }
  gm._gradientTexture=createGradientTexture(gm.gradient);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform sampler2D uGradient; void main(){ vec4 color=texture2D(uTex,vUV); float gray=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 mapped=texture2D(uGradient,vec2(gray,0.5)).rgb; gl_FragColor=vec4(mapped,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gm._program=gl.createProgram();
  gl.attachShader(gm._program,vs);
  gl.attachShader(gm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gm._program);
  function render(inputTexture){
    if(!gm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gm._framebuffer.framebuffer);
    gl.viewport(0,0,gm.width,gm.height);
    gl.useProgram(gm._program);
    const aPos=gl.getAttribLocation(gm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gm._program,'uTex'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,gm._gradientTexture); gl.uniform1i(gl.getUniformLocation(gm._program,'uGradient'),1);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gm._framebuffer.texture;
  }
  function resize(w,h){ gm.width=w; gm.height=h; }
  function dispose(){ gl.deleteFramebuffer(gm._framebuffer.framebuffer); gl.deleteTexture(gm._framebuffer.texture); gl.deleteTexture(gm._gradientTexture); gl.deleteProgram(gm._program); }
  console.log('[GradientMap] 创建完成 gradient stops=' + gm.gradient.length);
  return { render, resize, dispose, gm };
}

/* ===== 后期处理照片滤镜系统 ===== */
function createPhotoFilter(gl, width, height, options){
  const opt = options || {};
  const pf = {
    gl: gl, width, height,
    color: opt.color ? opt.color.slice() : [1,0.8,0.6],
    density: opt.density !== undefined ? opt.density : 0.25,
    preserveLuminosity: opt.preserveLuminosity !== undefined ? opt.preserveLuminosity : true,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  pf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform vec3 uColor; uniform float uDensity; uniform int uPreserveLuminosity;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 filtered=mix(color.rgb,uColor,uDensity); if(uPreserveLuminosity==1){ float newLuma=dot(filtered,vec3(0.299,0.587,0.114)); filtered*=luma/max(newLuma,0.001); } gl_FragColor=vec4(filtered,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  pf._program=gl.createProgram();
  gl.attachShader(pf._program,vs);
  gl.attachShader(pf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(pf._program);
  function render(inputTexture){
    if(!pf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,pf._framebuffer.framebuffer);
    gl.viewport(0,0,pf.width,pf.height);
    gl.useProgram(pf._program);
    const aPos=gl.getAttribLocation(pf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(pf._program,'uTex'),0);
    gl.uniform3fv(gl.getUniformLocation(pf._program,'uColor'),pf.color);
    gl.uniform1f(gl.getUniformLocation(pf._program,'uDensity'),pf.density);
    gl.uniform1i(gl.getUniformLocation(pf._program,'uPreserveLuminosity'),pf.preserveLuminosity?1:0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return pf._framebuffer.texture;
  }
  function resize(w,h){ pf.width=w; pf.height=h; }
  function dispose(){ gl.deleteFramebuffer(pf._framebuffer.framebuffer); gl.deleteTexture(pf._framebuffer.texture); gl.deleteProgram(pf._program); }
  console.log('[PhotoFilter] 创建完成 density=' + pf.density);
  return { render, resize, dispose, pf };
}

/* ===== 后期处理阴影高光系统 ===== */
function createShadowHighlight(gl, width, height, options){
  const opt = options || {};
  const sh = {
    gl: gl, width, height,
    shadowAmount: opt.shadowAmount !== undefined ? opt.shadowAmount : 0,
    highlightAmount: opt.highlightAmount !== undefined ? opt.highlightAmount : 0,
    shadowTone: opt.shadowTone !== undefined ? opt.shadowTone : 0.5,
    highlightTone: opt.highlightTone !== undefined ? opt.highlightTone : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 100,
    colorCorrection: opt.colorCorrection !== undefined ? opt.colorCorrection : 0,
    midtoneContrast: opt.midtoneContrast !== undefined ? opt.midtoneContrast : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  sh._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uShadowAmount; uniform float uHighlightAmount; uniform float uShadowTone; uniform float uHighlightTone; uniform float uColorCorrection; uniform float uMidtoneContrast;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); float shadowMask=1.0-smoothstep(0.0,uShadowTone,luma); float highlightMask=smoothstep(1.0-uHighlightTone,1.0,luma); float midtoneMask=1.0-shadowMask-highlightMask; color.rgb+=uShadowAmount*shadowMask*0.5; color.rgb-=uHighlightAmount*highlightMask*0.5; color.rgb=(color.rgb-0.5)*midtoneMask*uMidtoneContrast+color.rgb; gl_FragColor=color; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  sh._program=gl.createProgram();
  gl.attachShader(sh._program,vs);
  gl.attachShader(sh._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(sh._program);
  function render(inputTexture){
    if(!sh.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,sh._framebuffer.framebuffer);
    gl.viewport(0,0,sh.width,sh.height);
    gl.useProgram(sh._program);
    const aPos=gl.getAttribLocation(sh._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(sh._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uShadowAmount'),sh.shadowAmount);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uHighlightAmount'),sh.highlightAmount);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uShadowTone'),sh.shadowTone);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uHighlightTone'),sh.highlightTone);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uColorCorrection'),sh.colorCorrection);
    gl.uniform1f(gl.getUniformLocation(sh._program,'uMidtoneContrast'),sh.midtoneContrast);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return sh._framebuffer.texture;
  }
  function resize(w,h){ sh.width=w; sh.height=h; }
  function dispose(){ gl.deleteFramebuffer(sh._framebuffer.framebuffer); gl.deleteTexture(sh._framebuffer.texture); gl.deleteProgram(sh._program); }
  console.log('[ShadowHighlight] 创建完成 shadow=' + sh.shadowAmount + ' highlight=' + sh.highlightAmount);
  return { render, resize, dispose, sh };
}

/* ===== 后期处理HDR色调系统 ===== */
function createHDRToning(gl, width, height, options){
  const opt = options || {};
  const hdr = {
    gl: gl, width, height,
    radius: opt.radius !== undefined ? opt.radius : 1,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    gamma: opt.gamma !== undefined ? opt.gamma : 1,
    exposure: opt.exposure !== undefined ? opt.exposure : 0,
    detail: opt.detail !== undefined ? opt.detail : 0.5,
    saturation: opt.saturation !== undefined ? opt.saturation : 0.5,
    radius2: opt.radius2 !== undefined ? opt.radius2 : 1,
    strength2: opt.strength2 !== undefined ? opt.strength2 : 0.5,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  hdr._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRadius; uniform float uStrength; uniform float uGamma; uniform float uExposure; uniform float uDetail; uniform float uSaturation;
    void main(){ vec4 color=texture2D(uTex,vUV); float luma=dot(color.rgb,vec3(0.299,0.587,0.114)); vec3 hdrColor=color.rgb*(1.0+uExposure); hdrColor=pow(max(hdrColor,vec3(0.0)),vec3(1.0/uGamma)); float gray=dot(hdrColor,vec3(0.299,0.587,0.114)); hdrColor=mix(vec3(gray),hdrColor,uSaturation); gl_FragColor=vec4(hdrColor,color.a); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hdr._program=gl.createProgram();
  gl.attachShader(hdr._program,vs);
  gl.attachShader(hdr._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hdr._program);
  function render(inputTexture){
    if(!hdr.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hdr._framebuffer.framebuffer);
    gl.viewport(0,0,hdr.width,hdr.height);
    gl.useProgram(hdr._program);
    const aPos=gl.getAttribLocation(hdr._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hdr._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uRadius'),hdr.radius);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uStrength'),hdr.strength);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uGamma'),hdr.gamma);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uExposure'),hdr.exposure);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uDetail'),hdr.detail);
    gl.uniform1f(gl.getUniformLocation(hdr._program,'uSaturation'),hdr.saturation);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hdr._framebuffer.texture;
  }
  function resize(w,h){ hdr.width=w; hdr.height=h; }
  function dispose(){ gl.deleteFramebuffer(hdr._framebuffer.framebuffer); gl.deleteTexture(hdr._framebuffer.texture); gl.deleteProgram(hdr._program); }
  console.log('[HDRToning] 创建完成 strength=' + hdr.strength);
  return { render, resize, dispose, hdr };
}

/* ===== 后期处理去噪系统 ===== */
function createDenoise(gl, width, height, options){
  const opt = options || {};
  const dn = {
    gl: gl, width, height,
    strength: opt.strength !== undefined ? opt.strength : 0.5,
    threshold: opt.threshold !== undefined ? opt.threshold : 0.1,
    radius: opt.radius || 2,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  dn._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uStrength; uniform float uThreshold; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 result=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); float diff=length(sample.rgb-center.rgb); float weight=exp(-diff*diff/(uThreshold*uThreshold))*exp(-(float(x*x+y*y))/9.0); result+=sample*weight; total+=weight; } } result/=total; gl_FragColor=mix(center,result,uStrength); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  dn._program=gl.createProgram();
  gl.attachShader(dn._program,vs);
  gl.attachShader(dn._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(dn._program);
  function render(inputTexture){
    if(!dn.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,dn._framebuffer.framebuffer);
    gl.viewport(0,0,dn.width,dn.height);
    gl.useProgram(dn._program);
    const aPos=gl.getAttribLocation(dn._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(dn._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(dn._program,'uStrength'),dn.strength);
    gl.uniform1f(gl.getUniformLocation(dn._program,'uThreshold'),dn.threshold);
    gl.uniform2f(gl.getUniformLocation(dn._program,'uTexel'),1/dn.width,1/dn.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return dn._framebuffer.texture;
  }
  function resize(w,h){ dn.width=w; dn.height=h; }
  function dispose(){ gl.deleteFramebuffer(dn._framebuffer.framebuffer); gl.deleteTexture(dn._framebuffer.texture); gl.deleteProgram(dn._program); }
  console.log('[Denoise] 创建完成 strength=' + dn.strength);
  return { render, resize, dispose, dn };
}

/* ===== 后期处理USM锐化系统 ===== */
function createUnsharpMask(gl, width, height, options){
  const opt = options || {};
  const usm = {
    gl: gl, width, height,
    amount: opt.amount !== undefined ? opt.amount : 0.5,
    radius: opt.radius !== undefined ? opt.radius : 1,
    threshold: opt.threshold !== undefined ? opt.threshold : 0,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  usm._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uAmount; uniform float uRadius; uniform float uThreshold; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ float weight=exp(-(float(x*x+y*y))/(2.0*uRadius*uRadius)); blur+=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel)*weight; total+=weight; } } blur/=total; vec4 sharp=center+(center-blur)*uAmount; float diff=length(center.rgb-blur.rgb); if(diff<uThreshold) sharp=center; gl_FragColor=sharp; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  usm._program=gl.createProgram();
  gl.attachShader(usm._program,vs);
  gl.attachShader(usm._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(usm._program);
  function render(inputTexture){
    if(!usm.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,usm._framebuffer.framebuffer);
    gl.viewport(0,0,usm.width,usm.height);
    gl.useProgram(usm._program);
    const aPos=gl.getAttribLocation(usm._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(usm._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uAmount'),usm.amount);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uRadius'),usm.radius);
    gl.uniform1f(gl.getUniformLocation(usm._program,'uThreshold'),usm.threshold);
    gl.uniform2f(gl.getUniformLocation(usm._program,'uTexel'),1/usm.width,1/usm.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return usm._framebuffer.texture;
  }
  function resize(w,h){ usm.width=w; usm.height=h; }
  function dispose(){ gl.deleteFramebuffer(usm._framebuffer.framebuffer); gl.deleteTexture(usm._framebuffer.texture); gl.deleteProgram(usm._program); }
  console.log('[UnsharpMask] 创建完成 amount=' + usm.amount + ' radius=' + usm.radius);
  return { render, resize, dispose, usm };
}

/* ===== 后期处理高反差保留系统 ===== */
function createHighPass(gl, width, height, options){
  const opt = options || {};
  const hp = {
    gl: gl, width, height,
    radius: opt.radius !== undefined ? opt.radius : 1,
    amount: opt.amount !== undefined ? opt.amount : 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  hp._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uRadius; uniform float uAmount; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 blur=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ float weight=exp(-(float(x*x+y*y))/(2.0*uRadius*uRadius)); blur+=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel)*weight; total+=weight; } } blur/=total; vec4 highpass=center-blur+0.5; gl_FragColor=mix(center,highpass,uAmount); }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  hp._program=gl.createProgram();
  gl.attachShader(hp._program,vs);
  gl.attachShader(hp._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(hp._program);
  function render(inputTexture){
    if(!hp.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,hp._framebuffer.framebuffer);
    gl.viewport(0,0,hp.width,hp.height);
    gl.useProgram(hp._program);
    const aPos=gl.getAttribLocation(hp._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(hp._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(hp._program,'uRadius'),hp.radius);
    gl.uniform1f(gl.getUniformLocation(hp._program,'uAmount'),hp.amount);
    gl.uniform2f(gl.getUniformLocation(hp._program,'uTexel'),1/hp.width,1/hp.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return hp._framebuffer.texture;
  }
  function resize(w,h){ hp.width=w; hp.height=h; }
  function dispose(){ gl.deleteFramebuffer(hp._framebuffer.framebuffer); gl.deleteTexture(hp._framebuffer.texture); gl.deleteProgram(hp._program); }
  console.log('[HighPass] 创建完成 radius=' + hp.radius);
  return { render, resize, dispose, hp };
}

/* ===== 后期处理最小值系统 ===== */
function createMinimum(gl, width, height, options){
  const opt = options || {};
  const mn = {
    gl: gl, width, height,
    radius: opt.radius || 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mn._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 minVal=vec4(1.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); minVal=min(minVal,sample); } } } gl_FragColor=minVal; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mn._program=gl.createProgram();
  gl.attachShader(mn._program,vs);
  gl.attachShader(mn._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mn._program);
  function render(inputTexture){
    if(!mn.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mn._framebuffer.framebuffer);
    gl.viewport(0,0,mn.width,mn.height);
    gl.useProgram(mn._program);
    const aPos=gl.getAttribLocation(mn._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mn._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mn._program,'uRadius'),mn.radius);
    gl.uniform2f(gl.getUniformLocation(mn._program,'uTexel'),1/mn.width,1/mn.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mn._framebuffer.texture;
  }
  function resize(w,h){ mn.width=w; mn.height=h; }
  function dispose(){ gl.deleteFramebuffer(mn._framebuffer.framebuffer); gl.deleteTexture(mn._framebuffer.texture); gl.deleteProgram(mn._program); }
  console.log('[Minimum] 创建完成 radius=' + mn.radius);
  return { render, resize, dispose, mn };
}

/* ===== 后期处理最大值系统 ===== */
function createMaximum(gl, width, height, options){
  const opt = options || {};
  const mx = {
    gl: gl, width, height,
    radius: opt.radius || 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mx._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 maxVal=vec4(0.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); maxVal=max(maxVal,sample); } } } gl_FragColor=maxVal; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mx._program=gl.createProgram();
  gl.attachShader(mx._program,vs);
  gl.attachShader(mx._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mx._program);
  function render(inputTexture){
    if(!mx.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mx._framebuffer.framebuffer);
    gl.viewport(0,0,mx.width,mx.height);
    gl.useProgram(mx._program);
    const aPos=gl.getAttribLocation(mx._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mx._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mx._program,'uRadius'),mx.radius);
    gl.uniform2f(gl.getUniformLocation(mx._program,'uTexel'),1/mx.width,1/mx.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mx._framebuffer.texture;
  }
  function resize(w,h){ mx.width=w; mx.height=h; }
  function dispose(){ gl.deleteFramebuffer(mx._framebuffer.framebuffer); gl.deleteTexture(mx._framebuffer.texture); gl.deleteProgram(mx._program); }
  console.log('[Maximum] 创建完成 radius=' + mx.radius);
  return { render, resize, dispose, mx };
}

/* ===== 后期处理中值滤波系统 ===== */
function createMedianFilter(gl, width, height, options){
  const opt = options || {};
  const mf = {
    gl: gl, width, height,
    radius: opt.radius || 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 samples[9]; int idx=0; for(int x=-1;x<=1;x++){ for(int y=-1;y<=1;y++){ samples[idx]=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); idx++; } } for(int i=0;i<9;i++){ for(int j=i+1;j<9;j++){ if(samples[i].r>samples[j].r){ vec4 tmp=samples[i]; samples[i]=samples[j]; samples[j]=tmp; } } } gl_FragColor=samples[4]; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mf._program=gl.createProgram();
  gl.attachShader(mf._program,vs);
  gl.attachShader(mf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mf._program);
  function render(inputTexture){
    if(!mf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mf._framebuffer.framebuffer);
    gl.viewport(0,0,mf.width,mf.height);
    gl.useProgram(mf._program);
    const aPos=gl.getAttribLocation(mf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mf._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mf._program,'uRadius'),mf.radius);
    gl.uniform2f(gl.getUniformLocation(mf._program,'uTexel'),1/mf.width,1/mf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mf._framebuffer.texture;
  }
  function resize(w,h){ mf.width=w; mf.height=h; }
  function dispose(){ gl.deleteFramebuffer(mf._framebuffer.framebuffer); gl.deleteTexture(mf._framebuffer.texture); gl.deleteProgram(mf._program); }
  console.log('[MedianFilter] 创建完成 radius=' + mf.radius);
  return { render, resize, dispose, mf };
}

/* ===== 后期处理双边滤波系统 ===== */
function createBilateralFilter(gl, width, height, options){
  const opt = options || {};
  const bf = {
    gl: gl, width, height,
    spatialSigma: opt.spatialSigma !== undefined ? opt.spatialSigma : 2,
    rangeSigma: opt.rangeSigma !== undefined ? opt.rangeSigma : 0.1,
    radius: opt.radius || 3,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  bf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uSpatialSigma; uniform float uRangeSigma; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 result=vec4(0.0); float total=0.0; for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); float spatialWeight=exp(-(float(x*x+y*y))/(2.0*uSpatialSigma*uSpatialSigma)); float rangeWeight=exp(-(length(sample.rgb-center.rgb)*length(sample.rgb-center.rgb))/(2.0*uRangeSigma*uRangeSigma)); float weight=spatialWeight*rangeWeight; result+=sample*weight; total+=weight; } } } gl_FragColor=result/total; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  bf._program=gl.createProgram();
  gl.attachShader(bf._program,vs);
  gl.attachShader(bf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(bf._program);
  function render(inputTexture){
    if(!bf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,bf._framebuffer.framebuffer);
    gl.viewport(0,0,bf.width,bf.height);
    gl.useProgram(bf._program);
    const aPos=gl.getAttribLocation(bf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(bf._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(bf._program,'uSpatialSigma'),bf.spatialSigma);
    gl.uniform1f(gl.getUniformLocation(bf._program,'uRangeSigma'),bf.rangeSigma);
    gl.uniform1i(gl.getUniformLocation(bf._program,'uRadius'),bf.radius);
    gl.uniform2f(gl.getUniformLocation(bf._program,'uTexel'),1/bf.width,1/bf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return bf._framebuffer.texture;
  }
  function resize(w,h){ bf.width=w; bf.height=h; }
  function dispose(){ gl.deleteFramebuffer(bf._framebuffer.framebuffer); gl.deleteTexture(bf._framebuffer.texture); gl.deleteProgram(bf._program); }
  console.log('[BilateralFilter] 创建完成 spatialSigma=' + bf.spatialSigma + ' rangeSigma=' + bf.rangeSigma);
  return { render, resize, dispose, bf };
}

/* ===== 后期处理导向滤波系统 ===== */
function createGuidedFilter(gl, width, height, options){
  const opt = options || {};
  const gf = {
    gl: gl, width, height,
    radius: opt.radius || 4,
    epsilon: opt.epsilon !== undefined ? opt.epsilon : 0.01,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  gf._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uRadius; uniform float uEpsilon; uniform vec2 uTexel;
    void main(){ vec4 meanI=vec4(0.0); vec4 meanP=vec4(0.0); vec4 corrI=vec4(0.0); vec4 corrIP=vec4(0.0); float count=0.0; for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec2 uv=vUV+vec2(float(x),float(y))*uTexel; vec4 I=texture2D(uTex,uv); meanI+=I; meanP+=I; corrI+=I*I; corrIP+=I*I; count+=1.0; } } } meanI/=count; meanP/=count; corrI/=count; corrIP/=count; vec4 varI=corrI-meanI*meanI; vec4 covIP=corrIP-meanI*meanP; vec4 a=covIP/(varI+uEpsilon); vec4 b=meanP-a*meanI; vec4 meanA=vec4(0.0); vec4 meanB=vec4(0.0); for(int x=-4;x<=4;x++){ for(int y=-4;y<=4;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ meanA+=a; meanB+=b; } } } meanA/=count; meanB/=count; vec4 center=texture2D(uTex,vUV); gl_FragColor=meanA*center+meanB; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  gf._program=gl.createProgram();
  gl.attachShader(gf._program,vs);
  gl.attachShader(gf._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(gf._program);
  function render(inputTexture){
    if(!gf.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,gf._framebuffer.framebuffer);
    gl.viewport(0,0,gf.width,gf.height);
    gl.useProgram(gf._program);
    const aPos=gl.getAttribLocation(gf._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(gf._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(gf._program,'uRadius'),gf.radius);
    gl.uniform1f(gl.getUniformLocation(gf._program,'uEpsilon'),gf.epsilon);
    gl.uniform2f(gl.getUniformLocation(gf._program,'uTexel'),1/gf.width,1/gf.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return gf._framebuffer.texture;
  }
  function resize(w,h){ gf.width=w; gf.height=h; }
  function dispose(){ gl.deleteFramebuffer(gf._framebuffer.framebuffer); gl.deleteTexture(gf._framebuffer.texture); gl.deleteProgram(gf._program); }
  console.log('[GuidedFilter] 创建完成 radius=' + gf.radius + ' epsilon=' + gf.epsilon);
  return { render, resize, dispose, gf };
}

/* ===== 后期处理各向异性扩散系统 ===== */
function createAnisotropicDiffusion(gl, width, height, options){
  const opt = options || {};
  const ad = {
    gl: gl, width, height,
    iterations: opt.iterations || 1,
    lambda: opt.lambda !== undefined ? opt.lambda : 0.15,
    kappa: opt.kappa !== undefined ? opt.kappa : 0.05,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  ad._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform float uLambda; uniform float uKappa; uniform vec2 uTexel;
    void main(){ vec4 center=texture2D(uTex,vUV); vec4 north=texture2D(uTex,vUV+vec2(0.0,-1.0)*uTexel); vec4 south=texture2D(uTex,vUV+vec2(0.0,1.0)*uTexel); vec4 east=texture2D(uTex,vUV+vec2(1.0,0.0)*uTexel); vec4 west=texture2D(uTex,vUV+vec2(-1.0,0.0)*uTexel); vec4 gradN=north-center; vec4 gradS=south-center; vec4 gradE=east-center; vec4 gradW=west-center; float cN=exp(-(length(gradN.rgb)/uKappa)*(length(gradN.rgb)/uKappa)); float cS=exp(-(length(gradS.rgb)/uKappa)*(length(gradS.rgb)/uKappa)); float cE=exp(-(length(gradE.rgb)/uKappa)*(length(gradE.rgb)/uKappa)); float cW=exp(-(length(gradW.rgb)/uKappa)*(length(gradW.rgb)/uKappa)); vec4 result=center+uLambda*(cN*gradN+cS*gradS+cE*gradE+cW*gradW); gl_FragColor=result; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  ad._program=gl.createProgram();
  gl.attachShader(ad._program,vs);
  gl.attachShader(ad._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(ad._program);
  function render(inputTexture){
    if(!ad.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,ad._framebuffer.framebuffer);
    gl.viewport(0,0,ad.width,ad.height);
    gl.useProgram(ad._program);
    const aPos=gl.getAttribLocation(ad._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(ad._program,'uTex'),0);
    gl.uniform1f(gl.getUniformLocation(ad._program,'uLambda'),ad.lambda);
    gl.uniform1f(gl.getUniformLocation(ad._program,'uKappa'),ad.kappa);
    gl.uniform2f(gl.getUniformLocation(ad._program,'uTexel'),1/ad.width,1/ad.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return ad._framebuffer.texture;
  }
  function resize(w,h){ ad.width=w; ad.height=h; }
  function dispose(){ gl.deleteFramebuffer(ad._framebuffer.framebuffer); gl.deleteTexture(ad._framebuffer.texture); gl.deleteProgram(ad._program); }
  console.log('[AnisotropicDiffusion] 创建完成 lambda=' + ad.lambda + ' kappa=' + ad.kappa);
  return { render, resize, dispose, ad };
}

/* ===== 后期处理形态学操作系统 ===== */
function createMorphology(gl, width, height, options){
  const opt = options || {};
  const mo = {
    gl: gl, width, height,
    operation: opt.operation || 'erode',
    radius: opt.radius || 1,
    enabled: true,
    _program: null,
    _framebuffer: null,
  };
  function createFB(w,h){
    const fb=gl.createFramebuffer(); const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {framebuffer:fb,texture:tex};
  }
  mo._framebuffer=createFB(width,height);
  const vsSrc='attribute vec2 aPos; varying vec2 vUV; void main(){ vUV=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  const fsSrc=`precision highp float; varying vec2 vUV; uniform sampler2D uTex; uniform int uOperation; uniform int uRadius; uniform vec2 uTexel;
    void main(){ vec4 result; if(uOperation==0){ result=vec4(1.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); result=min(result,sample); } } } } else { result=vec4(0.0); for(int x=-3;x<=3;x++){ for(int y=-3;y<=3;y++){ if(abs(x)<=uRadius&&abs(y)<=uRadius){ vec4 sample=texture2D(uTex,vUV+vec2(float(x),float(y))*uTexel); result=max(result,sample); } } } } gl_FragColor=result; }`;
  function compileShader(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; }
  const vs=compileShader(gl.VERTEX_SHADER,vsSrc);
  mo._program=gl.createProgram();
  gl.attachShader(mo._program,vs);
  gl.attachShader(mo._program,compileShader(gl.FRAGMENT_SHADER,fsSrc));
  gl.linkProgram(mo._program);
  function render(inputTexture){
    if(!mo.enabled) return inputTexture;
    const quad=new Float32Array([-1,-1,1,-1,-1,1,1,1]);
    const qbuf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER,mo._framebuffer.framebuffer);
    gl.viewport(0,0,mo.width,mo.height);
    gl.useProgram(mo._program);
    const aPos=gl.getAttribLocation(mo._program,'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,inputTexture); gl.uniform1i(gl.getUniformLocation(mo._program,'uTex'),0);
    gl.uniform1i(gl.getUniformLocation(mo._program,'uOperation'),mo.operation==='erode'?0:1);
    gl.uniform1i(gl.getUniformLocation(mo._program,'uRadius'),mo.radius);
    gl.uniform2f(gl.getUniformLocation(mo._program,'uTexel'),1/mo.width,1/mo.height);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    gl.deleteBuffer(qbuf);
    return mo._framebuffer.texture;
  }
  function resize(w,h){ mo.width=w; mo.height=h; }
  function dispose(){ gl.deleteFramebuffer(mo._framebuffer.framebuffer); gl.deleteTexture(mo._framebuffer.texture); gl.deleteProgram(mo._program); }
  console.log('[Morphology] 创建完成 operation=' + mo.operation + ' radius=' + mo.radius);
  return { render, resize, dispose, mo };
}

/* ===== 后期处理管线（集成所有效果，实时可见） ===== */
function createPostProcessPipeline(gl, width, height){
  const ppl = {
    gl: gl, width: width, height: height,
    effects: {
      brightness: 0, contrast: 1, saturation: 1, hue: 0, temperature: 0,
      vignette: 0, vignetteRadius: 0.5, vignetteSoftness: 0.5,
      grain: 0, sharpen: 0, blur: 0, pixelate: 0, scanlines: 0,
      grayscale: 0, invert: 0, sepia: 0, bloom: 0, threshold: 0.8,
      chromaticAberration: 0, filmGrain: 0, colorGrade: 0,
      exposure: 1, gamma: 1.0,
    },
    _framebuffer: null, _depthBuffer: null, _texture: null,
    _program: null, _quadBuffer: null, _time: 0,
    _enabled: true,
  };

  function createFramebuffer(w, h){
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer: fb, texture: tex, depth: depth };
  }

  const fb = createFramebuffer(width, height);
  ppl._framebuffer = fb.framebuffer;
  ppl._texture = fb.texture;
  ppl._depthBuffer = fb.depth;

  const vsSrc = 'attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
  const fsSrc = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
uniform float uHue;
uniform float uTemperature;
uniform float uVignette;
uniform float uVignetteRadius;
uniform float uVignetteSoftness;
uniform float uGrain;
uniform float uSharpen;
uniform float uBlur;
uniform float uPixelate;
uniform float uScanlines;
uniform float uGrayscale;
uniform float uInvert;
uniform float uSepia;
uniform float uChromaticAberration;
uniform float uExposure;
uniform float uGamma;

vec3 rgb2hsv(vec3 c){
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  vec3 hsv = vec3(0.0, 0.0, mx);
  if(d != 0.0){
    hsv.y = d / mx;
    if(c.r == mx) hsv.x = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if(c.g == mx) hsv.x = (c.b - c.r) / d + 2.0;
    else hsv.x = (c.r - c.g) / d + 4.0;
    hsv.x /= 6.0;
  }
  return hsv;
}
vec3 hsv2rgb(vec3 hsv){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  return hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y);
}
float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = vUV;
  if(uPixelate > 0.0){
    vec2 pixel = vec2(uPixelate) / uResolution;
    uv = floor(uv / pixel) * pixel + pixel * 0.5;
  }

  vec3 color;
  if(uChromaticAberration > 0.0){
    vec2 dir = normalize(uv - 0.5) * uChromaticAberration * 0.01;
    float r = texture2D(uTex, uv + dir).r;
    float g = texture2D(uTex, uv).g;
    float b = texture2D(uTex, uv - dir).b;
    color = vec3(r, g, b);
  } else {
    color = texture2D(uTex, uv).rgb;
  }

  if(uBlur > 0.0){
    vec3 blurred = vec3(0.0);
    float total = 0.0;
    for(int x = -3; x <= 3; x++){
      for(int y = -3; y <= 3; y++){
        float weight = exp(-(float(x*x + y*y)) / (2.0 * uBlur * uBlur));
        blurred += texture2D(uTex, uv + vec2(float(x), float(y)) / uResolution * uBlur).rgb * weight;
        total += weight;
      }
    }
    color = mix(color, blurred / total, min(1.0, uBlur * 0.3));
  }

  if(uSharpen > 0.0){
    vec3 center = texture2D(uTex, uv).rgb;
    vec3 blur = vec3(0.0);
    blur += texture2D(uTex, uv + vec2(-1.0, -1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(1.0, -1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(-1.0, 1.0) / uResolution).rgb;
    blur += texture2D(uTex, uv + vec2(1.0, 1.0) / uResolution).rgb;
    blur /= 4.0;
    color = center + (center - blur) * uSharpen;
  }

  color *= uExposure;
  color += uBrightness;
  color = (color - 0.5) * uContrast + 0.5;

  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(gray), color, uSaturation);

  if(uHue != 0.0){
    vec3 hsv = rgb2hsv(color);
    hsv.x = fract(hsv.x + uHue / 360.0);
    color = hsv2rgb(hsv);
  }

  if(uTemperature != 0.0){
    if(uTemperature > 0.0){
      color.r += uTemperature * 0.3;
      color.b -= uTemperature * 0.2;
    } else {
      color.r += uTemperature * 0.2;
      color.b -= uTemperature * 0.3;
    }
  }

  if(uSepia > 0.0){
    vec3 sepiaColor = vec3(
      dot(color, vec3(0.393, 0.769, 0.189)),
      dot(color, vec3(0.349, 0.686, 0.168)),
      dot(color, vec3(0.272, 0.534, 0.131))
    );
    color = mix(color, sepiaColor, uSepia);
  }

  if(uGrayscale > 0.0){
    color = mix(color, vec3(gray), uGrayscale);
  }

  if(uInvert > 0.0){
    color = mix(color, 1.0 - color, uInvert);
  }

  if(uScanlines > 0.0){
    float scanline = sin(uv.y * uResolution.y * 3.14159) * 0.5 + 0.5;
    color *= 1.0 - scanline * uScanlines * 0.3;
  }

  if(uVignette > 0.0){
    float dist = length(uv - 0.5);
    float vig = smoothstep(uVignetteRadius, uVignetteRadius - uVignetteSoftness, dist);
    color *= mix(1.0, vig, uVignette);
  }

  if(uGrain > 0.0){
    float noise = rand(uv * uResolution + uTime * 100.0) * 2.0 - 1.0;
    color += noise * uGrain * 0.1;
  }

  color = pow(max(color, vec3(0.0)), vec3(1.0 / uGamma));

  float origAlpha = texture2D(uTex, uv).a;
  float outAlpha = origAlpha > 0.5 ? 1.0 : 0.0;
  gl_FragColor = vec4(color, outAlpha);
}`;

  function compileShader(type, src){
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      console.log('[PostProcessPipeline] 着色器编译失败:', gl.getShaderInfoLog(s));
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
  ppl._program = gl.createProgram();
  gl.attachShader(ppl._program, vs);
  gl.attachShader(ppl._program, compileShader(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(ppl._program);

  ppl._quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ppl._quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  function setEffect(name, value){
    if(ppl.effects.hasOwnProperty(name)){
      ppl.effects[name] = value;
    }
  }

  function getEffect(name){
    return ppl.effects[name];
  }

  function setEnabled(enabled){
    ppl._enabled = enabled;
  }

  function render(renderer, modelInstance, camera, options){
    if(!ppl._enabled){
      renderModel(renderer, modelInstance, camera, options);
      return;
    }
    const gl = renderer.gl;
    ppl._time += 0.016;

    for(let _tu = 0; _tu < 8; _tu++){
      gl.activeTexture(gl.TEXTURE0 + _tu);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, ppl._framebuffer);
    gl.viewport(0, 0, ppl.width, ppl.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    renderModel(renderer, modelInstance, camera, options);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);

    if(renderer._vaoExt && renderer._vaoExt.isVertexArrayOES){
      try { renderer._vaoExt.bindVertexArrayOES(null); } catch(e){}
    }

    for(let i = 0; i < 16; i++){
      try { gl.disableVertexAttribArray(i); } catch(e){}
    }

    gl.useProgram(ppl._program);
    gl.bindBuffer(gl.ARRAY_BUFFER, ppl._quadBuffer);
    const aPos = gl.getAttribLocation(ppl._program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ppl._texture);
    gl.uniform1i(gl.getUniformLocation(ppl._program, 'uTex'), 0);
    gl.uniform2f(gl.getUniformLocation(ppl._program, 'uResolution'), ppl.width, ppl.height);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uTime'), ppl._time);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uBrightness'), ppl.effects.brightness);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uContrast'), ppl.effects.contrast);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSaturation'), ppl.effects.saturation);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uHue'), ppl.effects.hue);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uTemperature'), ppl.effects.temperature);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignette'), ppl.effects.vignette);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignetteRadius'), ppl.effects.vignetteRadius);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uVignetteSoftness'), ppl.effects.vignetteSoftness);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGrain'), ppl.effects.grain);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSharpen'), ppl.effects.sharpen);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uBlur'), ppl.effects.blur);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uPixelate'), ppl.effects.pixelate);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uScanlines'), ppl.effects.scanlines);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGrayscale'), ppl.effects.grayscale);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uInvert'), ppl.effects.invert);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uSepia'), ppl.effects.sepia);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uChromaticAberration'), ppl.effects.chromaticAberration);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uExposure'), ppl.effects.exposure);
    gl.uniform1f(gl.getUniformLocation(ppl._program, 'uGamma'), ppl.effects.gamma);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
  }

  function resize(w, h){
    ppl.width = w;
    ppl.height = h;
    gl.bindTexture(gl.TEXTURE_2D, ppl._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, ppl._depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  }

  function dispose(){
    gl.deleteFramebuffer(ppl._framebuffer);
    gl.deleteTexture(ppl._texture);
    gl.deleteRenderbuffer(ppl._depthBuffer);
    gl.deleteProgram(ppl._program);
    gl.deleteBuffer(ppl._quadBuffer);
  }

  function reset(){
    ppl.effects.brightness = 0;
    ppl.effects.contrast = 1;
    ppl.effects.saturation = 1;
    ppl.effects.hue = 0;
    ppl.effects.temperature = 0;
    ppl.effects.vignette = 0;
    ppl.effects.vignetteRadius = 0.5;
    ppl.effects.vignetteSoftness = 0.5;
    ppl.effects.grain = 0;
    ppl.effects.sharpen = 0;
    ppl.effects.blur = 0;
    ppl.effects.pixelate = 0;
    ppl.effects.scanlines = 0;
    ppl.effects.grayscale = 0;
    ppl.effects.invert = 0;
    ppl.effects.sepia = 0;
    ppl.effects.chromaticAberration = 0;
    ppl.effects.exposure = 1;
    ppl.effects.gamma = 2.2;
  }

  console.log('[PostProcessPipeline] 创建完成 ' + width + 'x' + height + ' 效果数量=21');
  return { render, resize, dispose, setEffect, getEffect, setEnabled, reset, ppl };
}



/* ===== 扩展系统（新增17个子系统） ===== */


/* ===== 样条曲线与路径系统 =====
   支持: 贝塞尔曲线 / Catmull-Rom / B样条 / NURBS简化 / 路径跟随
*/

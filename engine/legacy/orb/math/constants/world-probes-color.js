
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
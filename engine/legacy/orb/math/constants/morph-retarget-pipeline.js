
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
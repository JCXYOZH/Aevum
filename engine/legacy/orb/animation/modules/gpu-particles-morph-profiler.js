/* ===== GPU粒子系统 =====
   支持: TransformFeedback / GPU更新 / 发射器类型 / 排序
*/
function createGPUParticleSystem(gl, maxParticles, options){
  const ps = {
    gl: gl,
    maxParticles: maxParticles || 10000,
    _programUpdate: null,
    _programRender: null,
    _vao: null,
    _buffers: [],
    _currentBuffer: 0,
    _transformFeedback: null,
    _emitter: { position: [0,0,0], rate: 100, type: 'point' },
    _time: 0,
    _activeCount: 0,
    _sorting: (options && options.sorting) || false
  };

  function init(){
    const gl = ps.gl;
    const updateVS = `
      precision highp float;
      attribute vec3 aPosition;
      attribute vec3 aVelocity;
      attribute vec4 aColor;
      attribute float aLife;
      attribute float aMaxLife;
      attribute float aSize;
      uniform float uDeltaTime;
      uniform vec3 uGravity;
      uniform vec3 uEmitterPos;
      uniform float uEmitRate;
      uniform float uTime;
      varying vec3 vPosition;
      varying vec3 vVelocity;
      varying vec4 vColor;
      varying float vLife;
      varying float vMaxLife;
      varying float vSize;
      float rand(vec2 co){ return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        if(aLife > 0.0){
          vLife = aLife - uDeltaTime;
          vVelocity = aVelocity + uGravity * uDeltaTime;
          vPosition = aPosition + vVelocity * uDeltaTime;
          vMaxLife = aMaxLife;
          vSize = aSize;
          float t = 1.0 - vLife / vMaxLife;
          vColor = vec4(aColor.rgb * (1.0 - t * 0.5), aColor.a * (1.0 - t));
        } else {
          float r = rand(vec2(uTime + float(gl_VertexID), uTime));
          if(r < uEmitRate * uDeltaTime){
            vLife = 1.0 + rand(vec2(uTime, float(gl_VertexID))) * 2.0;
            vMaxLife = vLife;
            float angle = rand(vec2(float(gl_VertexID), uTime)) * 6.28318;
            float speed = 0.5 + rand(vec2(uTime + 1.0, float(gl_VertexID))) * 1.5;
            vVelocity = vec3(cos(angle) * speed, speed * 0.8, sin(angle) * speed);
            vPosition = uEmitterPos;
            vSize = 5.0 + rand(vec2(float(gl_VertexID), uTime + 2.0)) * 10.0;
            vColor = vec4(1.0, 0.8, 0.4, 1.0);
          } else {
            vLife = 0.0;
            vPosition = vec3(0.0);
            vVelocity = vec3(0.0);
            vColor = vec4(0.0);
            vMaxLife = 1.0;
            vSize = 0.0;
          }
        }
        gl_Position = vec4(vPosition, 1.0);
      }
    `;
    const updateFS = `
      precision mediump float;
      void main(){ gl_FragColor = vec4(0.0); }
    `;

    const renderVS = `
      attribute vec3 aPosition;
      attribute vec4 aColor;
      attribute float aLife;
      attribute float aSize;
      uniform mat4 uViewProj;
      varying vec4 vColor;
      void main(){
        if(aLife <= 0.0){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
        gl_PointSize = aSize * (300.0 / gl_Position.w);
      }
    `;
    const renderFS = `
      precision mediump float;
      uniform sampler2D uParticleTexture;
      varying vec4 vColor;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if(dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist);
        gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
      }
    `;

    function compileShader(type, src){
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
        console.error('[GPUParticles] 着色器错误:', gl.getShaderInfoLog(s));
      }
      return s;
    }

    ps._programUpdate = gl.createProgram();
    const uvsh = compileShader(gl.VERTEX_SHADER, updateVS);
    const ufsh = compileShader(gl.FRAGMENT_SHADER, updateFS);
    gl.attachShader(ps._programUpdate, uvsh);
    gl.attachShader(ps._programUpdate, ufsh);
    gl.transformFeedbackVaryings(ps._programUpdate, ['vPosition','vVelocity','vColor','vLife','vMaxLife','vSize'], gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(ps._programUpdate);

    ps._programRender = gl.createProgram();
    const rvsh = compileShader(gl.VERTEX_SHADER, renderVS);
    const rfsh = compileShader(gl.FRAGMENT_SHADER, renderFS);
    gl.attachShader(ps._programRender, rvsh);
    gl.attachShader(ps._programRender, rfsh);
    gl.linkProgram(ps._programRender);

    const stride = 3 + 3 + 4 + 1 + 1 + 1;
    for(let b = 0; b < 2; b++){
      const data = new Float32Array(ps.maxParticles * stride);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
      ps._buffers.push(buf);
    }

    ps._transformFeedback = gl.createTransformFeedback();
    ps._vao = gl.createVertexArray ? gl.createVertexArray() : null;
  }

  function setEmitter(position, rate, type){
    ps._emitter.position = [position[0], position[1], position[2]];
    ps._emitter.rate = rate || ps._emitter.rate;
    ps._emitter.type = type || 'point';
  }

  function update(dt){
    if(!ps._programUpdate) return;
    const gl = ps.gl;
    ps._time += dt;
    gl.useProgram(ps._programUpdate);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uDeltaTime'), dt);
    gl.uniform3fv(gl.getUniformLocation(ps._programUpdate, 'uGravity'), [0, -2, 0]);
    gl.uniform3fv(gl.getUniformLocation(ps._programUpdate, 'uEmitterPos'), ps._emitter.position);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uEmitRate'), ps._emitter.rate);
    gl.uniform1f(gl.getUniformLocation(ps._programUpdate, 'uTime'), ps._time);

    const readBuf = ps._buffers[ps._currentBuffer];
    const writeBuf = ps._buffers[1 - ps._currentBuffer];
    const stride = 13 * 4;

    gl.bindBuffer(gl.ARRAY_BUFFER, readBuf);
    const posLoc = gl.getAttribLocation(ps._programUpdate, 'aPosition');
    const velLoc = gl.getAttribLocation(ps._programUpdate, 'aVelocity');
    const colLoc = gl.getAttribLocation(ps._programUpdate, 'aColor');
    const lifeLoc = gl.getAttribLocation(ps._programUpdate, 'aLife');
    const maxLifeLoc = gl.getAttribLocation(ps._programUpdate, 'aMaxLife');
    const sizeLoc = gl.getAttribLocation(ps._programUpdate, 'aSize');
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(velLoc); gl.vertexAttribPointer(velLoc, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(lifeLoc); gl.vertexAttribPointer(lifeLoc, 1, gl.FLOAT, false, stride, 40);
    gl.enableVertexAttribArray(maxLifeLoc); gl.vertexAttribPointer(maxLifeLoc, 1, gl.FLOAT, false, stride, 44);
    gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 48);

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, ps._transformFeedback);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, writeBuf);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, ps.maxParticles);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    ps._currentBuffer = 1 - ps._currentBuffer;
  }

  function render(viewProj){
    if(!ps._programRender) return;
    const gl = ps.gl;
    gl.useProgram(ps._programRender);
    gl.uniformMatrix4fv(gl.getUniformLocation(ps._programRender, 'uViewProj'), false, viewProj);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);

    const buf = ps._buffers[ps._currentBuffer];
    const stride = 13 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const posLoc = gl.getAttribLocation(ps._programRender, 'aPosition');
    const colLoc = gl.getAttribLocation(ps._programRender, 'aColor');
    const lifeLoc = gl.getAttribLocation(ps._programRender, 'aLife');
    const sizeLoc = gl.getAttribLocation(ps._programRender, 'aSize');
    gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(colLoc); gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(lifeLoc); gl.vertexAttribPointer(lifeLoc, 1, gl.FLOAT, false, stride, 40);
    gl.enableVertexAttribArray(sizeLoc); gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 48);

    gl.drawArrays(gl.POINTS, 0, ps.maxParticles);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function reset(){
    const gl = ps.gl;
    const stride = 13;
    for(let b = 0; b < 2; b++){
      const data = new Float32Array(ps.maxParticles * stride);
      gl.bindBuffer(gl.ARRAY_BUFFER, ps._buffers[b]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    }
    ps._time = 0;
  }

  function dispose(){
    const gl = ps.gl;
    for(let b = 0; b < ps._buffers.length; b++) gl.deleteBuffer(ps._buffers[b]);
    if(ps._programUpdate) gl.deleteProgram(ps._programUpdate);
    if(ps._programRender) gl.deleteProgram(ps._programRender);
    if(ps._transformFeedback) gl.deleteTransformFeedback(ps._transformFeedback);
  }

  return { init, setEmitter, update, render, reset, dispose, ps };
}

/* ===== 变形目标动画系统 =====
   支持:  morph动画 / 权重混合 / 自动播放 / 表情预设
*/
function createMorphAnimator(model, options){
  const anim = {
    model: model,
    morphs: model && model.morphs ? model.morphs : [],
    weights: {},
    _animations: [],
    _currentAnim: null,
    _time: 0,
    _playing: false,
    _speed: 1,
    _presets: {}
  };

  function init(){
    for(let i = 0; i < anim.morphs.length; i++){
      anim.weights[anim.morphs[i].name] = 0;
    }
  }

  function setWeight(name, value){
    if(anim.weights[name] !== undefined){
      anim.weights[name] = Math.max(0, Math.min(1, value));
    }
  }

  function getWeight(name){
    return anim.weights[name] || 0;
  }

  function resetWeights(){
    for(const name in anim.weights) anim.weights[name] = 0;
  }

  function addAnimation(name, keyframes, duration){
    const animData = {
      name: name,
      keyframes: keyframes || [],
      duration: duration || 1,
      loop: true
    };
    anim._animations.push(animData);
    return animData;
  }

  function play(name, options){
    const a = anim._animations.find(function(a){ return a.name === name; });
    if(!a) return false;
    anim._currentAnim = a;
    anim._time = 0;
    anim._playing = true;
    anim._speed = (options && options.speed) || 1;
    if(options && options.loop !== undefined) a.loop = options.loop;
    return true;
  }

  function stop(){
    anim._playing = false;
    anim._currentAnim = null;
  }

  function pause(){
    anim._playing = false;
  }

  function resume(){
    if(anim._currentAnim) anim._playing = true;
  }

  function update(dt){
    if(!anim._playing || !anim._currentAnim) return;
    anim._time += dt * anim._speed;
    const a = anim._currentAnim;
    if(anim._time >= a.duration){
      if(a.loop){
        anim._time = anim._time % a.duration;
      } else {
        anim._time = a.duration;
        anim._playing = false;
      }
    }
    for(let i = 0; i < a.keyframes.length; i++){
      const kf = a.keyframes[i];
      let weight = 0;
      if(kf.type === 'pulse'){
        const t = (anim._time % kf.period) / kf.period;
        weight = Math.sin(t * Math.PI) * kf.amplitude;
      } else if(kf.type === 'hold'){
        weight = anim._time >= kf.start && anim._time <= kf.end ? kf.value : 0;
      } else if(kf.type === 'linear'){
        if(anim._time >= kf.start && anim._time <= kf.end){
          weight = kf.startValue + (kf.endValue - kf.startValue) * ((anim._time - kf.start) / (kf.end - kf.start));
        }
      }
      setWeight(kf.morph, weight);
    }
  }

  function addPreset(name, weights){
    anim._presets[name] = { ...weights };
  }

  function applyPreset(name, blend){
    const preset = anim._presets[name];
    if(!preset) return false;
    const b = blend !== undefined ? blend : 1;
    for(const morphName in preset){
      const current = getWeight(morphName);
      setWeight(morphName, current + (preset[morphName] - current) * b);
    }
    return true;
  }

  function getPresetNames(){
    return Object.keys(anim._presets);
  }

  function getMorphNames(){
    return anim.morphs.map(function(m){ return m.name; });
  }

  function getWeights(){
    return { ...anim.weights };
  }

  function applyToGeometry(geometry){
    if(!geometry || !geometry.positions) return geometry;
    const positions = new Float32Array(geometry.positions);
    const normals = geometry.normals ? new Float32Array(geometry.normals) : null;
    for(let m = 0; m < anim.morphs.length; m++){
      const morph = anim.morphs[m];
      const weight = anim.weights[morph.name] || 0;
      if(Math.abs(weight) < 0.001) continue;
      if(morph.vertices){
        for(let i = 0; i < morph.vertices.length && i < positions.length / 3; i++){
          positions[i*3] += morph.vertices[i][0] * weight;
          positions[i*3+1] += morph.vertices[i][1] * weight;
          positions[i*3+2] += morph.vertices[i][2] * weight;
        }
      }
    }
    return { ...geometry, positions: positions, normals: normals };
  }

  return { init, setWeight, getWeight, resetWeights, addAnimation, play, stop, pause, resume, update, addPreset, applyPreset, getPresetNames, getMorphNames, getWeights, applyToGeometry, anim };
}

/* ===== 骨骼可视化系统 =====
   支持: 骨骼线框 / 关节点 / 骨骼名称 / 选择高亮
*/
function createSkeletonVisualizer(gl, options){
  const vis = {
    gl: gl,
    _program: null,
    _lineBuffer: null,
    _pointBuffer: null,
    _initialized: false,
    boneColor: (options && options.boneColor) || [0.2, 0.8, 0.2, 1],
    jointColor: (options && options.jointColor) || [0.8, 0.2, 0.2, 1],
    selectedColor: (options && options.selectedColor) || [1, 1, 0, 1],
    selectedBone: -1,
    showNames: (options && options.showNames) || false,
    boneScale: (options && options.boneScale) || 1
  };

  function init(){
    const gl = vis.gl;
    const vs = `
      attribute vec3 aPosition;
      attribute vec4 aColor;
      uniform mat4 uViewProj;
      varying vec4 vColor;
      void main(){
        vColor = aColor;
        gl_Position = uViewProj * vec4(aPosition, 1.0);
      }
    `;
    const fs = `
      precision mediump float;
      varying vec4 vColor;
      void main(){ gl_FragColor = vColor; }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vis._program = gl.createProgram();
    gl.attachShader(vis._program, vsh);
    gl.attachShader(vis._program, fsh);
    gl.linkProgram(vis._program);
    vis._lineBuffer = gl.createBuffer();
    vis._pointBuffer = gl.createBuffer();
    vis._initialized = true;
  }

  function buildBoneData(boneSystem, poseRotations, posePositions){
    const bones = boneSystem.bones || [];
    const lines = [];
    const points = [];
    const bonePositions = [];

    for(let i = 0; i < bones.length; i++){
      const bone = bones[i];
      let pos = [0, 0, 0];
      if(posePositions && posePositions[i]){
        pos = posePositions[i];
      } else if(bone.position){
        pos = bone.position;
      }
      bonePositions.push([pos[0], pos[1], pos[2]]);
    }

    for(let i = 0; i < bones.length; i++){
      const bone = bones[i];
      const pos = bonePositions[i];
      const isSelected = i === vis.selectedBone;
      const color = isSelected ? vis.selectedColor : vis.boneColor;

      points.push(pos[0], pos[1], pos[2],
        isSelected ? vis.selectedColor[0] : vis.jointColor[0],
        isSelected ? vis.selectedColor[1] : vis.jointColor[1],
        isSelected ? vis.selectedColor[2] : vis.jointColor[2],
        isSelected ? vis.selectedColor[3] : vis.jointColor[3]);

      if(bone.parent >= 0 && bone.parent < bonePositions.length){
        const parentPos = bonePositions[bone.parent];
        lines.push(parentPos[0], parentPos[1], parentPos[2], color[0], color[1], color[2], color[3]);
        lines.push(pos[0], pos[1], pos[2], color[0], color[1], color[2], color[3]);
      }
    }

    return { lines: new Float32Array(lines), points: new Float32Array(points), bonePositions: bonePositions };
  }

  function render(boneSystem, viewProj, poseRotations, posePositions){
    if(!vis._initialized) return;
    const gl = vis.gl;
    const data = buildBoneData(boneSystem, poseRotations, posePositions);

    gl.useProgram(vis._program);
    gl.uniformMatrix4fv(gl.getUniformLocation(vis._program, 'uViewProj'), false, viewProj);

    gl.bindBuffer(gl.ARRAY_BUFFER, vis._lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.lines, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(vis._program, 'aPosition');
    const colLoc = gl.getAttribLocation(vis._program, 'aColor');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.LINES, 0, data.lines.length / 7);

    gl.bindBuffer(gl.ARRAY_BUFFER, vis._pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.points, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.POINTS, 0, data.points.length / 7);

    return data.bonePositions;
  }

  function pickBone(boneSystem, camera, mouseX, mouseY, canvasWidth, canvasHeight, poseRotations, posePositions){
    const bones = boneSystem.bones || [];
    const data = buildBoneData(boneSystem, poseRotations, posePositions);
    let bestBone = -1;
    let bestDist = 20;

    for(let i = 0; i < bones.length; i++){
      const pos = data.bonePositions[i];
      const projected = projectPoint(pos, camera, canvasWidth, canvasHeight);
      if(!projected) continue;
      const dx = projected.x - mouseX;
      const dy = projected.y - mouseY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if(dist < bestDist){
        bestDist = dist;
        bestBone = i;
      }
    }
    vis.selectedBone = bestBone;
    return bestBone;
  }

  function projectPoint(point, camera, width, height){
    const viewProj = camera.viewProj || M4.create();
    const x = viewProj[0]*point[0] + viewProj[4]*point[1] + viewProj[8]*point[2] + viewProj[12];
    const y = viewProj[1]*point[0] + viewProj[5]*point[1] + viewProj[9]*point[2] + viewProj[13];
    const w = viewProj[3]*point[0] + viewProj[7]*point[1] + viewProj[11]*point[2] + viewProj[15];
    if(w <= 0) return null;
    return { x: (x/w + 1) * 0.5 * width, y: (1 - (y/w + 1) * 0.5) * height };
  }

  function setSelectedBone(index){
    vis.selectedBone = index;
  }

  function getSelectedBone(){
    return vis.selectedBone;
  }

  function dispose(){
    const gl = vis.gl;
    if(vis._lineBuffer) gl.deleteBuffer(vis._lineBuffer);
    if(vis._pointBuffer) gl.deleteBuffer(vis._pointBuffer);
    if(vis._program) gl.deleteProgram(vis._program);
  }

  return { init, render, pickBone, setSelectedBone, getSelectedBone, dispose, vis };
}

/* ===== 性能分析器 =====
   支持: 帧时间统计 / 函数计时 / 内存监控 / 报告生成
*/
function createPerformanceProfiler(options){
  const profiler = {
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true,
    _frameTimes: [],
    _maxFrames: (options && options.maxFrames) || 300,
    _counters: {},
    _timers: {},
    _activeTimers: [],
    _memory: { used: 0, total: 0, limit: 0 },
    _gpuStats: { drawCalls: 0, triangles: 0, textures: 0, programs: 0 },
    _frameCount: 0,
    _lastFrameTime: 0,
    _fps: 0,
    _fpsAccumulator: 0,
    _fpsFrames: 0
  };

  function beginFrame(){
    if(!profiler._enabled) return;
    profiler._lastFrameTime = performance.now();
    profiler._gpuStats.drawCalls = 0;
    profiler._gpuStats.triangles = 0;
  }

  function endFrame(){
    if(!profiler._enabled) return;
    const frameTime = performance.now() - profiler._lastFrameTime;
    profiler._frameTimes.push(frameTime);
    if(profiler._frameTimes.length > profiler._maxFrames){
      profiler._frameTimes.shift();
    }
    profiler._frameCount++;
    profiler._fpsAccumulator += frameTime;
    profiler._fpsFrames++;
    if(profiler._fpsAccumulator >= 1000){
      profiler._fps = profiler._fpsFrames * 1000 / profiler._fpsAccumulator;
      profiler._fpsAccumulator = 0;
      profiler._fpsFrames = 0;
    }
  }

  function startTimer(name){
    if(!profiler._enabled) return;
    if(!profiler._timers[name]){
      profiler._timers[name] = { total: 0, count: 0, min: Infinity, max: 0, last: 0 };
    }
    profiler._activeTimers.push({ name: name, start: performance.now() });
  }

  function endTimer(name){
    if(!profiler._enabled) return;
    for(let i = profiler._activeTimers.length - 1; i >= 0; i--){
      if(profiler._activeTimers[i].name === name){
        const elapsed = performance.now() - profiler._activeTimers[i].start;
        const timer = profiler._timers[name];
        timer.total += elapsed;
        timer.count++;
        timer.last = elapsed;
        timer.min = Math.min(timer.min, elapsed);
        timer.max = Math.max(timer.max, elapsed);
        profiler._activeTimers.splice(i, 1);
        return elapsed;
      }
    }
    return 0;
  }

  function incrementCounter(name, amount){
    if(!profiler._enabled) return;
    profiler._counters[name] = (profiler._counters[name] || 0) + (amount || 1);
  }

  function setCounter(name, value){
    if(!profiler._enabled) return;
    profiler._counters[name] = value;
  }

  function getCounter(name){
    return profiler._counters[name] || 0;
  }

  function resetCounters(){
    profiler._counters = {};
  }

  function recordDrawCall(triangleCount){
    if(!profiler._enabled) return;
    profiler._gpuStats.drawCalls++;
    profiler._gpuStats.triangles += triangleCount || 0;
  }

  function updateMemory(){
    if(performance.memory){
      profiler._memory.used = performance.memory.usedJSHeapSize;
      profiler._memory.total = performance.memory.totalJSHeapSize;
      profiler._memory.limit = performance.memory.jsHeapSizeLimit;
    }
  }

  function getFPS(){
    return profiler._fps;
  }

  function getFrameTime(){
    if(profiler._frameTimes.length === 0) return 0;
    return profiler._frameTimes[profiler._frameTimes.length - 1];
  }

  function getAverageFrameTime(){
    if(profiler._frameTimes.length === 0) return 0;
    let sum = 0;
    for(let i = 0; i < profiler._frameTimes.length; i++) sum += profiler._frameTimes[i];
    return sum / profiler._frameTimes.length;
  }

  function getFrameTimeStats(){
    if(profiler._frameTimes.length === 0) return { min: 0, max: 0, avg: 0, p95: 0, p99: 0 };
    const sorted = [...profiler._frameTimes].sort(function(a, b){ return a - b; });
    const sum = sorted.reduce(function(a, b){ return a + b; }, 0);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  function getTimerReport(name){
    const timer = profiler._timers[name];
    if(!timer || timer.count === 0) return null;
    return {
      name: name,
      total: timer.total,
      count: timer.count,
      average: timer.total / timer.count,
      min: timer.min,
      max: timer.max,
      last: timer.last
    };
  }

  function getAllTimerReports(){
    const reports = [];
    for(const name in profiler._timers){
      const report = getTimerReport(name);
      if(report) reports.push(report);
    }
    reports.sort(function(a, b){ return b.total - a.total; });
    return reports;
  }

  function getGPUStats(){
    return { ...profiler._gpuStats };
  }

  function getMemoryStats(){
    updateMemory();
    return { ...profiler._memory };
  }

  function generateReport(){
    return {
      frameCount: profiler._frameCount,
      fps: profiler._fps,
      frameTime: getFrameTimeStats(),
      timers: getAllTimerReports(),
      counters: { ...profiler._counters },
      gpu: getGPUStats(),
      memory: getMemoryStats()
    };
  }

  function reset(){
    profiler._frameTimes = [];
    profiler._timers = {};
    profiler._counters = {};
    profiler._frameCount = 0;
    profiler._fps = 0;
    profiler._fpsAccumulator = 0;
    profiler._fpsFrames = 0;
  }

  function setEnabled(enabled){
    profiler._enabled = enabled;
  }

  function isEnabled(){
    return profiler._enabled;
  }

  return {
    beginFrame, endFrame, startTimer, endTimer, incrementCounter, setCounter,
    getCounter, resetCounters, recordDrawCall, getFPS, getFrameTime,
    getAverageFrameTime, getFrameTimeStats, getTimerReport, getAllTimerReports,
    getGPUStats, getMemoryStats, generateReport, reset, setEnabled, isEnabled, profiler
  };
}

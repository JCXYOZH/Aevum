
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
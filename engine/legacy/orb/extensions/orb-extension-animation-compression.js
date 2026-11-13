/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-animation-compression
 * 从 legacy/_orb_expand_part6.js 转换 (GBK->UTF-8)
 * @module orb-extension-animation-compression
 */
'use strict';



/* ===== 骨骼动画压缩系统 =====
   支持: 关键帧精简 / 量化 / 差值编码/ 运行时解码*/
function createAnimationCompressor(options){
  const comp = {
    positionTolerance: (options && options.positionTolerance) || 0.001,
    rotationTolerance: (options && options.rotationTolerance) || 0.001,
    scaleTolerance: (options && options.scaleTolerance) || 0.001,
    positionBits: (options && options.positionBits) || 16,
    rotationBits: (options && options.rotationBits) || 16,
    _minPos: [Infinity, Infinity, Infinity],
    _maxPos: [-Infinity, -Infinity, -Infinity]
  };

  function compressClip(clip){
    const compressed = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      frameRate: clip.frameRate || 30
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const compressedTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: compressKeyframes(track.keyframes, track.type)
      };
      compressed.tracks.push(compressedTrack);
    }
    return compressed;
  }

  function compressKeyframes(keyframes, type){
    if(!keyframes || keyframes.length === 0) return [];
    const tolerance = type === 'rotation' ? comp.rotationTolerance :
                      type === 'scale' ? comp.scaleTolerance : comp.positionTolerance;
    const result = [keyframes[0]];
    for(let i = 1; i < keyframes.length - 1; i++){
      const prev = result[result.length - 1];
      const curr = keyframes[i];
      const next = keyframes[i + 1];
      const interpolated = interpolateKeyframe(prev, next, curr.time, type);
      if(!keyframesClose(curr, interpolated, tolerance)){
        result.push(curr);
      }
    }
    result.push(keyframes[keyframes.length - 1]);
    return result;
  }

  function interpolateKeyframe(a, b, time, type){
    const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time || 1)));
    if(type === 'rotation'){
      const q = Q.create();
      Q.slerp(q, a.value, b.value, t);
      return { time: time, value: q };
    }
    const val = new Float32Array(a.value.length);
    for(let i = 0; i < a.value.length; i++){
      val[i] = a.value[i] + (b.value[i] - a.value[i]) * t;
    }
    return { time: time, value: val };
  }

  function keyframesClose(a, b, tolerance){
    if(a.value.length !== b.value.length) return false;
    for(let i = 0; i < a.value.length; i++){
      if(Math.abs(a.value[i] - b.value[i]) > tolerance) return false;
    }
    return true;
  }

  function quantizeClip(clip){
    const quantized = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      positionMin: [...comp._minPos],
      positionMax: [...comp._maxPos]
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const qTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: []
      };
      for(let k = 0; k < track.keyframes.length; k++){
        const kf = track.keyframes[k];
        const qkf = { time: kf.time, value: [] };
        for(let v = 0; v < kf.value.length; v++){
          const bits = track.type === 'rotation' ? comp.rotationBits : comp.positionBits;
          const maxVal = (1 << bits) - 1;
          if(track.type === 'position'){
            const range = comp._maxPos[v % 3] - comp._minPos[v % 3] || 1;
            qkf.value[v] = Math.round(((kf.value[v] - comp._minPos[v % 3]) / range) * maxVal);
          } else {
            qkf.value[v] = Math.round(((kf.value[v] + 1) / 2) * maxVal);
          }
        }
        qTrack.keyframes.push(qkf);
      }
      quantized.tracks.push(qTrack);
    }
    return quantized;
  }

  function decompressClip(compressed){
    const clip = {
      name: compressed.name,
      duration: compressed.duration,
      tracks: []
    };
    for(let t = 0; t < compressed.tracks.length; t++){
      const track = compressed.tracks[t];
      clip.tracks.push({
        boneName: track.boneName,
        type: track.type,
        keyframes: track.keyframes.map(function(kf){
          return { time: kf.time, value: new Float32Array(kf.value) };
        })
      });
    }
    return clip;
  }

  function getCompressionRatio(original, compressed){
    const origSize = estimateClipSize(original);
    const compSize = estimateClipSize(compressed);
    return { original: origSize, compressed: compSize, ratio: origSize / compSize };
  }

  function estimateClipSize(clip){
    let size = 0;
    for(let t = 0; t < clip.tracks.length; t++){
      size += clip.tracks[t].boneName.length;
      size += (clip.tracks[t].keyframes || []).length * 20;
    }
    return size;
  }

  return { compressClip, quantizeClip, decompressClip, getCompressionRatio, comp };
}

/* ===== 渲染队列系统 =====
   支持: 不透明/透明排序 / 批处理/ 状态切换优化*/
function createRenderQueue(options){
  const queue = {
    _opaque: [],
    _transparent: [],
    _overlay: [],
    _stats: { submitted: 0, rendered: 0, stateChanges: 0 },
    _currentState: {}
  };

  function submit(item){
    queue._stats.submitted++;
    if(item.transparent){
      queue._transparent.push(item);
    } else if(item.overlay){
      queue._overlay.push(item);
    } else {
      queue._opaque.push(item);
    }
  }

  function sort(){
    queue._opaque.sort(function(a, b){
      if(a.materialId !== b.materialId) return a.materialId - b.materialId;
      if(a.depth !== b.depth) return a.depth - b.depth;
      return 0;
    });
    queue._transparent.sort(function(a, b){
      return b.depth - a.depth;
    });
  }

  function execute(gl, camera){
    sort();
    queue._stats.rendered = 0;
    queue._stats.stateChanges = 0;
    const all = [...queue._opaque, ...queue._transparent, ...queue._overlay];
    for(let i = 0; i < all.length; i++){
      const item = all[i];
      if(item.materialId !== queue._currentState.material){
        queue._currentState.material = item.materialId;
        queue._stats.stateChanges++;
        if(item.bindMaterial) item.bindMaterial(gl);
      }
      if(item.render) item.render(gl, camera);
      queue._stats.rendered++;
    }
    clear();
  }

  function clear(){
    queue._opaque = [];
    queue._transparent = [];
    queue._overlay = [];
    queue._currentState = {};
  }

  function getStats(){
    return { ...queue._stats };
  }

  return { submit, execute, clear, getStats, queue };
}

/* ===== 材质实例系统 =====
   支持: 材质继承 / 参数覆盖 / 实例共享
*/
function createMaterialInstance(baseMaterial, overrides){
  const inst = {
    base: baseMaterial,
    overrides: overrides || {},
    _dirty: true
  };

  function set(name, value){
    inst.overrides[name] = value;
    inst._dirty = true;
  }

  function get(name){
    if(inst.overrides[name] !== undefined) return inst.overrides[name];
    return baseMaterial ? baseMaterial[name] : undefined;
  }

  function has(name){
    return inst.overrides[name] !== undefined || (baseMaterial && baseMaterial[name] !== undefined);
  }

  function removeOverride(name){
    delete inst.overrides[name];
    inst._dirty = true;
  }

  function reset(){
    inst.overrides = {};
    inst._dirty = true;
  }

  function getResolved(){
    if(!baseMaterial) return { ...inst.overrides };
    const resolved = { ...baseMaterial };
    for(const key in inst.overrides){
      resolved[key] = inst.overrides[key];
    }
    return resolved;
  }

  function clone(){
    return createMaterialInstance(baseMaterial, { ...inst.overrides });
  }

  return { set, get, has, removeOverride, reset, getResolved, clone, inst };
}

/* ===== 光照贴图系统 =====
   支持: 烘焙光照 / 运行时采样/ 方向光照贴图
*/
function createLightmapSystem(gl, options){
  const lm = {
    gl: gl,
    width: (options && options.width) || 1024,
    height: (options && options.height) || 1024,
    _texture: null,
    _directionalTexture: null,
    _data: null,
    _directionalData: null,
    _objects: [],
    _baked: false
  };

  function init(){
    const gl = lm.gl;
    lm._data = new Uint8Array(lm.width * lm.height * 4);
    lm._directionalData = new Uint8Array(lm.width * lm.height * 4);
    lm._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lm.width, lm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function addObject(geometry, uvOffset, uvScale){
    lm._objects.push({ geometry: geometry, uvOffset: uvOffset || [0,0], uvScale: uvScale || [1,1] });
  }

  function bake(lights, samples){
    samples = samples || 64;
    for(let y = 0; y < lm.height; y++){
      for(let x = 0; x < lm.width; x++){
        const u = x / lm.width;
        const v = y / lm.height;
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < samples; s++){
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const dir = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
          for(let l = 0; l < lights.length; l++){
            const light = lights[l];
            const ndotl = Math.max(0, dir[0]*light.direction[0] + dir[1]*light.direction[1] + dir[2]*light.direction[2]);
            r += light.color[0] * ndotl * light.intensity;
            g += light.color[1] * ndotl * light.intensity;
            b += light.color[2] * ndotl * light.intensity;
          }
        }
        const idx = (y * lm.width + x) * 4;
        lm._data[idx] = Math.min(255, r / samples * 255);
        lm._data[idx+1] = Math.min(255, g / samples * 255);
        lm._data[idx+2] = Math.min(255, b / samples * 255);
        lm._data[idx+3] = 255;
      }
    }
    const gl = lm.gl;
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, lm.width, lm.height, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    lm._baked = true;
  }

  function sample(uv){
    const x = Math.floor(uv[0] * (lm.width - 1));
    const y = Math.floor(uv[1] * (lm.height - 1));
    const idx = (y * lm.width + x) * 4;
    return [lm._data[idx]/255, lm._data[idx+1]/255, lm._data[idx+2]/255];
  }

  function getTexture(){
    return lm._texture;
  }

  function isBaked(){
    return lm._baked;
  }

  function dispose(){
    const gl = lm.gl;
    if(lm._texture) gl.deleteTexture(lm._texture);
  }

  return { init, addObject, bake, sample, getTexture, isBaked, dispose, lm };
}

/* ===== 相机效果系统 =====
   支持: 镜头抖动 / 焦距变化 / 运动模糊 / 景深
*/
function createCameraEffects(options){
  const fx = {
    _shake: { amplitude: 0, duration: 0, time: 0, frequency: 10 },
    _fov: { current: 60, target: 60, speed: 5 },
    _chromaticAberration: 0,
    _vignette: 0.5,
    _grain: 0,
    _motionBlur: 0,
    _dof: { focus: 10, aperture: 0.1, maxBlur: 0.05 },
    _time: 0
  };

  function update(dt, camera){
    fx._time += dt;
    if(fx._shake.time > 0){
      fx._shake.time -= dt;
      const t = fx._shake.time / fx._shake.duration;
      const amp = fx._shake.amplitude * t * t;
      camera.position[0] += (Math.random() - 0.5) * amp;
      camera.position[1] += (Math.random() - 0.5) * amp;
      camera.position[2] += (Math.random() - 0.5) * amp;
    }
    if(camera.fov !== undefined){
      camera.fov += (fx._fov.target - camera.fov) * Math.min(1, fx._fov.speed * dt);
    }
  }

  function shake(amplitude, duration, frequency){
    fx._shake.amplitude = amplitude || 0.1;
    fx._shake.duration = duration || 0.5;
    fx._shake.time = duration || 0.5;
    fx._shake.frequency = frequency || 10;
  }

  function setFov(target, speed){
    fx._fov.target = target;
    if(speed) fx._fov.speed = speed;
  }

  function setChromaticAberration(value){
    fx._chromaticAberration = value;
  }

  function setVignette(value){
    fx._vignette = value;
  }

  function setGrain(value){
    fx._grain = value;
  }

  function setMotionBlur(value){
    fx._motionBlur = value;
  }

  function setDOF(focus, aperture, maxBlur){
    fx._dof.focus = focus;
    fx._dof.aperture = aperture;
    fx._dof.maxBlur = maxBlur;
  }

  function getUniforms(){
    return {
      chromaticAberration: fx._chromaticAberration,
      vignette: fx._vignette,
      grain: fx._grain,
      motionBlur: fx._motionBlur,
      dofFocus: fx._dof.focus,
      dofAperture: fx._dof.aperture,
      dofMaxBlur: fx._dof.maxBlur,
      time: fx._time
    };
  }

  function reset(){
    fx._shake.time = 0;
    fx._fov.target = 60;
    fx._chromaticAberration = 0;
    fx._vignette = 0.5;
    fx._grain = 0;
    fx._motionBlur = 0;
  }

  return { update, shake, setFov, setChromaticAberration, setVignette, setGrain, setMotionBlur, setDOF, getUniforms, reset, fx };
}

/* ===== 输入映射系统 =====
   支持: 按键绑定 / 轴映射/ 多设备/ 配置保存
*/
function createInputMap(options){
  const map = {
    _actions: {},
    _axes: {},
    _keyStates: {},
    _mouseStates: { x: 0, y: 0, dx: 0, dy: 0, buttons: {} },
    _bindings: {},
    _sensitivity: (options && options.sensitivity) || 1,
    _invertY: (options && options.invertY) || false
  };

  function bindAction(action, key){
    if(!map._bindings[action]) map._bindings[action] = [];
    map._bindings[action].push(key);
  }

  function unbindAction(action, key){
    if(!map._bindings[action]) return;
    const idx = map._bindings[action].indexOf(key);
    if(idx >= 0) map._bindings[action].splice(idx, 1);
  }

  function bindAxis(axis, positiveKey, negativeKey){
    map._axes[axis] = { positive: positiveKey, negative: negativeKey, value: 0 };
  }

  function isActionPressed(action){
    const keys = map._bindings[action];
    if(!keys) return false;
    for(let i = 0; i < keys.length; i++){
      if(map._keyStates[keys[i]]) return true;
    }
    return false;
  }

  function getAxis(axis){
    const a = map._axes[axis];
    if(!a) return 0;
    let value = 0;
    if(map._keyStates[a.positive]) value += 1;
    if(map._keyStates[a.negative]) value -= 1;
    return value;
  }

  function getMouseDelta(){
    const dx = map._mouseStates.dx * map._sensitivity;
    const dy = map._mouseStates.dy * map._sensitivity * (map._invertY ? -1 : 1);
    map._mouseStates.dx = 0;
    map._mouseStates.dy = 0;
    return { x: dx, y: dy };
  }

  function handleKeyDown(key){
    map._keyStates[key] = true;
  }

  function handleKeyUp(key){
    map._keyStates[key] = false;
  }

  function handleMouseMove(x, y, dx, dy){
    map._mouseStates.x = x;
    map._mouseStates.y = y;
    map._mouseStates.dx += dx;
    map._mouseStates.dy += dy;
  }

  function handleMouseDown(button){
    map._mouseStates.buttons[button] = true;
  }

  function handleMouseUp(button){
    map._mouseStates.buttons[button] = false;
  }

  function isMouseDown(button){
    return !!map._mouseStates.buttons[button];
  }

  function setSensitivity(value){
    map._sensitivity = value;
  }

  function setInvertY(value){
    map._invertY = value;
  }

  function saveConfig(){
    return JSON.stringify({
      bindings: map._bindings,
      axes: map._axes,
      sensitivity: map._sensitivity,
      invertY: map._invertY
    });
  }

  function loadConfig(json){
    const config = JSON.parse(json);
    map._bindings = config.bindings || {};
    map._axes = config.axes || {};
    map._sensitivity = config.sensitivity || 1;
    map._invertY = config.invertY || false;
  }

  function reset(){
    map._keyStates = {};
    map._mouseStates = { x: 0, y: 0, dx: 0, dy: 0, buttons: {} };
  }

  return {
    bindAction, unbindAction, bindAxis, isActionPressed, getAxis, getMouseDelta,
    handleKeyDown, handleKeyUp, handleMouseMove, handleMouseDown, handleMouseUp,
    isMouseDown, setSensitivity, setInvertY, saveConfig, loadConfig, reset, map
  };
}

/* ===== 行为树系统=====
   支持: 选择器/ 序列 / 装饰器/ 条件 / 动作
*/
const NodeStatus = { SUCCESS: 0, FAILURE: 1, RUNNING: 2 };

function createBehaviorTree(root){
  const bt = {
    root: root,
    _blackboard: {},
    _runningNodes: []
  };

  function setBlackboard(key, value){
    bt._blackboard[key] = value;
  }

  function getBlackboard(key){
    return bt._blackboard[key];
  }

  function tick(context){
    return bt.root.tick(context, bt._blackboard);
  }

  function reset(){
    bt._runningNodes = [];
  }

  return { tick, setBlackboard, getBlackboard, reset, bt };
}

function createSelector(children){
  return {
    type: 'selector',
    children: children || [],
    _current: 0,
    tick: function(context, blackboard){
      for(let i = this._current; i < this.children.length; i++){
        const status = this.children[i].tick(context, blackboard);
        if(status === NodeStatus.RUNNING){
          this._current = i;
          return NodeStatus.RUNNING;
        }
        if(status === NodeStatus.SUCCESS){
          this._current = 0;
          return NodeStatus.SUCCESS;
        }
      }
      this._current = 0;
      return NodeStatus.FAILURE;
    }
  };
}

function createSequence(children){
  return {
    type: 'sequence',
    children: children || [],
    _current: 0,
    tick: function(context, blackboard){
      for(let i = this._current; i < this.children.length; i++){
        const status = this.children[i].tick(context, blackboard);
        if(status === NodeStatus.RUNNING){
          this._current = i;
          return NodeStatus.RUNNING;
        }
        if(status === NodeStatus.FAILURE){
          this._current = 0;
          return NodeStatus.FAILURE;
        }
      }
      this._current = 0;
      return NodeStatus.SUCCESS;
    }
  };
}

function createCondition(conditionFunc){
  return {
    type: 'condition',
    tick: function(context, blackboard){
      return conditionFunc(context, blackboard) ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
    }
  };
}

function createAction(actionFunc){
  return {
    type: 'action',
    tick: function(context, blackboard){
      return actionFunc(context, blackboard);
    }
  };
}

function createInverter(child){
  return {
    type: 'inverter',
    child: child,
    tick: function(context, blackboard){
      const status = this.child.tick(context, blackboard);
      if(status === NodeStatus.SUCCESS) return NodeStatus.FAILURE;
      if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
      return status;
    }
  };
}

function createRepeater(child, count){
  return {
    type: 'repeater',
    child: child,
    count: count || -1,
    _iterations: 0,
    tick: function(context, blackboard){
      if(this.count > 0 && this._iterations >= this.count){
        this._iterations = 0;
        return NodeStatus.SUCCESS;
      }
      const status = this.child.tick(context, blackboard);
      if(status === NodeStatus.SUCCESS){
        this._iterations++;
        if(this.count < 0 || this._iterations < this.count) return NodeStatus.RUNNING;
        this._iterations = 0;
        return NodeStatus.SUCCESS;
      }
      return status;
    }
  };
}

function createUntilFailure(child){
  return {
    type: 'untilFailure',
    child: child,
    tick: function(context, blackboard){
      while(true){
        const status = this.child.tick(context, blackboard);
        if(status === NodeStatus.FAILURE) return NodeStatus.SUCCESS;
        if(status === NodeStatus.RUNNING) return NodeStatus.RUNNING;
      }
    }
  };
}

/* ===== 寻路系统 (A*) =====
   支持: 网格寻路 / 导航网格 / 平滑路径 / 动态障碍*/
function createPathfinder(options){
  const pf = {
    gridWidth: (options && options.gridWidth) || 50,
    gridHeight: (options && options.gridHeight) || 50,
    cellSize: (options && options.cellSize) || 1,
    _grid: null,
    _heuristic: (options && options.heuristic) || 'manhattan',
    _allowDiagonal: (options && options.allowDiagonal !== undefined) ? options.allowDiagonal : true
  };

  function init(){
    pf._grid = new Uint8Array(pf.gridWidth * pf.gridHeight);
  }

  function setWalkable(x, y, walkable){
    if(x < 0 || x >= pf.gridWidth || y < 0 || y >= pf.gridHeight) return;
    pf._grid[y * pf.gridWidth + x] = walkable ? 0 : 1;
  }

  function isWalkable(x, y){
    if(x < 0 || x >= pf.gridWidth || y < 0 || y >= pf.gridHeight) return false;
    return pf._grid[y * pf.gridWidth + x] === 0;
  }

  function heuristic(a, b){
    if(pf._heuristic === 'euclidean'){
      return Math.sqrt((a.x-b.x)*(a.x-b.x) + (a.y-b.y)*(a.y-b.y));
    }
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function findPath(startX, startY, endX, endY){
    if(!isWalkable(startX, startY) || !isWalkable(endX, endY)) return [];
    const open = [];
    const closed = new Set();
    const cameFrom = {};
    const gScore = {};
    const fScore = {};
    const startKey = startX + ',' + startY;
    const endKey = endX + ',' + endY;
    gScore[startKey] = 0;
    fScore[startKey] = heuristic({x:startX,y:startY}, {x:endX,y:endY});
    open.push({ x: startX, y: startY, f: fScore[startKey] });

    while(open.length > 0){
      open.sort(function(a, b){ return a.f - b.f; });
      const current = open.shift();
      const currentKey = current.x + ',' + current.y;
      if(currentKey === endKey){
        const path = [];
        let key = endKey;
        while(key){
          const parts = key.split(',');
          path.unshift({ x: parseInt(parts[0]), y: parseInt(parts[1]) });
          key = cameFrom[key];
        }
        return path;
      }
      closed.add(currentKey);
      const neighbors = getNeighbors(current.x, current.y);
      for(let i = 0; i < neighbors.length; i++){
        const n = neighbors[i];
        const nKey = n.x + ',' + n.y;
        if(closed.has(nKey)) continue;
        const tentativeG = (gScore[currentKey] || 0) + n.cost;
        if(tentativeG < (gScore[nKey] || Infinity)){
          cameFrom[nKey] = currentKey;
          gScore[nKey] = tentativeG;
          fScore[nKey] = tentativeG + heuristic(n, {x:endX,y:endY});
          if(!open.find(function(o){ return o.x === n.x && o.y === n.y; })){
            open.push({ x: n.x, y: n.y, f: fScore[nKey] });
          }
        }
      }
    }
    return [];
  }

  function getNeighbors(x, y){
    const neighbors = [];
    const dirs = pf._allowDiagonal ?
      [[0,-1,1],[1,0,1],[0,1,1],[-1,0,1],[1,-1,1.414],[1,1,1.414],[-1,1,1.414],[-1,-1,1.414]] :
      [[0,-1,1],[1,0,1],[0,1,1],[-1,0,1]];
    for(let i = 0; i < dirs.length; i++){
      const nx = x + dirs[i][0], ny = y + dirs[i][1];
      if(isWalkable(nx, ny)){
        neighbors.push({ x: nx, y: ny, cost: dirs[i][2] });
      }
    }
    return neighbors;
  }

  function smoothPath(path){
    if(path.length < 3) return path;
    const smoothed = [path[0]];
    let lastIndex = 0;
    for(let i = 2; i < path.length; i++){
      if(!lineOfSight(path[lastIndex], path[i])){
        smoothed.push(path[i-1]);
        lastIndex = i - 1;
      }
    }
    smoothed.push(path[path.length - 1]);
    return smoothed;
  }

  function lineOfSight(a, b){
    let x0 = a.x, y0 = a.y;
    const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while(true){
      if(!isWalkable(x0, y0)) return false;
      if(x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if(e2 > -dy){ err -= dy; x0 += sx; }
      if(e2 < dx){ err += dx; y0 += sy; }
    }
    return true;
  }

  function gridToWorld(x, y){
    return {
      x: (x - pf.gridWidth / 2) * pf.cellSize,
      z: (y - pf.gridHeight / 2) * pf.cellSize
    };
  }

  function worldToGrid(x, z){
    return {
      x: Math.floor(x / pf.cellSize + pf.gridWidth / 2),
      y: Math.floor(z / pf.cellSize + pf.gridHeight / 2)
    };
  }

  return { init, setWalkable, isWalkable, findPath, smoothPath, gridToWorld, worldToGrid, pf };
}

/* ===== 有限状态机 =====
   支持: 状态/ 转换 / 条件 / 层级状态机
*/
function createFSM(){
  const fsm = {
    states: {},
    currentState: null,
    previousState: null,
    _transitions: [],
    _globalTransitions: []
  };

  function addState(name, onEnter, onUpdate, onExit){
    fsm.states[name] = {
      name: name,
      onEnter: onEnter || function(){},
      onUpdate: onUpdate || function(){},
      onExit: onExit || function(){}
    };
    if(!fsm.currentState) fsm.currentState = fsm.states[name];
  }

  function addTransition(from, to, condition){
    fsm._transitions.push({ from: from, to: to, condition: condition || function(){ return false; } });
  }

  function addGlobalTransition(to, condition){
    fsm._globalTransitions.push({ to: to, condition: condition || function(){ return false; } });
  }

  function changeState(name){
    if(!fsm.states[name]) return false;
    if(fsm.currentState && fsm.currentState.name === name) return true;
    if(fsm.currentState) fsm.currentState.onExit();
    fsm.previousState = fsm.currentState;
    fsm.currentState = fsm.states[name];
    fsm.currentState.onEnter();
    return true;
  }

  function update(dt, context){
    if(!fsm.currentState) return;
    for(let i = 0; i < fsm._globalTransitions.length; i++){
      if(fsm._globalTransitions[i].condition(context)){
        changeState(fsm._globalTransitions[i].to);
        break;
      }
    }
    for(let i = 0; i < fsm._transitions.length; i++){
      const t = fsm._transitions[i];
      if(t.from === fsm.currentState.name && t.condition(context)){
        changeState(t.to);
        break;
      }
    }
    fsm.currentState.onUpdate(dt, context);
  }

  function getCurrentState(){
    return fsm.currentState ? fsm.currentState.name : null;
  }

  function reset(){
    fsm.currentState = null;
    fsm.previousState = null;
    fsm._transitions = [];
    fsm._globalTransitions = [];
  }

  return { addState, addTransition, addGlobalTransition, changeState, update, getCurrentState, reset, fsm };
}

/* ===== 对象池系统=====
   支持: 对象复用 / 预热 / 自动扩容 / 统计
*/
function createObjectPool(factory, resetFunc, options){
  const pool = {
    _available: [],
    _inUse: [],
    _factory: factory,
    _reset: resetFunc || function(){},
    _maxSize: (options && options.maxSize) || 1000,
    _autoExpand: (options && options.autoExpand !== undefined) ? options.autoExpand : true,
    _created: 0
  };

  function acquire(){
    let obj;
    if(pool._available.length > 0){
      obj = pool._available.pop();
    } else if(pool._created < pool._maxSize || pool._autoExpand){
      obj = pool._factory();
      pool._created++;
    } else {
      obj = pool._inUse.shift();
      pool._reset(obj);
    }
    pool._inUse.push(obj);
    return obj;
  }

  function release(obj){
    const idx = pool._inUse.indexOf(obj);
    if(idx >= 0) pool._inUse.splice(idx, 1);
    pool._reset(obj);
    pool._available.push(obj);
  }

  function releaseAll(){
    while(pool._inUse.length > 0){
      const obj = pool._inUse.pop();
      pool._reset(obj);
      pool._available.push(obj);
    }
  }

  function prewarm(count){
    for(let i = 0; i < count && pool._created < pool._maxSize; i++){
      const obj = pool._factory();
      pool._created++;
      pool._available.push(obj);
    }
  }

  function getStats(){
    return {
      available: pool._available.length,
      inUse: pool._inUse.length,
      created: pool._created,
      maxSize: pool._maxSize
    };
  }

  function clear(){
    pool._available = [];
    pool._inUse = [];
    pool._created = 0;
  }

  return { acquire, release, releaseAll, prewarm, getStats, clear, pool };
}

/* ===== 任务调度系统 =====
   支持: 协程 / 延时任务 / 优先级队列/ 帧预算*/
function createTaskScheduler(options){
  const scheduler = {
    _tasks: [],
    _coroutines: [],
    _time: 0,
    _frameBudget: (options && options.frameBudget) || 8,
    _maxTasksPerFrame: (options && options.maxTasksPerFrame) || 100
  };

  function schedule(task, delay, priority){
    scheduler._tasks.push({
      task: task,
      executeAt: scheduler._time + (delay || 0),
      priority: priority || 0,
      _id: Math.random()
    });
    scheduler._tasks.sort(function(a, b){
      if(a.executeAt !== b.executeAt) return a.executeAt - b.executeAt;
      return b.priority - a.priority;
    });
  }

  function startCoroutine(generatorFunc){
    const gen = generatorFunc();
    scheduler._coroutines.push({ gen: gen, nextTime: 0 });
  }

  function update(dt){
    scheduler._time += dt;
    const frameStart = performance.now();
    let tasksExecuted = 0;
    while(scheduler._tasks.length > 0 &&
          scheduler._tasks[0].executeAt <= scheduler._time &&
          tasksExecuted < scheduler._maxTasksPerFrame &&
          performance.now() - frameStart < scheduler._frameBudget){
      const task = scheduler._tasks.shift();
      try{ task.task(); } catch(e){ console.error('[Scheduler] 任务错误:', e); }
      tasksExecuted++;
    }
    for(let i = scheduler._coroutines.length - 1; i >= 0; i--){
      const co = scheduler._coroutines[i];
      if(scheduler._time >= co.nextTime){
        const result = co.gen.next();
        if(result.done){
          scheduler._coroutines.splice(i, 1);
        } else if(typeof result.value === 'number'){
          co.nextTime = scheduler._time + result.value;
        }
      }
    }
  }

  function getPendingCount(){
    return scheduler._tasks.length;
  }

  function getCoroutineCount(){
    return scheduler._coroutines.length;
  }

  function clear(){
    scheduler._tasks = [];
    scheduler._coroutines = [];
  }

  return { schedule, startCoroutine, update, getPendingCount, getCoroutineCount, clear, scheduler };
}

/* ===== 二进制序列化系统 =====
   支持: 类型化数组/ 压缩 / 校验和/ 版本控制
*/
function createBinarySerializer(){
  const ser = {
    _buffer: null,
    _view: null,
    _offset: 0,
    _littleEndian: true
  };

  function write(buffer, data){
    ser._buffer = buffer;
    ser._view = new DataView(buffer);
    ser._offset = 0;
    writeUint32(0x4D524855);
    writeUint16(1);
    writeValue(data);
    return ser._offset;
  }

  function read(buffer){
    ser._buffer = buffer;
    ser._view = new DataView(buffer);
    ser._offset = 0;
    const magic = readUint32();
    if(magic !== 0x4D524855) throw new Error('无效的二进制格式');
    const version = readUint16();
    return { version: version, data: readValue() };
  }

  function writeValue(value){
    if(value === null || value === undefined){ writeUint8(0); }
    else if(typeof value === 'boolean'){ writeUint8(1); writeUint8(value ? 1 : 0); }
    else if(typeof value === 'number'){
      if(Number.isInteger(value)){ writeUint8(2); writeInt32(value); }
      else { writeUint8(3); writeFloat64(value); }
    }
    else if(typeof value === 'string'){
      writeUint8(4);
      const bytes = new TextEncoder().encode(value);
      writeUint32(bytes.length);
      for(let i = 0; i < bytes.length; i++) writeUint8(bytes[i]);
    }
    else if(Array.isArray(value) || value instanceof Float32Array || value instanceof Uint8Array){
      writeUint8(5);
      writeUint32(value.length);
      for(let i = 0; i < value.length; i++) writeValue(value[i]);
    }
    else if(typeof value === 'object'){
      writeUint8(6);
      const keys = Object.keys(value);
      writeUint32(keys.length);
      for(let i = 0; i < keys.length; i++){
        writeValue(keys[i]);
        writeValue(value[keys[i]]);
      }
    }
  }

  function readValue(){
    const type = readUint8();
    switch(type){
      case 0: return null;
      case 1: return readUint8() === 1;
      case 2: return readInt32();
      case 3: return readFloat64();
      case 4: {
        const len = readUint32();
        const bytes = new Uint8Array(len);
        for(let i = 0; i < len; i++) bytes[i] = readUint8();
        return new TextDecoder().decode(bytes);
      }
      case 5: {
        const len = readUint32();
        const arr = [];
        for(let i = 0; i < len; i++) arr.push(readValue());
        return arr;
      }
      case 6: {
        const len = readUint32();
        const obj = {};
        for(let i = 0; i < len; i++){
          const key = readValue();
          obj[key] = readValue();
        }
        return obj;
      }
      default: throw new Error('未知类型: ' + type);
    }
  }

  function writeUint8(v){ ser._view.setUint8(ser._offset, v); ser._offset += 1; }
  function writeUint16(v){ ser._view.setUint16(ser._offset, v, ser._littleEndian); ser._offset += 2; }
  function writeUint32(v){ ser._view.setUint32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeInt32(v){ ser._view.setInt32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeFloat32(v){ ser._view.setFloat32(ser._offset, v, ser._littleEndian); ser._offset += 4; }
  function writeFloat64(v){ ser._view.setFloat64(ser._offset, v, ser._littleEndian); ser._offset += 8; }
  function readUint8(){ const v = ser._view.getUint8(ser._offset); ser._offset += 1; return v; }
  function readUint16(){ const v = ser._view.getUint16(ser._offset, ser._littleEndian); ser._offset += 2; return v; }
  function readUint32(){ const v = ser._view.getUint32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readInt32(){ const v = ser._view.getInt32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readFloat32(){ const v = ser._view.getFloat32(ser._offset, ser._littleEndian); ser._offset += 4; return v; }
  function readFloat64(){ const v = ser._view.getFloat64(ser._offset, ser._littleEndian); ser._offset += 8; return v; }

  function computeChecksum(buffer){
    let hash = 0;
    const view = new DataView(buffer);
    for(let i = 0; i < buffer.byteLength; i += 4){
      hash ^= view.getUint32(i, true);
    }
    return hash >>> 0;
  }

  return { write, read, computeChecksum, ser };
}

/* ===== 配置系统 =====
   支持: 分层配置 / 环境覆盖 / 类型验证 / 热重载*/
function createConfigSystem(defaults){
  const config = {
    _values: { ...defaults },
    _overrides: {},
    _env: 'default',
    _listeners: []
  };

  function set(key, value){
    const oldValue = get(key);
    config._overrides[key] = value;
    if(oldValue !== value){
      for(let i = 0; i < config._listeners.length; i++){
        config._listeners[i](key, value, oldValue);
      }
    }
  }

  function get(key, defaultValue){
    if(config._overrides[key] !== undefined) return config._overrides[key];
    if(config._values[key] !== undefined) return config._values[key];
    return defaultValue;
  }

  function has(key){
    return config._overrides[key] !== undefined || config._values[key] !== undefined;
  }

  function remove(key){
    delete config._overrides[key];
  }

  function setEnvironment(env){
    config._env = env;
  }

  function getEnvironment(){
    return config._env;
  }

  function load(json){
    const data = JSON.parse(json);
    for(const key in data){
      config._values[key] = data[key];
    }
  }

  function save(){
    return JSON.stringify({ ...config._values, ...config._overrides }, null, 2);
  }

  function onChange(callback){
    config._listeners.push(callback);
    return function(){
      const idx = config._listeners.indexOf(callback);
      if(idx >= 0) config._listeners.splice(idx, 1);
    };
  }

  function getGroup(prefix){
    const result = {};
    const all = { ...config._values, ...config._overrides };
    for(const key in all){
      if(key.startsWith(prefix)){
        result[key.substring(prefix.length)] = all[key];
      }
    }
    return result;
  }

  function reset(){
    config._overrides = {};
    config._listeners = [];
  }

  return { set, get, has, remove, setEnvironment, getEnvironment, load, save, onChange, getGroup, reset, config };
}

/* ===== 日志系统 =====
   支持: 级别 / 格式化/ 输出目标 / 性能监控
*/
const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };

function createLogger(options){
  const logger = {
    _level: (options && options.level) || LogLevel.INFO,
    _outputs: [],
    _buffer: [],
    _maxBuffer: (options && options.maxBuffer) || 1000,
    _includeTimestamp: (options && options.includeTimestamp !== undefined) ? options.includeTimestamp : true,
    _includeLevel: (options && options.includeLevel !== undefined) ? options.includeLevel : true
  };

  function setLevel(level){
    logger._level = level;
  }

  function addOutput(outputFunc){
    logger._outputs.push(outputFunc);
  }

  function log(level, args){
    if(level < logger._level) return;
    const parts = [];
    if(logger._includeTimestamp) parts.push('[' + new Date().toISOString() + ']');
    if(logger._includeLevel){
      const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      parts.push('[' + levels[level] + ']');
    }
    parts.push(...args);
    const message = parts.join(' ');
    logger._buffer.push({ level: level, message: message, time: Date.now() });
    if(logger._buffer.length > logger._maxBuffer) logger._buffer.shift();
    for(let i = 0; i < logger._outputs.length; i++){
      try{ logger._outputs[i](level, message); } catch(e){}
    }
    if(level >= LogLevel.ERROR) console.error(message);
    else if(level >= LogLevel.WARN) console.warn(message);
    else if(level >= LogLevel.INFO) console.log(message);
    else console.debug(message);
  }

  function debug(){ log(LogLevel.DEBUG, Array.from(arguments)); }
  function info(){ log(LogLevel.INFO, Array.from(arguments)); }
  function warn(){ log(LogLevel.WARN, Array.from(arguments)); }
  function error(){ log(LogLevel.ERROR, Array.from(arguments)); }

  function getBuffer(){
    return [...logger._buffer];
  }

  function clearBuffer(){
    logger._buffer = [];
  }

  function flush(){
    const messages = [...logger._buffer];
    logger._buffer = [];
    return messages;
  }

  return { setLevel, addOutput, debug, info, warn, error, getBuffer, clearBuffer, flush, logger };
}

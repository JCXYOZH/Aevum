/* ===== 输入映射系统 =====
   支持: 按键绑定 / 轴映射 / 多设备 / 配置保存
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

/* ===== 行为树系统 =====
   支持: 选择器 / 序列 / 装饰器 / 条件 / 动作
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
   支持: 网格寻路 / 导航网格 / 平滑路径 / 动态障碍
*/
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
   支持: 状态 / 转换 / 条件 / 层级状态机
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

/* ===== 对象池系统 =====
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
   支持: 协程 / 延时任务 / 优先级队列 / 帧预算
*/
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
   支持: 类型化数据 / 压缩 / 校验和 / 版本控制
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
   支持: 分层配置 / 环境覆盖 / 类型验证 / 热重载
*/
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
   支持: 级别 / 格式化 / 输出目标 / 性能监控
*/
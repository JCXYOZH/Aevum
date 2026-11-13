/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-ecs
 * 从 legacy/_orb_expand_part9.js 转换 (GBK->UTF-8)
 * @module orb-extension-ecs
 */
'use strict';



/* ===== 实体组件系统 (ECS) =====
   支持: 实体管理 / 组件存储 / 系统调度 / 事件驱动
*/
function createECS(options){
  const ecs = {
    _entities: new Map(),
    _components: new Map(),
    _systems: [],
    _nextEntityId: 1,
    _eventBus: createEventBus(),
    _running: false,
    _time: 0,
    _deltaTime: 0,
    _entityQueries: new Map()
  };

  function createEntity(name){
    const id = ecs._nextEntityId++;
    const entity = {
      id: id,
      name: name || ('Entity_' + id),
      components: new Set(),
      active: true,
      tags: new Set()
    };
    ecs._entities.set(id, entity);
    ecs._eventBus.emit('entityCreated', { entity: entity });
    return entity;
  }

  function destroyEntity(id){
    const entity = ecs._entities.get(id);
    if(!entity) return false;
    entity.components.forEach(function(compType){
      const compStore = ecs._components.get(compType);
      if(compStore) compStore.delete(id);
    });
    ecs._entities.delete(id);
    ecs._eventBus.emit('entityDestroyed', { id: id });
    invalidateQueries();
    return true;
  }

  function getEntity(id){
    return ecs._entities.get(id) || null;
  }

  function findEntityByName(name){
    for(const [id, entity] of ecs._entities){
      if(entity.name === name) return entity;
    }
    return null;
  }

  function registerComponent(type){
    if(!ecs._components.has(type)){
      ecs._components.set(type, new Map());
    }
  }

  function addComponent(entityId, type, data){
    registerComponent(type);
    const entity = ecs._entities.get(entityId);
    if(!entity) return null;
    const compStore = ecs._components.get(type);
    const component = { ...data, _entityId: entityId, _type: type };
    compStore.set(entityId, component);
    entity.components.add(type);
    ecs._eventBus.emit('componentAdded', { entityId: entityId, type: type, component: component });
    invalidateQueries();
    return component;
  }

  function removeComponent(entityId, type){
    const entity = ecs._entities.get(entityId);
    if(!entity) return false;
    const compStore = ecs._components.get(type);
    if(compStore) compStore.delete(entityId);
    entity.components.delete(type);
    ecs._eventBus.emit('componentRemoved', { entityId: entityId, type: type });
    invalidateQueries();
    return true;
  }

  function getComponent(entityId, type){
    const compStore = ecs._components.get(type);
    return compStore ? compStore.get(entityId) || null : null;
  }

  function hasComponent(entityId, type){
    const entity = ecs._entities.get(entityId);
    return entity ? entity.components.has(type) : false;
  }

  function getAllComponentsOfType(type){
    const compStore = ecs._components.get(type);
    if(!compStore) return [];
    return Array.from(compStore.values());
  }

  function query(componentTypes){
    const key = componentTypes.sort().join(',');
    if(ecs._entityQueries.has(key)) return ecs._entityQueries.get(key);
    const results = [];
    for(const [id, entity] of ecs._entities){
      if(!entity.active) continue;
      let hasAll = true;
      for(let i = 0; i < componentTypes.length; i++){
        if(!entity.components.has(componentTypes[i])){ hasAll = false; break; }
      }
      if(hasAll){
        const comps = {};
        for(let i = 0; i < componentTypes.length; i++){
          comps[componentTypes[i]] = getComponent(id, componentTypes[i]);
        }
        results.push({ entity: entity, components: comps });
      }
    }
    ecs._entityQueries.set(key, results);
    return results;
  }

  function invalidateQueries(){
    ecs._entityQueries.clear();
  }

  function addSystem(system){
    ecs._systems.push(system);
    if(system.init) system.init(ecs);
  }

  function removeSystem(system){
    const idx = ecs._systems.indexOf(system);
    if(idx >= 0){
      if(system.destroy) system.destroy(ecs);
      ecs._systems.splice(idx, 1);
    }
  }

  function update(dt){
    ecs._deltaTime = dt;
    ecs._time += dt;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].update) ecs._systems[i].update(ecs, dt);
    }
  }

  function render(renderer){
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].render) ecs._systems[i].render(ecs, renderer);
    }
  }

  function start(){
    ecs._running = true;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].start) ecs._systems[i].start(ecs);
    }
  }

  function stop(){
    ecs._running = false;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].stop) ecs._systems[i].stop(ecs);
    }
  }

  function getEntityCount(){
    return ecs._entities.size;
  }

  function getSystemCount(){
    return ecs._systems.length;
  }

  function getEventBus(){
    return ecs._eventBus;
  }

  function clear(){
    ecs._entities.clear();
    ecs._components.clear();
    ecs._systems = [];
    ecs._entityQueries.clear();
    ecs._nextEntityId = 1;
    ecs._time = 0;
  }

  return { createEntity, destroyEntity, getEntity, findEntityByName, registerComponent, addComponent, removeComponent, getComponent, hasComponent, getAllComponentsOfType, query, addSystem, removeSystem, update, render, start, stop, getEntityCount, getSystemCount, getEventBus, clear, ecs };
}

/* ===== 事件总线 =====
   支持: 订阅 / 发布 / 优先级/ 一次性监听器*/
function createEventBus(){
  const bus = {
    _listeners: new Map(),
    _onceListeners: new Map(),
    _eventHistory: [],
    _maxHistory: 100,
    _enabled: true
  };

  function on(event, callback, priority){
    if(!bus._listeners.has(event)) bus._listeners.set(event, []);
    const listener = { callback: callback, priority: priority || 0 };
    bus._listeners.get(event).push(listener);
    bus._listeners.get(event).sort(function(a, b){ return b.priority - a.priority; });
    return function(){ off(event, callback); };
  }

  function once(event, callback){
    if(!bus._onceListeners.has(event)) bus._onceListeners.set(event, []);
    bus._onceListeners.get(event).push(callback);
  }

  function off(event, callback){
    const listeners = bus._listeners.get(event);
    if(listeners){
      const idx = listeners.findIndex(function(l){ return l.callback === callback; });
      if(idx >= 0) listeners.splice(idx, 1);
    }
  }

  function emit(event, data){
    if(!bus._enabled) return;
    bus._eventHistory.push({ event: event, data: data, time: Date.now() });
    if(bus._eventHistory.length > bus._maxHistory) bus._eventHistory.shift();
    const listeners = bus._listeners.get(event);
    if(listeners){
      for(let i = 0; i < listeners.length; i++){
        try{ listeners[i].callback(data); } catch(e){ console.error('[EventBus] 处理器错误', e); }
      }
    }
    const onceListeners = bus._onceListeners.get(event);
    if(onceListeners){
      for(let i = 0; i < onceListeners.length; i++){
        try{ onceListeners[i](data); } catch(e){ console.error('[EventBus] 一次性处理器错误:', e); }
      }
      bus._onceListeners.delete(event);
    }
  }

  function clear(event){
    if(event){
      bus._listeners.delete(event);
      bus._onceListeners.delete(event);
    } else {
      bus._listeners.clear();
      bus._onceListeners.clear();
    }
  }

  function getListenerCount(event){
    const listeners = bus._listeners.get(event);
    return listeners ? listeners.length : 0;
  }

  function getHistory(){
    return [...bus._eventHistory];
  }

  function setEnabled(enabled){
    bus._enabled = enabled;
  }

  return { on, once, off, emit, clear, getListenerCount, getHistory, setEnabled, bus };
}

/* ===== 导航网格系统 =====
   支持: 网格构建 / 路径查找 / 平滑路径 / 动态障碍*/
function createNavMesh(options){
  const nav = {
    _cells: [],
    _width: (options && options.width) || 100,
    _height: (options && options.height) || 100,
    _cellSize: (options && options.cellSize) || 1,
    _obstacles: [],
    _initialized: false
  };

  function init(){
    const cols = Math.ceil(nav._width / nav._cellSize);
    const rows = Math.ceil(nav._height / nav._cellSize);
    nav._cells = [];
    for(let y = 0; y < rows; y++){
      const row = [];
      for(let x = 0; x < cols; x++){
        row.push({ x: x, y: y, walkable: true, cost: 1, region: 0 });
      }
      nav._cells.push(row);
    }
    nav._initialized = true;
  }

  function setWalkable(x, z, walkable){
    const cell = getCellAt(x, z);
    if(cell) cell.walkable = walkable;
  }

  function getCellAt(x, z){
    if(!nav._initialized) return null;
    const cx = Math.floor(x / nav._cellSize);
    const cz = Math.floor(z / nav._cellSize);
    if(cz < 0 || cz >= nav._cells.length || cx < 0 || cx >= nav._cells[0].length) return null;
    return nav._cells[cz][cx];
  }

  function addObstacle(x, z, radius){
    nav._obstacles.push({ x: x, z: z, radius: radius });
    for(let dz = -radius; dz <= radius; dz += nav._cellSize){
      for(let dx = -radius; dx <= radius; dx += nav._cellSize){
        const dist = Math.sqrt(dx*dx + dz*dz);
        if(dist <= radius){
          setWalkable(x + dx, z + dz, false);
        }
      }
    }
  }

  function removeObstacle(x, z, radius){
    for(let i = nav._obstacles.length - 1; i >= 0; i--){
      const obs = nav._obstacles[i];
      if(Math.abs(obs.x - x) < 0.1 && Math.abs(obs.z - z) < 0.1 && Math.abs(obs.radius - radius) < 0.1){
        nav._obstacles.splice(i, 1);
      }
    }
    rebuild();
  }

  function rebuild(){
    init();
    for(let i = 0; i < nav._obstacles.length; i++){
      const obs = nav._obstacles[i];
      for(let dz = -obs.radius; dz <= obs.radius; dz += nav._cellSize){
        for(let dx = -obs.radius; dx <= obs.radius; dx += nav._cellSize){
          const dist = Math.sqrt(dx*dx + dz*dz);
          if(dist <= obs.radius){
            setWalkable(obs.x + dx, obs.z + dz, false);
          }
        }
      }
    }
  }

  function findPath(startX, startZ, endX, endZ){
    if(!nav._initialized) return [];
    const startCell = getCellAt(startX, startZ);
    const endCell = getCellAt(endX, endZ);
    if(!startCell || !endCell || !startCell.walkable || !endCell.walkable) return [];
    const openSet = [startCell];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const cellKey = function(c){ return c.x + ',' + c.y; };
    gScore.set(cellKey(startCell), 0);
    fScore.set(cellKey(startCell), heuristic(startCell, endCell));
    while(openSet.length > 0){
      let current = openSet[0];
      let currentIdx = 0;
      for(let i = 1; i < openSet.length; i++){
        if((fScore.get(cellKey(openSet[i])) || Infinity) < (fScore.get(cellKey(current)) || Infinity)){
          current = openSet[i];
          currentIdx = i;
        }
      }
      if(current === endCell){
        return reconstructPath(cameFrom, current);
      }
      openSet.splice(currentIdx, 1);
      closedSet.add(cellKey(current));
      const neighbors = getNeighbors(current);
      for(let i = 0; i < neighbors.length; i++){
        const neighbor = neighbors[i];
        if(closedSet.has(cellKey(neighbor)) || !neighbor.walkable) continue;
        const tentativeG = (gScore.get(cellKey(current)) || 0) + neighbor.cost;
        if(!openSet.includes(neighbor)){
          openSet.push(neighbor);
        } else if(tentativeG >= (gScore.get(cellKey(neighbor)) || Infinity)){
          continue;
        }
        cameFrom.set(cellKey(neighbor), current);
        gScore.set(cellKey(neighbor), tentativeG);
        fScore.set(cellKey(neighbor), tentativeG + heuristic(neighbor, endCell));
      }
    }
    return [];
  }

  function heuristic(a, b){
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function getNeighbors(cell){
    const neighbors = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
    for(let i = 0; i < dirs.length; i++){
      const nx = cell.x + dirs[i][0];
      const ny = cell.y + dirs[i][1];
      if(ny >= 0 && ny < nav._cells.length && nx >= 0 && nx < nav._cells[0].length){
        neighbors.push(nav._cells[ny][nx]);
      }
    }
    return neighbors;
  }

  function reconstructPath(cameFrom, current){
    const path = [{ x: current.x * nav._cellSize, z: current.y * nav._cellSize }];
    const cellKey = function(c){ return c.x + ',' + c.y; };
    while(cameFrom.has(cellKey(current))){
      current = cameFrom.get(cellKey(current));
      path.unshift({ x: current.x * nav._cellSize, z: current.y * nav._cellSize });
    }
    return path;
  }

  function smoothPath(path){
    if(path.length <= 2) return path;
    const smoothed = [path[0]];
    let lastValid = 0;
    for(let i = 1; i < path.length; i++){
      if(!hasLineOfSight(smoothed[smoothed.length-1], path[i])){
        smoothed.push(path[i-1]);
      }
    }
    smoothed.push(path[path.length-1]);
    return smoothed;
  }

  function hasLineOfSight(a, b){
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const steps = Math.ceil(dist / nav._cellSize);
    for(let i = 0; i <= steps; i++){
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const cell = getCellAt(x, z);
      if(!cell || !cell.walkable) return false;
    }
    return true;
  }

  function getRandomWalkablePosition(){
    if(!nav._initialized) return null;
    for(let attempts = 0; attempts < 100; attempts++){
      const x = Math.random() * nav._width;
      const z = Math.random() * nav._height;
      const cell = getCellAt(x, z);
      if(cell && cell.walkable) return { x: x, z: z };
    }
    return null;
  }

  function clear(){
    nav._cells = [];
    nav._obstacles = [];
    nav._initialized = false;
  }

  return { init, setWalkable, getCellAt, addObstacle, removeObstacle, rebuild, findPath, smoothPath, getRandomWalkablePosition, clear, nav };
}

/* ===== 群体行为系统 =====
   支持: 分离 / 对齐 / 聚合 / 避障 / 追逐*/
function createFlockingSystem(options){
  const flock = {
    _agents: [],
    _separationWeight: (options && options.separationWeight) || 1.5,
    _alignmentWeight: (options && options.alignmentWeight) || 1,
    _cohesionWeight: (options && options.cohesionWeight) || 1,
    _avoidanceWeight: (options && options.avoidanceWeight) || 2,
    _maxSpeed: (options && options.maxSpeed) || 5,
    _maxForce: (options && options.maxForce) || 0.5,
    _perceptionRadius: (options && options.perceptionRadius) || 5,
    _separationRadius: (options && options.separationRadius) || 2,
    _obstacles: [],
    _bounds: (options && options.bounds) || { minX: -50, maxX: 50, minY: -50, maxY: 50, minZ: -50, maxZ: 50 }
  };

  function createAgent(position, velocity){
    const agent = {
      position: position ? [...position] : [0,0,0],
      velocity: velocity ? [...velocity] : [Math.random()-0.5, 0, Math.random()-0.5],
      acceleration: [0,0,0],
      maxSpeed: flock._maxSpeed,
      maxForce: flock._maxForce,
      active: true
    };
    flock._agents.push(agent);
    return agent;
  }

  function removeAgent(agent){
    const idx = flock._agents.indexOf(agent);
    if(idx >= 0) flock._agents.splice(idx, 1);
  }

  function addObstacle(position, radius){
    flock._obstacles.push({ position: [...position], radius: radius });
  }

  function update(dt){
    for(let i = 0; i < flock._agents.length; i++){
      const agent = flock._agents[i];
      if(!agent.active) continue;
      const separation = computeSeparation(agent);
      const alignment = computeAlignment(agent);
      const cohesion = computeCohesion(agent);
      const avoidance = computeAvoidance(agent);
      const bounds = computeBounds(agent);
      agent.acceleration[0] += separation[0] * flock._separationWeight;
      agent.acceleration[1] += separation[1] * flock._separationWeight;
      agent.acceleration[2] += separation[2] * flock._separationWeight;
      agent.acceleration[0] += alignment[0] * flock._alignmentWeight;
      agent.acceleration[1] += alignment[1] * flock._alignmentWeight;
      agent.acceleration[2] += alignment[2] * flock._alignmentWeight;
      agent.acceleration[0] += cohesion[0] * flock._cohesionWeight;
      agent.acceleration[1] += cohesion[1] * flock._cohesionWeight;
      agent.acceleration[2] += cohesion[2] * flock._cohesionWeight;
      agent.acceleration[0] += avoidance[0] * flock._avoidanceWeight;
      agent.acceleration[1] += avoidance[1] * flock._avoidanceWeight;
      agent.acceleration[2] += avoidance[2] * flock._avoidanceWeight;
      agent.acceleration[0] += bounds[0];
      agent.acceleration[1] += bounds[1];
      agent.acceleration[2] += bounds[2];
      agent.velocity[0] += agent.acceleration[0] * dt;
      agent.velocity[1] += agent.acceleration[1] * dt;
      agent.velocity[2] += agent.acceleration[2] * dt;
      const speed = Math.sqrt(agent.velocity[0]**2 + agent.velocity[1]**2 + agent.velocity[2]**2);
      if(speed > agent.maxSpeed){
        agent.velocity[0] = agent.velocity[0] / speed * agent.maxSpeed;
        agent.velocity[1] = agent.velocity[1] / speed * agent.maxSpeed;
        agent.velocity[2] = agent.velocity[2] / speed * agent.maxSpeed;
      }
      agent.position[0] += agent.velocity[0] * dt;
      agent.position[1] += agent.velocity[1] * dt;
      agent.position[2] += agent.velocity[2] * dt;
      agent.acceleration = [0,0,0];
    }
  }

  function computeSeparation(agent){
    const steer = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._separationRadius){
        const diff = [
          (agent.position[0] - other.position[0]) / d,
          (agent.position[1] - other.position[1]) / d,
          (agent.position[2] - other.position[2]) / d
        ];
        steer[0] += diff[0];
        steer[1] += diff[1];
        steer[2] += diff[2];
        count++;
      }
    }
    if(count > 0){
      steer[0] /= count; steer[1] /= count; steer[2] /= count;
      return limitForce(steer, agent);
    }
    return steer;
  }

  function computeAlignment(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.velocity[0];
        sum[1] += other.velocity[1];
        sum[2] += other.velocity[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] * agent.maxSpeed, sum[1] * agent.maxSpeed, sum[2] * agent.maxSpeed];
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeCohesion(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.position[0];
        sum[1] += other.position[1];
        sum[2] += other.position[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] - agent.position[0], sum[1] - agent.position[1], sum[2] - agent.position[2]];
      const dl = Math.sqrt(desired[0]**2 + desired[1]**2 + desired[2]**2) || 1;
      desired[0] = desired[0]/dl * agent.maxSpeed;
      desired[1] = desired[1]/dl * agent.maxSpeed;
      desired[2] = desired[2]/dl * agent.maxSpeed;
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeAvoidance(agent){
    const steer = [0,0,0];
    for(let i = 0; i < flock._obstacles.length; i++){
      const obs = flock._obstacles[i];
      const d = dist3(agent.position, obs.position);
      if(d < obs.radius + flock._perceptionRadius){
        const diff = [
          (agent.position[0] - obs.position[0]) / (d || 1),
          (agent.position[1] - obs.position[1]) / (d || 1),
          (agent.position[2] - obs.position[2]) / (d || 1)
        ];
        const strength = 1 - (d / (obs.radius + flock._perceptionRadius));
        steer[0] += diff[0] * strength;
        steer[1] += diff[1] * strength;
        steer[2] += diff[2] * strength;
      }
    }
    return limitForce(steer, agent);
  }

  function computeBounds(agent){
    const steer = [0,0,0];
    const b = flock._bounds;
    const margin = 5;
    if(agent.position[0] < b.minX + margin) steer[0] = 1;
    if(agent.position[0] > b.maxX - margin) steer[0] = -1;
    if(agent.position[1] < b.minY + margin) steer[1] = 1;
    if(agent.position[1] > b.maxY - margin) steer[1] = -1;
    if(agent.position[2] < b.minZ + margin) steer[2] = 1;
    if(agent.position[2] > b.maxZ - margin) steer[2] = -1;
    return steer;
  }

  function dist3(a, b){
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }

  function limitForce(force, agent){
    const mag = Math.sqrt(force[0]**2 + force[1]**2 + force[2]**2);
    if(mag > agent.maxForce){
      force[0] = force[0]/mag * agent.maxForce;
      force[1] = force[1]/mag * agent.maxForce;
      force[2] = force[2]/mag * agent.maxForce;
    }
    return force;
  }

  function getAgents(){
    return flock._agents;
  }

  function setWeights(separation, alignment, cohesion, avoidance){
    if(separation !== undefined) flock._separationWeight = separation;
    if(alignment !== undefined) flock._alignmentWeight = alignment;
    if(cohesion !== undefined) flock._cohesionWeight = cohesion;
    if(avoidance !== undefined) flock._avoidanceWeight = avoidance;
  }

  function clear(){
    flock._agents = [];
    flock._obstacles = [];
  }

  return { createAgent, removeAgent, addObstacle, update, getAgents, setWeights, clear, flock };
}

/* ===== 感知系统 =====
   支持: 视觉 / 听觉 / 触觉 / 记忆 / 威胁评估
*/
function createPerceptionSystem(owner, options){
  const perc = {
    owner: owner,
    _senses: {
      vision: { enabled: true, range: 20, fov: Math.PI * 0.5, rayCount: 8 },
      hearing: { enabled: true, range: 15, threshold: 0.5 },
      touch: { enabled: true, range: 1 },
      smell: { enabled: false, range: 10 }
    },
    _memory: [],
    _maxMemory: (options && options.maxMemory) || 50,
    _memoryDuration: (options && options.memoryDuration) || 30,
    _threats: [],
    _knownEntities: new Map(),
    _lastUpdate: 0
  };

  function setSenseEnabled(sense, enabled){
    if(perc._senses[sense]) perc._senses[sense].enabled = enabled;
  }

  function setSenseRange(sense, range){
    if(perc._senses[sense]) perc._senses[sense].range = range;
  }

  function update(position, forward, entities, dt, currentTime){
    perc._lastUpdate = currentTime;
    perc._threats = [];
    perc._knownEntities.clear();
    if(perc._senses.vision.enabled){
      senseVision(position, forward, entities, currentTime);
    }
    if(perc._senses.hearing.enabled){
      senseHearing(position, entities, currentTime);
    }
    if(perc._senses.touch.enabled){
      senseTouch(position, entities, currentTime);
    }
    updateMemory(currentTime);
  }

  function senseVision(position, forward, entities, currentTime){
    const vision = perc._senses.vision;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const toEntity = [
        entity.position[0] - position[0],
        entity.position[1] - position[1],
        entity.position[2] - position[2]
      ];
      const dist = Math.sqrt(toEntity[0]**2 + toEntity[1]**2 + toEntity[2]**2);
      if(dist > vision.range) continue;
      const dir = [toEntity[0]/dist, toEntity[1]/dist, toEntity[2]/dist];
      const dot = forward[0]*dir[0] + forward[1]*dir[1] + forward[2]*dir[2];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if(angle <= vision.fov * 0.5){
        const awareness = 1 - (dist / vision.range);
        perc._knownEntities.set(entity.id || i, {
          entity: entity,
          position: [...entity.position],
          lastSeen: currentTime,
          awareness: awareness,
          sense: 'vision'
        });
        if(entity.isThreat){
          perc._threats.push({ entity: entity, position: [...entity.position], threatLevel: awareness });
        }
      }
    }
  }

  function senseHearing(position, entities, currentTime){
    const hearing = perc._senses.hearing;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      if(!entity.noiseLevel || entity.noiseLevel < hearing.threshold) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist > hearing.range) continue;
      const awareness = entity.noiseLevel * (1 - dist / hearing.range);
      const key = entity.id || ('heard_' + i);
      if(!perc._knownEntities.has(key)){
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastHeard: currentTime,
          awareness: awareness,
          sense: 'hearing'
        });
      }
    }
  }

  function senseTouch(position, entities, currentTime){
    const touch = perc._senses.touch;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist <= touch.range){
        const key = entity.id || ('touched_' + i);
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastTouched: currentTime,
          awareness: 1,
          sense: 'touch'
        });
      }
    }
  }

  function updateMemory(currentTime){
    for(const [key, info] of perc._knownEntities){
      perc._memory.push({
        key: key,
        entity: info.entity,
        position: [...info.position],
        time: currentTime,
        sense: info.sense,
        awareness: info.awareness
      });
    }
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(currentTime - perc._memory[i].time > perc._memoryDuration){
        perc._memory.splice(i, 1);
      }
    }
    if(perc._memory.length > perc._maxMemory){
      perc._memory.splice(0, perc._memory.length - perc._maxMemory);
    }
  }

  function getKnownEntities(){
    return Array.from(perc._knownEntities.values());
  }

  function getThreats(){
    return [...perc._threats];
  }

  function getHighestThreat(){
    if(perc._threats.length === 0) return null;
    return perc._threats.reduce(function(max, t){ return t.threatLevel > max.threatLevel ? t : max; });
  }

  function getMemory(){
    return [...perc._memory];
  }

  function isAwareOf(entity){
    return perc._knownEntities.has(entity.id) || perc._memory.some(function(m){ return m.entity === entity; });
  }

  function getLastKnownPosition(entity){
    const known = perc._knownEntities.get(entity.id);
    if(known) return [...known.position];
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(perc._memory[i].entity === entity) return [...perc._memory[i].position];
    }
    return null;
  }

  function clear(){
    perc._memory = [];
    perc._threats = [];
    perc._knownEntities.clear();
  }

  return { setSenseEnabled, setSenseRange, update, getKnownEntities, getThreats, getHighestThreat, getMemory, isAwareOf, getLastKnownPosition, clear, perc };
}

/* ===== 对话系统 =====
   支持: 对话树/ 条件分支 / 选项 / 变量
*/
function createDialogueSystem(options){
  const dlg = {
    _nodes: new Map(),
    _currentNode: null,
    _variables: {},
    _history: [],
    _listeners: [],
    _speaker: ''
  };

  function addNode(id, data){
    dlg._nodes.set(id, { id: id, ...data });
  }

  function removeNode(id){
    dlg._nodes.delete(id);
  }

  function start(nodeId){
    const node = dlg._nodes.get(nodeId);
    if(!node) return false;
    dlg._currentNode = node;
    dlg._speaker = node.speaker || '';
    dlg._history.push({ nodeId: nodeId, time: Date.now() });
    emitEvent('nodeStart', node);
    if(node.onEnter) node.onEnter(dlg);
    return true;
  }

  function selectOption(index){
    if(!dlg._currentNode || !dlg._currentNode.options) return false;
    const option = dlg._currentNode.options[index];
    if(!option) return false;
    if(option.condition && !option.condition(dlg)) return false;
    if(option.onSelect) option.onSelect(dlg);
    if(option.next){
      return start(option.next);
    }
    return true;
  }

  function advance(){
    if(!dlg._currentNode) return false;
    if(dlg._currentNode.next){
      return start(dlg._currentNode.next);
    }
    return false;
  }

  function getCurrentNode(){
    return dlg._currentNode;
  }

  function getText(){
    return dlg._currentNode ? dlg._currentNode.text : '';
  }

  function getSpeaker(){
    return dlg._currentNode ? dlg._currentNode.speaker || '' : '';
  }

  function getOptions(){
    if(!dlg._currentNode || !dlg._currentNode.options) return [];
    return dlg._currentNode.options.filter(function(opt){
      return !opt.condition || opt.condition(dlg);
    }).map(function(opt){
      return { text: opt.text, available: !opt.condition || opt.condition(dlg) };
    });
  }

  function setVariable(name, value){
    dlg._variables[name] = value;
    emitEvent('variableChange', { name: name, value: value });
  }

  function getVariable(name){
    return dlg._variables[name];
  }

  function getHistory(){
    return [...dlg._history];
  }

  function hasVisited(nodeId){
    return dlg._history.some(function(h){ return h.nodeId === nodeId; });
  }

  function on(event, callback){
    dlg._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < dlg._listeners.length; i++){
      if(dlg._listeners[i].event === event){
        try{ dlg._listeners[i].callback(data); } catch(e){ console.error('[Dialogue] 事件错误:', e); }
      }
    }
  }

  function isFinished(){
    return !dlg._currentNode;
  }

  function reset(){
    dlg._currentNode = null;
    dlg._variables = {};
    dlg._history = [];
    dlg._speaker = '';
  }

  function clear(){
    dlg._nodes.clear();
    reset();
    dlg._listeners = [];
  }

  return { addNode, removeNode, start, selectOption, advance, getCurrentNode, getText, getSpeaker, getOptions, setVariable, getVariable, getHistory, hasVisited, on, isFinished, reset, clear, dlg };
}

/* ===== 存档系统 =====
   支持: 多槽位/ 自动存档 / 序列化/ 元数据*/
function createSaveSystem(options){
  const save = {
    _slots: new Map(),
    _maxSlots: (options && options.maxSlots) || 10,
    _autoSaveSlot: (options && options.autoSaveSlot) || 0,
    _currentSlot: -1,
    _serializers: new Map(),
    _storageKey: (options && options.storageKey) || 'game_saves',
    _listeners: []
  };

  function registerSerializer(type, serializeFn, deserializeFn){
    save._serializers.set(type, { serialize: serializeFn, deserialize: deserializeFn });
  }

  function saveGame(slotIndex, data, metadata){
    if(slotIndex < 0 || slotIndex >= save._maxSlots) return false;
    const slot = {
      index: slotIndex,
      data: serializeData(data),
      metadata: metadata || {},
      timestamp: Date.now(),
      version: (options && options.version) || '1.0'
    };
    save._slots.set(slotIndex, slot);
    save._currentSlot = slotIndex;
    persist();
    emitEvent('saved', { slot: slotIndex, metadata: slot.metadata });
    return true;
  }

  function loadGame(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    save._currentSlot = slotIndex;
    emitEvent('loaded', { slot: slotIndex, metadata: slot.metadata });
    return deserializeData(slot.data);
  }

  function autoSave(data, metadata){
    return saveGame(save._autoSaveSlot, data, { ...metadata, autoSave: true });
  }

  function deleteSave(slotIndex){
    if(save._slots.delete(slotIndex)){
      persist();
      emitEvent('deleted', { slot: slotIndex });
      return true;
    }
    return false;
  }

  function getSaveInfo(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    return {
      index: slot.index,
      metadata: slot.metadata,
      timestamp: slot.timestamp,
      version: slot.version,
      date: new Date(slot.timestamp).toLocaleString()
    };
  }

  function getAllSaves(){
    const saves = [];
    for(const [index, slot] of save._slots){
      saves.push(getSaveInfo(index));
    }
    return saves.sort(function(a, b){ return b.timestamp - a.timestamp; });
  }

  function getCurrentSlot(){
    return save._currentSlot;
  }

  function hasSave(slotIndex){
    return save._slots.has(slotIndex);
  }

  function serializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = { _type: value._type, _data: serializer.serialize(value) };
      } else {
        result[key] = JSON.parse(JSON.stringify(value));
      }
    }
    return result;
  }

  function deserializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = serializer.deserialize(value._data);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function persist(){
    try{
      const data = {};
      for(const [index, slot] of save._slots){
        data[index] = slot;
      }
      localStorage.setItem(save._storageKey, JSON.stringify(data));
    } catch(e){
      console.error('[SaveSystem] 持久化失败', e);
    }
  }

  function restore(){
    try{
      const data = localStorage.getItem(save._storageKey);
      if(data){
        const parsed = JSON.parse(data);
        for(const index in parsed){
          save._slots.set(parseInt(index), parsed[index]);
        }
      }
    } catch(e){
      console.error('[SaveSystem] 恢复失败:', e);
    }
  }

  function on(event, callback){
    save._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < save._listeners.length; i++){
      if(save._listeners[i].event === event){
        try{ save._listeners[i].callback(data); } catch(e){ console.error('[SaveSystem] 事件错误:', e); }
      }
    }
  }

  function exportSave(slotIndex){
    const slot = save._slots.get(slotIndex);
    return slot ? JSON.stringify(slot) : null;
  }

  function importSave(json){
    try{
      const slot = JSON.parse(json);
      if(slot.index !== undefined){
        save._slots.set(slot.index, slot);
        persist();
        return true;
      }
    } catch(e){
      console.error('[SaveSystem] 导入失败:', e);
    }
    return false;
  }

  function clearAll(){
    save._slots.clear();
    save._currentSlot = -1;
    persist();
  }

  restore();
  return { registerSerializer, saveGame, loadGame, autoSave, deleteSave, getSaveInfo, getAllSaves, getCurrentSlot, hasSave, on, exportSave, importSave, clearAll, save };
}

/* ===== 本地化系统=====
   支持: 多语言 / 文本替换 / 变量插值/ 复数形式
*/
function createLocalization(options){
  const loc = {
    _currentLanguage: (options && options.defaultLanguage) || 'zh-CN',
    _languages: new Map(),
    _fallbackLanguage: (options && options.fallbackLanguage) || 'en-US',
    _listeners: []
  };

  function addLanguage(code, strings){
    loc._languages.set(code, { ...strings });
  }

  function setLanguage(code){
    if(loc._languages.has(code)){
      loc._currentLanguage = code;
      emitEvent('languageChange', code);
      return true;
    }
    return false;
  }

  function getLanguage(){
    return loc._currentLanguage;
  }

  function getAvailableLanguages(){
    return Array.from(loc._languages.keys());
  }

  function t(key, variables){
    const strings = loc._languages.get(loc._currentLanguage);
    let text = strings ? strings[key] : undefined;
    if(text === undefined){
      const fallback = loc._languages.get(loc._fallbackLanguage);
      text = fallback ? fallback[key] : undefined;
    }
    if(text === undefined) return key;
    if(variables){
      for(const varName in variables){
        text = text.replace(new RegExp('\\{' + varName + '\\}', 'g'), variables[varName]);
      }
    }
    return text;
  }

  function tPlural(key, count, variables){
    const pluralKey = key + '_' + getPluralForm(count);
    let text = t(pluralKey, { count: count, ...variables });
    if(text === pluralKey){
      text = t(key, { count: count, ...variables });
    }
    return text;
  }

  function getPluralForm(count){
    const lang = loc._currentLanguage;
    if(lang === 'zh-CN' || lang === 'ja' || lang === 'ko'){
      return 'other';
    }
    if(lang === 'en-US' || lang === 'en-GB'){
      return count === 1 ? 'one' : 'other';
    }
    if(lang === 'ru' || lang === 'pl'){
      if(count % 10 === 1 && count % 100 !== 11) return 'one';
      if(count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return 'few';
      return 'many';
    }
    return count === 1 ? 'one' : 'other';
  }

  function hasKey(key){
    const strings = loc._languages.get(loc._currentLanguage);
    if(strings && strings[key] !== undefined) return true;
    const fallback = loc._languages.get(loc._fallbackLanguage);
    return fallback && fallback[key] !== undefined;
  }

  function addString(lang, key, value){
    if(!loc._languages.has(lang)) loc._languages.set(lang, {});
    loc._languages.get(lang)[key] = value;
  }

  function on(event, callback){
    loc._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < loc._listeners.length; i++){
      if(loc._listeners[i].event === event){
        try{ loc._listeners[i].callback(data); } catch(e){ console.error('[Localization] 事件错误:', e); }
      }
    }
  }

  function getLanguageName(code){
    const names = {
      'zh-CN': '简体中文',
      'zh-TW': '繁體中文',
      'en-US': 'English (US)',
      'en-GB': 'English (UK)',
      'ja': '日本語',
      'ko': '한국어',
      'fr': 'Français',
      'de': 'Deutsch',
      'es': 'Español',
      'ru': 'Русский'
    };
    return names[code] || code;
  }

  return { addLanguage, setLanguage, getLanguage, getAvailableLanguages, t, tPlural, hasKey, addString, on, getLanguageName, loc };
}

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
   支持: 订阅 / 发布 / 优先级 / 一次性监听
*/
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
        try{ listeners[i].callback(data); } catch(e){ console.error('[EventBus] 处理器错误:', e); }
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
   支持: 网格构建 / 路径查找 / 平滑路径 / 动态障碍
*/
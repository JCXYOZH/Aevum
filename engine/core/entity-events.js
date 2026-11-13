/**
 * 引擎核心 - 实体组件系统/事件总线/资源管理/状态机/时间管理
 * 纯JavaScript，零第三方依赖
 * @version 4.0.0
 */
'use strict';

const EngineCoreV4 = (function () {

  class EntityComponentSystem {
    constructor() {
      this.entities = new Map();
      this.components = new Map();
      this.systems = [];
      this.entityIdCounter = 0;
      this.componentTypes = new Map();
      this.queries = new Map();
      this.eventBus = new EventBus();
      this.isRunning = false;
      this.stats = {
        entityCount: 0,
        componentCount: 0,
        systemCount: 0,
        updatesPerSecond: 0
      };
    }

    createEntity(name = '') {
      const id = ++this.entityIdCounter;
      const entity = {
        id,
        name: name || `entity_${id}`,
        components: new Set(),
        active: true,
        tags: new Set(),
        createdAt: Date.now()
      };
      this.entities.set(id, entity);
      this.stats.entityCount++;
      this.eventBus.emit('entityCreated', entity);
      return entity;
    }

    removeEntity(id) {
      const entity = this.entities.get(id);
      if (!entity) return false;
      for (const componentType of entity.components) {
        this.removeComponent(id, componentType);
      }
      this.entities.delete(id);
      this.stats.entityCount--;
      this.eventBus.emit('entityRemoved', entity);
      this._invalidateQueries();
      return true;
    }

    getEntity(id) {
      return this.entities.get(id);
    }

    getEntityByName(name) {
      for (const entity of this.entities.values()) {
        if (entity.name === name) return entity;
      }
      return null;
    }

    getEntitiesByTag(tag) {
      const result = [];
      for (const entity of this.entities.values()) {
        if (entity.tags.has(tag)) result.push(entity);
      }
      return result;
    }

    addTag(id, tag) {
      const entity = this.entities.get(id);
      if (entity) {
        entity.tags.add(tag);
        this._invalidateQueries();
      }
    }

    removeTag(id, tag) {
      const entity = this.entities.get(id);
      if (entity) {
        entity.tags.delete(tag);
        this._invalidateQueries();
      }
    }

    registerComponentType(name, componentClass) {
      this.componentTypes.set(name, componentClass);
    }

    addComponent(id, componentType, data = {}) {
      const entity = this.entities.get(id);
      if (!entity) return null;
      const ComponentClass = this.componentTypes.get(componentType);
      if (!ComponentClass) {
        console.warn(`Component type not registered: ${componentType}`);
        return null;
      }
      const component = new ComponentClass(data);
      component.entityId = id;
      component.type = componentType;
      if (!this.components.has(componentType)) {
        this.components.set(componentType, new Map());
      }
      this.components.get(componentType).set(id, component);
      entity.components.add(componentType);
      this.stats.componentCount++;
      this.eventBus.emit('componentAdded', { entity, componentType, component });
      this._invalidateQueries();
      return component;
    }

    removeComponent(id, componentType) {
      const entity = this.entities.get(id);
      if (!entity) return false;
      const typeComponents = this.components.get(componentType);
      if (!typeComponents) return false;
      const component = typeComponents.get(id);
      if (!component) return false;
      if (typeof component.onRemove === 'function') {
        component.onRemove();
      }
      typeComponents.delete(id);
      entity.components.delete(componentType);
      this.stats.componentCount--;
      this.eventBus.emit('componentRemoved', { entity, componentType });
      this._invalidateQueries();
      return true;
    }

    getComponent(id, componentType) {
      const typeComponents = this.components.get(componentType);
      return typeComponents ? typeComponents.get(id) : null;
    }

    getComponents(componentType) {
      const typeComponents = this.components.get(componentType);
      return typeComponents ? Array.from(typeComponents.values()) : [];
    }

    hasComponent(id, componentType) {
      const entity = this.entities.get(id);
      return entity ? entity.components.has(componentType) : false;
    }

    addSystem(system) {
      system.ecs = this;
      if (typeof system.onAdd === 'function') {
        system.onAdd(this);
      }
      this.systems.push(system);
      this.stats.systemCount++;
      return system;
    }

    removeSystem(system) {
      const index = this.systems.indexOf(system);
      if (index !== -1) {
        if (typeof system.onRemove === 'function') {
          system.onRemove(this);
        }
        this.systems.splice(index, 1);
        this.stats.systemCount--;
      }
    }

    getSystems() {
      return [...this.systems];
    }

    query(componentTypes) {
      const key = componentTypes.sort().join(',');
      if (this.queries.has(key)) {
        return this.queries.get(key);
      }
      const result = [];
      for (const entity of this.entities.values()) {
        let hasAll = true;
        for (const componentType of componentTypes) {
          if (!entity.components.has(componentType)) {
            hasAll = false;
            break;
          }
        }
        if (hasAll) {
          result.push(entity);
        }
      }
      this.queries.set(key, result);
      return result;
    }

    _invalidateQueries() {
      this.queries.clear();
    }

    update(deltaTime) {
      if (!this.isRunning) return;
      for (const system of this.systems) {
        if (system.enabled !== false && typeof system.update === 'function') {
          system.update(deltaTime, this);
        }
      }
    }

    render(deltaTime) {
      for (const system of this.systems) {
        if (system.enabled !== false && typeof system.render === 'function') {
          system.render(deltaTime, this);
        }
      }
    }

    start() {
      this.isRunning = true;
      for (const system of this.systems) {
        if (typeof system.onStart === 'function') {
          system.onStart(this);
        }
      }
      this.eventBus.emit('ecsStarted');
    }

    stop() {
      this.isRunning = false;
      for (const system of this.systems) {
        if (typeof system.onStop === 'function') {
          system.onStop(this);
        }
      }
      this.eventBus.emit('ecsStopped');
    }

    getStats() {
      return { ...this.stats };
    }

    getEntityCount() {
      return this.entities.size;
    }

    getComponentCount() {
      return this.stats.componentCount;
    }

    getSystemCount() {
      return this.systems.length;
    }

    clear() {
      this.stop();
      for (const id of Array.from(this.entities.keys())) {
        this.removeEntity(id);
      }
      this.systems = [];
      this.componentTypes.clear();
      this.queries.clear();
      this.stats = { entityCount: 0, componentCount: 0, systemCount: 0, updatesPerSecond: 0 };
    }
  }

  class EventBus {
    constructor() {
      this.listeners = new Map();
      this.onceListeners = new Map();
      this.eventHistory = [];
      this.maxHistoryLength = 100;
      this.isEmitting = false;
      this.queuedEvents = [];
    }

    on(event, callback, priority = 0) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push({ callback, priority });
      this.listeners.get(event).sort((a, b) => b.priority - a.priority);
      return () => this.off(event, callback);
    }

    once(event, callback) {
      if (!this.onceListeners.has(event)) {
        this.onceListeners.set(event, []);
      }
      this.onceListeners.get(event).push(callback);
      return () => {
        const listeners = this.onceListeners.get(event);
        if (listeners) {
          const index = listeners.indexOf(callback);
          if (index !== -1) listeners.splice(index, 1);
        }
      };
    }

    off(event, callback) {
      const listeners = this.listeners.get(event);
      if (listeners) {
        const index = listeners.findIndex(l => l.callback === callback);
        if (index !== -1) listeners.splice(index, 1);
      }
    }

    emit(event, data) {
      const eventData = { event, data, timestamp: Date.now() };
      this.eventHistory.push(eventData);
      if (this.eventHistory.length > this.maxHistoryLength) {
        this.eventHistory.shift();
      }
      if (this.isEmitting) {
        this.queuedEvents.push(eventData);
        return;
      }
      this.isEmitting = true;
      try {
        const listeners = this.listeners.get(event);
        if (listeners) {
          for (const { callback } of [...listeners]) {
            try {
              callback(data);
            } catch (e) {
              console.error(`Error in event listener for ${event}:`, e);
            }
          }
        }
        const onceListeners = this.onceListeners.get(event);
        if (onceListeners) {
          for (const callback of [...onceListeners]) {
            try {
              callback(data);
            } catch (e) {
              console.error(`Error in once event listener for ${event}:`, e);
            }
          }
          this.onceListeners.delete(event);
        }
      } finally {
        this.isEmitting = false;
      }
      while (this.queuedEvents.length > 0) {
        const queued = this.queuedEvents.shift();
        this.emit(queued.event, queued.data);
      }
    }

    getListenerCount(event) {
      const listeners = this.listeners.get(event);
      return listeners ? listeners.length : 0;
    }

    getEventNames() {
      return Array.from(new Set([...this.listeners.keys(), ...this.onceListeners.keys()]));
    }

    getEventHistory(event = null, limit = 10) {
      let history = this.eventHistory;
      if (event) {
        history = history.filter(e => e.event === event);
      }
      return history.slice(-limit);
    }

    clear() {
      this.listeners.clear();
      this.onceListeners.clear();
      this.eventHistory = [];
      this.queuedEvents = [];
    }
  }

  class StateMachine {
    constructor() {
      this.states = new Map();
      this.currentState = null;
      this.currentStateName = null;
      this.previousState = null;
      this.transitions = new Map();
      this.isTransitioning = false;
      this.eventBus = new EventBus();
      this.stateHistory = [];
      this.maxHistoryLength = 50;
    }

    addState(name, config = {}) {
      const state = {
        name,
        onEnter: config.onEnter || null,
        onExit: config.onExit || null,
        onUpdate: config.onUpdate || null,
        onRender: config.onRender || null,
        data: config.data || {},
        enterTime: 0,
        duration: 0
      };
      this.states.set(name, state);
      return state;
    }

    removeState(name) {
      if (this.currentStateName === name) {
        this.transitionTo(null);
      }
      this.states.delete(name);
      this.transitions.delete(name);
    }

    addTransition(from, to, condition = null) {
      if (!this.transitions.has(from)) {
        this.transitions.set(from, []);
      }
      this.transitions.get(from).push({ to, condition });
    }

    removeTransition(from, to) {
      const transitions = this.transitions.get(from);
      if (transitions) {
        const index = transitions.findIndex(t => t.to === to);
        if (index !== -1) transitions.splice(index, 1);
      }
    }

    transitionTo(name, data = {}) {
      if (this.isTransitioning) return false;
      if (name && !this.states.has(name)) {
        console.warn(`State not found: ${name}`);
        return false;
      }
      this.isTransitioning = true;
      try {
        if (this.currentState) {
          if (typeof this.currentState.onExit === 'function') {
            this.currentState.onExit({ to: name, data });
          }
          this.currentState.duration = Date.now() - this.currentState.enterTime;
          this.eventBus.emit('stateExit', { from: this.currentStateName, to: name });
        }
        this.previousState = this.currentState;
        const previousName = this.currentStateName;
        if (name) {
          this.currentState = this.states.get(name);
          this.currentStateName = name;
          this.currentState.enterTime = Date.now();
          this.currentState.duration = 0;
          if (typeof this.currentState.onEnter === 'function') {
            this.currentState.onEnter({ from: previousName, data });
          }
          this.stateHistory.push({ state: name, timestamp: Date.now(), data });
          if (this.stateHistory.length > this.maxHistoryLength) {
            this.stateHistory.shift();
          }
          this.eventBus.emit('stateEnter', { state: name, from: previousName });
        } else {
          this.currentState = null;
          this.currentStateName = null;
        }
        this.eventBus.emit('stateChange', { from: previousName, to: name });
      } finally {
        this.isTransitioning = false;
      }
      return true;
    }

    update(deltaTime) {
      if (this.currentState && typeof this.currentState.onUpdate === 'function') {
        this.currentState.onUpdate(deltaTime, this.currentState.data);
      }
      this._checkTransitions();
    }

    render(deltaTime) {
      if (this.currentState && typeof this.currentState.onRender === 'function') {
        this.currentState.onRender(deltaTime, this.currentState.data);
      }
    }

    _checkTransitions() {
      if (!this.currentStateName || this.isTransitioning) return;
      const transitions = this.transitions.get(this.currentStateName);
      if (!transitions) return;
      for (const transition of transitions) {
        if (!transition.condition || transition.condition(this.currentState.data)) {
          this.transitionTo(transition.to);
          break;
        }
      }
    }

    getCurrentState() {
      return this.currentState;
    }

    getCurrentStateName() {
      return this.currentStateName;
    }

    getPreviousState() {
      return this.previousState;
    }

    getState(name) {
      return this.states.get(name);
    }

    getStateNames() {
      return Array.from(this.states.keys());
    }

    getStateCount() {
      return this.states.size;
    }

    getStateDuration() {
      if (!this.currentState) return 0;
      return Date.now() - this.currentState.enterTime;
    }

    getStateHistory() {
      return [...this.stateHistory];
    }

    canTransitionTo(name) {
      if (!this.currentStateName) return this.states.has(name);
      const transitions = this.transitions.get(this.currentStateName);
      if (!transitions) return false;
      return transitions.some(t => t.to === name && (!t.condition || t.condition(this.currentState.data)));
    }

    getAvailableTransitions() {
      if (!this.currentStateName) return [];
      const transitions = this.transitions.get(this.currentStateName);
      if (!transitions) return [];
      return transitions.filter(t => !t.condition || t.condition(this.currentState.data)).map(t => t.to);
    }

    on(event, callback) {
      return this.eventBus.on(event, callback);
    }

    clear() {
      this.states.clear();
      this.transitions.clear();
      this.currentState = null;
      this.currentStateName = null;
      this.previousState = null;
      this.stateHistory = [];
      this.isTransitioning = false;
    }
  }

  class TimeManager {
    constructor() {
      this.startTime = 0;
      this.lastTime = 0;
      this.deltaTime = 0;
      this.elapsedTime = 0;
      this.timeScale = 1;
      this.maxDeltaTime = 1 / 30;
      this.frameCount = 0;
      this.fps = 0;
      this.fpsUpdateInterval = 500;
      this.lastFpsUpdate = 0;
      this.framesSinceLastUpdate = 0;
      this.isPaused = false;
      this.timers = new Map();
      this.timerIdCounter = 0;
      this.eventBus = new EventBus();
    }

    start() {
      this.startTime = performance.now();
      this.lastTime = this.startTime;
      this.lastFpsUpdate = this.startTime;
      this.eventBus.emit('timeStart');
    }

    update() {
      const currentTime = performance.now();
      let delta = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;
      delta = Math.min(delta, this.maxDeltaTime);
      if (!this.isPaused) {
        this.deltaTime = delta * this.timeScale;
        this.elapsedTime += this.deltaTime;
        this._updateTimers(this.deltaTime);
      } else {
        this.deltaTime = 0;
      }
      this.frameCount++;
      this.framesSinceLastUpdate++;
      if (currentTime - this.lastFpsUpdate >= this.fpsUpdateInterval) {
        this.fps = Math.round(this.framesSinceLastUpdate * 1000 / (currentTime - this.lastFpsUpdate));
        this.framesSinceLastUpdate = 0;
        this.lastFpsUpdate = currentTime;
        this.eventBus.emit('fpsUpdate', this.fps);
      }
    }

    _updateTimers(deltaTime) {
      for (const [id, timer] of this.timers) {
        if (timer.paused) continue;
        timer.elapsed += deltaTime;
        if (timer.elapsed >= timer.duration) {
          if (timer.repeat) {
            timer.elapsed = 0;
            timer.repeatCount++;
          } else {
            this.timers.delete(id);
          }
          try {
            timer.callback(timer);
          } catch (e) {
            console.error('Error in timer callback:', e);
          }
        }
      }
    }

    setTimeout(callback, duration) {
      const id = ++this.timerIdCounter;
      this.timers.set(id, {
        id,
        callback,
        duration,
        elapsed: 0,
        repeat: false,
        repeatCount: 0,
        paused: false,
        createdAt: Date.now()
      });
      return id;
    }

    setInterval(callback, duration) {
      const id = ++this.timerIdCounter;
      this.timers.set(id, {
        id,
        callback,
        duration,
        elapsed: 0,
        repeat: true,
        repeatCount: 0,
        paused: false,
        createdAt: Date.now()
      });
      return id;
    }

    clearTimeout(id) {
      this.timers.delete(id);
    }

    clearInterval(id) {
      this.timers.delete(id);
    }

    pauseTimer(id) {
      const timer = this.timers.get(id);
      if (timer) timer.paused = true;
    }

    resumeTimer(id) {
      const timer = this.timers.get(id);
      if (timer) timer.paused = false;
    }

    getTimerRemaining(id) {
      const timer = this.timers.get(id);
      return timer ? Math.max(0, timer.duration - timer.elapsed) : 0;
    }

    getTimerProgress(id) {
      const timer = this.timers.get(id);
      return timer ? Math.min(1, timer.elapsed / timer.duration) : 0;
    }

    pause() {
      this.isPaused = true;
      this.eventBus.emit('timePause');
    }

    resume() {
      this.isPaused = false;
      this.lastTime = performance.now();
      this.eventBus.emit('timeResume');
    }

    setTimeScale(scale) {
      this.timeScale = Math.max(0, scale);
      this.eventBus.emit('timeScaleChange', this.timeScale);
    }

    getDeltaTime() {
      return this.deltaTime;
    }

    getElapsedTime() {
      return this.elapsedTime;
    }

    getFrameCount() {
      return this.frameCount;
    }

    getFps() {
      return this.fps;
    }

    isPausedState() {
      return this.isPaused;
    }

    getTimeScale() {
      return this.timeScale;
    }

    getActiveTimerCount() {
      return this.timers.size;
    }

    on(event, callback) {
      return this.eventBus.on(event, callback);
    }

    reset() {
      this.startTime = performance.now();
      this.lastTime = this.startTime;
      this.deltaTime = 0;
      this.elapsedTime = 0;
      this.frameCount = 0;
      this.fps = 0;
      this.timers.clear();
      this.isPaused = false;
    }

    dispose() {
      this.reset();
      this.eventBus.clear();
    }
  }

  return {
    EntityComponentSystem, EventBus, StateMachine, TimeManager
  };
})();

if (typeof window !== 'undefined') window.EngineCoreV4 = EngineCoreV4;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreV4 = EngineCoreV4;

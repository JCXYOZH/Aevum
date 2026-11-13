/**
 * 引擎核心 - 场景管理/资源管理/状态机/实体组件系统/事件总线/时间管理
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const EngineCoreV2 = (function () {

  // ============================================================
  // 实体组件系统 (ECS)
  // ============================================================
  class Entity {
    constructor(id, world) {
      this.id = id;
      this.world = world;
      this.components = new Map();
      this.tags = new Set();
      this.active = true;
      this.name = '';
      this.parent = null;
      this.children = [];
      this.transform = {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        worldMatrix: new Float32Array(16),
        localMatrix: new Float32Array(16),
        dirty: true
      };
    }

    addComponent(type, data = {}) {
      const component = { type, entity: this, ...data };
      this.components.set(type, component);
      this.world._onComponentAdded(this, type, component);
      return component;
    }

    removeComponent(type) {
      const component = this.components.get(type);
      if (component) {
        this.components.delete(type);
        this.world._onComponentRemoved(this, type, component);
      }
      return component;
    }

    getComponent(type) {
      return this.components.get(type);
    }

    hasComponent(type) {
      return this.components.has(type);
    }

    addTag(tag) { this.tags.add(tag); }
    removeTag(tag) { this.tags.delete(tag); }
    hasTag(tag) { return this.tags.has(tag); }

    setParent(parent) {
      if (this.parent) {
        const idx = this.parent.children.indexOf(this);
        if (idx !== -1) this.parent.children.splice(idx, 1);
      }
      this.parent = parent;
      if (parent) parent.children.push(this);
      this.transform.dirty = true;
    }

    setPosition(x, y, z) {
      this.transform.position = [x, y, z];
      this.transform.dirty = true;
    }

    setRotation(x, y, z, w) {
      this.transform.rotation = [x, y, z, w];
      this.transform.dirty = true;
    }

    setScale(x, y, z) {
      this.transform.scale = [x, y, z];
      this.transform.dirty = true;
    }

    getWorldPosition() {
      this._updateWorldMatrix();
      return [this.transform.worldMatrix[12], this.transform.worldMatrix[13], this.transform.worldMatrix[14]];
    }

    _updateWorldMatrix() {
      if (!this.transform.dirty) return;
      const m = this.transform.localMatrix;
      const x = this.transform.rotation[0], y = this.transform.rotation[1];
      const z = this.transform.rotation[2], w = this.transform.rotation[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = this.transform.scale[0], sy = this.transform.scale[1], sz = this.transform.scale[2];
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = this.transform.position[0]; m[13] = this.transform.position[1];
      m[14] = this.transform.position[2]; m[15] = 1;
      if (this.parent) {
        this.parent._updateWorldMatrix();
        const pm = this.parent.transform.worldMatrix;
        const wm = this.transform.worldMatrix;
        for (let i = 0; i < 16; i++) {
          const row = Math.floor(i / 4), col = i % 4;
          wm[i] = pm[row*4]*m[col] + pm[row*4+1]*m[4+col] + pm[row*4+2]*m[8+col] + pm[row*4+3]*m[12+col];
        }
      } else {
        this.transform.worldMatrix.set(m);
      }
      this.transform.dirty = false;
    }

    destroy() {
      this.world.removeEntity(this.id);
    }
  }

  class World {
    constructor() {
      this.entities = new Map();
      this.systems = [];
      this.queries = new Map();
      this.eventBus = new EventBus();
      this.nextEntityId = 1;
      this.resourceManager = null;
      this.time = { delta: 0, elapsed: 0, scale: 1, fixedDelta: 1/60, fixedAccumulator: 0 };
      this.running = false;
      this._componentListeners = new Map();
    }

    createEntity(name = '') {
      const id = this.nextEntityId++;
      const entity = new Entity(id, this);
      entity.name = name;
      this.entities.set(id, entity);
      this.eventBus.emit('entityCreated', { entity });
      return entity;
    }

    removeEntity(id) {
      const entity = this.entities.get(id);
      if (entity) {
        for (const [type, component] of entity.components) {
          this._onComponentRemoved(entity, type, component);
        }
        if (entity.parent) {
          const idx = entity.parent.children.indexOf(entity);
          if (idx !== -1) entity.parent.children.splice(idx, 1);
        }
        for (const child of entity.children) child.parent = null;
        this.entities.delete(id);
        this.eventBus.emit('entityDestroyed', { entity });
      }
    }

    getEntity(id) { return this.entities.get(id); }
    getEntityByName(name) {
      for (const entity of this.entities.values()) {
        if (entity.name === name) return entity;
      }
      return null;
    }

    addSystem(system) {
      system.world = this;
      this.systems.push(system);
      this.systems.sort((a, b) => (a.priority || 0) - (b.priority || 0));
      if (typeof system.init === 'function') system.init();
      return system;
    }

    removeSystem(system) {
      const idx = this.systems.indexOf(system);
      if (idx !== -1) {
        if (typeof system.destroy === 'function') system.destroy();
        this.systems.splice(idx, 1);
      }
    }

    query(components) {
      const key = components.sort().join(',');
      if (!this.queries.has(key)) {
        this.queries.set(key, { components, entities: [] });
      }
      const query = this.queries.get(key);
      query.entities = [];
      for (const entity of this.entities.values()) {
        if (!entity.active) continue;
        let match = true;
        for (const component of components) {
          if (!entity.hasComponent(component)) { match = false; break; }
        }
        if (match) query.entities.push(entity);
      }
      return query.entities;
    }

    _onComponentAdded(entity, type, component) {
      for (const query of this.queries.values()) {
        if (query.components.includes(type)) {
          let match = true;
          for (const c of query.components) {
            if (!entity.hasComponent(c)) { match = false; break; }
          }
          if (match && !query.entities.includes(entity)) {
            query.entities.push(entity);
          }
        }
      }
      const listeners = this._componentListeners.get(type);
      if (listeners) {
        for (const listener of listeners) listener(entity, component);
      }
    }

    _onComponentRemoved(entity, type, component) {
      for (const query of this.queries.values()) {
        if (query.components.includes(type)) {
          const idx = query.entities.indexOf(entity);
          if (idx !== -1) query.entities.splice(idx, 1);
        }
      }
    }

    onComponentAdded(type, listener) {
      if (!this._componentListeners.has(type)) {
        this._componentListeners.set(type, []);
      }
      this._componentListeners.get(type).push(listener);
    }

    update(delta) {
      this.time.delta = delta * this.time.scale;
      this.time.elapsed += this.time.delta;
      this.time.fixedAccumulator += this.time.delta;
      while (this.time.fixedAccumulator >= this.time.fixedDelta) {
        this._fixedUpdate(this.time.fixedDelta);
        this.time.fixedAccumulator -= this.time.fixedDelta;
      }
      for (const system of this.systems) {
        if (system.enabled !== false && typeof system.update === 'function') {
          system.update(this.time.delta);
        }
      }
      for (const entity of this.entities.values()) {
        entity._updateWorldMatrix();
      }
    }

    _fixedUpdate(delta) {
      for (const system of this.systems) {
        if (system.enabled !== false && typeof system.fixedUpdate === 'function') {
          system.fixedUpdate(delta);
        }
      }
    }

    render(renderer) {
      for (const system of this.systems) {
        if (system.enabled !== false && typeof system.render === 'function') {
          system.render(renderer);
        }
      }
    }

    getEntityCount() { return this.entities.size; }
    getSystemCount() { return this.systems.length; }
    getActiveEntities() { return Array.from(this.entities.values()).filter(e => e.active); }
    clear() {
      for (const entity of Array.from(this.entities.values())) {
        this.removeEntity(entity.id);
      }
      this.systems = [];
      this.queries.clear();
    }
  }

  // ============================================================
  // 事件总线
  // ============================================================
  class EventBus {
    constructor() {
      this.listeners = new Map();
      this.onceListeners = new Map();
      this.eventHistory = [];
      this.maxHistory = 100;
      this.enabled = true;
    }

    on(event, listener, priority = 0) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event).push({ listener, priority });
      this.listeners.get(event).sort((a, b) => a.priority - b.priority);
      return () => this.off(event, listener);
    }

    once(event, listener) {
      if (!this.onceListeners.has(event)) {
        this.onceListeners.set(event, []);
      }
      this.onceListeners.get(event).push(listener);
      return () => {
        const listeners = this.onceListeners.get(event);
        if (listeners) {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        }
      };
    }

    off(event, listener) {
      const listeners = this.listeners.get(event);
      if (listeners) {
        const idx = listeners.findIndex(l => l.listener === listener);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    }

    emit(event, data = {}) {
      if (!this.enabled) return;
      this.eventHistory.push({ event, data, timestamp: Date.now() });
      if (this.eventHistory.length > this.maxHistory) {
        this.eventHistory.shift();
      }
      const listeners = this.listeners.get(event);
      if (listeners) {
        for (const { listener } of [...listeners]) {
          try { listener(data); } catch (e) { console.error(`Event listener error for ${event}:`, e); }
        }
      }
      const onceListeners = this.onceListeners.get(event);
      if (onceListeners) {
        for (const listener of [...onceListeners]) {
          try { listener(data); } catch (e) { console.error(`Once listener error for ${event}:`, e); }
        }
        this.onceListeners.delete(event);
      }
      const wildcard = this.listeners.get('*');
      if (wildcard) {
        for (const { listener } of wildcard) {
          try { listener(event, data); } catch (e) { console.error('Wildcard listener error:', e); }
        }
      }
    }

    removeAll(event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    }

    clear() {
      this.listeners.clear();
      this.onceListeners.clear();
      this.eventHistory = [];
    }

    getListenerCount(event) {
      return this.listeners.get(event)?.length || 0;
    }

    getEventHistory() {
      return [...this.eventHistory];
    }

    setEnabled(v) { this.enabled = v; }
  }

  // ============================================================
  // 资源管理器
  // ============================================================
  class ResourceManager {
    constructor() {
      this.resources = new Map();
      this.loaders = new Map();
      this.loading = new Map();
      this.groups = new Map();
      this.maxCacheSize = 100;
      this.basePath = '';
      this.stats = { totalLoaded: 0, totalFailed: 0, cacheHits: 0, bytesLoaded: 0 };
      this.eventBus = new EventBus();
    }

    registerLoader(type, loader) {
      this.loaders.set(type, loader);
    }

    async load(type, url, options = {}) {
      const fullUrl = this.basePath + url;
      const cacheKey = options.cacheKey || `${type}:${fullUrl}`;
      if (this.resources.has(cacheKey)) {
        this.stats.cacheHits++;
        return this.resources.get(cacheKey);
      }
      if (this.loading.has(cacheKey)) {
        return this.loading.get(cacheKey);
      }
      const loader = this.loaders.get(type);
      if (!loader) {
        throw new Error(`No loader for type: ${type}`);
      }
      const loadPromise = (async () => {
        try {
          const resource = await loader.load(fullUrl, options, this);
          this.resources.set(cacheKey, resource);
          this.stats.totalLoaded++;
          this.eventBus.emit('resourceLoaded', { type, url: fullUrl, resource });
          return resource;
        } catch (error) {
          this.stats.totalFailed++;
          this.eventBus.emit('resourceFailed', { type, url: fullUrl, error });
          throw error;
        } finally {
          this.loading.delete(cacheKey);
        }
      })();
      this.loading.set(cacheKey, loadPromise);
      return loadPromise;
    }

    async loadGroup(name, resources) {
      if (!this.groups.has(name)) {
        this.groups.set(name, { resources: [], loaded: 0, total: 0 });
      }
      const group = this.groups.get(name);
      group.total = resources.length;
      group.loaded = 0;
      const results = [];
      for (const res of resources) {
        try {
          const resource = await this.load(res.type, res.url, res.options);
          results.push({ url: res.url, resource, success: true });
        } catch (error) {
          results.push({ url: res.url, error, success: false });
        }
        group.loaded++;
        this.eventBus.emit('groupProgress', { name, loaded: group.loaded, total: group.total, percentage: group.loaded / group.total });
      }
      this.eventBus.emit('groupComplete', { name, results });
      return results;
    }

    get(type, url) {
      return this.resources.get(`${type}:${this.basePath}${url}`);
    }

    getByKey(key) {
      return this.resources.get(key);
    }

    release(type, url) {
      const key = `${type}:${this.basePath}${url}`;
      const resource = this.resources.get(key);
      if (resource) {
        if (typeof resource.dispose === 'function') resource.dispose();
        this.resources.delete(key);
      }
    }

    releaseGroup(name) {
      const group = this.groups.get(name);
      if (group) {
        for (const res of group.resources) {
          this.release(res.type, res.url);
        }
        this.groups.delete(name);
      }
    }

    clear() {
      for (const [key, resource] of this.resources) {
        if (typeof resource.dispose === 'function') {
          try { resource.dispose(); } catch (e) {}
        }
      }
      this.resources.clear();
      this.loading.clear();
      this.groups.clear();
    }

    getResourceCount() { return this.resources.size; }
    getLoadingCount() { return this.loading.size; }
    getStats() { return { ...this.stats, resourceCount: this.resources.size, loadingCount: this.loading.size }; }
    setBasePath(path) { this.basePath = path; }
  }

  // ============================================================
  // 状态机
  // ============================================================
  class StateMachine {
    constructor() {
      this.states = new Map();
      this.currentState = null;
      this.currentStateName = null;
      this.transitions = new Map();
      this.history = [];
      this.maxHistory = 50;
      this.eventBus = new EventBus();
    }

    addState(name, config = {}) {
      this.states.set(name, {
        name,
        enter: config.enter || (() => {}),
        exit: config.exit || (() => {}),
        update: config.update || (() => {}),
        fixedUpdate: config.fixedUpdate || (() => {}),
        render: config.render || (() => {}),
        data: config.data || {}
      });
    }

    addTransition(from, to, condition) {
      const key = `${from}->${to}`;
      if (!this.transitions.has(from)) {
        this.transitions.set(from, []);
      }
      this.transitions.get(from).push({ to, condition, key });
    }

    async changeState(name, ...args) {
      if (!this.states.has(name)) {
        throw new Error(`State not found: ${name}`);
      }
      if (this.currentState) {
        await this.currentState.exit(...args);
        this.eventBus.emit('stateExit', { from: this.currentStateName, to: name });
      }
      const previousState = this.currentStateName;
      this.currentState = this.states.get(name);
      this.currentStateName = name;
      this.history.push({ from: previousState, to: name, timestamp: Date.now(), args });
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      await this.currentState.enter(...args);
      this.eventBus.emit('stateEnter', { state: name, previous: previousState });
      this.eventBus.emit('stateChange', { from: previousState, to: name });
    }

    update(delta) {
      if (this.currentState) {
        this.currentState.update(delta);
        this._checkTransitions();
      }
    }

    fixedUpdate(delta) {
      if (this.currentState) {
        this.currentState.fixedUpdate(delta);
      }
    }

    render(renderer) {
      if (this.currentState) {
        this.currentState.render(renderer);
      }
    }

    _checkTransitions() {
      const transitions = this.transitions.get(this.currentStateName);
      if (!transitions) return;
      for (const transition of transitions) {
        if (transition.condition(this.currentState.data)) {
          this.changeState(transition.to);
          return;
        }
      }
    }

    getCurrentState() { return this.currentStateName; }
    getStateData() { return this.currentState?.data || {}; }
    getStateNames() { return Array.from(this.states.keys()); }
    getHistory() { return [...this.history]; }
    hasState(name) { return this.states.has(name); }
    removeState(name) {
      if (this.currentStateName === name) {
        this.currentState = null;
        this.currentStateName = null;
      }
      this.states.delete(name);
      this.transitions.delete(name);
    }
    clear() {
      this.states.clear();
      this.transitions.clear();
      this.history = [];
      this.currentState = null;
      this.currentStateName = null;
    }
  }

  // ============================================================
  // 时间管理器
  // ============================================================
  class TimeManager {
    constructor() {
      this.startTime = performance.now();
      this.lastTime = this.startTime;
      this.deltaTime = 0;
      this.unscaledDeltaTime = 0;
      this.elapsedTime = 0;
      this.unscaledElapsedTime = 0;
      this.timeScale = 1;
      this.maxDeltaTime = 0.1;
      this.fixedDeltaTime = 1 / 60;
      this.fixedAccumulator = 0;
      this.frameCount = 0;
      this.fps = 0;
      this.fpsUpdateInterval = 0.5;
      this.fpsAccumulator = 0;
      this.fpsFrameCount = 0;
      this.coroutines = [];
      this.timers = [];
      this.nextTimerId = 1;
    }

    update() {
      const now = performance.now();
      this.unscaledDeltaTime = Math.min((now - this.lastTime) / 1000, this.maxDeltaTime);
      this.deltaTime = this.unscaledDeltaTime * this.timeScale;
      this.lastTime = now;
      this.elapsedTime += this.deltaTime;
      this.unscaledElapsedTime += this.unscaledDeltaTime;
      this.frameCount++;
      this.fpsAccumulator += this.unscaledDeltaTime;
      this.fpsFrameCount++;
      if (this.fpsAccumulator >= this.fpsUpdateInterval) {
        this.fps = Math.round(this.fpsFrameCount / this.fpsAccumulator);
        this.fpsAccumulator = 0;
        this.fpsFrameCount = 0;
      }
      this.fixedAccumulator += this.deltaTime;
      this._updateTimers();
      this._updateCoroutines();
    }

    fixedUpdate() {
      if (this.fixedAccumulator >= this.fixedDeltaTime) {
        this.fixedAccumulator -= this.fixedDeltaTime;
        return true;
      }
      return false;
    }

    setTimeout(callback, delay, ...args) {
      const id = this.nextTimerId++;
      this.timers.push({ id, callback, delay, elapsed: 0, args, type: 'timeout' });
      return id;
    }

    setInterval(callback, interval, ...args) {
      const id = this.nextTimerId++;
      this.timers.push({ id, callback, interval, elapsed: 0, args, type: 'interval' });
      return id;
    }

    clearTimer(id) {
      const idx = this.timers.findIndex(t => t.id === id);
      if (idx !== -1) this.timers.splice(idx, 1);
    }

    _updateTimers() {
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const timer = this.timers[i];
        timer.elapsed += this.deltaTime;
        if (timer.type === 'timeout' && timer.elapsed >= timer.delay) {
          timer.callback(...timer.args);
          this.timers.splice(i, 1);
        } else if (timer.type === 'interval' && timer.elapsed >= timer.interval) {
          timer.callback(...timer.args);
          timer.elapsed = 0;
        }
      }
    }

    startCoroutine(generatorFunc) {
      const coroutine = {
        generator: generatorFunc(),
        done: false,
        value: null
      };
      this.coroutines.push(coroutine);
      return coroutine;
    }

    stopCoroutine(coroutine) {
      const idx = this.coroutines.indexOf(coroutine);
      if (idx !== -1) this.coroutines.splice(idx, 1);
    }

    _updateCoroutines() {
      for (let i = this.coroutines.length - 1; i >= 0; i--) {
        const coroutine = this.coroutines[i];
        if (coroutine.done) {
          this.coroutines.splice(i, 1);
          continue;
        }
        const result = coroutine.generator.next(this.deltaTime);
        coroutine.value = result.value;
        if (result.done) {
          coroutine.done = true;
        }
      }
    }

    waitForSeconds(seconds) {
      return { type: 'wait', duration: seconds, elapsed: 0 };
    }

    getTimeSinceStart() {
      return (performance.now() - this.startTime) / 1000;
    }

    reset() {
      this.startTime = performance.now();
      this.lastTime = this.startTime;
      this.deltaTime = 0;
      this.elapsedTime = 0;
      this.frameCount = 0;
      this.fps = 0;
      this.coroutines = [];
      this.timers = [];
    }
  }

  // ============================================================
  // 场景管理器
  // ============================================================
  class SceneManager {
    constructor(world) {
      this.world = world;
      this.scenes = new Map();
      this.currentScene = null;
      this.currentSceneName = null;
      this.loadingScene = null;
      this.eventBus = new EventBus();
    }

    addScene(name, config = {}) {
      this.scenes.set(name, {
        name,
        entities: config.entities || [],
        systems: config.systems || [],
        resources: config.resources || [],
        onLoad: config.onLoad || (() => {}),
        onUnload: config.onUnload || (() => {}),
        onEnter: config.onEnter || (() => {}),
        onExit: config.onExit || (() => {}),
        loaded: false,
        data: config.data || {}
      });
    }

    async loadScene(name) {
      const scene = this.scenes.get(name);
      if (!scene) throw new Error(`Scene not found: ${name}`);
      this.eventBus.emit('sceneLoadStart', { scene: name });
      if (this.world.resourceManager && scene.resources.length > 0) {
        await this.world.resourceManager.loadGroup(name, scene.resources);
      }
      for (const entityConfig of scene.entities) {
        const entity = this.world.createEntity(entityConfig.name);
        for (const [type, data] of Object.entries(entityConfig.components || {})) {
          entity.addComponent(type, data);
        }
        if (entityConfig.position) entity.setPosition(...entityConfig.position);
        if (entityConfig.rotation) entity.setRotation(...entityConfig.rotation);
        if (entityConfig.scale) entity.setScale(...entityConfig.scale);
        if (entityConfig.parent) {
          const parent = this.world.getEntityByName(entityConfig.parent);
          if (parent) entity.setParent(parent);
        }
      }
      for (const systemConfig of scene.systems) {
        if (typeof systemConfig === 'function') {
          this.world.addSystem(new systemConfig());
        } else if (systemConfig.instance) {
          this.world.addSystem(systemConfig.instance);
        }
      }
      await scene.onLoad(this.world, scene.data);
      scene.loaded = true;
      this.eventBus.emit('sceneLoadComplete', { scene: name });
      return scene;
    }

    async changeScene(name, ...args) {
      const scene = this.scenes.get(name);
      if (!scene) throw new Error(`Scene not found: ${name}`);
      if (this.currentScene) {
        await this.currentScene.onExit(this.world, this.currentScene.data);
        this.eventBus.emit('sceneExit', { scene: this.currentSceneName });
        this._unloadCurrentScene();
      }
      if (!scene.loaded) {
        await this.loadScene(name);
      }
      this.currentScene = scene;
      this.currentSceneName = name;
      await scene.onEnter(this.world, scene.data, ...args);
      this.eventBus.emit('sceneEnter', { scene: name });
      this.eventBus.emit('sceneChange', { from: this.currentSceneName, to: name });
    }

    _unloadCurrentScene() {
      if (!this.currentScene) return;
      for (const entityConfig of this.currentScene.entities) {
        const entity = this.world.getEntityByName(entityConfig.name);
        if (entity) entity.destroy();
      }
      for (const systemConfig of this.currentScene.systems) {
        const system = typeof systemConfig === 'function' ? systemConfig : systemConfig.instance;
        if (system) this.world.removeSystem(system);
      }
      if (this.world.resourceManager) {
        this.world.resourceManager.releaseGroup(this.currentSceneName);
      }
      this.currentScene.onUnload(this.world, this.currentScene.data);
      this.currentScene.loaded = false;
    }

    getCurrentScene() { return this.currentSceneName; }
    getSceneData() { return this.currentScene?.data || {}; }
    getSceneNames() { return Array.from(this.scenes.keys()); }
    hasScene(name) { return this.scenes.has(name); }
    removeScene(name) {
      if (this.currentSceneName === name) {
        this._unloadCurrentScene();
        this.currentScene = null;
        this.currentSceneName = null;
      }
      this.scenes.delete(name);
    }
    clear() {
      this._unloadCurrentScene();
      this.scenes.clear();
      this.currentScene = null;
      this.currentSceneName = null;
    }
  }

  return {
    Entity, World, EventBus, ResourceManager, StateMachine, TimeManager, SceneManager
  };
})();

if (typeof window !== 'undefined') window.EngineCoreV2 = EngineCoreV2;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreV2 = EngineCoreV2;

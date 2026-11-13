/**
 * MrHua OrbEngine - 前端引擎总入口
 * 纯自研WebGL引擎，零第三方依赖
 * 八大模块协同：引擎核心 / 模型格式 / 人形动作 / 3D世界 / 灵体交互 / WebGL核心 / 灵体皮肤 / 灵体渲染
 * @version 2.0.0
 */

'use strict';

const OrbEngine = (function () {

  // ============================================================
  // 引擎版本与全局状态
  // ============================================================
  const VERSION = '2.0.0';
  const BUILD_DATE = '2026-08-29';
  const ENGINE_NAME = 'MrHua OrbEngine';

  const _state = {
    initialized: false,
    modules: {},
    config: {},
    events: {},
    performance: {
      fps: 0,
      frameTime: 0,
      drawCalls: 0,
      triangles: 0,
      memoryUsage: 0
    },
    debug: false
  };

  // ============================================================
  // 事件系统 - 模块间通信枢纽
  // ============================================================
  class EventBus {
    constructor() {
      this._listeners = new Map();
      this._onceListeners = new Map();
      this._eventLog = [];
      this._maxLogSize = 1000;
    }

    on(event, callback, priority = 0) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }
      this._listeners.get(event).push({ callback, priority });
      this._listeners.get(event).sort((a, b) => b.priority - a.priority);
      return () => this.off(event, callback);
    }

    once(event, callback) {
      if (!this._onceListeners.has(event)) {
        this._onceListeners.set(event, []);
      }
      this._onceListeners.get(event).push(callback);
    }

    off(event, callback) {
      if (this._listeners.has(event)) {
        const arr = this._listeners.get(event);
        const idx = arr.findIndex(l => l.callback === callback);
        if (idx !== -1) arr.splice(idx, 1);
      }
    }

    emit(event, data = {}) {
      if (_state.debug) {
        this._eventLog.push({ event, data, time: performance.now() });
        if (this._eventLog.length > this._maxLogSize) {
          this._eventLog.shift();
        }
      }
      if (this._listeners.has(event)) {
        for (const { callback } of this._listeners.get(event)) {
          try { callback(data); } catch (e) { console.error(`[EventBus] Error in ${event}:`, e); }
        }
      }
      if (this._onceListeners.has(event)) {
        const cbs = this._onceListeners.get(event);
        this._onceListeners.delete(event);
        for (const cb of cbs) {
          try { cb(data); } catch (e) { console.error(`[EventBus] Once error in ${event}:`, e); }
        }
      }
    }

    getEventLog() { return this._eventLog.slice(); }
    clearEventLog() { this._eventLog.length = 0; }
    listenerCount(event) {
      return (this._listeners.get(event) || []).length + (this._onceListeners.get(event) || []).length;
    }
  }

  const eventBus = new EventBus();

  // ============================================================
  // 模块管理器 - 依赖注入与生命周期
  // ============================================================
  class ModuleManager {
    constructor() {
      this._modules = new Map();
      this._initOrder = [];
      this._dependencyGraph = new Map();
    }

    register(name, module, dependencies = []) {
      if (this._modules.has(name)) {
        console.warn(`[ModuleManager] Module "${name}" already registered, overwriting`);
      }
      this._modules.set(name, { instance: module, dependencies, initialized: false, name });
      this._dependencyGraph.set(name, dependencies);
      eventBus.emit('module:registered', { name, dependencies });
    }

    get(name) {
      const entry = this._modules.get(name);
      return entry ? entry.instance : null;
    }

    async init(name) {
      const entry = this._modules.get(name);
      if (!entry) throw new Error(`Module "${name}" not found`);
      if (entry.initialized) return entry.instance;

      for (const dep of entry.dependencies) {
        if (!this._modules.has(dep)) {
          throw new Error(`Dependency "${dep}" for module "${name}" not found`);
        }
        await this.init(dep);
      }

      if (typeof entry.instance.init === 'function') {
        await entry.instance.init(this);
      }
      entry.initialized = true;
      this._initOrder.push(name);
      eventBus.emit('module:initialized', { name });
      return entry.instance;
    }

    async initAll() {
      const resolved = this._topologicalSort();
      for (const name of resolved) {
        await this.init(name);
      }
      eventBus.emit('engine:all-modules-ready', { count: resolved.length });
    }

    _topologicalSort() {
      const visited = new Set();
      const result = [];
      const visit = (name, stack) => {
        if (stack.has(name)) throw new Error(`Circular dependency detected: ${name}`);
        if (visited.has(name)) return;
        stack.add(name);
        const deps = this._dependencyGraph.get(name) || [];
        for (const dep of deps) visit(dep, stack);
        stack.delete(name);
        visited.add(name);
        result.push(name);
      };
      for (const name of this._modules.keys()) visit(name, new Set());
      return result;
    }

    getDependencyGraph() {
      const graph = {};
      for (const [name, deps] of this._dependencyGraph) {
        graph[name] = deps.slice();
      }
      return graph;
    }

    getInitOrder() { return this._initOrder.slice(); }
    isInitialized(name) { return this._modules.get(name)?.initialized || false; }
    listModules() { return Array.from(this._modules.keys()); }
  }

  const moduleManager = new ModuleManager();

  // ============================================================
  // 配置管理器
  // ============================================================
  class ConfigManager {
    constructor() {
      this._config = {};
      this._defaults = {};
      this._watchers = new Map();
    }

    setDefault(key, value) {
      this._defaults[key] = value;
      if (!(key in this._config)) this._config[key] = value;
    }

    set(key, value) {
      const old = this._config[key];
      this._config[key] = value;
      eventBus.emit('config:changed', { key, oldValue: old, newValue: value });
      if (this._watchers.has(key)) {
        for (const cb of this._watchers.get(key)) {
          try { cb(value, old); } catch (e) { console.error('[Config] Watcher error:', e); }
        }
      }
    }

    get(key, defaultValue) {
      if (key in this._config) return this._config[key];
      if (key in this._defaults) return this._defaults[key];
      return defaultValue;
    }

    has(key) { return key in this._config || key in this._defaults; }

    watch(key, callback) {
      if (!this._watchers.has(key)) this._watchers.set(key, []);
      this._watchers.get(key).push(callback);
    }

    batchSet(obj) {
      for (const [k, v] of Object.entries(obj)) this.set(k, v);
    }

    export() { return JSON.parse(JSON.stringify(this._config)); }
    import(data) { for (const [k, v] of Object.entries(data)) this.set(k, v); }
    reset() { this._config = JSON.parse(JSON.stringify(this._defaults)); }
  }

  const config = new ConfigManager();

  // ============================================================
  // 性能监控器
  // ============================================================
  class PerformanceMonitor {
    constructor() {
      this._frames = [];
      this._maxFrames = 120;
      this._lastTime = 0;
      this._fps = 0;
      this._frameTime = 0;
      this._counters = new Map();
      this._timers = new Map();
    }

    beginFrame() {
      this._lastTime = performance.now();
    }

    endFrame() {
      const now = performance.now();
      const dt = now - this._lastTime;
      this._frameTime = dt;
      this._frames.push(dt);
      if (this._frames.length > this._maxFrames) this._frames.shift();
      const avg = this._frames.reduce((a, b) => a + b, 0) / this._frames.length;
      this._fps = avg > 0 ? 1000 / avg : 0;
      _state.performance.fps = this._fps;
      _state.performance.frameTime = this._frameTime;
    }

    counter(name, value) {
      this._counters.set(name, value);
      if (name === 'drawCalls') _state.performance.drawCalls = value;
      if (name === 'triangles') _state.performance.triangles = value;
    }

    increment(name, amount = 1) {
      this._counters.set(name, (this._counters.get(name) || 0) + amount);
    }

    time(name, fn) {
      const start = performance.now();
      const result = fn();
      this._timers.set(name, performance.now() - start);
      return result;
    }

    async timeAsync(name, fn) {
      const start = performance.now();
      const result = await fn();
      this._timers.set(name, performance.now() - start);
      return result;
    }

    getStats() {
      return {
        fps: Math.round(this._fps * 100) / 100,
        frameTime: Math.round(this._frameTime * 100) / 100,
        avgFrameTime: Math.round(this._frames.reduce((a, b) => a + b, 0) / (this._frames.length || 1) * 100) / 100,
        counters: Object.fromEntries(this._counters),
        timers: Object.fromEntries(this._timers)
      };
    }

    reset() {
      this._frames.length = 0;
      this._counters.clear();
      this._timers.clear();
    }
  }

  const perfMonitor = new PerformanceMonitor();

  // ============================================================
  // 资源管理器 - 统一加载与缓存
  // ============================================================
  class ResourceManager {
    constructor() {
      this._cache = new Map();
      this._loaders = new Map();
      this._loading = new Map();
      this._maxCacheSize = 512 * 1024 * 1024;
      this._cacheSize = 0;
    }

    registerLoader(type, loader) {
      this._loaders.set(type, loader);
    }

    async load(url, type, options = {}) {
      const cacheKey = `${type}:${url}`;
      if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
      if (this._loading.has(cacheKey)) return this._loading.get(cacheKey);

      const loader = this._loaders.get(type);
      if (!loader) throw new Error(`No loader for type: ${type}`);

      const promise = loader(url, options).then(resource => {
        const size = this._estimateSize(resource);
        if (this._cacheSize + size > this._maxCacheSize) this._evict(size);
        this._cache.set(cacheKey, resource);
        this._cacheSize += size;
        this._loading.delete(cacheKey);
        eventBus.emit('resource:loaded', { url, type, size });
        return resource;
      }).catch(err => {
        this._loading.delete(cacheKey);
        eventBus.emit('resource:error', { url, type, error: err.message });
        throw err;
      });

      this._loading.set(cacheKey, promise);
      return promise;
    }

    _estimateSize(resource) {
      if (resource instanceof ArrayBuffer) return resource.byteLength;
      if (resource instanceof WebGLTexture) return 1024 * 1024;
      if (typeof resource === 'string') return resource.length * 2;
      if (resource && resource.vertices) return resource.vertices.byteLength || 65536;
      return 65536;
    }

    _evict(needed) {
      const entries = Array.from(this._cache.entries());
      entries.sort((a, b) => (a[1]._lastAccess || 0) - (b[1]._lastAccess || 0));
      for (const [key, resource] of entries) {
        const size = this._estimateSize(resource);
        this._cache.delete(key);
        this._cacheSize -= size;
        if (this._cacheSize + needed <= this._maxCacheSize) break;
      }
    }

    get(url, type) { return this._cache.get(`${type}:${url}`); }
    has(url, type) { return this._cache.has(`${type}:${url}`); }
    release(url, type) {
      const key = `${type}:${url}`;
      const resource = this._cache.get(key);
      if (resource) {
        this._cacheSize -= this._estimateSize(resource);
        this._cache.delete(key);
      }
    }
    clear() { this._cache.clear(); this._cacheSize = 0; }
    getCacheInfo() { return { count: this._cache.size, size: this._cacheSize, max: this._maxCacheSize }; }
  }

  const resourceManager = new ResourceManager();

  // ============================================================
  // 引擎主循环
  // ============================================================
  class EngineLoop {
    constructor() {
      this._running = false;
      this._paused = false;
      this._rafId = null;
      this._updateCallbacks = [];
      this._renderCallbacks = [];
      this._lastTime = 0;
      this._deltaTime = 0;
      this._fixedTimestep = 1 / 60;
      this._accumulator = 0;
    }

    onUpdate(callback, priority = 0) {
      this._updateCallbacks.push({ callback, priority });
      this._updateCallbacks.sort((a, b) => b.priority - a.priority);
    }

    onRender(callback, priority = 0) {
      this._renderCallbacks.push({ callback, priority });
      this._renderCallbacks.sort((a, b) => b.priority - a.priority);
    }

    start() {
      if (this._running) return;
      this._running = true;
      this._lastTime = performance.now();
      eventBus.emit('engine:loop-start');
      this._tick();
    }

    stop() {
      this._running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      eventBus.emit('engine:loop-stop');
    }

    pause() { this._paused = true; eventBus.emit('engine:paused'); }
    resume() { this._paused = false; this._lastTime = performance.now(); eventBus.emit('engine:resumed'); }

    _tick() {
      if (!this._running) return;
      this._rafId = requestAnimationFrame(() => this._tick());

      const now = performance.now();
      this._deltaTime = Math.min((now - this._lastTime) / 1000, 0.1);
      this._lastTime = now;

      if (this._paused) return;

      perfMonitor.beginFrame();

      // Fixed timestep update
      this._accumulator += this._deltaTime;
      while (this._accumulator >= this._fixedTimestep) {
        for (const { callback } of this._updateCallbacks) {
          try { callback(this._fixedTimestep); } catch (e) { console.error('[Loop] Update error:', e); }
        }
        this._accumulator -= this._fixedTimestep;
      }

      // Variable render
      for (const { callback } of this._renderCallbacks) {
        try { callback(this._deltaTime, this._accumulator / this._fixedTimestep); } catch (e) { console.error('[Loop] Render error:', e); }
      }

      perfMonitor.endFrame();
      eventBus.emit('engine:frame', { deltaTime: this._deltaTime, fps: perfMonitor._fps });
    }

    get deltaTime() { return this._deltaTime; }
    get isRunning() { return this._running; }
    get isPaused() { return this._paused; }
  }

  const engineLoop = new EngineLoop();

  // ============================================================
  // 场景图 - 节点层级管理
  // ============================================================
  class SceneNode {
    constructor(name = 'Node') {
      this.name = name;
      this.id = SceneNode._nextId++;
      this.parent = null;
      this.children = [];
      this.position = { x: 0, y: 0, z: 0 };
      this.rotation = { x: 0, y: 0, z: 0, w: 1 };
      this.scale = { x: 1, y: 1, z: 1 };
      this.visible = true;
      this.userData = {};
      this._worldMatrix = new Float32Array(16);
      this._localMatrix = new Float32Array(16);
      this._matrixDirty = true;
    }

    add(child) {
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
      child._matrixDirty = true;
      eventBus.emit('scene:child-added', { parent: this.name, child: child.name });
      return this;
    }

    remove(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        child.parent = null;
        eventBus.emit('scene:child-removed', { parent: this.name, child: child.name });
      }
      return this;
    }

    traverse(callback) {
      callback(this);
      for (const child of this.children) child.traverse(callback);
    }

    findByName(name) {
      if (this.name === name) return this;
      for (const child of this.children) {
        const found = child.findByName(name);
        if (found) return found;
      }
      return null;
    }

    setPosition(x, y, z) { this.position.x = x; this.position.y = y; this.position.z = z; this._matrixDirty = true; }
    setRotation(x, y, z, w) { this.rotation.x = x; this.rotation.y = y; this.rotation.z = z; this.rotation.w = w; this._matrixDirty = true; }
    setScale(x, y, z) { this.scale.x = x; this.scale.y = y; this.scale.z = z; this._matrixDirty = true; }

    getWorldMatrix() {
      if (this._matrixDirty) {
        this._computeLocalMatrix();
        if (this.parent) {
          const parentMatrix = this.parent.getWorldMatrix();
          this._multiplyMatrices(this._worldMatrix, parentMatrix, this._localMatrix);
        } else {
          this._worldMatrix.set(this._localMatrix);
        }
        this._matrixDirty = false;
      }
      return this._worldMatrix;
    }

    _computeLocalMatrix() {
      const m = this._localMatrix;
      const { x: px, y: py, z: pz } = this.position;
      const { x: rx, y: ry, z: rz, w: rw } = this.rotation;
      const { x: sx, y: sy, z: sz } = this.scale;
      const x2 = rx + rx, y2 = ry + ry, z2 = rz + rz;
      const xx = rx * x2, xy = rx * y2, xz = rx * z2;
      const yy = ry * y2, yz = ry * z2, zz = rz * z2;
      const wx = rw * x2, wy = rw * y2, wz = rw * z2;
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    }

    _multiplyMatrices(out, a, b) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          out[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j] + a[i * 4 + 3] * b[12 + j];
        }
      }
    }

    static _nextId = 1;
  }

  class SceneGraph {
    constructor() {
      this.root = new SceneNode('Root');
      this._activeCamera = null;
      this._nodes = new Map();
    }

    add(node) { this.root.add(node); this._nodes.set(node.id, node); return node; }
    remove(node) { this.root.remove(node); this._nodes.delete(node.id); }
    getNodeById(id) { return this._nodes.get(id); }
    findByName(name) { return this.root.findByName(name); }
    setActiveCamera(camera) { this._activeCamera = camera; }
    getActiveCamera() { return this._activeCamera; }
    traverse(callback) { this.root.traverse(callback); }
    getVisibleNodes() {
      const visible = [];
      this.root.traverse(node => { if (node.visible) visible.push(node); });
      return visible;
    }
  }

  const sceneGraph = new SceneGraph();

  // ============================================================
  // 引擎初始化与公开API
  // ============================================================
  async function init(userConfig = {}) {
    if (_state.initialized) {
      console.warn('[OrbEngine] Already initialized');
      return;
    }

    config.batchSet(userConfig);
    config.setDefault('debug', false);
    config.setDefault('antialias', true);
    config.setDefault('powerPreference', 'high-performance');
    config.setDefault('maxAnisotropy', 8);
    config.setDefault('shadowQuality', 'high');
    config.setDefault('textureQuality', 'high');
    config.setDefault('targetFPS', 60);

    _state.debug = config.get('debug');

    eventBus.emit('engine:init-start', { version: VERSION });
    await moduleManager.initAll();
    _state.initialized = true;
    eventBus.emit('engine:init-complete', { version: VERSION, modules: moduleManager.listModules() });
    console.log(`[${ENGINE_NAME}] v${VERSION} initialized successfully`);
  }

  function getModule(name) { return moduleManager.get(name); }
  function registerModule(name, module, dependencies) { moduleManager.register(name, module, dependencies); }
  function getConfig(key, def) { return config.get(key, def); }
  function setConfig(key, value) { config.set(key, value); }
  function on(event, cb) { return eventBus.on(event, cb); }
  function emit(event, data) { eventBus.emit(event, data); }
  function startLoop() { engineLoop.start(); }
  function stopLoop() { engineLoop.stop(); }
  function getPerformance() { return perfMonitor.getStats(); }
  function getVersion() { return VERSION; }
  function getDependencyGraph() { return moduleManager.getDependencyGraph(); }

  // 公开API
  return {
    init,
    getModule,
    registerModule,
    getConfig,
    setConfig,
    on,
    emit,
    startLoop,
    stopLoop,
    getPerformance,
    getVersion,
    getDependencyGraph,
    EventBus,
    ModuleManager,
    ConfigManager,
    PerformanceMonitor,
    ResourceManager,
    EngineLoop,
    SceneNode,
    SceneGraph,
    eventBus,
    moduleManager,
    config,
    perfMonitor,
    resourceManager,
    engineLoop,
    sceneGraph,
    VERSION
  };
})();

// 全局暴露
if (typeof window !== 'undefined') {
  window.OrbEngine = OrbEngine;
}
if (typeof globalThis !== 'undefined') {
  globalThis.OrbEngine = OrbEngine;
}

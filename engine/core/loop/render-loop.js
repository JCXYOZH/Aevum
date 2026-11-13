/**
 * 引擎核心 - 渲染循环/资源管线/场景管理/插件系统/实体组件系统
 * 纯JavaScript，零第三方依赖
 * @version 3.0.0
 */
'use strict';

const EngineCoreV3 = (function () {

  class RenderLoop {
    constructor() {
      this.running = false;
      this.paused = false;
      this.lastTime = 0;
      this.deltaTime = 0;
      this.elapsedTime = 0;
      this.frameCount = 0;
      this.fps = 0;
      this.fpsUpdateInterval = 500;
      this.lastFpsUpdate = 0;
      this.framesSinceLastUpdate = 0;
      this.updateCallbacks = [];
      this.renderCallbacks = [];
      this.postRenderCallbacks = [];
      this.maxDeltaTime = 1 / 30;
      this.timeScale = 1;
      this.animationFrameId = null;
      this.performanceMetrics = {
        updateTime: 0,
        renderTime: 0,
        totalTime: 0,
        frameTime: 0
      };
      this.eventBus = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.paused = false;
      this.lastTime = performance.now();
      this.lastFpsUpdate = this.lastTime;
      this._loop();
      this.eventBus.dispatchEvent(new CustomEvent('start'));
    }

    stop() {
      this.running = false;
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
      this.eventBus.dispatchEvent(new CustomEvent('stop'));
    }

    pause() {
      this.paused = true;
      this.eventBus.dispatchEvent(new CustomEvent('pause'));
    }

    resume() {
      this.paused = false;
      this.lastTime = performance.now();
      this.eventBus.dispatchEvent(new CustomEvent('resume'));
    }

    _loop() {
      if (!this.running) return;
      this.animationFrameId = requestAnimationFrame(() => this._loop());
      const currentTime = performance.now();
      let delta = (currentTime - this.lastTime) / 1000;
      this.lastTime = currentTime;
      delta = Math.min(delta, this.maxDeltaTime);
      this.deltaTime = delta * this.timeScale;
      if (!this.paused) {
        this.elapsedTime += this.deltaTime;
        const updateStart = performance.now();
        this._executeCallbacks(this.updateCallbacks, this.deltaTime, this.elapsedTime);
        this.performanceMetrics.updateTime = performance.now() - updateStart;
        const renderStart = performance.now();
        this._executeCallbacks(this.renderCallbacks, this.deltaTime, this.elapsedTime);
        this.performanceMetrics.renderTime = performance.now() - renderStart;
        this._executeCallbacks(this.postRenderCallbacks, this.deltaTime, this.elapsedTime);
      }
      this.frameCount++;
      this.framesSinceLastUpdate++;
      if (currentTime - this.lastFpsUpdate >= this.fpsUpdateInterval) {
        this.fps = Math.round(this.framesSinceLastUpdate * 1000 / (currentTime - this.lastFpsUpdate));
        this.framesSinceLastUpdate = 0;
        this.lastFpsUpdate = currentTime;
      }
      this.performanceMetrics.totalTime = performance.now() - currentTime;
      this.performanceMetrics.frameTime = this.performanceMetrics.totalTime;
    }

    _executeCallbacks(callbacks, deltaTime, elapsedTime) {
      for (const callback of callbacks) {
        try {
          callback(deltaTime, elapsedTime);
        } catch (e) {
          console.error('Error in render loop callback:', e);
        }
      }
    }

    onUpdate(callback) {
      this.updateCallbacks.push(callback);
      return () => {
        const index = this.updateCallbacks.indexOf(callback);
        if (index !== -1) this.updateCallbacks.splice(index, 1);
      };
    }

    onRender(callback) {
      this.renderCallbacks.push(callback);
      return () => {
        const index = this.renderCallbacks.indexOf(callback);
        if (index !== -1) this.renderCallbacks.splice(index, 1);
      };
    }

    onPostRender(callback) {
      this.postRenderCallbacks.push(callback);
      return () => {
        const index = this.postRenderCallbacks.indexOf(callback);
        if (index !== -1) this.postRenderCallbacks.splice(index, 1);
      };
    }

    getDeltaTime() { return this.deltaTime; }
    getElapsedTime() { return this.elapsedTime; }
    getFrameCount() { return this.frameCount; }
    getFps() { return this.fps; }
    isRunning() { return this.running; }
    isPaused() { return this.paused; }
    setTimeScale(scale) { this.timeScale = Math.max(0, scale); }
    getTimeScale() { return this.timeScale; }
    setMaxDeltaTime(max) { this.maxDeltaTime = max; }
    getPerformanceMetrics() { return { ...this.performanceMetrics }; }
    reset() {
      this.elapsedTime = 0;
      this.frameCount = 0;
      this.fps = 0;
    }
    dispose() {
      this.stop();
      this.updateCallbacks = [];
      this.renderCallbacks = [];
      this.postRenderCallbacks = [];
    }
  }

  class ResourcePipeline {
    constructor() {
      this.resources = new Map();
      this.loaders = new Map();
      this.loadingQueue = [];
      this.processingQueue = [];
      this.maxConcurrentLoads = 4;
      this.currentLoads = 0;
      this.cacheEnabled = true;
      this.cacheSize = 100;
      this.events = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this.stats = {
        totalLoaded: 0,
        totalFailed: 0,
        totalBytes: 0,
        loadTime: 0
      };
      this._initDefaultLoaders();
    }

    _initDefaultLoaders() {
      this.addLoader('texture', this._loadTexture.bind(this));
      this.addLoader('model', this._loadModel.bind(this));
      this.addLoader('json', this._loadJSON.bind(this));
      this.addLoader('text', this._loadText.bind(this));
      this.addLoader('binary', this._loadBinary.bind(this));
      this.addLoader('audio', this._loadAudio.bind(this));
      this.addLoader('shader', this._loadShader.bind(this));
    }

    addLoader(type, loader) {
      this.loaders.set(type, loader);
    }

    removeLoader(type) {
      this.loaders.delete(type);
    }

    async load(url, type, options = {}) {
      const cacheKey = `${type}:${url}`;
      if (this.cacheEnabled && this.resources.has(cacheKey)) {
        const cached = this.resources.get(cacheKey);
        cached.lastAccessTime = Date.now();
        cached.accessCount++;
        return cached.data;
      }
      const loader = this.loaders.get(type);
      if (!loader) {
        throw new Error(`No loader found for type: ${type}`);
      }
      const startTime = performance.now();
      try {
        const data = await loader(url, options);
        const loadTime = performance.now() - startTime;
        const resource = {
          url,
          type,
          data,
          createdAt: Date.now(),
          lastAccessTime: Date.now(),
          accessCount: 1,
          loadTime,
          size: this._estimateSize(data)
        };
        if (this.cacheEnabled) {
          this.resources.set(cacheKey, resource);
          this._evictIfNeeded();
        }
        this.stats.totalLoaded++;
        this.stats.totalBytes += resource.size;
        this.stats.loadTime += loadTime;
        this.events.dispatchEvent(new CustomEvent('load', { detail: { url, type, loadTime } }));
        return data;
      } catch (error) {
        this.stats.totalFailed++;
        this.events.dispatchEvent(new CustomEvent('error', { detail: { url, type, error } }));
        throw error;
      }
    }

    async loadBatch(resources, onProgress) {
      const results = {};
      const errors = {};
      let completed = 0;
      const total = resources.length;
      const promises = resources.map(async (resource) => {
        try {
          const data = await this.load(resource.url, resource.type, resource.options);
          results[resource.url] = data;
        } catch (error) {
          errors[resource.url] = error;
        } finally {
          completed++;
          if (onProgress) {
            onProgress(completed, total, results, errors);
          }
        }
      });
      await Promise.all(promises);
      return { results, errors };
    }

    getResource(url, type) {
      const cacheKey = `${type}:${url}`;
      const resource = this.resources.get(cacheKey);
      if (resource) {
        resource.lastAccessTime = Date.now();
        resource.accessCount++;
        return resource.data;
      }
      return null;
    }

    hasResource(url, type) {
      return this.resources.has(`${type}:${url}`);
    }

    unload(url, type) {
      const cacheKey = `${type}:${url}`;
      const resource = this.resources.get(cacheKey);
      if (resource) {
        this._disposeResource(resource);
        this.resources.delete(cacheKey);
      }
    }

    _disposeResource(resource) {
      if (resource.data && typeof resource.data.dispose === 'function') {
        resource.data.dispose();
      }
    }

    _evictIfNeeded() {
      if (this.resources.size <= this.cacheSize) return;
      const entries = Array.from(this.resources.entries());
      entries.sort((a, b) => a[1].lastAccessTime - b[1].lastAccessTime);
      const toRemove = entries.slice(0, this.resources.size - this.cacheSize);
      for (const [key, resource] of toRemove) {
        this._disposeResource(resource);
        this.resources.delete(key);
      }
    }

    _estimateSize(data) {
      if (data instanceof ArrayBuffer) return data.byteLength;
      if (data instanceof Float32Array || data instanceof Uint32Array || data instanceof Uint8Array) return data.byteLength;
      if (typeof data === 'string') return data.length * 2;
      if (typeof data === 'object') return JSON.stringify(data).length * 2;
      return 0;
    }

    async _loadTexture(url, options) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
        image.src = url;
      });
    }

    async _loadModel(url, options) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load model: ${url}`);
      const buffer = await response.arrayBuffer();
      return { buffer, format: options.format || 'auto' };
    }

    async _loadJSON(url, options) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load JSON: ${url}`);
      return response.json();
    }

    async _loadText(url, options) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load text: ${url}`);
      return response.text();
    }

    async _loadBinary(url, options) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load binary: ${url}`);
      return response.arrayBuffer();
    }

    async _loadAudio(url, options) {
      return new Promise((resolve, reject) => {
        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.oncanplaythrough = () => resolve(audio);
        audio.onerror = () => reject(new Error(`Failed to load audio: ${url}`));
        audio.src = url;
      });
    }

    async _loadShader(url, options) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to load shader: ${url}`);
      return response.text();
    }

    getStats() { return { ...this.stats, cachedResources: this.resources.size }; }
    getResourceCount() { return this.resources.size; }
    getLoaderTypes() { return Array.from(this.loaders.keys()); }
    setCacheEnabled(enabled) { this.cacheEnabled = enabled; }
    setCacheSize(size) { this.cacheSize = size; }
    clearCache() {
      for (const [key, resource] of this.resources) {
        this._disposeResource(resource);
      }
      this.resources.clear();
    }
    dispose() {
      this.clearCache();
      this.loaders.clear();
    }
  }

  class SceneManager {
    constructor() {
      this.scenes = new Map();
      this.currentScene = null;
      this.activeCamera = null;
      this.activeLights = [];
      this.rootNode = null;
      this.eventBus = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this._initRootNode();
    }

    _initRootNode() {
      this.rootNode = this.createNode('root');
    }

    createNode(name, parent = null) {
      const node = {
        id: this._generateId(),
        name,
        parent: parent || this.rootNode,
        children: [],
        components: new Map(),
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        localMatrix: new Float32Array(16),
        worldMatrix: new Float32Array(16),
        visible: true,
        enabled: true,
        tags: new Set(),
        layers: 0,
        userData: {}
      };
      this._computeLocalMatrix(node);
      if (node.parent) {
        node.parent.children.push(node);
      }
      return node;
    }

    removeNode(node) {
      if (!node) return;
      if (node.parent) {
        const index = node.parent.children.indexOf(node);
        if (index !== -1) node.parent.children.splice(index, 1);
      }
      for (const child of [...node.children]) {
        this.removeNode(child);
      }
      for (const [type, component] of node.components) {
        if (typeof component.dispose === 'function') component.dispose();
      }
      node.components.clear();
    }

    findNode(name) {
      return this._findNodeRecursive(this.rootNode, name);
    }

    _findNodeRecursive(node, name) {
      if (node.name === name) return node;
      for (const child of node.children) {
        const found = this._findNodeRecursive(child, name);
        if (found) return found;
      }
      return null;
    }

    findNodesByTag(tag) {
      const results = [];
      this._findNodesByTagRecursive(this.rootNode, tag, results);
      return results;
    }

    _findNodesByTagRecursive(node, tag, results) {
      if (node.tags.has(tag)) results.push(node);
      for (const child of node.children) {
        this._findNodesByTagRecursive(child, tag, results);
      }
    }

    addComponent(node, type, component) {
      node.components.set(type, component);
      component.node = node;
      if (typeof component.onAdd === 'function') {
        component.onAdd(node);
      }
      return component;
    }

    getComponent(node, type) {
      return node.components.get(type);
    }

    removeComponent(node, type) {
      const component = node.components.get(type);
      if (component) {
        if (typeof component.onRemove === 'function') {
          component.onRemove(node);
        }
        if (typeof component.dispose === 'function') {
          component.dispose();
        }
        node.components.delete(type);
      }
    }

    setNodePosition(node, x, y, z) {
      node.position = [x, y, z];
      this._computeLocalMatrix(node);
      this._updateWorldMatrix(node);
    }

    setNodeRotation(node, x, y, z, w) {
      node.rotation = [x, y, z, w];
      this._computeLocalMatrix(node);
      this._updateWorldMatrix(node);
    }

    setNodeScale(node, x, y, z) {
      node.scale = [x, y, z];
      this._computeLocalMatrix(node);
      this._updateWorldMatrix(node);
    }

    _computeLocalMatrix(node) {
      const m = node.localMatrix;
      const x = node.rotation[0], y = node.rotation[1], z = node.rotation[2], w = node.rotation[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const sx = node.scale[0], sy = node.scale[1], sz = node.scale[2];
      m[0] = (1 - (yy + zz)) * sx; m[1] = (xy + wz) * sx; m[2] = (xz - wy) * sx; m[3] = 0;
      m[4] = (xy - wz) * sy; m[5] = (1 - (xx + zz)) * sy; m[6] = (yz + wx) * sy; m[7] = 0;
      m[8] = (xz + wy) * sz; m[9] = (yz - wx) * sz; m[10] = (1 - (xx + yy)) * sz; m[11] = 0;
      m[12] = node.position[0]; m[13] = node.position[1]; m[14] = node.position[2]; m[15] = 1;
    }

    _updateWorldMatrix(node) {
      const updateRecursive = (n, parentMatrix) => {
        if (parentMatrix) {
          n.worldMatrix.set(this._multiplyMatrices(parentMatrix, n.localMatrix));
        } else {
          n.worldMatrix.set(n.localMatrix);
        }
        for (const child of n.children) {
          updateRecursive(child, n.worldMatrix);
        }
      };
      updateRecursive(node, node.parent ? node.parent.worldMatrix : null);
    }

    _multiplyMatrices(a, b) {
      const result = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          result[i*4+j] = a[i*4]*b[j] + a[i*4+1]*b[4+j] + a[i*4+2]*b[8+j] + a[i*4+3]*b[12+j];
        }
      }
      return result;
    }

    createScene(name) {
      const scene = {
        name,
        rootNode: this.createNode(`${name}_root`),
        cameras: [],
        lights: [],
        fog: null,
        background: [0.1, 0.1, 0.1, 1],
        userData: {}
      };
      this.scenes.set(name, scene);
      return scene;
    }

    loadScene(name) {
      const scene = this.scenes.get(name);
      if (!scene) return false;
      this.currentScene = scene;
      this.rootNode = scene.rootNode;
      this.activeCamera = scene.cameras[0] || null;
      this.activeLights = [...scene.lights];
      this.eventBus.dispatchEvent(new CustomEvent('sceneLoad', { detail: { name } }));
      return true;
    }

    getCurrentScene() { return this.currentScene; }
    getSceneNames() { return Array.from(this.scenes.keys()); }
    getSceneCount() { return this.scenes.size; }
    removeScene(name) {
      const scene = this.scenes.get(name);
      if (scene) {
        this.removeNode(scene.rootNode);
        this.scenes.delete(name);
        if (this.currentScene?.name === name) {
          this.currentScene = null;
        }
      }
    }
    setActiveCamera(camera) { this.activeCamera = camera; }
    getActiveCamera() { return this.activeCamera; }
    addLight(scene, light) {
      if (scene.lights.indexOf(light) === -1) {
        scene.lights.push(light);
      }
    }
    removeLight(scene, light) {
      const index = scene.lights.indexOf(light);
      if (index !== -1) scene.lights.splice(index, 1);
    }
    getNodeCount() {
      let count = 0;
      const countRecursive = (node) => {
        count++;
        for (const child of node.children) countRecursive(child);
      };
      countRecursive(this.rootNode);
      return count;
    }
    clear() {
      this.scenes.clear();
      this.currentScene = null;
      this.activeCamera = null;
      this.activeLights = [];
      this._initRootNode();
    }
    _generateId() {
      return 'node_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
    }
  }

  class PluginSystem {
    constructor() {
      this.plugins = new Map();
      this.enabledPlugins = new Set();
      this.hooks = new Map();
      this.dependencies = new Map();
      this.events = new (typeof EventTarget !== 'undefined' ? EventTarget : class { addEventListener(){} removeEventListener(){} dispatchEvent(){return true;} })();
      this._initDefaultHooks();
    }

    _initDefaultHooks() {
      const hookTypes = [
        'beforeInit', 'afterInit',
        'beforeUpdate', 'afterUpdate',
        'beforeRender', 'afterRender',
        'beforeDestroy', 'afterDestroy',
        'onSceneLoad', 'onSceneUnload',
        'onResourceLoad', 'onResourceUnload',
        'onError', 'onResize'
      ];
      for (const hook of hookTypes) {
        this.hooks.set(hook, []);
      }
    }

    registerPlugin(plugin) {
      if (!plugin.name) {
        throw new Error('Plugin must have a name');
      }
      if (this.plugins.has(plugin.name)) {
        console.warn(`Plugin already registered: ${plugin.name}`);
        return false;
      }
      this.plugins.set(plugin.name, {
        ...plugin,
        registeredAt: Date.now(),
        initialized: false,
        enabled: false
      });
      if (plugin.dependencies) {
        this.dependencies.set(plugin.name, plugin.dependencies);
      }
      this.events.dispatchEvent(new CustomEvent('pluginRegister', { detail: { name: plugin.name } }));
      return true;
    }

    unregisterPlugin(name) {
      const plugin = this.plugins.get(name);
      if (!plugin) return false;
      if (plugin.enabled) {
        this.disablePlugin(name);
      }
      this.plugins.delete(name);
      this.dependencies.delete(name);
      this.events.dispatchEvent(new CustomEvent('pluginUnregister', { detail: { name } }));
      return true;
    }

    async enablePlugin(name) {
      const plugin = this.plugins.get(name);
      if (!plugin) {
        throw new Error(`Plugin not found: ${name}`);
      }
      if (plugin.enabled) return true;
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.plugins.has(dep)) {
            throw new Error(`Plugin dependency not found: ${dep} (required by ${name})`);
          }
          if (!this.plugins.get(dep).enabled) {
            await this.enablePlugin(dep);
          }
        }
      }
      try {
        if (typeof plugin.init === 'function') {
          await plugin.init(this);
        }
        plugin.initialized = true;
        plugin.enabled = true;
        this.enabledPlugins.add(name);
        if (plugin.hooks) {
          for (const [hook, callback] of Object.entries(plugin.hooks)) {
            this.registerHook(hook, callback.bind(plugin));
          }
        }
        this.events.dispatchEvent(new CustomEvent('pluginEnable', { detail: { name } }));
        return true;
      } catch (error) {
        console.error(`Failed to initialize plugin ${name}:`, error);
        plugin.initialized = false;
        plugin.enabled = false;
        throw error;
      }
    }

    disablePlugin(name) {
      const plugin = this.plugins.get(name);
      if (!plugin || !plugin.enabled) return false;
      try {
        if (typeof plugin.destroy === 'function') {
          plugin.destroy(this);
        }
        if (plugin.hooks) {
          for (const [hook, callback] of Object.entries(plugin.hooks)) {
            this.unregisterHook(hook, callback);
          }
        }
        plugin.enabled = false;
        this.enabledPlugins.delete(name);
        this.events.dispatchEvent(new CustomEvent('pluginDisable', { detail: { name } }));
        return true;
      } catch (error) {
        console.error(`Failed to destroy plugin ${name}:`, error);
        return false;
      }
    }

    registerHook(hook, callback) {
      if (!this.hooks.has(hook)) {
        this.hooks.set(hook, []);
      }
      this.hooks.get(hook).push(callback);
      return () => this.unregisterHook(hook, callback);
    }

    unregisterHook(hook, callback) {
      const callbacks = this.hooks.get(hook);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index !== -1) callbacks.splice(index, 1);
      }
    }

    async triggerHook(hook, data) {
      const callbacks = this.hooks.get(hook);
      if (!callbacks) return data;
      let result = data;
      for (const callback of callbacks) {
        try {
          result = await callback(result);
        } catch (error) {
          console.error(`Error in hook ${hook}:`, error);
        }
      }
      return result;
    }

    getPlugin(name) {
      return this.plugins.get(name);
    }

    getPluginNames() {
      return Array.from(this.plugins.keys());
    }

    getEnabledPlugins() {
      return Array.from(this.enabledPlugins);
    }

    getPluginCount() {
      return this.plugins.size;
    }

    isPluginEnabled(name) {
      return this.enabledPlugins.has(name);
    }

    getHooks() {
      return Array.from(this.hooks.keys());
    }

    getHookCallbacks(hook) {
      return this.hooks.get(hook) || [];
    }

    async enableAll() {
      for (const name of this.plugins.keys()) {
        if (!this.isPluginEnabled(name)) {
          await this.enablePlugin(name);
        }
      }
    }

    disableAll() {
      for (const name of Array.from(this.enabledPlugins)) {
        this.disablePlugin(name);
      }
    }

    clear() {
      this.disableAll();
      this.plugins.clear();
      this.enabledPlugins.clear();
      this.dependencies.clear();
      for (const callbacks of this.hooks.values()) {
        callbacks.length = 0;
      }
    }
  }

  return {
    RenderLoop, ResourcePipeline, SceneManager, PluginSystem
  };
})();

if (typeof window !== 'undefined') window.EngineCoreV3 = EngineCoreV3;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreV3 = EngineCoreV3;

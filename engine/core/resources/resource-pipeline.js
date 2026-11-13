/**
 * 引擎核心 - 资源管线/场景管理/插件系统/ECS扩展/实体组件系统
 * 纯JavaScript，零第三方依赖
 * @version 5.0.0
 */
'use strict';

const EngineCoreV5 = (function () {

  class ResourcePipeline {
    constructor() {
      this.loaders = new Map();
      this.cache = new Map();
      this.queue = [];
      this.processing = false;
      this.maxConcurrent = 4;
      this.activeCount = 0;
      this.stats = { loaded: 0, failed: 0, cached: 0, totalSize: 0 };
      this.callbacks = new Map();
      this.preloadList = [];
    }

    registerLoader(type, loader) {
      this.loaders.set(type, loader);
    }

    unregisterLoader(type) {
      this.loaders.delete(type);
    }

    async load(url, type, options = {}) {
      const cacheKey = `${type}:${url}`;
      if (this.cache.has(cacheKey) && !options.forceReload) {
        this.stats.cached++;
        return this.cache.get(cacheKey);
      }
      const loader = this.loaders.get(type);
      if (!loader) {
        throw new Error(`No loader registered for type: ${type}`);
      }
      try {
        const resource = await loader.load(url, options);
        this.cache.set(cacheKey, resource);
        this.stats.loaded++;
        this.stats.totalSize += resource.size || 0;
        const callback = this.callbacks.get('load');
        if (callback) callback(resource);
        return resource;
      } catch (error) {
        this.stats.failed++;
        const errorCallback = this.callbacks.get('error');
        if (errorCallback) errorCallback(error, url);
        throw error;
      }
    }

    loadBatch(resources, onProgress) {
      return new Promise((resolve, reject) => {
        const results = new Map();
        let completed = 0;
        let failed = 0;
        const total = resources.length;
        const processNext = async () => {
          while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const item = this.queue.shift();
            this.activeCount++;
            try {
              const resource = await this.load(item.url, item.type, item.options);
              results.set(item.url, resource);
              completed++;
            } catch (error) {
              results.set(item.url, { error });
              failed++;
            }
            this.activeCount--;
            if (onProgress) onProgress(completed + failed, total, completed, failed);
            if (completed + failed >= total) {
              resolve({ results, completed, failed, total });
              return;
            }
          }
          if (this.queue.length > 0) {
            setTimeout(processNext, 10);
          }
        };
        for (const resource of resources) {
          this.queue.push(resource);
        }
        processNext();
      });
    }

    preload(resources) {
      this.preloadList = [...resources];
      return this.loadBatch(resources);
    }

    get(url, type) {
      const cacheKey = `${type}:${url}`;
      return this.cache.get(cacheKey);
    }

    has(url, type) {
      const cacheKey = `${type}:${url}`;
      return this.cache.has(cacheKey);
    }

    remove(url, type) {
      const cacheKey = `${type}:${url}`;
      const resource = this.cache.get(cacheKey);
      if (resource) {
        if (resource.dispose) resource.dispose();
        this.cache.delete(cacheKey);
      }
    }

    clearCache() {
      for (const resource of this.cache.values()) {
        if (resource.dispose) resource.dispose();
      }
      this.cache.clear();
    }

    getStats() {
      return {
        ...this.stats,
        cachedCount: this.cache.size,
        queueLength: this.queue.length,
        activeCount: this.activeCount
      };
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    setMaxConcurrent(count) {
      this.maxConcurrent = Math.max(1, count);
    }

    getLoaderTypes() {
      return Array.from(this.loaders.keys());
    }

    getCachedResources() {
      return Array.from(this.cache.entries()).map(([key, resource]) => ({
        key,
        type: key.split(':')[0],
        url: key.split(':').slice(1).join(':'),
        size: resource.size || 0
      }));
    }

    dispose() {
      this.clearCache();
      this.queue = [];
      this.loaders.clear();
      this.callbacks.clear();
    }
  }

  class SceneManager {
    constructor() {
      this.scenes = new Map();
      this.currentScene = null;
      this.activeSceneName = null;
      this.transitioning = false;
      this.callbacks = new Map();
      this.sceneStack = [];
    }

    createScene(name, config = {}) {
      const scene = {
        name,
        entities: new Map(),
        systems: new Map(),
        cameras: new Map(),
        lights: new Map(),
        activeCamera: null,
        environment: config.environment || {
          background: [0.1, 0.1, 0.1, 1],
          ambient: [0.2, 0.2, 0.2],
          fog: { enabled: false, color: [0.5, 0.5, 0.5], density: 0.01 }
        },
        physics: config.physics || { enabled: false, gravity: [0, -9.8, 0] },
        metadata: config.metadata || {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.scenes.set(name, scene);
      return scene;
    }

    removeScene(name) {
      if (this.activeSceneName === name) {
        this.deactivateScene();
      }
      this.scenes.delete(name);
      this.sceneStack = this.sceneStack.filter(s => s !== name);
    }

    getScene(name) {
      return this.scenes.get(name);
    }

    getCurrentScene() {
      return this.currentScene;
    }

    activateScene(name) {
      if (this.transitioning) return false;
      const scene = this.scenes.get(name);
      if (!scene) return false;
      if (this.currentScene) {
        this._deactivateSceneInternal(this.currentScene);
      }
      this.currentScene = scene;
      this.activeSceneName = name;
      this._activateSceneInternal(scene);
      const callback = this.callbacks.get('sceneChange');
      if (callback) callback(name, scene);
      return true;
    }

    _activateSceneInternal(scene) {
      for (const system of scene.systems.values()) {
        if (system.onActivate) system.onActivate(scene);
      }
    }

    _deactivateSceneInternal(scene) {
      for (const system of scene.systems.values()) {
        if (system.onDeactivate) system.onDeactivate(scene);
      }
    }

    deactivateScene() {
      if (this.currentScene) {
        this._deactivateSceneInternal(this.currentScene);
        this.currentScene = null;
        this.activeSceneName = null;
      }
    }

    pushScene(name) {
      if (this.activeSceneName) {
        this.sceneStack.push(this.activeSceneName);
      }
      return this.activateScene(name);
    }

    popScene() {
      if (this.sceneStack.length > 0) {
        const previous = this.sceneStack.pop();
        return this.activateScene(previous);
      }
      return false;
    }

    addEntity(sceneName, entity) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      scene.entities.set(entity.id, entity);
      return true;
    }

    removeEntity(sceneName, entityId) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      return scene.entities.delete(entityId);
    }

    getEntity(sceneName, entityId) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return null;
      return scene.entities.get(entityId);
    }

    addSystem(sceneName, name, system) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      scene.systems.set(name, system);
      return true;
    }

    removeSystem(sceneName, name) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      return scene.systems.delete(name);
    }

    addCamera(sceneName, name, camera) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      scene.cameras.set(name, camera);
      if (!scene.activeCamera) scene.activeCamera = name;
      return true;
    }

    setActiveCamera(sceneName, name) {
      const scene = this.scenes.get(sceneName);
      if (!scene || !scene.cameras.has(name)) return false;
      scene.activeCamera = name;
      return true;
    }

    addLight(sceneName, name, light) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      scene.lights.set(name, light);
      return true;
    }

    removeLight(sceneName, name) {
      const scene = this.scenes.get(sceneName);
      if (!scene) return false;
      return scene.lights.delete(name);
    }

    update(deltaTime) {
      if (!this.currentScene) return;
      const scene = this.currentScene;
      for (const system of scene.systems.values()) {
        if (system.update) system.update(scene, deltaTime);
      }
      scene.updatedAt = Date.now();
    }

    getSceneNames() {
      return Array.from(this.scenes.keys());
    }

    getSceneCount() {
      return this.scenes.size;
    }

    getActiveSceneName() {
      return this.activeSceneName;
    }

    getSceneStack() {
      return [...this.sceneStack];
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    clear() {
      this.deactivateScene();
      this.scenes.clear();
      this.sceneStack = [];
      this.callbacks.clear();
    }

    exportScene(name) {
      const scene = this.scenes.get(name);
      if (!scene) return null;
      const exportData = {
        name: scene.name,
        environment: scene.environment,
        physics: scene.physics,
        metadata: scene.metadata,
        entities: Array.from(scene.entities.entries()),
        cameras: Array.from(scene.cameras.entries()),
        lights: Array.from(scene.lights.entries())
      };
      return JSON.stringify(exportData, null, 2);
    }

    importScene(json) {
      try {
        const data = JSON.parse(json);
        const scene = this.createScene(data.name, {
          environment: data.environment,
          physics: data.physics,
          metadata: data.metadata
        });
        for (const [id, entity] of data.entities) {
          scene.entities.set(id, entity);
        }
        for (const [name, camera] of data.cameras) {
          scene.cameras.set(name, camera);
        }
        for (const [name, light] of data.lights) {
          scene.lights.set(name, light);
        }
        return scene;
      } catch (e) {
        console.error('Failed to import scene:', e);
        return null;
      }
    }
  }

  class PluginSystem {
    constructor() {
      this.plugins = new Map();
      this.enabled = new Set();
      this.hooks = new Map();
      this.dependencies = new Map();
      this.loadOrder = [];
      this.stats = { loaded: 0, enabled: 0, failed: 0 };
      this.callbacks = new Map();
    }

    register(plugin) {
      if (!plugin.name) {
        throw new Error('Plugin must have a name');
      }
      if (this.plugins.has(plugin.name)) {
        throw new Error(`Plugin already registered: ${plugin.name}`);
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
      this.stats.loaded++;
      const callback = this.callbacks.get('register');
      if (callback) callback(plugin.name);
      return true;
    }

    unregister(name) {
      if (this.enabled.has(name)) {
        this.disable(name);
      }
      this.plugins.delete(name);
      this.dependencies.delete(name);
      this.loadOrder = this.loadOrder.filter(n => n !== name);
    }

    async enable(name) {
      const plugin = this.plugins.get(name);
      if (!plugin) {
        throw new Error(`Plugin not found: ${name}`);
      }
      if (this.enabled.has(name)) return true;
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.enabled.has(dep)) {
            await this.enable(dep);
          }
        }
      }
      try {
        if (plugin.init && !plugin.initialized) {
          await plugin.init();
          plugin.initialized = true;
        }
        if (plugin.enable) {
          await plugin.enable();
        }
        plugin.enabled = true;
        this.enabled.add(name);
        this.loadOrder.push(name);
        this.stats.enabled++;
        const callback = this.callbacks.get('enable');
        if (callback) callback(name);
        return true;
      } catch (error) {
        this.stats.failed++;
        const errorCallback = this.callbacks.get('error');
        if (errorCallback) errorCallback(name, error);
        throw error;
      }
    }

    async disable(name) {
      const plugin = this.plugins.get(name);
      if (!plugin || !this.enabled.has(name)) return false;
      const dependents = this._getDependents(name);
      for (const dependent of dependents) {
        await this.disable(dependent);
      }
      try {
        if (plugin.disable) {
          await plugin.disable();
        }
        plugin.enabled = false;
        this.enabled.delete(name);
        this.loadOrder = this.loadOrder.filter(n => n !== name);
        this.stats.enabled--;
        const callback = this.callbacks.get('disable');
        if (callback) callback(name);
        return true;
      } catch (error) {
        const errorCallback = this.callbacks.get('error');
        if (errorCallback) errorCallback(name, error);
        throw error;
      }
    }

    _getDependents(name) {
      const dependents = [];
      for (const [pluginName, deps] of this.dependencies) {
        if (deps.includes(name) && this.enabled.has(pluginName)) {
          dependents.push(pluginName);
        }
      }
      return dependents;
    }

    registerHook(hookName, handler, priority = 0) {
      if (!this.hooks.has(hookName)) {
        this.hooks.set(hookName, []);
      }
      this.hooks.get(hookName).push({ handler, priority });
      this.hooks.get(hookName).sort((a, b) => b.priority - a.priority);
    }

    unregisterHook(hookName, handler) {
      const hooks = this.hooks.get(hookName);
      if (hooks) {
        const index = hooks.findIndex(h => h.handler === handler);
        if (index !== -1) hooks.splice(index, 1);
      }
    }

    async triggerHook(hookName, ...args) {
      const hooks = this.hooks.get(hookName);
      if (!hooks) return args;
      let result = args;
      for (const hook of hooks) {
        try {
          result = await hook.handler(...result);
          if (!Array.isArray(result)) result = [result];
        } catch (error) {
          console.error(`Hook error (${hookName}):`, error);
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
      return Array.from(this.enabled);
    }

    getDisabledPlugins() {
      return Array.from(this.plugins.keys()).filter(name => !this.enabled.has(name));
    }

    isEnabled(name) {
      return this.enabled.has(name);
    }

    getLoadOrder() {
      return [...this.loadOrder];
    }

    getStats() {
      return { ...this.stats };
    }

    getDependencies(name) {
      return this.dependencies.get(name) || [];
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    async enableAll() {
      for (const name of this.plugins.keys()) {
        if (!this.enabled.has(name)) {
          await this.enable(name);
        }
      }
    }

    async disableAll() {
      for (const name of [...this.enabled]) {
        await this.disable(name);
      }
    }

    clear() {
      this.disableAll();
      this.plugins.clear();
      this.enabled.clear();
      this.hooks.clear();
      this.dependencies.clear();
      this.loadOrder = [];
      this.callbacks.clear();
    }
  }

  class EntityComponentSystem {
    constructor() {
      this.entities = new Map();
      this.components = new Map();
      this.systems = new Map();
      this.queries = new Map();
      this.entityIdCounter = 0;
      this.componentIdCounter = 0;
      this.events = new Map();
      this.callbacks = new Map();
      this.stats = { entities: 0, components: 0, systems: 0, queries: 0 };
    }

    createEntity(name = '') {
      const id = ++this.entityIdCounter;
      const entity = {
        id,
        name: name || `Entity_${id}`,
        components: new Set(),
        active: true,
        tags: new Set(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.entities.set(id, entity);
      this.stats.entities++;
      return entity;
    }

    removeEntity(id) {
      const entity = this.entities.get(id);
      if (!entity) return false;
      for (const componentName of entity.components) {
        this._removeComponentInternal(id, componentName);
      }
      this.entities.delete(id);
      this.stats.entities--;
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

    registerComponent(name, schema = {}) {
      if (this.components.has(name)) {
        throw new Error(`Component already registered: ${name}`);
      }
      const component = {
        id: ++this.componentIdCounter,
        name,
        schema,
        instances: new Map(),
        defaultValue: this._createDefaultValue(schema)
      };
      this.components.set(name, component);
      return component;
    }

    _createDefaultValue(schema) {
      const defaultValue = {};
      for (const [key, config] of Object.entries(schema)) {
        if (config.default !== undefined) {
          defaultValue[key] = config.default;
        } else if (config.type === 'number') {
          defaultValue[key] = 0;
        } else if (config.type === 'boolean') {
          defaultValue[key] = false;
        } else if (config.type === 'string') {
          defaultValue[key] = '';
        } else if (config.type === 'array') {
          defaultValue[key] = [];
        } else if (config.type === 'object') {
          defaultValue[key] = {};
        } else {
          defaultValue[key] = null;
        }
      }
      return defaultValue;
    }

    addComponent(entityId, componentName, data = {}) {
      const entity = this.entities.get(entityId);
      const component = this.components.get(componentName);
      if (!entity || !component) return false;
      if (entity.components.has(componentName)) return false;
      const instance = {
        ...component.defaultValue,
        ...data,
        entityId,
        componentName,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      component.instances.set(entityId, instance);
      entity.components.add(componentName);
      this.stats.components++;
      this._invalidateQueries();
      return instance;
    }

    removeComponent(entityId, componentName) {
      return this._removeComponentInternal(entityId, componentName);
    }

    _removeComponentInternal(entityId, componentName) {
      const entity = this.entities.get(entityId);
      const component = this.components.get(componentName);
      if (!entity || !component) return false;
      if (!entity.components.has(componentName)) return false;
      component.instances.delete(entityId);
      entity.components.delete(componentName);
      this.stats.components--;
      this._invalidateQueries();
      return true;
    }

    getComponent(entityId, componentName) {
      const component = this.components.get(componentName);
      if (!component) return null;
      return component.instances.get(entityId);
    }

    hasComponent(entityId, componentName) {
      const entity = this.entities.get(entityId);
      return entity ? entity.components.has(componentName) : false;
    }

    updateComponent(entityId, componentName, updates) {
      const instance = this.getComponent(entityId, componentName);
      if (!instance) return false;
      Object.assign(instance, updates);
      instance.updatedAt = Date.now();
      return true;
    }

    registerSystem(name, system) {
      if (this.systems.has(name)) {
        throw new Error(`System already registered: ${name}`);
      }
      this.systems.set(name, {
        ...system,
        name,
        enabled: system.enabled !== false,
        registeredAt: Date.now()
      });
      this.stats.systems++;
      return true;
    }

    removeSystem(name) {
      this.systems.delete(name);
      this.stats.systems--;
    }

    getSystem(name) {
      return this.systems.get(name);
    }

    setSystemEnabled(name, enabled) {
      const system = this.systems.get(name);
      if (system) system.enabled = enabled;
    }

    createQuery(name, requiredComponents, optionalComponents = []) {
      const query = {
        name,
        requiredComponents,
        optionalComponents,
        results: [],
        dirty: true,
        createdAt: Date.now()
      };
      this.queries.set(name, query);
      this.stats.queries++;
      return query;
    }

    executeQuery(name) {
      const query = this.queries.get(name);
      if (!query) return [];
      if (!query.dirty) return query.results;
      query.results = [];
      for (const entity of this.entities.values()) {
        if (!entity.active) continue;
        let hasAll = true;
        for (const component of query.requiredComponents) {
          if (!entity.components.has(component)) {
            hasAll = false;
            break;
          }
        }
        if (hasAll) {
          const result = { entity };
          for (const component of query.requiredComponents) {
            result[component] = this.getComponent(entity.id, component);
          }
          for (const component of query.optionalComponents) {
            if (entity.components.has(component)) {
              result[component] = this.getComponent(entity.id, component);
            }
          }
          query.results.push(result);
        }
      }
      query.dirty = false;
      return query.results;
    }

    _invalidateQueries() {
      for (const query of this.queries.values()) {
        query.dirty = true;
      }
    }

    update(deltaTime) {
      for (const system of this.systems.values()) {
        if (!system.enabled) continue;
        if (system.update) {
          system.update(this, deltaTime);
        }
      }
      for (const entity of this.entities.values()) {
        entity.updatedAt = Date.now();
      }
    }

    getEntities() {
      return Array.from(this.entities.values());
    }

    getActiveEntities() {
      return Array.from(this.entities.values()).filter(e => e.active);
    }

    getComponentNames() {
      return Array.from(this.components.keys());
    }

    getSystemNames() {
      return Array.from(this.systems.keys());
    }

    getQueryNames() {
      return Array.from(this.queries.keys());
    }

    getStats() {
      return { ...this.stats };
    }

    setEntityActive(id, active) {
      const entity = this.entities.get(id);
      if (entity) {
        entity.active = active;
        this._invalidateQueries();
      }
    }

    addTag(entityId, tag) {
      const entity = this.entities.get(entityId);
      if (entity) entity.tags.add(tag);
    }

    removeTag(entityId, tag) {
      const entity = this.entities.get(entityId);
      if (entity) entity.tags.delete(tag);
    }

    hasTag(entityId, tag) {
      const entity = this.entities.get(entityId);
      return entity ? entity.tags.has(tag) : false;
    }

    getEntitiesByTag(tag) {
      return Array.from(this.entities.values()).filter(e => e.tags.has(tag));
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    clear() {
      this.entities.clear();
      this.components.clear();
      this.systems.clear();
      this.queries.clear();
      this.entityIdCounter = 0;
      this.componentIdCounter = 0;
      this.stats = { entities: 0, components: 0, systems: 0, queries: 0 };
    }
  }

  return {
    ResourcePipeline, SceneManager, PluginSystem, EntityComponentSystem
  };
})();

if (typeof window !== 'undefined') window.EngineCoreV5 = EngineCoreV5;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreV5 = EngineCoreV5;

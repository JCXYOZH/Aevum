/**
 * 模型加载注册表 - 统一格式分发/缓存/异步加载/进度回调
 * 纯JavaScript，零第三方依赖
 * @version 2.0.0
 */
'use strict';

const ModelLoaderRegistry = (function () {

  class ModelLoaderRegistry {
    constructor() {
      this.loaders = new Map();
      this.cache = new Map();
      this.loading = new Map();
      this.maxCacheSize = 50;
      this.cachePolicy = 'lru';
      this.basePath = '';
      this.crossOrigin = 'anonymous';
      this.requestTimeout = 30000;
      this.retryCount = 3;
      this.retryDelay = 1000;
      this.stats = { totalLoaded: 0, totalFailed: 0, cacheHits: 0, cacheMisses: 0, bytesLoaded: 0 };
      this.eventListeners = new Map();
      this._initDefaultLoaders();
    }

    _initDefaultLoaders() {
      this.registerLoader('pmx', {
        extensions: ['.pmx'],
        mimeTypes: ['application/octet-stream'],
        binary: true,
        load: async (url, options) => {
          const buffer = await this._fetchBinary(url, options);
          if (typeof PMXParser !== 'undefined') {
            const parser = new PMXParser();
            return parser.parse(buffer);
          }
          return { format: 'pmx', url, data: buffer };
        }
      });
      this.registerLoader('gltf', {
        extensions: ['.gltf'],
        mimeTypes: ['model/gltf+json'],
        binary: false,
        load: async (url, options) => {
          const text = await this._fetchText(url, options);
          return { format: 'gltf', url, data: JSON.parse(text) };
        }
      });
      this.registerLoader('glb', {
        extensions: ['.glb'],
        mimeTypes: ['model/gltf-binary'],
        binary: true,
        load: async (url, options) => {
          const buffer = await this._fetchBinary(url, options);
          return { format: 'glb', url, data: buffer };
        }
      });
      this.registerLoader('obj', {
        extensions: ['.obj'],
        mimeTypes: ['text/plain'],
        binary: false,
        load: async (url, options) => {
          const text = await this._fetchText(url, options);
          return this._parseOBJ(text, url);
        }
      });
      this.registerLoader('vmd', {
        extensions: ['.vmd'],
        mimeTypes: ['application/octet-stream'],
        binary: true,
        load: async (url, options) => {
          const buffer = await this._fetchBinary(url, options);
          return { format: 'vmd', url, data: buffer };
        }
      });
      this.registerLoader('fbx', {
        extensions: ['.fbx'],
        mimeTypes: ['application/octet-stream'],
        binary: true,
        load: async (url, options) => {
          const buffer = await this._fetchBinary(url, options);
          if (typeof FBXParser !== 'undefined') {
            const parser = new FBXParser();
            return parser.parse(buffer);
          }
          return { format: 'fbx', url, data: buffer };
        }
      });
      this.registerLoader('vrm', {
        extensions: ['.vrm'],
        mimeTypes: ['application/octet-stream'],
        binary: true,
        load: async (url, options) => {
          const buffer = await this._fetchBinary(url, options);
          if (typeof VRMParser !== 'undefined') {
            const parser = new VRMParser();
            return parser.parse(buffer);
          }
          return { format: 'vrm', url, data: buffer };
        }
      });
    }

    registerLoader(name, config) {
      this.loaders.set(name, {
        name,
        extensions: config.extensions || [],
        mimeTypes: config.mimeTypes || [],
        binary: config.binary !== false,
        load: config.load,
        parse: config.parse,
        enabled: true
      });
      this._emit('loaderRegistered', { name, config });
    }

    unregisterLoader(name) {
      this.loaders.delete(name);
      this._emit('loaderUnregistered', { name });
    }

    getLoader(name) {
      return this.loaders.get(name);
    }

    getLoaderForExtension(extension) {
      const ext = extension.toLowerCase();
      for (const [name, loader] of this.loaders) {
        if (loader.extensions.includes(ext)) return loader;
      }
      return null;
    }

    getLoaderForUrl(url) {
      const extension = this._getExtension(url);
      return this.getLoaderForExtension(extension);
    }

    async load(url, options = {}) {
      const fullUrl = this.basePath ? this.basePath + url : url;
      const cacheKey = options.cacheKey || fullUrl;
      if (options.useCache !== false && this.cache.has(cacheKey)) {
        this.stats.cacheHits++;
        this._emit('cacheHit', { url: fullUrl, cacheKey });
        return this.cache.get(cacheKey);
      }
      this.stats.cacheMisses++;
      if (this.loading.has(cacheKey)) {
        this._emit('alreadyLoading', { url: fullUrl });
        return this.loading.get(cacheKey);
      }
      const loader = options.loader ? this.loaders.get(options.loader) : this.getLoaderForUrl(fullUrl);
      if (!loader) {
        this.stats.totalFailed++;
        const error = new Error(`No loader found for URL: ${fullUrl}`);
        this._emit('error', { url: fullUrl, error });
        throw error;
      }
      if (!loader.enabled) {
        throw new Error(`Loader ${loader.name} is disabled`);
      }
      const loadPromise = this._loadWithRetry(fullUrl, loader, options);
      this.loading.set(cacheKey, loadPromise);
      this._emit('loadStart', { url: fullUrl, loader: loader.name });
      try {
        const result = await loadPromise;
        this.stats.totalLoaded++;
        if (options.useCache !== false) {
          this._addToCache(cacheKey, result);
        }
        this._emit('loadComplete', { url: fullUrl, result });
        return result;
      } catch (error) {
        this.stats.totalFailed++;
        this._emit('loadError', { url: fullUrl, error });
        throw error;
      } finally {
        this.loading.delete(cacheKey);
      }
    }

    async _loadWithRetry(url, loader, options) {
      let lastError = null;
      for (let attempt = 0; attempt <= this.retryCount; attempt++) {
        try {
          if (attempt > 0) {
            this._emit('retry', { url, attempt, delay: this.retryDelay });
            await this._delay(this.retryDelay * attempt);
          }
          return await loader.load(url, { ...options, attempt, registry: this });
        } catch (error) {
          lastError = error;
          if (error.status && error.status >= 400 && error.status < 500) {
            throw error;
          }
        }
      }
      throw lastError;
    }

    async loadBatch(urls, options = {}) {
      const results = [];
      const errors = [];
      const concurrency = options.concurrency || 4;
      const batches = [];
      for (let i = 0; i < urls.length; i += concurrency) {
        batches.push(urls.slice(i, i + concurrency));
      }
      let loaded = 0;
      for (const batch of batches) {
        const batchResults = await Promise.allSettled(batch.map(url => this.load(url, options)));
        for (let i = 0; i < batchResults.length; i++) {
          if (batchResults[i].status === 'fulfilled') {
            results.push({ url: batch[i], data: batchResults[i].value });
          } else {
            errors.push({ url: batch[i], error: batchResults[i].reason });
          }
          loaded++;
          this._emit('batchProgress', { loaded, total: urls.length, percentage: loaded / urls.length });
        }
      }
      return { results, errors, total: urls.length, successful: results.length, failed: errors.length };
    }

    async _fetchBinary(url, options = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout || this.requestTimeout);
      try {
        const response = await fetch(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: options.headers || {}
        });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.status = response.status;
          throw error;
        }
        const buffer = await response.arrayBuffer();
        this.stats.bytesLoaded += buffer.byteLength;
        return buffer;
      } finally {
        clearTimeout(timeout);
      }
    }

    async _fetchText(url, options = {}) {
      const buffer = await this._fetchBinary(url, options);
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    }

    _parseOBJ(text, url) {
      const result = { format: 'obj', url, vertices: [], normals: [], uvs: [], faces: [], materials: [], objects: [] };
      const lines = text.split('\n');
      let currentObject = null;
      let currentMaterial = null;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/\s+/);
        const command = parts[0];
        switch (command) {
          case 'v':
            result.vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            break;
          case 'vn':
            result.normals.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            break;
          case 'vt':
            result.uvs.push(parseFloat(parts[1]), parseFloat(parts[2] || 0));
            break;
          case 'f':
            const face = [];
            for (let i = 1; i < parts.length; i++) {
              const indices = parts[i].split('/').map(v => v ? parseInt(v) - 1 : -1);
              face.push({ vertex: indices[0], uv: indices[1], normal: indices[2] });
            }
            result.faces.push(face);
            break;
          case 'o':
          case 'g':
            currentObject = parts[1] || 'default';
            if (!result.objects.find(o => o.name === currentObject)) {
              result.objects.push({ name: currentObject, faces: [] });
            }
            break;
          case 'usemtl':
            currentMaterial = parts[1];
            if (!result.materials.find(m => m.name === currentMaterial)) {
              result.materials.push({ name: currentMaterial });
            }
            break;
          case 'mtllib':
            result.materialLibrary = parts[1];
            break;
        }
      }
      return result;
    }

    _addToCache(key, value) {
      if (this.cache.size >= this.maxCacheSize) {
        if (this.cachePolicy === 'lru') {
          const oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
          this._emit('cacheEvicted', { key: oldestKey });
        }
      }
      this.cache.set(key, value);
      this._emit('cacheAdded', { key });
    }

    getFromCache(key) {
      return this.cache.get(key);
    }

    removeFromCache(key) {
      return this.cache.delete(key);
    }

    clearCache() {
      this.cache.clear();
      this._emit('cacheCleared');
    }

    getCacheSize() {
      return this.cache.size;
    }

    setMaxCacheSize(size) {
      this.maxCacheSize = size;
      while (this.cache.size > size) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
    }

    setCachePolicy(policy) {
      if (['lru', 'fifo', 'none'].includes(policy)) {
        this.cachePolicy = policy;
      }
    }

    setBasePath(path) {
      this.basePath = path;
    }

    setRequestTimeout(ms) {
      this.requestTimeout = ms;
    }

    setRetryCount(count) {
      this.retryCount = count;
    }

    setRetryDelay(ms) {
      this.retryDelay = ms;
    }

    enableLoader(name) {
      const loader = this.loaders.get(name);
      if (loader) loader.enabled = true;
    }

    disableLoader(name) {
      const loader = this.loaders.get(name);
      if (loader) loader.enabled = false;
    }

    getRegisteredLoaders() {
      return Array.from(this.loaders.values()).map(l => ({
        name: l.name,
        extensions: l.extensions,
        mimeTypes: l.mimeTypes,
        binary: l.binary,
        enabled: l.enabled
      }));
    }

    getStats() {
      return { ...this.stats, cacheSize: this.cache.size, loadingCount: this.loading.size };
    }

    resetStats() {
      this.stats = { totalLoaded: 0, totalFailed: 0, cacheHits: 0, cacheMisses: 0, bytesLoaded: 0 };
    }

    on(event, listener) {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event).push(listener);
    }

    off(event, listener) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
      }
    }

    _emit(event, data) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        for (const listener of listeners) {
          try { listener(data); } catch (e) { console.error('Event listener error:', e); }
        }
      }
    }

    _getExtension(url) {
      const cleanUrl = url.split('?')[0].split('#')[0];
      const dotIndex = cleanUrl.lastIndexOf('.');
      return dotIndex !== -1 ? cleanUrl.substring(dotIndex) : '';
    }

    _delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispose() {
      this.loaders.clear();
      this.cache.clear();
      this.loading.clear();
      this.eventListeners.clear();
    }
  }

  return { ModelLoaderRegistry };
})();

if (typeof window !== 'undefined') window.ModelLoaderRegistry = ModelLoaderRegistry;
if (typeof globalThis !== 'undefined') globalThis.ModelLoaderRegistry = ModelLoaderRegistry;

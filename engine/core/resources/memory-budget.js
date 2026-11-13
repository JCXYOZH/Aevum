/**
 * 内存管理器 - GPU/CPU内存统一管理
 * 包含：内存池、泄漏检测、GC优化、纹理/缓冲内存追踪、预算控制
 * @version 2.0.0
 */

'use strict';

const OrbMemory = (function () {

  // ============================================================
  // 内存预算与配额
  // ============================================================
  class MemoryBudget {
    constructor() {
      this._budgets = new Map();
      this._usage = new Map();
      this._totalBudget = 512 * 1024 * 1024;
      this._totalUsage = 0;
      this._warningThreshold = 0.8;
      this._criticalThreshold = 0.95;
      this._listeners = new Map();
    }

    setBudget(category, bytes) {
      this._budgets.set(category, bytes);
      if (!this._usage.has(category)) this._usage.set(category, 0);
    }

    allocate(category, bytes) {
      const current = this._usage.get(category) || 0;
      const budget = this._budgets.get(category);
      const newUsage = current + bytes;
      if (budget && newUsage > budget) {
        this._emit('budget-exceeded', { category, current: newUsage, budget });
        if (newUsage > budget * 1.2) {
          this._emit('budget-critical', { category, current: newUsage, budget });
          return false;
        }
      }
      this._usage.set(category, newUsage);
      this._totalUsage += bytes;
      this._checkGlobalThreshold();
      return true;
    }

    deallocate(category, bytes) {
      const current = this._usage.get(category) || 0;
      this._usage.set(category, Math.max(0, current - bytes));
      this._totalUsage = Math.max(0, this._totalUsage - bytes);
    }

    getUsage(category) { return this._usage.get(category) || 0; }
    getBudget(category) { return this._budgets.get(category) || 0; }
    getTotalUsage() { return this._totalUsage; }
    getTotalBudget() { return this._totalBudget; }
    setTotalBudget(bytes) { this._totalBudget = bytes; }

    getUsageRatio(category) {
      const budget = this._budgets.get(category);
      if (!budget) return 0;
      return (this._usage.get(category) || 0) / budget;
    }

    getGlobalRatio() { return this._totalUsage / this._totalBudget; }

    _checkGlobalThreshold() {
      const ratio = this.getGlobalRatio();
      if (ratio >= this._criticalThreshold) {
        this._emit('global-critical', { usage: this._totalUsage, ratio });
      } else if (ratio >= this._warningThreshold) {
        this._emit('global-warning', { usage: this._totalUsage, ratio });
      }
    }

    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(callback);
    }

    _emit(event, data) {
      if (this._listeners.has(event)) {
        for (const cb of this._listeners.get(event)) {
          try { cb(data); } catch (e) { console.error('[MemoryBudget] Listener error:', e); }
        }
      }
    }

    getReport() {
      const report = { categories: {}, total: { usage: this._totalUsage, budget: this._totalBudget, ratio: this.getGlobalRatio() } };
      for (const [category, usage] of this._usage) {
        const budget = this._budgets.get(category) || 0;
        report.categories[category] = {
          usage,
          budget,
          ratio: budget ? usage / budget : 0,
          remaining: Math.max(0, budget - usage)
        };
      }
      return report;
    }

    reset() {
      for (const key of this._usage.keys()) this._usage.set(key, 0);
      this._totalUsage = 0;
    }
  }

  // ============================================================
  // GPU内存追踪器
  // ============================================================
  class GPUMemoryTracker {
    constructor() {
      this._textures = new Map();
      this._buffers = new Map();
      this._framebuffers = new Map();
      this._renderbuffers = new Map();
      this._programs = new Map();
      this._nextId = 1;
      this._totalTextureMemory = 0;
      this._totalBufferMemory = 0;
      this._totalFramebufferMemory = 0;
    }

    registerTexture(texture, width, height, format, type, mipmaps = false) {
      const id = this._nextId++;
      const bytesPerPixel = this._getBytesPerPixel(format, type);
      let size = width * height * bytesPerPixel;
      if (mipmaps) size = Math.floor(size * 1.333);
      this._textures.set(id, { texture, width, height, format, type, size, mipmaps, createdAt: performance.now() });
      this._totalTextureMemory += size;
      return id;
    }

    registerBuffer(buffer, byteLength, target) {
      const id = this._nextId++;
      this._buffers.set(id, { buffer, byteLength, target, createdAt: performance.now() });
      this._totalBufferMemory += byteLength;
      return id;
    }

    registerFramebuffer(framebuffer, attachments) {
      const id = this._nextId++;
      let size = 0;
      for (const att of attachments) {
        if (att.texture) size += att.width * att.height * 4;
        if (att.renderbuffer) size += att.width * att.height * 4;
      }
      this._framebuffers.set(id, { framebuffer, attachments, size, createdAt: performance.now() });
      this._totalFramebufferMemory += size;
      return id;
    }

    registerProgram(program, vertexSource, fragmentSource) {
      const id = this._nextId++;
      this._programs.set(id, {
        program,
        vertexSize: vertexSource.length * 2,
        fragmentSize: fragmentSource.length * 2,
        createdAt: performance.now()
      });
      return id;
    }

    unregisterTexture(id) {
      const entry = this._textures.get(id);
      if (entry) {
        this._totalTextureMemory -= entry.size;
        this._textures.delete(id);
      }
    }

    unregisterBuffer(id) {
      const entry = this._buffers.get(id);
      if (entry) {
        this._totalBufferMemory -= entry.byteLength;
        this._buffers.delete(id);
      }
    }

    unregisterFramebuffer(id) {
      const entry = this._framebuffers.get(id);
      if (entry) {
        this._totalFramebufferMemory -= entry.size;
        this._framebuffers.delete(id);
      }
    }

    unregisterProgram(id) { this._programs.delete(id); }

    _getBytesPerPixel(format, type) {
      const formatMap = {
        'RGBA': 4, 'RGB': 3, 'RGBA8': 4, 'RGB8': 3,
        'RGBA16F': 8, 'RGB16F': 6, 'RGBA32F': 16, 'RGB32F': 12,
        'DEPTH_COMPONENT16': 2, 'DEPTH_COMPONENT24': 3, 'DEPTH_COMPONENT32F': 4,
        'DEPTH24_STENCIL8': 4, 'DEPTH32F_STENCIL8': 5
      };
      return formatMap[format] || 4;
    }

    getTotalMemory() {
      return this._totalTextureMemory + this._totalBufferMemory + this._totalFramebufferMemory;
    }

    getStats() {
      return {
        textures: { count: this._textures.size, memory: this._totalTextureMemory },
        buffers: { count: this._buffers.size, memory: this._totalBufferMemory },
        framebuffers: { count: this._framebuffers.size, memory: this._totalFramebufferMemory },
        programs: { count: this._programs.size },
        total: this.getTotalMemory()
      };
    }

    getLeakedResources(maxAge = 60000) {
      const now = performance.now();
      const leaked = { textures: [], buffers: [], framebuffers: [] };
      for (const [id, entry] of this._textures) {
        if (now - entry.createdAt > maxAge) leaked.textures.push({ id, ...entry });
      }
      for (const [id, entry] of this._buffers) {
        if (now - entry.createdAt > maxAge) leaked.buffers.push({ id, ...entry });
      }
      for (const [id, entry] of this._framebuffers) {
        if (now - entry.createdAt > maxAge) leaked.framebuffers.push({ id, ...entry });
      }
      return leaked;
    }

    clear() {
      this._textures.clear();
      this._buffers.clear();
      this._framebuffers.clear();
      this._programs.clear();
      this._totalTextureMemory = 0;
      this._totalBufferMemory = 0;
      this._totalFramebufferMemory = 0;
    }
  }

  // ============================================================
  // 垃圾回收优化器
  // ============================================================
  class GCOptimizer {
    constructor() {
      this._allocationTracker = [];
      this._maxTracked = 1000;
      this._gcHints = [];
      this._frameAllocations = 0;
      this._lastFrameAllocations = 0;
      this._threshold = 1024 * 1024;
      this._enabled = true;
    }

    trackAllocation(size, type = 'unknown') {
      if (!this._enabled) return;
      this._frameAllocations += size;
      if (this._allocationTracker.length < this._maxTracked) {
        this._allocationTracker.push({ size, type, time: performance.now(), stack: new Error().stack });
      }
    }

    frame() {
      this._lastFrameAllocations = this._frameAllocations;
      if (this._frameAllocations > this._threshold) {
        this._gcHints.push({
          frame: performance.now(),
          size: this._frameAllocations,
          topAllocations: this._getTopAllocations(5)
        });
        if (this._gcHints.length > 100) this._gcHints.shift();
      }
      this._frameAllocations = 0;
      this._allocationTracker.length = 0;
    }

    _getTopAllocations(count) {
      const byType = new Map();
      for (const alloc of this._allocationTracker) {
        byType.set(alloc.type, (byType.get(alloc.type) || 0) + alloc.size);
      }
      return Array.from(byType.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, count)
        .map(([type, size]) => ({ type, size }));
    }

    suggestGC() {
      if (this._lastFrameAllocations > this._threshold * 2) {
        if (typeof global.gc === 'function') {
          global.gc();
          return true;
        }
      }
      return false;
    }

    getFrameAllocations() { return this._lastFrameAllocations; }
    getGCHints() { return this._gcHints.slice(); }
    setThreshold(bytes) { this._threshold = bytes; }
    enable() { this._enabled = true; }
    disable() { this._enabled = false; }
    clear() { this._allocationTracker.length = 0; this._gcHints.length = 0; this._frameAllocations = 0; }
  }

  // ============================================================
  // 内存池管理器 - 统一管理各类对象池
  // ============================================================
  class MemoryPoolManager {
    constructor() {
      this._pools = new Map();
      this._stats = { totalCreated: 0, totalReused: 0, totalReleased: 0 };
    }

    createPool(name, factory, resetFn, initialSize = 32, maxSize = 1024) {
      if (this._pools.has(name)) return this._pools.get(name);
      const pool = {
        factory, resetFn,
        available: [],
        created: 0,
        borrowed: 0,
        peakBorrowed: 0,
        initialSize, maxSize
      };
      for (let i = 0; i < initialSize; i++) {
        pool.available.push(factory());
        pool.created++;
      }
      this._pools.set(name, pool);
      return pool;
    }

    acquire(name) {
      const pool = this._pools.get(name);
      if (!pool) throw new Error(`Pool "${name}" not found`);
      let obj;
      if (pool.available.length > 0) {
        obj = pool.available.pop();
        this._stats.totalReused++;
      } else {
        obj = pool.factory();
        pool.created++;
        this._stats.totalCreated++;
      }
      pool.borrowed++;
      if (pool.borrowed > pool.peakBorrowed) pool.peakBorrowed = pool.borrowed;
      return obj;
    }

    release(name, obj) {
      const pool = this._pools.get(name);
      if (!pool) return;
      if (pool.resetFn) pool.resetFn(obj);
      if (pool.available.length < pool.maxSize) pool.available.push(obj);
      pool.borrowed--;
      this._stats.totalReleased++;
    }

    getPool(name) { return this._pools.get(name); }
    hasPool(name) { return this._pools.has(name); }

    prewarm(name, count) {
      const pool = this._pools.get(name);
      if (!pool) return;
      while (pool.available.length < count && pool.available.length < pool.maxSize) {
        pool.available.push(pool.factory());
        pool.created++;
      }
    }

    shrinkAll() {
      for (const pool of this._pools.values()) {
        const target = Math.floor(pool.peakBorrowed * 1.5);
        while (pool.available.length > target) pool.available.pop();
      }
    }

    clearPool(name) {
      const pool = this._pools.get(name);
      if (pool) { pool.available.length = 0; pool.borrowed = 0; }
    }

    clearAll() {
      for (const pool of this._pools.values()) {
        pool.available.length = 0;
        pool.borrowed = 0;
      }
    }

    getReport() {
      const report = { pools: {}, totals: this._stats };
      for (const [name, pool] of this._pools) {
        report.pools[name] = {
          created: pool.created,
          available: pool.available.length,
          borrowed: pool.borrowed,
          peakBorrowed: pool.peakBorrowed,
          maxSize: pool.maxSize,
          reuseRate: pool.created > 0 ? this._stats.totalReused / (this._stats.totalReused + pool.created) : 0
        };
      }
      return report;
    }
  }

  // ============================================================
  // 统一内存管理器
  // ============================================================
  class MemoryManager {
    constructor() {
      this.budget = new MemoryBudget();
      this.gpuTracker = new GPUMemoryTracker();
      this.gcOptimizer = new GCOptimizer();
      this.poolManager = new MemoryPoolManager();
      this._initialized = false;
      this._monitorInterval = null;
    }

    init() {
      if (this._initialized) return;
      this.budget.setBudget('textures', 128 * 1024 * 1024);
      this.budget.setBudget('buffers', 64 * 1024 * 1024);
      this.budget.setBudget('framebuffers', 64 * 1024 * 1024);
      this.budget.setBudget('models', 128 * 1024 * 1024);
      this.budget.setBudget('animations', 32 * 1024 * 1024);
      this.budget.setBudget('audio', 16 * 1024 * 1024);
      this.budget.setBudget('misc', 32 * 1024 * 1024);
      this._initialized = true;
    }

    startMonitoring(intervalMs = 5000) {
      this._monitorInterval = setInterval(() => {
        const stats = this.getStats();
        if (stats.gpu.total > this.budget.getTotalBudget() * 0.8) {
          console.warn('[MemoryManager] High memory usage:', stats);
        }
      }, intervalMs);
    }

    stopMonitoring() {
      if (this._monitorInterval) {
        clearInterval(this._monitorInterval);
        this._monitorInterval = null;
      }
    }

    getStats() {
      return {
        budget: this.budget.getReport(),
        gpu: this.gpuTracker.getStats(),
        gc: { frameAllocations: this.gcOptimizer.getFrameAllocations(), hints: this.gcOptimizer.getGCHints().length },
        pools: this.poolManager.getReport()
      };
    }

    dispose() {
      this.stopMonitoring();
      this.gpuTracker.clear();
      this.poolManager.clearAll();
      this.gcOptimizer.clear();
      this.budget.reset();
      this._initialized = false;
    }
  }

  const memoryManager = new MemoryManager();

  return {
    MemoryBudget,
    GPUMemoryTracker,
    GCOptimizer,
    MemoryPoolManager,
    MemoryManager,
    memoryManager
  };
})();

if (typeof window !== 'undefined') window.OrbMemory = OrbMemory;
if (typeof globalThis !== 'undefined') globalThis.OrbMemory = OrbMemory;

/**
 * 任务调度器 - 异步任务管理与执行
 * 包含：任务队列、优先级调度、并发控制、Promise编排、帧任务分发、延迟执行
 * @version 2.0.0
 */

'use strict';

const OrbScheduler = (function () {

  // ============================================================
  // 任务状态枚举
  // ============================================================
  const TaskState = {
    PENDING: 'pending',
    RUNNING: 'running',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  };

  // ============================================================
  // 任务类
  // ============================================================
  class Task {
    constructor(id, fn, options = {}) {
      this.id = id;
      this._fn = fn;
      this._options = {
        priority: options.priority || 0,
        timeout: options.timeout || 0,
        retries: options.retries || 0,
        retryDelay: options.retryDelay || 100,
        onProgress: options.onProgress || null,
        onComplete: options.onComplete || null,
        onError: options.onError || null,
        onCancel: options.onCancel || null
      };
      this.state = TaskState.PENDING;
      this.result = null;
      this.error = null;
      this._attempts = 0;
      this._progress = 0;
      this._createdAt = performance.now();
      this._startedAt = 0;
      this._completedAt = 0;
      this._cancelRequested = false;
      this._resolve = null;
      this._reject = null;
      this._promise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }

    async execute() {
      if (this._cancelRequested) {
        this._cancel();
        return this._promise;
      }
      this.state = TaskState.RUNNING;
      this._startedAt = performance.now();
      this._attempts++;

      try {
        const result = await this._fn(this);
        this.result = result;
        this.state = TaskState.COMPLETED;
        this._completedAt = performance.now();
        this._progress = 1;
        if (this._options.onComplete) this._options.onComplete(result);
        this._resolve(result);
      } catch (error) {
        if (this._attempts <= this._options.retries && !this._cancelRequested) {
          this.state = TaskState.PENDING;
          setTimeout(() => this.execute(), this._options.retryDelay);
        } else {
          this.error = error;
          this.state = TaskState.FAILED;
          this._completedAt = performance.now();
          if (this._options.onError) this._options.onError(error);
          this._reject(error);
        }
      }
      return this._promise;
    }

    setProgress(value) {
      this._progress = Math.max(0, Math.min(1, value));
      if (this._options.onProgress) this._options.onProgress(this._progress);
    }

    get progress() { return this._progress; }
    get elapsed() { return this._startedAt ? (this._completedAt || performance.now()) - this._startedAt : 0; }
    get promise() { return this._promise; }

    cancel() {
      this._cancelRequested = true;
      if (this.state === TaskState.PENDING) this._cancel();
    }

    _cancel() {
      this.state = TaskState.CANCELLED;
      this._completedAt = performance.now();
      if (this._options.onCancel) this._options.onCancel();
      this._reject(new Error('Task cancelled'));
    }

    then(onFulfilled, onRejected) { return this._promise.then(onFulfilled, onRejected); }
    catch(onRejected) { return this._promise.catch(onRejected); }
  }

  // ============================================================
  // 任务调度器
  // ============================================================
  class TaskScheduler {
    constructor(options = {}) {
      this._maxConcurrent = options.maxConcurrent || 4;
      this._tasks = new Map();
      this._pendingQueue = [];
      this._running = new Set();
      this._nextId = 1;
      this._paused = false;
      this._frameTasks = [];
      this._idleTasks = [];
      this._stats = { submitted: 0, completed: 0, failed: 0, cancelled: 0 };
      this._eventListeners = new Map();
    }

    submit(fn, options = {}) {
      const id = this._nextId++;
      const task = new Task(id, fn, options);
      this._tasks.set(id, task);
      this._pendingQueue.push(task);
      this._pendingQueue.sort((a, b) => b._options.priority - a._options.priority);
      this._stats.submitted++;
      this._emit('task:submitted', { id, task });
      this._processQueue();
      return task;
    }

    _processQueue() {
      if (this._paused) return;
      while (this._running.size < this._maxConcurrent && this._pendingQueue.length > 0) {
        const task = this._pendingQueue.shift();
        if (task.state === TaskState.CANCELLED) continue;
        this._running.add(task.id);
        this._emit('task:started', { id: task.id });
        task.execute().finally(() => {
          this._running.delete(task.id);
          if (task.state === TaskState.COMPLETED) this._stats.completed++;
          else if (task.state === TaskState.FAILED) this._stats.failed++;
          else if (task.state === TaskState.CANCELLED) this._stats.cancelled++;
          this._emit('task:finished', { id: task.id, state: task.state });
          this._processQueue();
        });
      }
    }

    cancel(id) {
      const task = this._tasks.get(id);
      if (task) {
        task.cancel();
        const idx = this._pendingQueue.indexOf(task);
        if (idx !== -1) this._pendingQueue.splice(idx, 1);
      }
    }

    cancelAll() {
      for (const task of this._tasks.values()) task.cancel();
      this._pendingQueue.length = 0;
    }

    pause() { this._paused = true; this._emit('scheduler:paused'); }
    resume() { this._paused = false; this._emit('scheduler:resumed'); this._processQueue(); }

    getTask(id) { return this._tasks.get(id); }
    getPendingCount() { return this._pendingQueue.length; }
    getRunningCount() { return this._running.size; }
    getStats() { return { ...this._stats, pending: this._pendingQueue.length, running: this._running.size }; }

    setMaxConcurrent(n) { this._maxConcurrent = n; this._processQueue(); }

    on(event, callback) {
      if (!this._eventListeners.has(event)) this._eventListeners.set(event, []);
      this._eventListeners.get(event).push(callback);
    }

    _emit(event, data) {
      if (this._eventListeners.has(event)) {
        for (const cb of this._eventListeners.get(event)) {
          try { cb(data); } catch (e) { console.error('[Scheduler] Event error:', e); }
        }
      }
    }

    // 帧任务 - 在下一帧执行
    scheduleFrameTask(fn) {
      this._frameTasks.push(fn);
    }

    processFrameTasks() {
      const tasks = this._frameTasks;
      this._frameTasks = [];
      for (const fn of tasks) {
        try { fn(); } catch (e) { console.error('[Scheduler] Frame task error:', e); }
      }
    }

    // 空闲任务 - 在浏览器空闲时执行
    scheduleIdleTask(fn, timeout = 1000) {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => { try { fn(); } catch (e) { console.error('[Scheduler] Idle task error:', e); } }, { timeout });
      } else {
        setTimeout(() => { try { fn(); } catch (e) { console.error('[Scheduler] Idle task error:', e); } }, 1);
      }
    }

    // Promise 编排工具
    async parallel(tasks, maxConcurrent = this._maxConcurrent) {
      const results = [];
      let index = 0;
      const workers = [];
      const worker = async () => {
        while (index < tasks.length) {
          const currentIndex = index++;
          results[currentIndex] = await tasks[currentIndex]();
        }
      };
      for (let i = 0; i < Math.min(maxConcurrent, tasks.length); i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      return results;
    }

    async series(tasks) {
      const results = [];
      for (const task of tasks) results.push(await task());
      return results;
    }

    async race(tasks) { return Promise.race(tasks.map(t => t())); }

    async any(tasks) {
      const errors = [];
      for (const task of tasks) {
        try { return await task(); } catch (e) { errors.push(e); }
      }
      throw new AggregateError(errors, 'All tasks failed');
    }

    // 延迟执行
    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    // 超时控制
    withTimeout(promise, ms, timeoutError = new Error('Operation timed out')) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(timeoutError), ms))
      ]);
    }

    // 重试
    async withRetry(fn, retries = 3, delayMs = 100) {
      let lastError;
      for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (e) {
          lastError = e;
          if (i < retries) await this.delay(delayMs * (i + 1));
        }
      }
      throw lastError;
    }

    // 节流
    throttle(fn, limit) {
      let inThrottle = false;
      return function (...args) {
        if (!inThrottle) {
          fn.apply(this, args);
          inThrottle = true;
          setTimeout(() => { inThrottle = false; }, limit);
        }
      };
    }

    // 防抖
    debounce(fn, delay) {
      let timeoutId;
      return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
      };
    }

    clear() {
      this.cancelAll();
      this._tasks.clear();
      this._frameTasks.length = 0;
      this._stats = { submitted: 0, completed: 0, failed: 0, cancelled: 0 };
    }
  }

  // ============================================================
  // 帧调度器 - 与渲染循环同步
  // ============================================================
  class FrameScheduler {
    constructor() {
      this._updateTasks = new Map();
      this._renderTasks = new Map();
      this._lateTasks = [];
      this._nextTaskId = 1;
      this._running = false;
      this._rafId = null;
      this._lastTime = 0;
      this._deltaTime = 0;
      this._frameCount = 0;
    }

    addUpdateTask(fn, priority = 0) {
      const id = this._nextTaskId++;
      this._updateTasks.set(id, { fn, priority });
      this._sortTasks(this._updateTasks);
      return id;
    }

    addRenderTask(fn, priority = 0) {
      const id = this._nextTaskId++;
      this._renderTasks.set(id, { fn, priority });
      this._sortTasks(this._renderTasks);
      return id;
    }

    addLateTask(fn) { this._lateTasks.push(fn); }

    removeTask(id) {
      this._updateTasks.delete(id);
      this._renderTasks.delete(id);
    }

    _sortTasks(map) {
      const entries = Array.from(map.entries()).sort((a, b) => b[1].priority - a[1].priority);
      map.clear();
      for (const [id, task] of entries) map.set(id, task);
    }

    start() {
      if (this._running) return;
      this._running = true;
      this._lastTime = performance.now();
      this._tick();
    }

    stop() {
      this._running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
    }

    _tick() {
      if (!this._running) return;
      this._rafId = requestAnimationFrame(() => this._tick());
      const now = performance.now();
      this._deltaTime = (now - this._lastTime) / 1000;
      this._lastTime = now;
      this._frameCount++;

      for (const { fn } of this._updateTasks.values()) {
        try { fn(this._deltaTime); } catch (e) { console.error('[FrameScheduler] Update error:', e); }
      }
      for (const { fn } of this._renderTasks.values()) {
        try { fn(this._deltaTime); } catch (e) { console.error('[FrameScheduler] Render error:', e); }
      }
      const late = this._lateTasks;
      this._lateTasks = [];
      for (const fn of late) {
        try { fn(); } catch (e) { console.error('[FrameScheduler] Late task error:', e); }
      }
    }

    get deltaTime() { return this._deltaTime; }
    get frameCount() { return this._frameCount; }
    get isRunning() { return this._running; }
    clear() { this._updateTasks.clear(); this._renderTasks.clear(); this._lateTasks.length = 0; }
  }

  const taskScheduler = new TaskScheduler();
  const frameScheduler = new FrameScheduler();

  return {
    TaskState,
    Task,
    TaskScheduler,
    FrameScheduler,
    taskScheduler,
    frameScheduler
  };
})();

if (typeof window !== 'undefined') window.OrbScheduler = OrbScheduler;
if (typeof globalThis !== 'undefined') globalThis.OrbScheduler = OrbScheduler;

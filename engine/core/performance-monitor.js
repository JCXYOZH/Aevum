/**
 * 引擎核心 - 性能监控/调试系统/输入系统/工具库/数学库扩展
 * 纯JavaScript，零第三方依赖
 * @version 6.0.0
 */
'use strict';

const EngineCoreV6 = (function () {

  class PerformanceMonitor {
    constructor() {
      this.metrics = new Map();
      this.history = new Map();
      this.maxHistoryLength = 300;
      this.enabled = true;
      this.updateInterval = 1000;
      this.lastUpdateTime = 0;
      this.callbacks = new Map();
      this.stats = { fps: 0, frameTime: 0, drawCalls: 0, triangles: 0, memory: 0, gpuMemory: 0 };
      this.frameCount = 0;
      this.frameTimeAccumulator = 0;
      this.lastFrameTime = 0;
    }

    beginFrame() {
      if (!this.enabled) return;
      this.lastFrameTime = performance.now();
    }

    endFrame() {
      if (!this.enabled) return;
      const now = performance.now();
      const frameTime = now - this.lastFrameTime;
      this.frameTimeAccumulator += frameTime;
      this.frameCount++;
      if (now - this.lastUpdateTime >= this.updateInterval) {
        this.stats.fps = Math.round(this.frameCount * 1000 / (now - this.lastUpdateTime));
        this.stats.frameTime = this.frameTimeAccumulator / this.frameCount;
        this._recordHistory('fps', this.stats.fps);
        this._recordHistory('frameTime', this.stats.frameTime);
        this.frameCount = 0;
        this.frameTimeAccumulator = 0;
        this.lastUpdateTime = now;
        const callback = this.callbacks.get('update');
        if (callback) callback(this.stats);
      }
    }

    _recordHistory(metric, value) {
      if (!this.history.has(metric)) {
        this.history.set(metric, []);
      }
      const history = this.history.get(metric);
      history.push({ value, timestamp: Date.now() });
      if (history.length > this.maxHistoryLength) {
        history.shift();
      }
    }

    setMetric(name, value) {
      this.metrics.set(name, { value, timestamp: Date.now() });
      this._recordHistory(name, value);
    }

    getMetric(name) {
      const metric = this.metrics.get(name);
      return metric ? metric.value : null;
    }

    getMetrics() {
      const result = {};
      for (const [name, metric] of this.metrics) {
        result[name] = metric.value;
      }
      return { ...result, ...this.stats };
    }

    getHistory(name, length = 60) {
      const history = this.history.get(name);
      if (!history) return [];
      return history.slice(-length);
    }

    getAverage(name, length = 60) {
      const history = this.getHistory(name, length);
      if (history.length === 0) return 0;
      const sum = history.reduce((acc, item) => acc + item.value, 0);
      return sum / history.length;
    }

    getMin(name, length = 60) {
      const history = this.getHistory(name, length);
      if (history.length === 0) return 0;
      return Math.min(...history.map(item => item.value));
    }

    getMax(name, length = 60) {
      const history = this.getHistory(name, length);
      if (history.length === 0) return 0;
      return Math.max(...history.map(item => item.value));
    }

    getStats() {
      return { ...this.stats };
    }

    setUpdateInterval(interval) {
      this.updateInterval = interval;
    }

    setMaxHistoryLength(length) {
      this.maxHistoryLength = length;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    reset() {
      this.metrics.clear();
      this.history.clear();
      this.stats = { fps: 0, frameTime: 0, drawCalls: 0, triangles: 0, memory: 0, gpuMemory: 0 };
      this.frameCount = 0;
      this.frameTimeAccumulator = 0;
    }

    dispose() {
      this.reset();
      this.callbacks.clear();
    }
  }

  class DebugSystem {
    constructor() {
      this.enabled = false;
      this.overlay = null;
      this.logs = [];
      this.maxLogs = 100;
      this.watches = new Map();
      this.breakpoints = new Set();
      this.profilers = new Map();
      this.callbacks = new Map();
      this.stats = { logs: 0, warnings: 0, errors: 0, profilers: 0 };
      this._initOverlay();
    }

    _initOverlay() {
      if (typeof document === 'undefined') return;
      this.overlay = document.createElement('div');
      this.overlay.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: #0f0;
        font-family: monospace;
        font-size: 12px;
        padding: 10px;
        border-radius: 5px;
        z-index: 9999;
        max-width: 400px;
        max-height: 80vh;
        overflow-y: auto;
        display: none;
      `;
      document.body.appendChild(this.overlay);
    }

    enable() {
      this.enabled = true;
      if (this.overlay) this.overlay.style.display = 'block';
      const callback = this.callbacks.get('enable');
      if (callback) callback();
    }

    disable() {
      this.enabled = false;
      if (this.overlay) this.overlay.style.display = 'none';
      const callback = this.callbacks.get('disable');
      if (callback) callback();
    }

    toggle() {
      if (this.enabled) this.disable();
      else this.enable();
    }

    log(message, level = 'info') {
      const logEntry = {
        message,
        level,
        timestamp: Date.now(),
        stack: level === 'error' ? new Error().stack : null
      };
      this.logs.push(logEntry);
      if (this.logs.length > this.maxLogs) {
        this.logs.shift();
      }
      this.stats.logs++;
      if (level === 'warning') this.stats.warnings++;
      if (level === 'error') this.stats.errors++;
      if (this.enabled && this.overlay) {
        this._updateOverlay();
      }
      const callback = this.callbacks.get('log');
      if (callback) callback(logEntry);
    }

    info(message) {
      this.log(message, 'info');
    }

    warning(message) {
      this.log(message, 'warning');
    }

    error(message) {
      this.log(message, 'error');
    }

    _updateOverlay() {
      if (!this.overlay) return;
      let html = '<div style="margin-bottom: 10px; font-weight: bold;">Debug Console</div>';
      html += `<div>FPS: ${this.watches.get('fps')?.value || 'N/A'}</div>`;
      html += `<div>Frame Time: ${this.watches.get('frameTime')?.value?.toFixed(2) || 'N/A'}ms</div>`;
      html += '<div style="margin-top: 10px; border-top: 1px solid #333; padding-top: 10px;">';
      for (let i = this.logs.length - 1; i >= Math.max(0, this.logs.length - 20); i--) {
        const log = this.logs[i];
        const color = log.level === 'error' ? '#f00' : log.level === 'warning' ? '#ff0' : '#0f0';
        html += `<div style="color: ${color};">[${log.level.toUpperCase()}] ${log.message}</div>`;
      }
      html += '</div>';
      this.overlay.innerHTML = html;
    }

    watch(name, getter) {
      this.watches.set(name, { getter, value: null });
    }

    unwatch(name) {
      this.watches.delete(name);
    }

    updateWatches() {
      for (const [name, watch] of this.watches) {
        try {
          watch.value = watch.getter();
        } catch (e) {
          watch.value = 'Error: ' + e.message;
        }
      }
      if (this.enabled && this.overlay) {
        this._updateOverlay();
      }
    }

    addBreakpoint(name) {
      this.breakpoints.add(name);
    }

    removeBreakpoint(name) {
      this.breakpoints.delete(name);
    }

    checkBreakpoint(name) {
      if (this.breakpoints.has(name)) {
        const callback = this.callbacks.get('breakpoint');
        if (callback) callback(name);
        return true;
      }
      return false;
    }

    startProfiler(name) {
      this.profilers.set(name, {
        startTime: performance.now(),
        endTime: null,
        duration: 0,
        calls: 1
      });
      this.stats.profilers++;
    }

    stopProfiler(name) {
      const profiler = this.profilers.get(name);
      if (profiler) {
        profiler.endTime = performance.now();
        profiler.duration = profiler.endTime - profiler.startTime;
      }
    }

    getProfiler(name) {
      return this.profilers.get(name);
    }

    getProfilers() {
      const result = {};
      for (const [name, profiler] of this.profilers) {
        result[name] = { duration: profiler.duration, calls: profiler.calls };
      }
      return result;
    }

    getLogs(level = null, limit = 50) {
      let logs = this.logs;
      if (level) {
        logs = logs.filter(log => log.level === level);
      }
      return logs.slice(-limit);
    }

    clearLogs() {
      this.logs = [];
      this.stats = { logs: 0, warnings: 0, errors: 0, profilers: this.stats.profilers };
    }

    getStats() {
      return { ...this.stats };
    }

    setMaxLogs(max) {
      this.maxLogs = max;
    }

    isEnabled() {
      return this.enabled;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    dispose() {
      this.disable();
      if (this.overlay && this.overlay.parentNode) {
        this.overlay.parentNode.removeChild(this.overlay);
      }
      this.logs = [];
      this.watches.clear();
      this.breakpoints.clear();
      this.profilers.clear();
      this.callbacks.clear();
    }
  }

  class InputSystem {
    constructor() {
      this.keys = new Set();
      this.mouse = {
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: 0,
        buttons: new Set(),
        wheel: 0,
        wheelDelta: 0
      };
      this.touch = {
        touches: [],
        active: false
      };
      this.callbacks = new Map();
      this.enabled = true;
      this.preventDefault = true;
      this.lastMouseX = 0;
      this.lastMouseY = 0;
      this._initEventListeners();
    }

    _initEventListeners() {
      if (typeof window === 'undefined') return;
      window.addEventListener('keydown', (e) => this._onKeyDown(e));
      window.addEventListener('keyup', (e) => this._onKeyUp(e));
      window.addEventListener('mousemove', (e) => this._onMouseMove(e));
      window.addEventListener('mousedown', (e) => this._onMouseDown(e));
      window.addEventListener('mouseup', (e) => this._onMouseUp(e));
      window.addEventListener('wheel', (e) => this._onWheel(e));
      window.addEventListener('touchstart', (e) => this._onTouchStart(e));
      window.addEventListener('touchmove', (e) => this._onTouchMove(e));
      window.addEventListener('touchend', (e) => this._onTouchEnd(e));
      window.addEventListener('contextmenu', (e) => {
        if (this.preventDefault) e.preventDefault();
      });
    }

    _onKeyDown(e) {
      if (!this.enabled) return;
      if (this.preventDefault) e.preventDefault();
      this.keys.add(e.code);
      const callback = this.callbacks.get('keydown');
      if (callback) callback(e.code, e);
    }

    _onKeyUp(e) {
      if (!this.enabled) return;
      this.keys.delete(e.code);
      const callback = this.callbacks.get('keyup');
      if (callback) callback(e.code, e);
    }

    _onMouseMove(e) {
      if (!this.enabled) return;
      this.mouse.deltaX = e.clientX - this.lastMouseX;
      this.mouse.deltaY = e.clientY - this.lastMouseY;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      const callback = this.callbacks.get('mousemove');
      if (callback) callback(this.mouse, e);
    }

    _onMouseDown(e) {
      if (!this.enabled) return;
      if (this.preventDefault) e.preventDefault();
      this.mouse.buttons.add(e.button);
      const callback = this.callbacks.get('mousedown');
      if (callback) callback(e.button, this.mouse, e);
    }

    _onMouseUp(e) {
      if (!this.enabled) return;
      this.mouse.buttons.delete(e.button);
      const callback = this.callbacks.get('mouseup');
      if (callback) callback(e.button, this.mouse, e);
    }

    _onWheel(e) {
      if (!this.enabled) return;
      if (this.preventDefault) e.preventDefault();
      this.mouse.wheelDelta = e.deltaY;
      this.mouse.wheel += e.deltaY;
      const callback = this.callbacks.get('wheel');
      if (callback) callback(this.mouse.wheelDelta, this.mouse, e);
    }

    _onTouchStart(e) {
      if (!this.enabled) return;
      if (this.preventDefault) e.preventDefault();
      this.touch.active = true;
      this.touch.touches = Array.from(e.touches).map(t => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        radiusX: t.radiusX,
        radiusY: t.radiusY,
        force: t.force
      }));
      const callback = this.callbacks.get('touchstart');
      if (callback) callback(this.touch, e);
    }

    _onTouchMove(e) {
      if (!this.enabled) return;
      if (this.preventDefault) e.preventDefault();
      this.touch.touches = Array.from(e.touches).map(t => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        radiusX: t.radiusX,
        radiusY: t.radiusY,
        force: t.force
      }));
      const callback = this.callbacks.get('touchmove');
      if (callback) callback(this.touch, e);
    }

    _onTouchEnd(e) {
      if (!this.enabled) return;
      this.touch.touches = Array.from(e.touches).map(t => ({
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        radiusX: t.radiusX,
        radiusY: t.radiusY,
        force: t.force
      }));
      if (this.touch.touches.length === 0) {
        this.touch.active = false;
      }
      const callback = this.callbacks.get('touchend');
      if (callback) callback(this.touch, e);
    }

    isKeyDown(code) {
      return this.keys.has(code);
    }

    isMouseButtonDown(button) {
      return this.mouse.buttons.has(button);
    }

    getMousePosition() {
      return { x: this.mouse.x, y: this.mouse.y };
    }

    getMouseDelta() {
      const delta = { x: this.mouse.deltaX, y: this.mouse.deltaY };
      this.mouse.deltaX = 0;
      this.mouse.deltaY = 0;
      return delta;
    }

    getWheelDelta() {
      const delta = this.mouse.wheelDelta;
      this.mouse.wheelDelta = 0;
      return delta;
    }

    getTouches() {
      return [...this.touch.touches];
    }

    isTouchActive() {
      return this.touch.active;
    }

    getPressedKeys() {
      return Array.from(this.keys);
    }

    getPressedMouseButtons() {
      return Array.from(this.mouse.buttons);
    }

    clear() {
      this.keys.clear();
      this.mouse.buttons.clear();
      this.mouse.deltaX = 0;
      this.mouse.deltaY = 0;
      this.mouse.wheelDelta = 0;
      this.touch.touches = [];
      this.touch.active = false;
    }

    setEnabled(v) {
      this.enabled = v;
    }

    isEnabled() {
      return this.enabled;
    }

    setPreventDefault(v) {
      this.preventDefault = v;
    }

    on(event, callback) {
      this.callbacks.set(event, callback);
    }

    off(event) {
      this.callbacks.delete(event);
    }

    dispose() {
      this.callbacks.clear();
      this.clear();
    }
  }

  class UtilityLibrary {
    constructor() {
      this.randomSeed = 12345;
      this._initRandom();
    }

    _initRandom() {
      let seed = this.randomSeed;
      this.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    }

    setRandomSeed(seed) {
      this.randomSeed = seed;
      this._initRandom();
    }

    randomRange(min, max) {
      return min + this.random() * (max - min);
    }

    randomInt(min, max) {
      return Math.floor(this.randomRange(min, max + 1));
    }

    randomChoice(array) {
      return array[Math.floor(this.random() * array.length)];
    }

    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    lerp(a, b, t) {
      return a + (b - a) * t;
    }

    inverseLerp(a, b, value) {
      return (value - a) / (b - a);
    }

    remap(value, inMin, inMax, outMin, outMax) {
      return this.lerp(outMin, outMax, this.inverseLerp(inMin, inMax, value));
    }

    smoothstep(edge0, edge1, x) {
      const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    smootherstep(edge0, edge1, x) {
      const t = this.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

    easeInQuad(t) {
      return t * t;
    }

    easeOutQuad(t) {
      return t * (2 - t);
    }

    easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    easeInCubic(t) {
      return t * t * t;
    }

    easeOutCubic(t) {
      return (--t) * t * t + 1;
    }

    easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
    }

    easeInElastic(t) {
      if (t === 0 || t === 1) return t;
      return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
    }

    easeOutElastic(t) {
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
    }

    easeInBounce(t) {
      return 1 - this.easeOutBounce(1 - t);
    }

    easeOutBounce(t) {
      if (t < 1 / 2.75) {
        return 7.5625 * t * t;
      } else if (t < 2 / 2.75) {
        t -= 1.5 / 2.75;
        return 7.5625 * t * t + 0.75;
      } else if (t < 2.5 / 2.75) {
        t -= 2.25 / 2.75;
        return 7.5625 * t * t + 0.9375;
      } else {
        t -= 2.625 / 2.75;
        return 7.5625 * t * t + 0.984375;
      }
    }

    degToRad(deg) {
      return deg * Math.PI / 180;
    }

    radToDeg(rad) {
      return rad * 180 / Math.PI;
    }

    distance(x1, y1, x2, y2) {
      return Math.sqrt((x2 - x1)**2 + (y2 - y1)**2);
    }

    distance3D(x1, y1, z1, x2, y2, z2) {
      return Math.sqrt((x2 - x1)**2 + (y2 - y1)**2 + (z2 - z1)**2);
    }

    normalizeAngle(angle) {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    }

    lerpAngle(a, b, t) {
      const diff = this.normalizeAngle(b - a);
      return a + diff * t;
    }

    uuid() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = this.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    deepClone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    mergeDeep(target, source) {
      const result = { ...target };
      for (const key in source) {
        if (source[key] instanceof Object && key in target) {
          result[key] = this.mergeDeep(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      }
      return result;
    }

    debounce(func, wait) {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    throttle(func, limit) {
      let inThrottle;
      return function(...args) {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => inThrottle = false, limit);
        }
      };
    }

    formatNumber(num, decimals = 2) {
      return num.toFixed(decimals);
    }

    formatBytes(bytes, decimals = 2) {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    isPowerOf2(value) {
      return (value & (value - 1)) === 0;
    }

    nextPowerOf2(value) {
      return Math.pow(2, Math.ceil(Math.log(value) / Math.log(2)));
    }

    hexToRgb(hex) {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : null;
    }

    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(x => {
        const hex = Math.round(x).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');
    }

    hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
    }

    rgbToHsl(r, g, b) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;
      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return { h, s, l };
    }
  }

  return {
    PerformanceMonitor, DebugSystem, InputSystem, UtilityLibrary
  };
})();

if (typeof window !== 'undefined') window.EngineCoreV6 = EngineCoreV6;
if (typeof globalThis !== 'undefined') globalThis.EngineCoreV6 = EngineCoreV6;

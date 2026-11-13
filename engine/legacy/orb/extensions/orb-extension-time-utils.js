/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-time-utils
 * 从 legacy/_orb_expand_part14.js 转换 (GBK->UTF-8)
 * @module orb-extension-time-utils
 */
'use strict';



/* ===== 时间与日期工具库 =====
   支持: 格式化/ 解析 / 计算 / 时区
*/
const TimeUtils = {
  format: function(date, format){
    const d = date instanceof Date ? date : new Date(date);
    const map = {
      'YYYY': d.getFullYear(),
      'MM': String(d.getMonth() + 1).padStart(2, '0'),
      'DD': String(d.getDate()).padStart(2, '0'),
      'HH': String(d.getHours()).padStart(2, '0'),
      'mm': String(d.getMinutes()).padStart(2, '0'),
      'ss': String(d.getSeconds()).padStart(2, '0'),
      'SSS': String(d.getMilliseconds()).padStart(3, '0')
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, function(match){
      return map[match];
    });
  },
  parse: function(str, format){
    const map = {
      'YYYY': 'year', 'MM': 'month', 'DD': 'day',
      'HH': 'hour', 'mm': 'minute', 'ss': 'second'
    };
    const result = { year: 1970, month: 0, day: 1, hour: 0, minute: 0, second: 0 };
    let strIdx = 0, fmtIdx = 0;
    while(fmtIdx < format.length && strIdx < str.length){
      let matched = false;
      for(const token in map){
        if(format.substring(fmtIdx, fmtIdx + token.length) === token){
          const len = token.length;
          const value = parseInt(str.substring(strIdx, strIdx + len));
          if(!isNaN(value)){
            if(map[token] === 'month') result.month = value - 1;
            else result[map[token]] = value;
          }
          strIdx += len;
          fmtIdx += len;
          matched = true;
          break;
        }
      }
      if(!matched){
        strIdx++;
        fmtIdx++;
      }
    }
    return new Date(result.year, result.month, result.day, result.hour, result.minute, result.second);
  },
  addDays: function(date, days){
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  },
  addHours: function(date, hours){
    const d = new Date(date);
    d.setHours(d.getHours() + hours);
    return d;
  },
  addMinutes: function(date, minutes){
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  },
  addSeconds: function(date, seconds){
    const d = new Date(date);
    d.setSeconds(d.getSeconds() + seconds);
    return d;
  },
  diffDays: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60 * 24));
  },
  diffHours: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60 * 60));
  },
  diffMinutes: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / (1000 * 60));
  },
  diffSeconds: function(date1, date2){
    return Math.floor((new Date(date2) - new Date(date1)) / 1000);
  },
  isSameDay: function(date1, date2){
    const d1 = new Date(date1), d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  },
  isToday: function(date){
    return TimeUtils.isSameDay(date, new Date());
  },
  isYesterday: function(date){
    return TimeUtils.isSameDay(date, TimeUtils.addDays(new Date(), -1));
  },
  isTomorrow: function(date){
    return TimeUtils.isSameDay(date, TimeUtils.addDays(new Date(), 1));
  },
  isLeapYear: function(year){
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  },
  getDaysInMonth: function(year, month){
    return new Date(year, month + 1, 0).getDate();
  },
  getDayOfYear: function(date){
    const d = new Date(date);
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / (1000 * 60 * 60 * 24));
  },
  getWeekOfYear: function(date){
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  },
  startOfDay: function(date){
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfDay: function(date){
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  startOfWeek: function(date){
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfWeek: function(date){
    const d = TimeUtils.startOfWeek(date);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  startOfMonth: function(date){
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  endOfMonth: function(date){
    const d = new Date(date);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  relativeTime: function(date){
    const now = new Date();
    const diff = now - new Date(date);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if(seconds < 60) return '刚刚';
    if(minutes < 60) return minutes + '分钟前';
    if(hours < 24) return hours + '小时前';
    if(days < 7) return days + '天前';
    if(days < 30) return Math.floor(days / 7) + '周前';
    if(days < 365) return Math.floor(days / 30) + '个月前';
    return Math.floor(days / 365) + '年前';
  },
  formatDuration: function(ms){
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if(days > 0) return days + '天 ' + (hours % 24) + '小时';
    if(hours > 0) return hours + '小时 ' + (minutes % 60) + '分钟';
    if(minutes > 0) return minutes + '分钟 ' + (seconds % 60) + '秒';
    return seconds + '秒';
  },
  getTimezoneOffset: function(){
    return -new Date().getTimezoneOffset() / 60;
  },
  getTimezoneName: function(){
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },
  toUTC: function(date){
    const d = new Date(date);
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000);
  },
  fromUTC: function(date){
    const d = new Date(date);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  }
};

/* ===== 对象工具库=====
   支持: 深拷贝/ 合并 / 比较 / 遍历 / 路径访问
*/
const ObjectUtils = {
  deepClone: function(obj){
    if(obj === null || typeof obj !== 'object') return obj;
    if(obj instanceof Date) return new Date(obj.getTime());
    if(obj instanceof Array) return obj.map(function(item){ return ObjectUtils.deepClone(item); });
    if(obj instanceof Map) return new Map(Array.from(obj.entries()).map(function([k, v]){ return [k, ObjectUtils.deepClone(v)]; }));
    if(obj instanceof Set) return new Set(Array.from(obj).map(function(v){ return ObjectUtils.deepClone(v); }));
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[key] = ObjectUtils.deepClone(obj[key]);
      }
    }
    return result;
  },
  deepMerge: function(target, source){
    if(!source || typeof source !== 'object') return target;
    if(!target || typeof target !== 'object') return ObjectUtils.deepClone(source);
    if(source instanceof Array){
      return source.map(function(item){ return ObjectUtils.deepClone(item); });
    }
    const result = { ...target };
    for(const key in source){
      if(source.hasOwnProperty(key)){
        if(source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])){
          result[key] = ObjectUtils.deepMerge(result[key], source[key]);
        } else {
          result[key] = ObjectUtils.deepClone(source[key]);
        }
      }
    }
    return result;
  },
  deepEqual: function(a, b){
    if(a === b) return true;
    if(a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if(a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if(a instanceof Array || b instanceof Array){
      if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for(let i = 0; i < a.length; i++){
        if(!ObjectUtils.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }
    const keysA = Object.keys(a), keysB = Object.keys(b);
    if(keysA.length !== keysB.length) return false;
    for(let i = 0; i < keysA.length; i++){
      if(!ObjectUtils.deepEqual(a[keysA[i]], b[keysA[i]])) return false;
    }
    return true;
  },
  get: function(obj, path, defaultValue){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length; i++){
      if(current === null || current === undefined) return defaultValue;
      current = current[keys[i]];
    }
    return current !== undefined ? current : defaultValue;
  },
  set: function(obj, path, value){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length - 1; i++){
      if(current[keys[i]] === undefined || current[keys[i]] === null){
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    return obj;
  },
  has: function(obj, path){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length; i++){
      if(current === null || current === undefined || !(keys[i] in current)) return false;
      current = current[keys[i]];
    }
    return true;
  },
  delete: function(obj, path){
    const keys = path.split('.');
    let current = obj;
    for(let i = 0; i < keys.length - 1; i++){
      if(current === null || current === undefined) return false;
      current = current[keys[i]];
    }
    if(current && keys[keys.length - 1] in current){
      delete current[keys[keys.length - 1]];
      return true;
    }
    return false;
  },
  flatten: function(obj, prefix){
    prefix = prefix || '';
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        const newKey = prefix ? prefix + '.' + key : key;
        if(obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)){
          Object.assign(result, ObjectUtils.flatten(obj[key], newKey));
        } else {
          result[newKey] = obj[key];
        }
      }
    }
    return result;
  },
  unflatten: function(obj){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        ObjectUtils.set(result, key, obj[key]);
      }
    }
    return result;
  },
  pick: function(obj, keys){
    const result = {};
    for(let i = 0; i < keys.length; i++){
      if(keys[i] in obj) result[keys[i]] = obj[keys[i]];
    }
    return result;
  },
  omit: function(obj, keys){
    const result = { ...obj };
    for(let i = 0; i < keys.length; i++){
      delete result[keys[i]];
    }
    return result;
  },
  mapValues: function(obj, fn){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[key] = fn(obj[key], key);
      }
    }
    return result;
  },
  mapKeys: function(obj, fn){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[fn(obj[key], key)] = obj[key];
      }
    }
    return result;
  },
  filterValues: function(obj, predicate){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key) && predicate(obj[key], key)){
        result[key] = obj[key];
      }
    }
    return result;
  },
  findKey: function(obj, predicate){
    for(const key in obj){
      if(obj.hasOwnProperty(key) && predicate(obj[key], key)){
        return key;
      }
    }
    return undefined;
  },
  invert: function(obj){
    const result = {};
    for(const key in obj){
      if(obj.hasOwnProperty(key)){
        result[obj[key]] = key;
      }
    }
    return result;
  },
  size: function(obj){
    return Object.keys(obj).length;
  },
  isEmpty: function(obj){
    return Object.keys(obj).length === 0;
  },
  isPlainObject: function(obj){
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof Date) && !(obj instanceof RegExp);
  },
  toQueryString: function(obj){
    const parts = [];
    for(const key in obj){
      if(obj.hasOwnProperty(key) && obj[key] !== undefined && obj[key] !== null){
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
      }
    }
    return parts.join('&');
  },
  fromQueryString: function(str){
    const result = {};
    const pairs = str.replace(/^\?/, '').split('&');
    for(let i = 0; i < pairs.length; i++){
      const pair = pairs[i].split('=');
      if(pair[0]) result[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    }
    return result;
  }
};

/* ===== 性能监控系统 =====
   支持: FPS / 帧时间/ 内存 / 调用计数 / 历史记录
*/
function createPerformanceMonitor(options){
  const pm = {
    _frames: [],
    _maxFrames: (options && options.maxFrames) || 600,
    _lastTime: performance.now(),
    _fps: 0,
    _frameTime: 0,
    _minFrameTime: Infinity,
    _maxFrameTime: 0,
    _avgFrameTime: 0,
    _counters: {},
    _timers: new Map(),
    _memoryHistory: [],
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true
  };

  function beginFrame(){
    pm._lastTime = performance.now();
  }

  function endFrame(){
    const now = performance.now();
    const frameTime = now - pm._lastTime;
    pm._frameTime = frameTime;
    pm._fps = 1000 / frameTime;
    pm._frames.push({ time: now, frameTime: frameTime, fps: pm._fps });
    if(pm._frames.length > pm._maxFrames) pm._frames.shift();
    pm._minFrameTime = Math.min(pm._minFrameTime, frameTime);
    pm._maxFrameTime = Math.max(pm._maxFrameTime, frameTime);
    if(pm._frames.length > 0){
      let sum = 0;
      for(let i = 0; i < pm._frames.length; i++) sum += pm._frames[i].frameTime;
      pm._avgFrameTime = sum / pm._frames.length;
    }
    if(performance.memory){
      pm._memoryHistory.push({
        time: now,
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      });
      if(pm._memoryHistory.length > 100) pm._memoryHistory.shift();
    }
  }

  function startTimer(name){
    pm._timers.set(name, { start: performance.now(), duration: 0 });
  }

  function endTimer(name){
    const timer = pm._timers.get(name);
    if(timer){
      timer.duration = performance.now() - timer.start;
      return timer.duration;
    }
    return 0;
  }

  function getTimer(name){
    const timer = pm._timers.get(name);
    return timer ? timer.duration : 0;
  }

  function incrementCounter(name, amount){
    pm._counters[name] = (pm._counters[name] || 0) + (amount || 1);
  }

  function getCounter(name){
    return pm._counters[name] || 0;
  }

  function resetCounters(){
    pm._counters = {};
  }

  function getFPS(){
    return pm._fps;
  }

  function getFrameTime(){
    return pm._frameTime;
  }

  function getMinFrameTime(){
    return pm._minFrameTime === Infinity ? 0 : pm._minFrameTime;
  }

  function getMaxFrameTime(){
    return pm._maxFrameTime;
  }

  function getAvgFrameTime(){
    return pm._avgFrameTime;
  }

  function getFrameHistory(){
    return [...pm._frames];
  }

  function getMemory(){
    if(performance.memory){
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        usagePercent: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100
      };
    }
    return null;
  }

  function getMemoryHistory(){
    return [...pm._memoryHistory];
  }

  function getReport(){
    return {
      fps: pm._fps,
      frameTime: pm._frameTime,
      minFrameTime: pm.getMinFrameTime(),
      maxFrameTime: pm._maxFrameTime,
      avgFrameTime: pm._avgFrameTime,
      counters: { ...pm._counters },
      memory: pm.getMemory(),
      frameCount: pm._frames.length
    };
  }

  function reset(){
    pm._frames = [];
    pm._minFrameTime = Infinity;
    pm._maxFrameTime = 0;
    pm._avgFrameTime = 0;
    pm._counters = {};
    pm._timers.clear();
    pm._memoryHistory = [];
  }

  function setEnabled(enabled){
    pm._enabled = enabled;
  }

  return { beginFrame, endFrame, startTimer, endTimer, getTimer, incrementCounter, getCounter, resetCounters, getFPS, getFrameTime, getMinFrameTime, getMaxFrameTime, getAvgFrameTime, getFrameHistory, getMemory, getMemoryHistory, getReport, reset, setEnabled, pm };
}

/* ===== 环境与特性检测=====
   支持: 浏览器/ 设备 / 性能 / WebGL能力
*/
const EnvironmentDetector = {
  getBrowser: function(){
    const ua = navigator.userAgent;
    if(/Edg\//.test(ua)) return { name: 'Edge', version: (ua.match(/Edg\/([\d.]+)/) || [])[1] };
    if(/Chrome\//.test(ua) && !/Edg\//.test(ua)) return { name: 'Chrome', version: (ua.match(/Chrome\/([\d.]+)/) || [])[1] };
    if(/Firefox\//.test(ua)) return { name: 'Firefox', version: (ua.match(/Firefox\/([\d.]+)/) || [])[1] };
    if(/Safari\//.test(ua) && !/Chrome\//.test(ua)) return { name: 'Safari', version: (ua.match(/Version\/([\d.]+)/) || [])[1] };
    return { name: 'Unknown', version: '0' };
  },
  getOS: function(){
    const ua = navigator.userAgent;
    if(/Windows NT 10/.test(ua)) return { name: 'Windows', version: '10/11' };
    if(/Windows NT 6.3/.test(ua)) return { name: 'Windows', version: '8.1' };
    if(/Windows NT 6.2/.test(ua)) return { name: 'Windows', version: '8' };
    if(/Windows NT 6.1/.test(ua)) return { name: 'Windows', version: '7' };
    if(/Mac OS X/.test(ua)) return { name: 'macOS', version: (ua.match(/Mac OS X ([\d_.]+)/) || [])[1] || 'Unknown' };
    if(/Android/.test(ua)) return { name: 'Android', version: (ua.match(/Android ([\d.]+)/) || [])[1] || 'Unknown' };
    if(/iOS|iPhone|iPad|iPod/.test(ua)) return { name: 'iOS', version: (ua.match(/OS ([\d_]+)/) || [])[1] || 'Unknown' };
    if(/Linux/.test(ua)) return { name: 'Linux', version: 'Unknown' };
    return { name: 'Unknown', version: 'Unknown' };
  },
  getDevice: function(){
    const ua = navigator.userAgent;
    if(/Mobile|Android|iPhone|iPod/.test(ua)) return 'mobile';
    if(/iPad|Tablet/.test(ua)) return 'tablet';
    return 'desktop';
  },
  isMobile: function(){
    return EnvironmentDetector.getDevice() === 'mobile';
  },
  isTablet: function(){
    return EnvironmentDetector.getDevice() === 'tablet';
  },
  isDesktop: function(){
    return EnvironmentDetector.getDevice() === 'desktop';
  },
  getScreenInfo: function(){
    return {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelRatio: window.devicePixelRatio || 1,
      orientation: window.screen.orientation ? window.screen.orientation.type : 'unknown'
    };
  },
  getViewport: function(){
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    };
  },
  getLanguage: function(){
    return navigator.language || navigator.userLanguage;
  },
  getLanguages: function(){
    return navigator.languages || [navigator.language];
  },
  getTimezone: function(){
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  },
  getCores: function(){
    return navigator.hardwareConcurrency || 4;
  },
  getMemory: function(){
    return navigator.deviceMemory || 4;
  },
  getConnection: function(){
    if(navigator.connection){
      return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      };
    }
    return null;
  },
  isOnline: function(){
    return navigator.onLine;
  },
  hasTouch: function(){
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  },
  hasWebGL: function(){
    try{
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch(e){
      return false;
    }
  },
  hasWebGL2: function(){
    try{
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch(e){
      return false;
    }
  },
  getWebGLInfo: function(){
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if(!gl) return null;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown',
      vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'Unknown',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
      maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
      maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      maxViewportDimensions: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
      maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)
    };
  },
  hasLocalStorage: function(){
    try{
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
      return true;
    } catch(e){
      return false;
    }
  },
  hasSessionStorage: function(){
    try{
      sessionStorage.setItem('__test__', '1');
      sessionStorage.removeItem('__test__');
      return true;
    } catch(e){
      return false;
    }
  },
  hasIndexedDB: function(){
    return 'indexedDB' in window;
  },
  hasServiceWorker: function(){
    return 'serviceWorker' in navigator;
  },
  hasWebSocket: function(){
    return 'WebSocket' in window;
  },
  hasWorker: function(){
    return 'Worker' in window;
  },
  hasSharedWorker: function(){
    return 'SharedWorker' in window;
  },
  hasFetch: function(){
    return 'fetch' in window;
  },
  hasPromise: function(){
    return 'Promise' in window;
  },
  hasAsyncAwait: function(){
    try{
      new Function('async () => await Promise.resolve()')();
      return true;
    } catch(e){
      return false;
    }
  },
  hasBigInt: function(){
    return typeof BigInt !== 'undefined';
  },
  hasWebAssembly: function(){
    return typeof WebAssembly !== 'undefined';
  },
  hasWebRTC: function(){
    return !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || window.RTCPeerConnection);
  },
  hasGeolocation: function(){
    return 'geolocation' in navigator;
  },
  hasNotification: function(){
    return 'Notification' in window;
  },
  getFullReport: function(){
    return {
      browser: EnvironmentDetector.getBrowser(),
      os: EnvironmentDetector.getOS(),
      device: EnvironmentDetector.getDevice(),
      screen: EnvironmentDetector.getScreenInfo(),
      viewport: EnvironmentDetector.getViewport(),
      language: EnvironmentDetector.getLanguage(),
      languages: EnvironmentDetector.getLanguages(),
      timezone: EnvironmentDetector.getTimezone(),
      cores: EnvironmentDetector.getCores(),
      memory: EnvironmentDetector.getMemory(),
      connection: EnvironmentDetector.getConnection(),
      online: EnvironmentDetector.isOnline(),
      touch: EnvironmentDetector.hasTouch(),
      webgl: EnvironmentDetector.hasWebGL(),
      webgl2: EnvironmentDetector.hasWebGL2(),
      webglInfo: EnvironmentDetector.getWebGLInfo(),
      features: {
        localStorage: EnvironmentDetector.hasLocalStorage(),
        sessionStorage: EnvironmentDetector.hasSessionStorage(),
        indexedDB: EnvironmentDetector.hasIndexedDB(),
        serviceWorker: EnvironmentDetector.hasServiceWorker(),
        webSocket: EnvironmentDetector.hasWebSocket(),
        worker: EnvironmentDetector.hasWorker(),
        sharedWorker: EnvironmentDetector.hasSharedWorker(),
        fetch: EnvironmentDetector.hasFetch(),
        promise: EnvironmentDetector.hasPromise(),
        asyncAwait: EnvironmentDetector.hasAsyncAwait(),
        bigInt: EnvironmentDetector.hasBigInt(),
        webAssembly: EnvironmentDetector.hasWebAssembly(),
        webRTC: EnvironmentDetector.hasWebRTC(),
        geolocation: EnvironmentDetector.hasGeolocation(),
        notification: EnvironmentDetector.hasNotification()
      }
    };
  }
};

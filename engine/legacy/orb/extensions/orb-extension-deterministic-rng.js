/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-deterministic-rng
 * 从 legacy/_orb_expand_part13.js 转换 (GBK->UTF-8)
 * @module orb-extension-deterministic-rng
 */
'use strict';



/* ===== 确定性随机数生成器=====
   支持: 种子 / 状态保存/ 多种分布 / 可复现*/
function createDeterministicRandom(seed){
  const rng = {
    _state: seed || 123456789,
    _state2: 987654321,
    _seed: seed || 123456789
  };

  function next(){
    let x = rng._state;
    let y = rng._state2;
    x ^= x << 23;
    y ^= y >>> 17;
    x ^= x >>> 17;
    x ^= y;
    rng._state = y;
    rng._state2 = x;
    return (x >>> 0) / 4294967296;
  }

  function nextInt(min, max){
    if(max === undefined){ max = min; min = 0; }
    return Math.floor(next() * (max - min + 1)) + min;
  }

  function nextFloat(min, max){
    if(max === undefined){ max = min || 1; min = 0; }
    return next() * (max - min) + min;
  }

  function nextBoolean(){
    return next() > 0.5;
  }

  function nextGaussian(mean, stdDev){
    const m = mean || 0;
    const s = stdDev || 1;
    let u = 0, v = 0;
    while(u === 0) u = next();
    while(v === 0) v = next();
    return m + s * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function nextIntGaussian(min, max, mean, stdDev){
    const val = nextGaussian(mean, stdDev);
    return Math.max(min, Math.min(max, Math.round(val)));
  }

  function pick(array){
    return array[Math.floor(next() * array.length)];
  }

  function shuffle(array){
    const result = [...array];
    for(let i = result.length - 1; i > 0; i--){
      const j = Math.floor(next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function weightedPick(items, weights){
    const total = weights.reduce(function(a, b){ return a + b; }, 0);
    let r = next() * total;
    for(let i = 0; i < items.length; i++){
      r -= weights[i];
      if(r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function nextBytes(length){
    const bytes = new Uint8Array(length);
    for(let i = 0; i < length; i++){
      bytes[i] = Math.floor(next() * 256);
    }
    return bytes;
  }

  function nextColor(){
    return [next(), next(), next()];
  }

  function nextVector3(min, max){
    return [nextFloat(min, max), nextFloat(min, max), nextFloat(min, max)];
  }

  function nextQuaternion(){
    const u1 = next();
    const u2 = next();
    const u3 = next();
    const sqrt1 = Math.sqrt(1 - u1);
    const sqrt2 = Math.sqrt(u1);
    return [
      sqrt1 * Math.sin(2 * Math.PI * u2),
      sqrt1 * Math.cos(2 * Math.PI * u2),
      sqrt2 * Math.sin(2 * Math.PI * u3),
      sqrt2 * Math.cos(2 * Math.PI * u3)
    ];
  }

  function getState(){
    return { state: rng._state, state2: rng._state2, seed: rng._seed };
  }

  function setState(state){
    rng._state = state.state;
    rng._state2 = state.state2;
    rng._seed = state.seed;
  }

  function reset(){
    rng._state = rng._seed;
    rng._state2 = 987654321;
  }

  function getSeed(){
    return rng._seed;
  }

  return { next, nextInt, nextFloat, nextBoolean, nextGaussian, nextIntGaussian, pick, shuffle, weightedPick, nextBytes, nextColor, nextVector3, nextQuaternion, getState, setState, reset, getSeed, rng };
}

/* ===== 输入回放系统 =====
   支持: 录制 / 回放 / 序列化/ 确定性验证*/
function createInputReplay(options){
  const ir = {
    _recording: false,
    _playing: false,
    _frames: [],
    _currentFrame: 0,
    _startTime: 0,
    _frameDuration: (options && options.frameDuration) || 1000 / 60,
    _inputState: {},
    _listeners: [],
    _maxFrames: (options && options.maxFrames) || 36000
  };

  function startRecording(){
    ir._recording = true;
    ir._playing = false;
    ir._frames = [];
    ir._currentFrame = 0;
    ir._startTime = Date.now();
    emitEvent('recordingStarted', {});
  }

  function stopRecording(){
    ir._recording = false;
    emitEvent('recordingStopped', { frameCount: ir._frames.length });
  }

  function recordInput(input){
    if(!ir._recording) return;
    if(ir._frames.length >= ir._maxFrames){
      stopRecording();
      return;
    }
    ir._frames.push({
      time: Date.now() - ir._startTime,
      input: { ...input }
    });
  }

  function startPlayback(){
    if(ir._frames.length === 0) return false;
    ir._playing = true;
    ir._recording = false;
    ir._currentFrame = 0;
    ir._startTime = Date.now();
    emitEvent('playbackStarted', { frameCount: ir._frames.length });
    return true;
  }

  function stopPlayback(){
    ir._playing = false;
    emitEvent('playbackStopped', { frame: ir._currentFrame });
  }

  function update(){
    if(!ir._playing) return null;
    const elapsed = Date.now() - ir._startTime;
    while(ir._currentFrame < ir._frames.length && ir._frames[ir._currentFrame].time <= elapsed){
      ir._inputState = { ...ir._frames[ir._currentFrame].input };
      emitEvent('input', ir._inputState);
      ir._currentFrame++;
    }
    if(ir._currentFrame >= ir._frames.length){
      stopPlayback();
      emitEvent('playbackComplete', {});
    }
    return ir._inputState;
  }

  function getInput(){
    return { ...ir._inputState };
  }

  function isKeyDown(key){
    return ir._inputState[key] === true;
  }

  function getMousePosition(){
    return ir._inputState.mouseX !== undefined ? { x: ir._inputState.mouseX, y: ir._inputState.mouseY } : null;
  }

  function isRecording(){
    return ir._recording;
  }

  function isPlaying(){
    return ir._playing;
  }

  function getFrameCount(){
    return ir._frames.length;
  }

  function getCurrentFrame(){
    return ir._currentFrame;
  }

  function getProgress(){
    return ir._frames.length > 0 ? ir._currentFrame / ir._frames.length : 0;
  }

  function serialize(){
    return JSON.stringify({
      frameDuration: ir._frameDuration,
      frames: ir._frames
    });
  }

  function deserialize(data){
    try{
      const parsed = JSON.parse(data);
      ir._frameDuration = parsed.frameDuration || ir._frameDuration;
      ir._frames = parsed.frames || [];
      return true;
    } catch(e){
      console.error('[InputReplay] 反序列化失败:', e);
      return false;
    }
  }

  function seekToFrame(frame){
    ir._currentFrame = Math.max(0, Math.min(ir._frames.length - 1, frame));
    ir._startTime = Date.now() - (ir._frames[ir._currentFrame] ? ir._frames[ir._currentFrame].time : 0);
  }

  function on(event, callback){
    ir._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < ir._listeners.length; i++){
      if(ir._listeners[i].event === event){
        try{ ir._listeners[i].callback(data); } catch(e){ console.error('[InputReplay] 事件错误:', e); }
      }
    }
  }

  function clear(){
    ir._frames = [];
    ir._currentFrame = 0;
    ir._inputState = {};
  }

  return { startRecording, stopRecording, recordInput, startPlayback, stopPlayback, update, getInput, isKeyDown, getMousePosition, isRecording, isPlaying, getFrameCount, getCurrentFrame, getProgress, serialize, deserialize, seekToFrame, on, clear, ir };
}

/* ===== 通用缓存系统 =====
   支持: LRU / TTL / 统计 / 持久化*/
function createCache(options){
  const cache = {
    _store: new Map(),
    _maxSize: (options && options.maxSize) || 1000,
    _defaultTTL: (options && options.defaultTTL) || 0,
    _stats: { hits: 0, misses: 0, evictions: 0 },
    _persistKey: (options && options.persistKey) || null
  };

  function set(key, value, ttl){
    if(cache._store.size >= cache._maxSize && !cache._store.has(key)){
      evictOldest();
    }
    const entry = {
      value: value,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : (cache._defaultTTL ? Date.now() + cache._defaultTTL : 0),
      accessCount: 0,
      lastAccessed: Date.now()
    };
    cache._store.set(key, entry);
    if(cache._persistKey) persist();
  }

  function get(key){
    const entry = cache._store.get(key);
    if(!entry){
      cache._stats.misses++;
      return null;
    }
    if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
      cache._store.delete(key);
      cache._stats.misses++;
      return null;
    }
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    cache._stats.hits++;
    return entry.value;
  }

  function has(key){
    const entry = cache._store.get(key);
    if(!entry) return false;
    if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
      cache._store.delete(key);
      return false;
    }
    return true;
  }

  function remove(key){
    cache._store.delete(key);
    if(cache._persistKey) persist();
  }

  function clear(){
    cache._store.clear();
    cache._stats = { hits: 0, misses: 0, evictions: 0 };
    if(cache._persistKey) persist();
  }

  function evictOldest(){
    let oldestKey = null;
    let oldestTime = Infinity;
    for(const [key, entry] of cache._store){
      if(entry.lastAccessed < oldestTime){
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if(oldestKey !== null){
      cache._store.delete(oldestKey);
      cache._stats.evictions++;
    }
  }

  function cleanup(){
    const now = Date.now();
    for(const [key, entry] of cache._store){
      if(entry.expiresAt > 0 && now > entry.expiresAt){
        cache._store.delete(key);
      }
    }
  }

  function getStats(){
    return {
      ...cache._stats,
      size: cache._store.size,
      maxSize: cache._maxSize,
      hitRate: cache._stats.hits + cache._stats.misses > 0 ? cache._stats.hits / (cache._stats.hits + cache._stats.misses) : 0
    };
  }

  function getKeys(){
    return Array.from(cache._store.keys());
  }

  function getSize(){
    return cache._store.size;
  }

  function persist(){
    if(!cache._persistKey) return;
    try{
      const data = {};
      for(const [key, entry] of cache._store){
        data[key] = entry;
      }
      localStorage.setItem(cache._persistKey, JSON.stringify(data));
    } catch(e){
      console.error('[Cache] 持久化失败', e);
    }
  }

  function restore(){
    if(!cache._persistKey) return;
    try{
      const data = localStorage.getItem(cache._persistKey);
      if(data){
        const parsed = JSON.parse(data);
        for(const key in parsed){
          cache._store.set(key, parsed[key]);
        }
      }
    } catch(e){
      console.error('[Cache] 恢复失败:', e);
    }
  }

  function setMaxSize(size){
    cache._maxSize = size;
    while(cache._store.size > size){
      evictOldest();
    }
  }

  restore();
  return { set, get, has, remove, clear, cleanup, getStats, getKeys, getSize, setMaxSize, cache };
}

/* ===== 字符串工具库 =====
   支持: 格式化/ 截断 / 填充 / 转换 / 校验
*/
const StringUtils = {
  format: function(template){
    const args = Array.prototype.slice.call(arguments, 1);
    return template.replace(/\{(\d+)\}/g, function(match, index){
      return args[index] !== undefined ? args[index] : match;
    });
  },
  formatNamed: function(template, values){
    return template.replace(/\{(\w+)\}/g, function(match, key){
      return values[key] !== undefined ? values[key] : match;
    });
  },
  truncate: function(str, maxLength, suffix){
    if(str.length <= maxLength) return str;
    return str.substring(0, maxLength - (suffix || '...').length) + (suffix || '...');
  },
  padStart: function(str, targetLength, padString){
    padString = padString || ' ';
    while(str.length < targetLength){
      str = padString + str;
    }
    return str.substring(0, targetLength);
  },
  padEnd: function(str, targetLength, padString){
    padString = padString || ' ';
    while(str.length < targetLength){
      str = str + padString;
    }
    return str.substring(0, targetLength);
  },
  capitalize: function(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  camelCase: function(str){
    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index){
      return index === 0 ? letter.toLowerCase() : letter.toUpperCase();
    }).replace(/[\s_-]+/g, '');
  },
  snakeCase: function(str){
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/[\s-]+/g, '_').replace(/^_/, '');
  },
  kebabCase: function(str){
    return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/[\s_]+/g, '-').replace(/^-/, '');
  },
  titleCase: function(str){
    return str.replace(/\w\S*/g, function(txt){
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
  },
  reverse: function(str){
    return str.split('').reverse().join('');
  },
  countOccurrences: function(str, substring){
    let count = 0;
    let pos = 0;
    while((pos = str.indexOf(substring, pos)) !== -1){
      count++;
      pos += substring.length;
    }
    return count;
  },
  isEmpty: function(str){
    return !str || str.trim().length === 0;
  },
  isAlpha: function(str){
    return /^[a-zA-Z]+$/.test(str);
  },
  isNumeric: function(str){
    return /^-?\d+\.?\d*$/.test(str);
  },
  isAlphanumeric: function(str){
    return /^[a-zA-Z0-9]+$/.test(str);
  },
  isEmail: function(str){
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  },
  isURL: function(str){
    try{
      new URL(str);
      return true;
    } catch(e){
      return false;
    }
  },
  slugify: function(str){
    return str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
  },
  escapeHTML: function(str){
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
  unescapeHTML: function(str){
    const div = document.createElement('div');
    div.innerHTML = str;
    return div.textContent;
  },
  removeWhitespace: function(str){
    return str.replace(/\s+/g, '');
  },
  normalizeWhitespace: function(str){
    return str.replace(/\s+/g, ' ').trim();
  },
  repeat: function(str, count){
    let result = '';
    for(let i = 0; i < count; i++) result += str;
    return result;
  },
  startsWith: function(str, prefix){
    return str.substring(0, prefix.length) === prefix;
  },
  endsWith: function(str, suffix){
    return str.substring(str.length - suffix.length) === suffix;
  },
  between: function(str, start, end){
    const startIdx = str.indexOf(start);
    if(startIdx === -1) return '';
    const endIdx = str.indexOf(end, startIdx + start.length);
    if(endIdx === -1) return '';
    return str.substring(startIdx + start.length, endIdx);
  },
  toNumber: function(str){
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  },
  toBoolean: function(str){
    return str === 'true' || str === '1' || str === 'yes';
  },
  levenshteinDistance: function(a, b){
    const matrix = [];
    for(let i = 0; i <= b.length; i++) matrix[i] = [i];
    for(let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for(let i = 1; i <= b.length; i++){
      for(let j = 1; j <= a.length; j++){
        if(b.charAt(i-1) === a.charAt(j-1)){
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i-1][j-1] + 1,
            matrix[i][j-1] + 1,
            matrix[i-1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  },
  similarity: function(a, b){
    const longer = a.length > b.length ? a : b;
    if(longer.length === 0) return 1;
    const distance = StringUtils.levenshteinDistance(a, b);
    return (longer.length - distance) / longer.length;
  }
};

/* ===== 数组工具库=====
   支持: 去重 / 分组 / 分块 / 扁平化/ 随机
*/
const ArrayUtils = {
  unique: function(arr){
    return [...new Set(arr)];
  },
  uniqueBy: function(arr, key){
    const seen = new Set();
    return arr.filter(function(item){
      const k = typeof key === 'function' ? key(item) : item[key];
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  groupBy: function(arr, key){
    return arr.reduce(function(result, item){
      const k = typeof key === 'function' ? key(item) : item[key];
      if(!result[k]) result[k] = [];
      result[k].push(item);
      return result;
    }, {});
  },
  chunk: function(arr, size){
    const chunks = [];
    for(let i = 0; i < arr.length; i += size){
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },
  flatten: function(arr, depth){
    if(depth === undefined) depth = 1;
    if(depth <= 0) return arr.slice();
    return arr.reduce(function(result, item){
      if(Array.isArray(item)){
        return result.concat(ArrayUtils.flatten(item, depth - 1));
      }
      result.push(item);
      return result;
    }, []);
  },
  flattenDeep: function(arr){
    return ArrayUtils.flatten(arr, Infinity);
  },
  shuffle: function(arr){
    const result = [...arr];
    for(let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  sample: function(arr){
    return arr[Math.floor(Math.random() * arr.length)];
  },
  sampleSize: function(arr, n){
    return ArrayUtils.shuffle(arr).slice(0, n);
  },
  compact: function(arr){
    return arr.filter(Boolean);
  },
  without: function(arr){
    const values = Array.prototype.slice.call(arguments, 1);
    return arr.filter(function(item){
      return values.indexOf(item) === -1;
    });
  },
  intersection: function(){
    const arrays = Array.prototype.slice.call(arguments);
    if(arrays.length === 0) return [];
    return arrays[0].filter(function(item){
      return arrays.every(function(arr){
        return arr.indexOf(item) !== -1;
      });
    });
  },
  difference: function(arr1, arr2){
    return arr1.filter(function(item){
      return arr2.indexOf(item) === -1;
    });
  },
  union: function(){
    return ArrayUtils.unique(ArrayUtils.flatten(Array.prototype.slice.call(arguments)));
  },
  partition: function(arr, predicate){
    const pass = [], fail = [];
    for(let i = 0; i < arr.length; i++){
      if(predicate(arr[i])) pass.push(arr[i]);
      else fail.push(arr[i]);
    }
    return [pass, fail];
  },
  zip: function(){
    const arrays = Array.prototype.slice.call(arguments);
    const length = Math.min.apply(null, arrays.map(function(a){ return a.length; }));
    const result = [];
    for(let i = 0; i < length; i++){
      result.push(arrays.map(function(a){ return a[i]; }));
    }
    return result;
  },
  unzip: function(arr){
    if(arr.length === 0) return [];
    const length = arr[0].length;
    const result = [];
    for(let i = 0; i < length; i++){
      result.push(arr.map(function(a){ return a[i]; }));
    }
    return result;
  },
  range: function(start, end, step){
    if(end === undefined){ end = start; start = 0; }
    step = step || 1;
    const result = [];
    for(let i = start; i < end; i += step){
      result.push(i);
    }
    return result;
  },
  sum: function(arr){
    return arr.reduce(function(a, b){ return a + b; }, 0);
  },
  average: function(arr){
    return arr.length > 0 ? ArrayUtils.sum(arr) / arr.length : 0;
  },
  median: function(arr){
    const sorted = [...arr].sort(function(a, b){ return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  mode: function(arr){
    const frequency = {};
    let maxFreq = 0;
    let result = [];
    for(let i = 0; i < arr.length; i++){
      frequency[arr[i]] = (frequency[arr[i]] || 0) + 1;
      if(frequency[arr[i]] > maxFreq){
        maxFreq = frequency[arr[i]];
        result = [arr[i]];
      } else if(frequency[arr[i]] === maxFreq){
        result.push(arr[i]);
      }
    }
    return result;
  },
  min: function(arr){
    return Math.min.apply(null, arr);
  },
  max: function(arr){
    return Math.max.apply(null, arr);
  },
  first: function(arr, n){
    if(n === undefined) return arr[0];
    return arr.slice(0, n);
  },
  last: function(arr, n){
    if(n === undefined) return arr[arr.length - 1];
    return arr.slice(Math.max(arr.length - n, 0));
  },
  initial: function(arr){
    return arr.slice(0, -1);
  },
  rest: function(arr){
    return arr.slice(1);
  },
  fill: function(arr, value, start, end){
    const result = [...arr];
    const s = start || 0;
    const e = end || result.length;
    for(let i = s; i < e; i++) result[i] = value;
    return result;
  },
  removeDuplicates: function(arr){
    return ArrayUtils.unique(arr);
  },
  countBy: function(arr, key){
    return arr.reduce(function(result, item){
      const k = typeof key === 'function' ? key(item) : item[key];
      result[k] = (result[k] || 0) + 1;
      return result;
    }, {});
  },
  pluck: function(arr, key){
    return arr.map(function(item){ return item[key]; });
  },
  sortBy: function(arr, key, order){
    const dir = order === 'desc' ? -1 : 1;
    return [...arr].sort(function(a, b){
      const va = typeof key === 'function' ? key(a) : a[key];
      const vb = typeof key === 'function' ? key(b) : b[key];
      if(va < vb) return -1 * dir;
      if(va > vb) return 1 * dir;
      return 0;
    });
  },
  debounce: function(fn, delay){
    let timer = null;
    return function(){
      const args = arguments;
      const context = this;
      clearTimeout(timer);
      timer = setTimeout(function(){
        fn.apply(context, args);
      }, delay);
    };
  },
  throttle: function(fn, limit){
    let inThrottle = false;
    return function(){
      const args = arguments;
      const context = this;
      if(!inThrottle){
        fn.apply(context, args);
        inThrottle = true;
        setTimeout(function(){
          inThrottle = false;
        }, limit);
      }
    };
  },
  memoize: function(fn){
    const cache = new Map();
    return function(){
      const key = JSON.stringify(arguments);
      if(cache.has(key)) return cache.get(key);
      const result = fn.apply(this, arguments);
      cache.set(key, result);
      return result;
    };
  },
  once: function(fn){
    let called = false;
    let result;
    return function(){
      if(!called){
        called = true;
        result = fn.apply(this, arguments);
      }
      return result;
    };
  },
  curry: function(fn){
    const arity = fn.length;
    return function curried(){
      const args = Array.prototype.slice.call(arguments);
      if(args.length >= arity){
        return fn.apply(this, args);
      }
      return function(){
        return curried.apply(this, args.concat(Array.prototype.slice.call(arguments)));
      };
    };
  },
  compose: function(){
    const fns = Array.prototype.slice.call(arguments);
    return function(){
      let result = fns[fns.length - 1].apply(this, arguments);
      for(let i = fns.length - 2; i >= 0; i--){
        result = fns[i](result);
      }
      return result;
    };
  },
  pipe: function(){
    const fns = Array.prototype.slice.call(arguments);
    return function(){
      let result = fns[0].apply(this, arguments);
      for(let i = 1; i < fns.length; i++){
        result = fns[i](result);
      }
      return result;
    };
  }
};

/* ===== 颜色工具库=====
   支持: RGB/HSL/HEX转换 / 混合 / 亮度 / 对比度*/
const ColorUtils = {
  hexToRgb: function(hex){
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  },
  rgbToHex: function(r, g, b){
    return '#' + [r, g, b].map(function(x){
      const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  },
  rgbToHsl: function(r, g, b){
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if(max === min){
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch(max){
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  },
  hslToRgb: function(h, s, l){
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if(s === 0){
      r = g = b = l;
    } else {
      const hue2rgb = function(p, q, t){
        if(t < 0) t += 1;
        if(t > 1) t -= 1;
        if(t < 1/6) return p + (q - p) * 6 * t;
        if(t < 1/2) return q;
        if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  },
  mix: function(color1, color2, ratio){
    ratio = ratio !== undefined ? ratio : 0.5;
    return {
      r: Math.round(color1.r + (color2.r - color1.r) * ratio),
      g: Math.round(color1.g + (color2.g - color1.g) * ratio),
      b: Math.round(color1.b + (color2.b - color1.b) * ratio)
    };
  },
  lighten: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.min(100, hsl.l + amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  darken: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.max(0, hsl.l - amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  saturate: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.min(100, hsl.s + amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  desaturate: function(color, amount){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.max(0, hsl.s - amount);
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  rotateHue: function(color, degrees){
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    hsl.h = (hsl.h + degrees) % 360;
    if(hsl.h < 0) hsl.h += 360;
    return ColorUtils.hslToRgb(hsl.h, hsl.s, hsl.l);
  },
  luminance: function(color){
    return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  },
  contrast: function(color1, color2){
    const l1 = ColorUtils.luminance(color1);
    const l2 = ColorUtils.luminance(color2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  },
  isLight: function(color){
    return ColorUtils.luminance(color) > 128;
  },
  isDark: function(color){
    return ColorUtils.luminance(color) <= 128;
  },
  complementary: function(color){
    return ColorUtils.rotateHue(color, 180);
  },
  analogous: function(color, count){
    count = count || 3;
    const colors = [];
    const step = 30;
    const start = -Math.floor(count / 2) * step;
    for(let i = 0; i < count; i++){
      colors.push(ColorUtils.rotateHue(color, start + i * step));
    }
    return colors;
  },
  triadic: function(color){
    return [
      color,
      ColorUtils.rotateHue(color, 120),
      ColorUtils.rotateHue(color, 240)
    ];
  },
  tetradic: function(color){
    return [
      color,
      ColorUtils.rotateHue(color, 90),
      ColorUtils.rotateHue(color, 180),
      ColorUtils.rotateHue(color, 270)
    ];
  },
  monochromatic: function(color, count){
    count = count || 5;
    const hsl = ColorUtils.rgbToHsl(color.r, color.g, color.b);
    const colors = [];
    for(let i = 0; i < count; i++){
      const l = 20 + (i / (count - 1)) * 60;
      colors.push(ColorUtils.hslToRgb(hsl.h, hsl.s, l));
    }
    return colors;
  },
  random: function(){
    return {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256)
    };
  },
  toArray: function(color){
    return [color.r / 255, color.g / 255, color.b / 255];
  },
  fromArray: function(arr){
    return { r: arr[0] * 255, g: arr[1] * 255, b: arr[2] * 255 };
  },
  toString: function(color){
    return 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
  }
};

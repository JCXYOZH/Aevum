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
   支持: 录制 / 回放 / 序列化 / 确定性验证
*/
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
   支持: LRU / TTL / 统计 / 持久化
*/
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
      console.error('[Cache] 持久化失败:', e);
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
   支持: 格式化 / 截断 / 填充 / 转换 / 校验
*/
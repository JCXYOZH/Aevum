/**
 * MrHua 3D灵体渲染引擎 - orb-utils
 * 工具函数库(哈希/加密/字符串/颜色/存储/文件等)
 * 从 orb-renderer-main.js 拆分 (原行 L25539-L29960)
 * @module orb-utils
 */
'use strict';

const HashUtils = {
  crc32: function(data){
    const table = HashUtils._crc32Table || (HashUtils._crc32Table = HashUtils._makeCRCTable());
    let crc = 0xFFFFFFFF;
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    for(let i = 0; i < bytes.length; i++){
      crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },
  _makeCRCTable: function(){
    const table = new Uint32Array(256);
    for(let i = 0; i < 256; i++){
      let c = i;
      for(let j = 0; j < 8; j++){
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  },
  fnv1a: function(data){
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    let hash = 0x811c9dc5;
    for(let i = 0; i < bytes.length; i++){
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  },
  fnv1a64: function(data){
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    let h0 = 0x84222325, h1 = 0xcbf29ce4;
    for(let i = 0; i < bytes.length; i++){
      h0 ^= bytes[i];
      const t0 = Math.imul(h0, 0x1000193) + Math.imul(h1, 0x1000193 >>> 0);
      const t1 = Math.imul(h1, 0x1000193);
      h0 = t0 >>> 0;
      h1 = t1 >>> 0;
    }
    return [h0, h1];
  },
  murmur3: function(data, seed){
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    const len = bytes.length;
    let h1 = seed || 0;
    const c1 = 0xcc9e2d51, c2 = 0x1b873593;
    let i = 0;
    while(i + 4 <= len){
      let k1 = bytes[i] | (bytes[i+1] << 8) | (bytes[i+2] << 16) | (bytes[i+3] << 24);
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
      h1 = (h1 << 13) | (h1 >>> 19);
      h1 = Math.imul(h1, 5) + 0xe6546b64;
      i += 4;
    }
    let k1 = 0;
    switch(len & 3){
      case 3: k1 ^= bytes[i+2] << 16;
      case 2: k1 ^= bytes[i+1] << 8;
      case 1: k1 ^= bytes[i];
        k1 = Math.imul(k1, c1);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, c2);
        h1 ^= k1;
    }
    h1 ^= len;
    h1 ^= h1 >>> 16;
    h1 = Math.imul(h1, 0x85ebca6b);
    h1 ^= h1 >>> 13;
    h1 = Math.imul(h1, 0xc2b2ae35);
    h1 ^= h1 >>> 16;
    return h1 >>> 0;
  },
  simpleStringHash: function(str){
    let hash = 0;
    for(let i = 0; i < str.length; i++){
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  },
  checksum16: function(data){
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    let sum = 0;
    for(let i = 0; i < bytes.length; i++){
      sum = (sum + bytes[i]) & 0xFFFF;
    }
    return sum;
  },
  adler32: function(data){
    const bytes = typeof data === 'string' ? HashUtils._stringToBytes(data) : data;
    let a = 1, b = 0;
    const MOD = 65521;
    for(let i = 0; i < bytes.length; i++){
      a = (a + bytes[i]) % MOD;
      b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
  },
  _stringToBytes: function(str){
    const bytes = new Uint8Array(str.length);
    for(let i = 0; i < str.length; i++){
      bytes[i] = str.charCodeAt(i) & 0xFF;
    }
    return bytes;
  },
  toHex: function(hash, length){
    return hash.toString(16).padStart(length || 8, '0');
  }
};

/* ===== 简单加密系统 =====
   支持: XOR / 凯撒 / Base64 / 简单AES-like
*/
const CryptoUtils = {
  xorEncrypt: function(data, key){
    const bytes = typeof data === 'string' ? CryptoUtils._stringToBytes(data) : new Uint8Array(data);
    const keyBytes = typeof key === 'string' ? CryptoUtils._stringToBytes(key) : new Uint8Array(key);
    const result = new Uint8Array(bytes.length);
    for(let i = 0; i < bytes.length; i++){
      result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return result;
  },
  xorDecrypt: function(data, key){
    return CryptoUtils.xorEncrypt(data, key);
  },
  caesarEncrypt: function(text, shift){
    let result = '';
    for(let i = 0; i < text.length; i++){
      const code = text.charCodeAt(i);
      if(code >= 65 && code <= 90){
        result += String.fromCharCode(((code - 65 + shift) % 26) + 65);
      } else if(code >= 97 && code <= 122){
        result += String.fromCharCode(((code - 97 + shift) % 26) + 97);
      } else {
        result += text[i];
      }
    }
    return result;
  },
  caesarDecrypt: function(text, shift){
    return CryptoUtils.caesarEncrypt(text, 26 - (shift % 26));
  },
  base64Encode: function(data){
    const bytes = typeof data === 'string' ? CryptoUtils._stringToBytes(data) : data;
    let binary = '';
    for(let i = 0; i < bytes.length; i++){
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },
  base64Decode: function(base64){
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for(let i = 0; i < binary.length; i++){
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },
  base64DecodeToString: function(base64){
    return atob(base64);
  },
  vigenereEncrypt: function(text, key){
    let result = '';
    let keyIndex = 0;
    for(let i = 0; i < text.length; i++){
      const code = text.charCodeAt(i);
      if(code >= 65 && code <= 90){
        const shift = key.charCodeAt(keyIndex % key.length) - 65;
        result += String.fromCharCode(((code - 65 + shift) % 26) + 65);
        keyIndex++;
      } else if(code >= 97 && code <= 122){
        const shift = key.charCodeAt(keyIndex % key.length) - 97;
        result += String.fromCharCode(((code - 97 + shift) % 26) + 97);
        keyIndex++;
      } else {
        result += text[i];
      }
    }
    return result;
  },
  vigenereDecrypt: function(text, key){
    let result = '';
    let keyIndex = 0;
    for(let i = 0; i < text.length; i++){
      const code = text.charCodeAt(i);
      if(code >= 65 && code <= 90){
        const shift = key.charCodeAt(keyIndex % key.length) - 65;
        result += String.fromCharCode(((code - 65 - shift + 26) % 26) + 65);
        keyIndex++;
      } else if(code >= 97 && code <= 122){
        const shift = key.charCodeAt(keyIndex % key.length) - 97;
        result += String.fromCharCode(((code - 97 - shift + 26) % 26) + 97);
        keyIndex++;
      } else {
        result += text[i];
      }
    }
    return result;
  },
  simpleHash: function(data){
    return HashUtils.fnv1a(data);
  },
  generateUUID: function(){
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },
  generateRandomBytes: function(length){
    const bytes = new Uint8Array(length);
    if(window.crypto && window.crypto.getRandomValues){
      window.crypto.getRandomValues(bytes);
    } else {
      for(let i = 0; i < length; i++){
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return bytes;
  },
  _stringToBytes: function(str){
    const bytes = new Uint8Array(str.length);
    for(let i = 0; i < str.length; i++){
      bytes[i] = str.charCodeAt(i) & 0xFF;
    }
    return bytes;
  }
};

/* ===== WebSocket客户端 =====
   支持: 自动重连 / 心跳 / 消息队列 / 事件分发
*/
function createWebSocketClient(url, options){
  const ws = {
    url: url,
    _socket: null,
    _connected: false,
    _closing: false,
    _closed: false,
    _reconnect: (options && options.reconnect !== undefined) ? options.reconnect : true,
    _reconnectDelay: (options && options.reconnectDelay) || 3000,
    _maxReconnectAttempts: (options && options.maxReconnectAttempts) || 10,
    _reconnectAttempts: 0,
    _heartbeatInterval: (options && options.heartbeatInterval) || 30000,
    _heartbeatTimer: null,
    _messageQueue: [],
    _listeners: new Map(),
    _reconnectTimer: null
  };

  function connect(){
    if(ws._socket && (ws._socket.readyState === WebSocket.OPEN || ws._socket.readyState === WebSocket.CONNECTING)){
      return;
    }
    if(ws._socket && (ws._socket.readyState === WebSocket.CLOSING || ws._socket.readyState === WebSocket.CLOSED)){
      ws._socket = null;
    }
    try{
      ws._closing = false;
      ws._closed = false;
      ws._socket = new WebSocket(ws.url);
      ws._socket.onopen = onOpen;
      ws._socket.onmessage = onMessage;
      ws._socket.onerror = onError;
      ws._socket.onclose = onClose;
    } catch(e){
      console.error('[WebSocket] 连接失败:', e);
      scheduleReconnect();
    }
  }

  function onOpen(){
    ws._connected = true;
    ws._closing = false;
    ws._closed = false;
    ws._reconnectAttempts = 0;
    emitEvent('connected', {});
    flushQueue();
    startHeartbeat();
  }

  function onMessage(event){
    let data = event.data;
    try{
      data = JSON.parse(data);
    } catch(e){}
    emitEvent('message', data);
    if(data && data.type){
      emitEvent(data.type, data);
    }
  }

  function onError(error){
    emitEvent('error', error);
  }

  function onClose(event){
    ws._connected = false;
    ws._closing = false;
    ws._closed = true;
    stopHeartbeat();
    emitEvent('disconnected', { code: event.code, reason: event.reason });
    if(ws._reconnect && ws._reconnectAttempts < ws._maxReconnectAttempts){
      scheduleReconnect();
    }
  }

  function scheduleReconnect(){
    if(!ws._reconnect || ws._closing) return;
    if(ws._reconnectTimer) clearTimeout(ws._reconnectTimer);
    ws._reconnectAttempts++;
    emitEvent('reconnecting', { attempt: ws._reconnectAttempts });
    ws._reconnectTimer = setTimeout(function(){
      if(ws._reconnect && !ws._closing){
        connect();
      }
    }, ws._reconnectDelay * Math.min(ws._reconnectAttempts, 5));
  }

  function send(data){
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    if(ws._closing || ws._closed || !ws._reconnect){
      return false;
    }
    if(ws._connected && ws._socket && ws._socket.readyState === WebSocket.OPEN){
      try{
        ws._socket.send(message);
        return true;
      } catch(e){
        ws._connected = false;
        ws._messageQueue.unshift(message);
        return false;
      }
    }
    ws._messageQueue.push(message);
    return false;
  }

  function flushQueue(){
    while(ws._messageQueue.length > 0 && ws._connected && ws._socket && ws._socket.readyState === WebSocket.OPEN){
      const msg = ws._messageQueue.shift();
      try{
        ws._socket.send(msg);
      } catch(e){
        ws._connected = false;
        ws._messageQueue.unshift(msg);
        break;
      }
    }
  }

  function startHeartbeat(){
    if(ws._heartbeatInterval <= 0) return;
    stopHeartbeat();
    ws._heartbeatTimer = setInterval(function(){
      if(ws._connected){
        send({ type: 'ping', time: Date.now() });
      }
    }, ws._heartbeatInterval);
  }

  function stopHeartbeat(){
    if(ws._heartbeatTimer){
      clearInterval(ws._heartbeatTimer);
      ws._heartbeatTimer = null;
    }
  }

  function on(event, callback){
    if(!ws._listeners.has(event)) ws._listeners.set(event, []);
    ws._listeners.get(event).push(callback);
  }

  function off(event, callback){
    const listeners = ws._listeners.get(event);
    if(listeners){
      const idx = listeners.indexOf(callback);
      if(idx >= 0) listeners.splice(idx, 1);
    }
  }

  function emitEvent(event, data){
    const listeners = ws._listeners.get(event);
    if(listeners){
      for(let i = 0; i < listeners.length; i++){
        try{ listeners[i](data); } catch(e){ console.error('[WebSocket] 事件错误:', e); }
      }
    }
  }

  function disconnect(){
    ws._reconnect = false;
    if(ws._reconnectTimer) clearTimeout(ws._reconnectTimer);
    stopHeartbeat();
    if(ws._socket){
      const state = ws._socket.readyState;
      if(state === WebSocket.OPEN || state === WebSocket.CONNECTING){
        ws._closing = true;
        ws._socket.close();
      } else {
        ws._socket = null;
      }
    }
    ws._connected = false;
    ws._closed = true;
  }

  function isConnected(){
    return ws._connected;
  }

  function getQueueLength(){
    return ws._messageQueue.length;
  }

  return { connect, send, on, off, disconnect, isConnected, getQueueLength, ws };
}

/* ===== HTTP客户端 =====
   支持: GET/POST/PUT/DELETE / 超时 / 重试 / 拦截器
*/
function createHttpClient(options){
  const http = {
    _baseURL: (options && options.baseURL) || '',
    _timeout: (options && options.timeout) || 30000,
    _headers: (options && options.headers) || {},
    _retryCount: (options && options.retryCount) || 0,
    _retryDelay: (options && options.retryDelay) || 1000,
    _interceptors: { request: [], response: [] }
  };

  function setBaseURL(url){
    http._baseURL = url;
  }

  function setHeader(name, value){
    http._headers[name] = value;
  }

  function removeHeader(name){
    delete http._headers[name];
  }

  function addRequestInterceptor(fn){
    http._interceptors.request.push(fn);
  }

  function addResponseInterceptor(fn){
    http._interceptors.response.push(fn);
  }

  function request(method, url, data, config){
    const fullUrl = http._baseURL + url;
    let headers = { ...http._headers, ...(config && config.headers) };
    let body = null;
    if(data !== undefined && data !== null){
      if(data instanceof FormData){
        body = data;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        body = JSON.stringify(data);
      }
    }
    let requestConfig = { method: method, url: fullUrl, headers: headers, body: body, data: data };
    for(let i = 0; i < http._interceptors.request.length; i++){
      requestConfig = http._interceptors.request[i](requestConfig) || requestConfig;
    }
    return executeWithRetry(requestConfig, config);
  }

  function executeWithRetry(requestConfig, config){
    const maxRetries = (config && config.retryCount !== undefined) ? config.retryCount : http._retryCount;
    return new Promise(function(resolve, reject){
      let attempts = 0;
      function tryRequest(){
        execute(requestConfig).then(function(response){
          let result = response;
          for(let i = 0; i < http._interceptors.response.length; i++){
            result = http._interceptors.response[i](result) || result;
          }
          resolve(result);
        }).catch(function(error){
          attempts++;
          if(attempts <= maxRetries && (error.status >= 500 || error.message === 'Network Error')){
            setTimeout(tryRequest, http._retryDelay * attempts);
          } else {
            reject(error);
          }
        });
      }
      tryRequest();
    });
  }

  function execute(requestConfig){
    return new Promise(function(resolve, reject){
      const controller = new AbortController();
      const timeoutId = setTimeout(function(){
        controller.abort();
      }, http._timeout);
      fetch(requestConfig.url, {
        method: requestConfig.method,
        headers: requestConfig.headers,
        body: requestConfig.body,
        signal: controller.signal
      }).then(function(response){
        clearTimeout(timeoutId);
        const contentType = response.headers.get('content-type') || '';
        const parser = contentType.indexOf('application/json') >= 0 ? 'json' : 'text';
        return response[parser]().then(function(data){
          if(response.ok){
            resolve({ status: response.status, data: data, headers: response.headers });
          } else {
            reject({ status: response.status, data: data, message: response.statusText });
          }
        });
      }).catch(function(error){
        clearTimeout(timeoutId);
        if(error.name === 'AbortError'){
          reject({ status: 0, message: 'Request Timeout' });
        } else {
          reject({ status: 0, message: 'Network Error', error: error });
        }
      });
    });
  }

  function get(url, config){
    return request('GET', url, null, config);
  }

  function post(url, data, config){
    return request('POST', url, data, config);
  }

  function put(url, data, config){
    return request('PUT', url, data, config);
  }

  function del(url, config){
    return request('DELETE', url, null, config);
  }

  function patch(url, data, config){
    return request('PATCH', url, data, config);
  }

  return { setBaseURL, setHeader, removeHeader, addRequestInterceptor, addResponseInterceptor, request, get, post, put, del, patch, http };
}



/* ===== 确定性随机数生成器 =====
   支持: 种子 / 状态保存 / 多种分布 / 可复现
*/
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

/* ===== 数组工具库 =====
   支持: 去重 / 分组 / 分块 / 扁平化 / 随机
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

/* ===== 颜色工具库 =====
   支持: RGB/HSL/HEX转换 / 混合 / 亮度 / 对比度
*/
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



/* ===== 时间与日期工具库 =====
   支持: 格式化 / 解析 / 计算 / 时区
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

/* ===== 对象工具库 =====
   支持: 深拷贝 / 合并 / 比较 / 遍历 / 路径访问
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
   支持: FPS / 帧时间 / 内存 / 调用计数 / 历史记录
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

/* ===== 环境与特性检测 =====
   支持: 浏览器 / 设备 / 性能 / WebGL能力
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



/* ===== DOM工具库 =====
   支持: 创建 / 查询 / 操作 / 遍历 / 事件
*/
const DOMUtils = {
  create: function(tag, attrs, children){
    const el = document.createElement(tag);
    if(attrs){
      for(const key in attrs){
        if(key === 'class') el.className = attrs[key];
        else if(key === 'style' && typeof attrs[key] === 'object') Object.assign(el.style, attrs[key]);
        else if(key.startsWith('on') && typeof attrs[key] === 'function') el.addEventListener(key.substring(2).toLowerCase(), attrs[key]);
        else if(key === 'dataset' && typeof attrs[key] === 'object') Object.assign(el.dataset, attrs[key]);
        else el.setAttribute(key, attrs[key]);
      }
    }
    if(children){
      if(typeof children === 'string') el.textContent = children;
      else if(children instanceof Node) el.appendChild(children);
      else if(Array.isArray(children)){
        children.forEach(function(child){
          if(typeof child === 'string') el.appendChild(document.createTextNode(child));
          else if(child instanceof Node) el.appendChild(child);
        });
      }
    }
    return el;
  },
  select: function(selector, context){
    return (context || document).querySelector(selector);
  },
  selectAll: function(selector, context){
    return Array.from((context || document).querySelectorAll(selector));
  },
  byId: function(id){
    return document.getElementById(id);
  },
  byClass: function(className, context){
    return Array.from((context || document).getElementsByClassName(className));
  },
  byTag: function(tagName, context){
    return Array.from((context || document).getElementsByTagName(tagName));
  },
  append: function(parent, child){
    if(typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else parent.appendChild(child);
    return parent;
  },
  prepend: function(parent, child){
    if(typeof child === 'string') child = document.createTextNode(child);
    parent.insertBefore(child, parent.firstChild);
    return parent;
  },
  insertAfter: function(newNode, referenceNode){
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
    return newNode;
  },
  insertBefore: function(newNode, referenceNode){
    referenceNode.parentNode.insertBefore(newNode, referenceNode);
    return newNode;
  },
  remove: function(el){
    if(el && el.parentNode) el.parentNode.removeChild(el);
  },
  empty: function(el){
    while(el.firstChild) el.removeChild(el.firstChild);
  },
  replace: function(oldEl, newEl){
    oldEl.parentNode.replaceChild(newEl, oldEl);
    return newEl;
  },
  clone: function(el, deep){
    return el.cloneNode(deep !== false);
  },
  contains: function(parent, child){
    return parent.contains(child);
  },
  matches: function(el, selector){
    return el.matches(selector);
  },
  closest: function(el, selector){
    return el.closest(selector);
  },
  parent: function(el, selector){
    if(selector) return el.closest(selector);
    return el.parentNode;
  },
  children: function(el, selector){
    if(selector) return Array.from(el.children).filter(function(c){ return c.matches(selector); });
    return Array.from(el.children);
  },
  firstChild: function(el, selector){
    const children = DOMUtils.children(el, selector);
    return children.length > 0 ? children[0] : null;
  },
  lastChild: function(el, selector){
    const children = DOMUtils.children(el, selector);
    return children.length > 0 ? children[children.length - 1] : null;
  },
  siblings: function(el, selector){
    const siblings = Array.from(el.parentNode.children).filter(function(c){ return c !== el; });
    if(selector) return siblings.filter(function(s){ return s.matches(selector); });
    return siblings;
  },
  next: function(el, selector){
    let next = el.nextElementSibling;
    while(next && selector && !next.matches(selector)) next = next.nextElementSibling;
    return next;
  },
  prev: function(el, selector){
    let prev = el.previousElementSibling;
    while(prev && selector && !prev.matches(selector)) prev = prev.previousElementSibling;
    return prev;
  },
  index: function(el){
    return Array.from(el.parentNode.children).indexOf(el);
  },
  attr: function(el, name, value){
    if(value === undefined) return el.getAttribute(name);
    if(value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    return el;
  },
  removeAttr: function(el, name){
    el.removeAttribute(name);
    return el;
  },
  hasAttr: function(el, name){
    return el.hasAttribute(name);
  },
  data: function(el, key, value){
    if(value === undefined) return el.dataset[key];
    el.dataset[key] = value;
    return el;
  },
  text: function(el, value){
    if(value === undefined) return el.textContent;
    el.textContent = value;
    return el;
  },
  html: function(el, value){
    if(value === undefined) return el.innerHTML;
    el.innerHTML = value;
    return el;
  },
  val: function(el, value){
    if(value === undefined) return el.value;
    el.value = value;
    return el;
  },
  addClass: function(el, className){
    el.classList.add(className);
    return el;
  },
  removeClass: function(el, className){
    el.classList.remove(className);
    return el;
  },
  toggleClass: function(el, className, force){
    el.classList.toggle(className, force);
    return el;
  },
  hasClass: function(el, className){
    return el.classList.contains(className);
  },
  replaceClass: function(el, oldClass, newClass){
    el.classList.replace(oldClass, newClass);
    return el;
  },
  css: function(el, prop, value){
    if(typeof prop === 'object'){
      Object.assign(el.style, prop);
      return el;
    }
    if(value === undefined) return getComputedStyle(el).getPropertyValue(prop);
    el.style[prop] = value;
    return el;
  },
  show: function(el, display){
    el.style.display = display || '';
    return el;
  },
  hide: function(el){
    el.style.display = 'none';
    return el;
  },
  toggle: function(el){
    el.style.display = el.style.display === 'none' ? '' : 'none';
    return el;
  },
  isVisible: function(el){
    return el.offsetParent !== null;
  },
  width: function(el, value){
    if(value === undefined) return el.offsetWidth;
    el.style.width = value + 'px';
    return el;
  },
  height: function(el, value){
    if(value === undefined) return el.offsetHeight;
    el.style.height = value + 'px';
    return el;
  },
  position: function(el){
    return { left: el.offsetLeft, top: el.offsetTop };
  },
  offset: function(el){
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top + window.pageYOffset,
      left: rect.left + window.pageXOffset,
      width: rect.width,
      height: rect.height
    };
  },
  rect: function(el){
    return el.getBoundingClientRect();
  },
  scrollTop: function(el, value){
    const target = el || window;
    if(value === undefined) return target === window ? window.pageYOffset : target.scrollTop;
    if(target === window) window.scrollTo(0, value);
    else target.scrollTop = value;
    return target;
  },
  scrollLeft: function(el, value){
    const target = el || window;
    if(value === undefined) return target === window ? window.pageXOffset : target.scrollLeft;
    if(target === window) window.scrollTo(value, 0);
    else target.scrollLeft = value;
    return target;
  },
  scrollIntoView: function(el, behavior){
    el.scrollIntoView({ behavior: behavior || 'smooth', block: 'start' });
    return el;
  },
  focus: function(el){
    el.focus();
    return el;
  },
  blur: function(el){
    el.blur();
    return el;
  },
  disabled: function(el, value){
    if(value === undefined) return el.disabled;
    el.disabled = value;
    return el;
  },
  checked: function(el, value){
    if(value === undefined) return el.checked;
    el.checked = value;
    return el;
  },
  serializeForm: function(form){
    const formData = new FormData(form);
    const result = {};
    for(const [key, value] of formData.entries()){
      if(result[key]){
        if(!Array.isArray(result[key])) result[key] = [result[key]];
        result[key].push(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },
  resetForm: function(form){
    form.reset();
    return form;
  },
  on: function(el, event, handler, options){
    el.addEventListener(event, handler, options);
    return el;
  },
  off: function(el, event, handler, options){
    el.removeEventListener(event, handler, options);
    return el;
  },
  once: function(el, event, handler, options){
    el.addEventListener(event, handler, { ...options, once: true });
    return el;
  },
  trigger: function(el, event, detail){
    const evt = new CustomEvent(event, { detail: detail, bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    return el;
  },
  delegate: function(parent, selector, event, handler){
    parent.addEventListener(event, function(e){
      const target = e.target.closest(selector);
      if(target && parent.contains(target)) handler.call(target, e);
    });
    return parent;
  }
};

/* ===== 存储工具库 =====
   支持: LocalStorage / SessionStorage / Cookie / 内存缓存
*/
const StorageUtils = {
  local: {
    set: function(key, value){
      try{
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch(e){
        console.error('[Storage] LocalStorage set error:', e);
        return false;
      }
    },
    get: function(key, defaultValue){
      try{
        const value = localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch(e){
        return defaultValue;
      }
    },
    remove: function(key){
      localStorage.removeItem(key);
    },
    clear: function(){
      localStorage.clear();
    },
    has: function(key){
      return localStorage.getItem(key) !== null;
    },
    keys: function(){
      return Object.keys(localStorage);
    },
    size: function(){
      return localStorage.length;
    },
    forEach: function(callback){
      for(let i = 0; i < localStorage.length; i++){
        const key = localStorage.key(i);
        callback(key, StorageUtils.local.get(key));
      }
    }
  },
  session: {
    set: function(key, value){
      try{
        sessionStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch(e){
        return false;
      }
    },
    get: function(key, defaultValue){
      try{
        const value = sessionStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch(e){
        return defaultValue;
      }
    },
    remove: function(key){
      sessionStorage.removeItem(key);
    },
    clear: function(){
      sessionStorage.clear();
    },
    has: function(key){
      return sessionStorage.getItem(key) !== null;
    },
    keys: function(){
      return Object.keys(sessionStorage);
    },
    size: function(){
      return sessionStorage.length;
    }
  },
  cookie: {
    set: function(name, value, options){
      options = options || {};
      let cookie = encodeURIComponent(name) + '=' + encodeURIComponent(JSON.stringify(value));
      if(options.expires){
        const expires = options.expires instanceof Date ? options.expires : new Date(Date.now() + options.expires * 86400000);
        cookie += '; expires=' + expires.toUTCString();
      }
      if(options.path) cookie += '; path=' + options.path;
      if(options.domain) cookie += '; domain=' + options.domain;
      if(options.secure) cookie += '; secure';
      if(options.sameSite) cookie += '; sameSite=' + options.sameSite;
      document.cookie = cookie;
    },
    get: function(name, defaultValue){
      const cookies = document.cookie.split(';');
      for(let i = 0; i < cookies.length; i++){
        const cookie = cookies[i].trim();
        if(cookie.indexOf(encodeURIComponent(name) + '=') === 0){
          try{
            return JSON.parse(decodeURIComponent(cookie.substring(encodeURIComponent(name).length + 1)));
          } catch(e){
            return defaultValue;
          }
        }
      }
      return defaultValue;
    },
    remove: function(name, options){
      options = options || {};
      StorageUtils.cookie.set(name, '', { ...options, expires: new Date(0) });
    },
    has: function(name){
      return document.cookie.split(';').some(function(c){
        return c.trim().indexOf(encodeURIComponent(name) + '=') === 0;
      });
    },
    keys: function(){
      return document.cookie.split(';').map(function(c){
        return decodeURIComponent(c.trim().split('=')[0]);
      }).filter(Boolean);
    },
    clear: function(options){
      const keys = StorageUtils.cookie.keys();
      keys.forEach(function(key){
        StorageUtils.cookie.remove(key, options);
      });
    },
    size: function(){
      return StorageUtils.cookie.keys().length;
    }
  },
  memory: {
    _store: {},
    set: function(key, value, ttl){
      StorageUtils.memory._store[key] = {
        value: value,
        expiresAt: ttl ? Date.now() + ttl : 0
      };
    },
    get: function(key, defaultValue){
      const entry = StorageUtils.memory._store[key];
      if(!entry) return defaultValue;
      if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
        delete StorageUtils.memory._store[key];
        return defaultValue;
      }
      return entry.value;
    },
    remove: function(key){
      delete StorageUtils.memory._store[key];
    },
    clear: function(){
      StorageUtils.memory._store = {};
    },
    has: function(key){
      const entry = StorageUtils.memory._store[key];
      if(!entry) return false;
      if(entry.expiresAt > 0 && Date.now() > entry.expiresAt){
        delete StorageUtils.memory._store[key];
        return false;
      }
      return true;
    },
    keys: function(){
      return Object.keys(StorageUtils.memory._store);
    },
    size: function(){
      return Object.keys(StorageUtils.memory._store).length;
    },
    cleanup: function(){
      const now = Date.now();
      for(const key in StorageUtils.memory._store){
        if(StorageUtils.memory._store[key].expiresAt > 0 && now > StorageUtils.memory._store[key].expiresAt){
          delete StorageUtils.memory._store[key];
        }
      }
    }
  },
  getBestStorage: function(){
    if(StorageUtils.local.has('__test__')) return 'local';
    if(StorageUtils.session.has('__test__')) return 'session';
    return 'memory';
  }
};

/* ===== 文件工具库 =====
   支持: 读取 / 写入 / 下载 / 格式转换
*/
const FileUtils = {
  readAsText: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsText(file);
    });
  },
  readAsDataURL: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsDataURL(file);
    });
  },
  readAsArrayBuffer: function(file){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = function(e){ reject(e); };
      reader.readAsArrayBuffer(file);
    });
  },
  readAsJSON: function(file){
    return FileUtils.readAsText(file).then(function(text){
      return JSON.parse(text);
    });
  },
  download: function(content, filename, mimeType){
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 100);
  },
  downloadJSON: function(data, filename){
    FileUtils.download(JSON.stringify(data, null, 2), filename || 'data.json', 'application/json');
  },
  downloadText: function(text, filename){
    FileUtils.download(text, filename || 'text.txt', 'text/plain');
  },
  downloadCSV: function(rows, filename){
    const csv = rows.map(function(row){
      return row.map(function(cell){
        if(typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))){
          return '"' + cell.replace(/"/g, '""') + '"';
        }
        return cell;
      }).join(',');
    }).join('\n');
    FileUtils.download('\uFEFF' + csv, filename || 'data.csv', 'text/csv');
  },
  formatSize: function(bytes){
    if(bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
  },
  getExtension: function(filename){
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  },
  getBaseName: function(filename){
    return filename.split('.').slice(0, -1).join('.');
  },
  getMimeType: function(filename){
    const ext = FileUtils.getExtension(filename);
    const types = {
      'txt': 'text/plain', 'html': 'text/html', 'css': 'text/css',
      'js': 'application/javascript', 'json': 'application/json',
      'xml': 'application/xml', 'pdf': 'application/pdf',
      'zip': 'application/zip', 'png': 'image/png', 'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml',
      'webp': 'image/webp', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
      'mp4': 'video/mp4', 'webm': 'video/webm', 'csv': 'text/csv',
      'md': 'text/markdown', 'yaml': 'text/yaml', 'yml': 'text/yaml'
    };
    return types[ext] || 'application/octet-stream';
  },
  isImage: function(filename){
    return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(FileUtils.getExtension(filename));
  },
  isVideo: function(filename){
    return ['mp4', 'webm', 'avi', 'mov', 'mkv', 'flv'].includes(FileUtils.getExtension(filename));
  },
  isAudio: function(filename){
    return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(FileUtils.getExtension(filename));
  },
  isText: function(filename){
    return ['txt', 'html', 'css', 'js', 'json', 'xml', 'csv', 'md', 'yaml', 'yml', 'log'].includes(FileUtils.getExtension(filename));
  },
  openFilePicker: function(accept, multiple){
    return new Promise(function(resolve){
      const input = document.createElement('input');
      input.type = 'file';
      if(accept) input.accept = accept;
      if(multiple) input.multiple = true;
      input.onchange = function(){
        resolve(multiple ? Array.from(input.files) : input.files[0]);
      };
      input.click();
    });
  },
  openImagePicker: function(){
    return FileUtils.openFilePicker('image/*', false);
  },
  dataURLToBlob: function(dataURL){
    const parts = dataURL.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for(let i = 0; i < rawLength; i++){
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  },
  blobToDataURL: function(blob){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
  arrayBufferToBlob: function(buffer, mimeType){
    return new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  },
  blobToArrayBuffer: function(blob){
    return new Promise(function(resolve, reject){
      const reader = new FileReader();
      reader.onload = function(e){ resolve(e.target.result); };
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }
};

/* ===== 图片工具库 =====
   支持: 加载 / 缩放 / 裁剪 / 压缩 / 格式转换
*/
const ImageUtils = {
  load: function(src){
    return new Promise(function(resolve, reject){
      const img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(e){ reject(e); };
      img.src = src;
    });
  },
  resize: function(img, maxWidth, maxHeight){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let width = img.width, height = img.height;
    if(maxWidth && width > maxWidth){
      height = height * (maxWidth / width);
      width = maxWidth;
    }
    if(maxHeight && height > maxHeight){
      width = width * (maxHeight / height);
      height = maxHeight;
    }
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  },
  crop: function(img, x, y, width, height){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
    return canvas;
  },
  compress: function(img, quality, maxWidth, maxHeight){
    const canvas = ImageUtils.resize(img, maxWidth, maxHeight);
    return canvas.toDataURL('image/jpeg', quality || 0.8);
  },
  toDataURL: function(img, format, quality){
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL(format || 'image/png', quality);
  },
  toBlob: function(img, format, quality){
    return new Promise(function(resolve){
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(function(blob){ resolve(blob); }, format || 'image/png', quality);
    });
  },
  getAverageColor: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1;
    canvas.height = 1;
    ctx.drawImage(img, 0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  },
  getDominantColors: function(img, count){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 50;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    const colorMap = {};
    for(let i = 0; i < data.length; i += 4){
      const r = Math.round(data[i] / 32) * 32;
      const g = Math.round(data[i+1] / 32) * 32;
      const b = Math.round(data[i+2] / 32) * 32;
      const key = r + ',' + g + ',' + b;
      colorMap[key] = (colorMap[key] || 0) + 1;
    }
    const sorted = Object.entries(colorMap).sort(function(a, b){ return b[1] - a[1]; });
    return sorted.slice(0, count || 5).map(function([key]){
      const [r, g, b] = key.split(',').map(Number);
      return { r: r, g: g, b: b };
    });
  },
  grayscale: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
      data[i] = data[i+1] = data[i+2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  invert: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      data[i] = 255 - data[i];
      data[i+1] = 255 - data[i+1];
      data[i+2] = 255 - data[i+2];
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  sepia: function(img){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      const r = data[i], g = data[i+1], b = data[i+2];
      data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
      data[i+1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
      data[i+2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  brightness: function(img, amount){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for(let i = 0; i < data.length; i += 4){
      data[i] = Math.max(0, Math.min(255, data[i] + amount));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + amount));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + amount));
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  contrast: function(img, amount){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const factor = (259 * (amount + 255)) / (255 * (259 - amount));
    for(let i = 0; i < data.length; i += 4){
      data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128));
      data[i+1] = Math.max(0, Math.min(255, factor * (data[i+1] - 128) + 128));
      data[i+2] = Math.max(0, Math.min(255, factor * (data[i+2] - 128) + 128));
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  },
  rotate: function(img, degrees){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const rad = degrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    canvas.width = img.width * cos + img.height * sin;
    canvas.height = img.width * sin + img.height * cos;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    return canvas;
  },
  flip: function(img, horizontal, vertical){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.translate(horizontal ? canvas.width : 0, vertical ? canvas.height : 0);
    ctx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    ctx.drawImage(img, 0, 0);
    return canvas;
  },
  watermark: function(img, text, x, y, font, color){
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    ctx.font = font || '20px Arial';
    ctx.fillStyle = color || 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(text, x || 10, y || 30);
    return canvas;
  },
  createThumbnail: function(img, size){
    return ImageUtils.resize(img, size, size);
  },
  getImageInfo: function(img){
    return {
      width: img.width,
      height: img.height,
      aspectRatio: img.width / img.height,
      megapixels: (img.width * img.height) / 1000000
    };
  }
};



/* ===== 键盘快捷键系统 =====
   支持: 组合键 / 序列 / 上下文 / 冲突检测
*/
function createKeyboardShortcuts(options){
  const ks = {
    _shortcuts: [],
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true,
    _context: (options && options.context) || 'global',
    _pressedKeys: new Set(),
    _sequenceBuffer: [],
    _sequenceTimeout: (options && options.sequenceTimeout) || 1000,
    _sequenceTimer: null,
    _listeners: []
  };

  function register(combo, handler, options){
    const shortcut = {
      combo: combo.toLowerCase(),
      handler: handler,
      context: (options && options.context) || 'global',
      description: (options && options.description) || '',
      enabled: (options && options.enabled !== undefined) ? options.enabled : true,
      preventDefault: (options && options.preventDefault !== undefined) ? options.preventDefault : true,
      stopPropagation: (options && options.stopPropagation) || false,
      isSequence: combo.includes(' ')
    };
    ks._shortcuts.push(shortcut);
    return shortcut;
  }

  function unregister(combo){
    const idx = ks._shortcuts.findIndex(function(s){ return s.combo === combo.toLowerCase(); });
    if(idx >= 0) ks._shortcuts.splice(idx, 1);
  }

  function enable(combo){
    const shortcut = ks._shortcuts.find(function(s){ return s.combo === combo.toLowerCase(); });
    if(shortcut) shortcut.enabled = true;
  }

  function disable(combo){
    const shortcut = ks._shortcuts.find(function(s){ return s.combo === combo.toLowerCase(); });
    if(shortcut) shortcut.enabled = false;
  }

  function setContext(context){
    ks._context = context;
  }

  function getContext(){
    return ks._context;
  }

  function parseCombo(combo){
    const parts = combo.split('+').map(function(p){ return p.trim().toLowerCase(); });
    const modifiers = new Set();
    let key = '';
    parts.forEach(function(part){
      if(['ctrl', 'alt', 'shift', 'meta', 'cmd', 'command', 'win', 'windows'].includes(part)){
        modifiers.add(normalizeModifier(part));
      } else {
        key = part;
      }
    });
    return { modifiers: modifiers, key: key };
  }

  function normalizeModifier(mod){
    const map = { 'cmd': 'meta', 'command': 'meta', 'win': 'meta', 'windows': 'meta' };
    return map[mod] || mod;
  }

  function matchEvent(shortcut, event){
    const parsed = parseCombo(shortcut.combo);
    if(parsed.key !== event.key.toLowerCase()) return false;
    if(parsed.modifiers.has('ctrl') !== event.ctrlKey) return false;
    if(parsed.modifiers.has('alt') !== event.altKey) return false;
    if(parsed.modifiers.has('shift') !== event.shiftKey) return false;
    if(parsed.modifiers.has('meta') !== event.metaKey) return false;
    return true;
  }

  function handleKeyDown(event){
    if(!ks._enabled) return;
    if(event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable){
      return;
    }
    ks._pressedKeys.add(event.key.toLowerCase());
    for(let i = 0; i < ks._shortcuts.length; i++){
      const shortcut = ks._shortcuts[i];
      if(!shortcut.enabled || shortcut.isSequence) continue;
      if(shortcut.context !== 'global' && shortcut.context !== ks._context) continue;
      if(matchEvent(shortcut, event)){
        if(shortcut.preventDefault) event.preventDefault();
        if(shortcut.stopPropagation) event.stopPropagation();
        shortcut.handler(event);
        emitEvent('shortcutTriggered', { combo: shortcut.combo, context: shortcut.context });
        break;
      }
    }
  }

  function handleKeyUp(event){
    ks._pressedKeys.delete(event.key.toLowerCase());
  }

  function start(){
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
  }

  function stop(){
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('keyup', handleKeyUp);
  }

  function getShortcuts(){
    return ks._shortcuts.map(function(s){
      return { combo: s.combo, description: s.description, context: s.context, enabled: s.enabled };
    });
  }

  function getShortcutsByContext(context){
    return getShortcuts().filter(function(s){ return s.context === context || s.context === 'global'; });
  }

  function on(event, callback){
    ks._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < ks._listeners.length; i++){
      if(ks._listeners[i].event === event){
        try{ ks._listeners[i].callback(data); } catch(e){ console.error('[KeyboardShortcuts] 事件错误:', e); }
      }
    }
  }

  function clear(){
    ks._shortcuts = [];
    ks._pressedKeys.clear();
  }

  start();
  return { register, unregister, enable, disable, setContext, getContext, start, stop, getShortcuts, getShortcutsByContext, on, clear, ks };
}

/* ===== 缓动函数库 =====
   支持: 30+种缓动 / 贝塞尔 / 弹性 / 回弹
*/
const EasingFunctions = {
  linear: function(t){ return t; },
  easeInQuad: function(t){ return t * t; },
  easeOutQuad: function(t){ return t * (2 - t); },
  easeInOutQuad: function(t){ return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
  easeInCubic: function(t){ return t * t * t; },
  easeOutCubic: function(t){ return (--t) * t * t + 1; },
  easeInOutCubic: function(t){ return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1; },
  easeInQuart: function(t){ return t * t * t * t; },
  easeOutQuart: function(t){ return 1 - (--t) * t * t * t; },
  easeInOutQuart: function(t){ return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t; },
  easeInQuint: function(t){ return t * t * t * t * t; },
  easeOutQuint: function(t){ return 1 + (--t) * t * t * t * t; },
  easeInOutQuint: function(t){ return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t; },
  easeInSine: function(t){ return 1 - Math.cos(t * Math.PI / 2); },
  easeOutSine: function(t){ return Math.sin(t * Math.PI / 2); },
  easeInOutSine: function(t){ return -(Math.cos(Math.PI * t) - 1) / 2; },
  easeInExpo: function(t){ return t === 0 ? 0 : Math.pow(2, 10 * t - 10); },
  easeOutExpo: function(t){ return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); },
  easeInOutExpo: function(t){
    if(t === 0) return 0;
    if(t === 1) return 1;
    return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },
  easeInCirc: function(t){ return 1 - Math.sqrt(1 - t * t); },
  easeOutCirc: function(t){ return Math.sqrt(1 - (--t) * t); },
  easeInOutCirc: function(t){
    return t < 0.5 ? (1 - Math.sqrt(1 - 4 * t * t)) / 2 : (Math.sqrt(1 - (-2 * t + 2) * (-2 * t + 2)) + 1) / 2;
  },
  easeInBack: function(t){
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: function(t){
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: function(t){
    const c1 = 1.70158, c2 = c1 * 1.525;
    return t < 0.5 ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2 :
           (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  easeInElastic: function(t){
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
  easeOutElastic: function(t){
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  easeInOutElastic: function(t){
    const c5 = (2 * Math.PI) / 4.5;
    if(t === 0) return 0;
    if(t === 1) return 1;
    return t < 0.5 ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2 :
           (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },
  easeOutBounce: function(t){
    const n1 = 7.5625, d1 = 2.75;
    if(t < 1 / d1) return n1 * t * t;
    if(t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if(t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  easeInBounce: function(t){
    return 1 - EasingFunctions.easeOutBounce(1 - t);
  },
  easeInOutBounce: function(t){
    return t < 0.5 ? (1 - EasingFunctions.easeOutBounce(1 - 2 * t)) / 2 :
           (1 + EasingFunctions.easeOutBounce(2 * t - 1)) / 2;
  },
  spring: function(t, stiffness, damping){
    const s = stiffness || 100, d = damping || 10;
    const zeta = d / (2 * Math.sqrt(s));
    const omega = Math.sqrt(s);
    if(zeta < 1){
      const omega_d = omega * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * omega * t) * (Math.cos(omega_d * t) + (zeta * omega / omega_d) * Math.sin(omega_d * t));
    } else if(zeta === 1){
      return 1 - (1 + omega * t) * Math.exp(-omega * t);
    } else {
      const omega_d = omega * Math.sqrt(zeta * zeta - 1);
      return 1 - Math.exp(-zeta * omega * t) * (Math.cosh(omega_d * t) + (zeta * omega / omega_d) * Math.sinh(omega_d * t));
    }
  },
  bezier: function(t, p1, p2, p3, p4){
    const u = 1 - t;
    return u * u * u * p1 + 3 * u * u * t * p2 + 3 * u * t * t * p3 + t * t * t * p4;
  },
  cubicBezier: function(x1, y1, x2, y2){
    return function(t){
      const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
      const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
      function sampleCurveX(t){ return ((ax * t + bx) * t + cx) * t; }
      function sampleCurveY(t){ return ((ay * t + by) * t + cy) * t; }
      function sampleCurveDerivativeX(t){ return (3 * ax * t + 2 * bx) * t + cx; }
      function solveCurveX(x){
        let t2 = x;
        for(let i = 0; i < 8; i++){
          const x2 = sampleCurveX(t2) - x;
          if(Math.abs(x2) < 1e-6) return t2;
          const d2 = sampleCurveDerivativeX(t2);
          if(Math.abs(d2) < 1e-6) break;
          t2 -= x2 / d2;
        }
        let t1 = 1, t0 = 0;
        t2 = x;
        while(t0 < t1){
          const x2 = sampleCurveX(t2);
          if(Math.abs(x2 - x) < 1e-6) return t2;
          if(x > x2) t0 = t2;
          else t1 = t2;
          t2 = (t1 - t0) * 0.5 + t0;
        }
        return t2;
      }
      return sampleCurveY(solveCurveX(t));
    };
  },
  getEasingNames: function(){
    return Object.keys(EasingFunctions).filter(function(key){
      return typeof EasingFunctions[key] === 'function' && key !== 'getEasingNames' && key !== 'bezier' && key !== 'cubicBezier' && key !== 'spring';
    });
  },
  getByName: function(name){
    return EasingFunctions[name] || EasingFunctions.linear;
  }
};

/* ===== 动画工具库 =====
   支持: 补间动画 / 关键帧 / 时间线 / 控制
*/
function createTweener(options){
  const tw = {
    _tweens: [],
    _time: 0,
    _running: false,
    _lastTime: 0,
    _listeners: []
  };

  function create(target, properties, duration, options){
    const tween = {
      target: target,
      properties: { ...properties },
      startValues: {},
      duration: duration || 1000,
      elapsed: 0,
      progress: 0,
      easing: (options && options.easing) || 'easeOutQuad',
      delay: (options && options.delay) || 0,
      repeat: (options && options.repeat) || 0,
      repeatDelay: (options && options.repeatDelay) || 0,
      yoyo: (options && options.yoyo) || false,
      paused: false,
      reversed: false,
      onStart: (options && options.onStart) || null,
      onUpdate: (options && options.onUpdate) || null,
      onComplete: (options && options.onComplete) || null,
      onRepeat: (options && options.onRepeat) || null,
      started: false,
      completed: false,
      repeatCount: 0
    };
    for(const key in properties){
      tween.startValues[key] = target[key];
    }
    tw._tweens.push(tween);
    return tween;
  }

  function update(deltaTime){
    for(let i = tw._tweens.length - 1; i >= 0; i--){
      const tween = tw._tweens[i];
      if(tween.paused || tween.completed) continue;
      if(tween.delay > 0){
        tween.delay -= deltaTime;
        continue;
      }
      if(!tween.started){
        tween.started = true;
        if(tween.onStart) tween.onStart(tween);
      }
      if(tween.reversed){
        tween.elapsed -= deltaTime;
        if(tween.elapsed <= 0){
          tween.elapsed = 0;
          if(tween.repeatCount < tween.repeat || tween.repeat === -1){
            tween.repeatCount++;
            tween.elapsed = tween.duration;
            tween.reversed = false;
            if(tween.onRepeat) tween.onRepeat(tween);
          } else {
            tween.completed = true;
            if(tween.onComplete) tween.onComplete(tween);
          }
        }
      } else {
        tween.elapsed += deltaTime;
        if(tween.elapsed >= tween.duration){
          tween.elapsed = tween.duration;
          if(tween.yoyo){
            tween.reversed = true;
            if(tween.repeatDelay > 0) tween.delay = tween.repeatDelay;
          } else if(tween.repeatCount < tween.repeat || tween.repeat === -1){
            tween.repeatCount++;
            tween.elapsed = 0;
            if(tween.repeatDelay > 0) tween.delay = tween.repeatDelay;
            if(tween.onRepeat) tween.onRepeat(tween);
          } else {
            tween.completed = true;
            if(tween.onComplete) tween.onComplete(tween);
          }
        }
      }
      tween.progress = tween.elapsed / tween.duration;
      const easingFn = typeof tween.easing === 'function' ? tween.easing : EasingFunctions.getByName(tween.easing);
      const easedProgress = easingFn(tween.progress);
      for(const key in tween.properties){
        const start = tween.startValues[key];
        const end = tween.properties[key];
        if(typeof start === 'number' && typeof end === 'number'){
          tween.target[key] = start + (end - start) * easedProgress;
        }
      }
      if(tween.onUpdate) tween.onUpdate(tween);
    }
    tw._tweens = tw._tweens.filter(function(t){ return !t.completed; });
  }

  function start(){
    if(tw._running) return;
    tw._running = true;
    tw._lastTime = performance.now();
    function loop(){
      if(!tw._running) return;
      const now = performance.now();
      const delta = now - tw._lastTime;
      tw._lastTime = now;
      update(delta);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function stop(){
    tw._running = false;
  }

  function pause(tween){
    if(tween) tween.paused = true;
    else tw._tweens.forEach(function(t){ t.paused = true; });
  }

  function resume(tween){
    if(tween) tween.paused = false;
    else tw._tweens.forEach(function(t){ t.paused = false; });
  }

  function kill(tween){
    const idx = tw._tweens.indexOf(tween);
    if(idx >= 0) tw._tweens.splice(idx, 1);
  }

  function killAll(){
    tw._tweens = [];
  }

  function getTweenCount(){
    return tw._tweens.length;
  }

  function getActiveTweens(){
    return tw._tweens.filter(function(t){ return !t.paused && !t.completed; });
  }

  return { create, update, start, stop, pause, resume, kill, killAll, getTweenCount, getActiveTweens, tw };
}

/* ===== 数学工具扩展 =====
   支持: 统计 / 插值 / 曲线 / 几何计算
*/
const MathUtils = {
  clamp: function(value, min, max){
    return Math.max(min, Math.min(max, value));
  },
  lerp: function(a, b, t){
    return a + (b - a) * t;
  },
  inverseLerp: function(a, b, value){
    return (value - a) / (b - a);
  },
  remap: function(value, inMin, inMax, outMin, outMax){
    return MathUtils.lerp(outMin, outMax, MathUtils.inverseLerp(inMin, inMax, value));
  },
  mapRange: function(value, inMin, inMax, outMin, outMax, clamp){
    const result = MathUtils.remap(value, inMin, inMax, outMin, outMax);
    return clamp ? MathUtils.clamp(result, outMin, outMax) : result;
  },
  smoothstep: function(edge0, edge1, x){
    const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  },
  smootherstep: function(edge0, edge1, x){
    const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  },
  pingpong: function(t, length){
    length = length || 1;
    return length - Math.abs(t % (2 * length) - length);
  },
  repeat: function(t, length){
    return t - Math.floor(t / length) * length;
  },
  deltaAngle: function(current, target){
    let delta = (target - current) % (Math.PI * 2);
    if(delta > Math.PI) delta -= Math.PI * 2;
    if(delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  },
  lerpAngle: function(a, b, t){
    return a + MathUtils.deltaAngle(a, b) * t;
  },
  moveTowards: function(current, target, maxDelta){
    if(Math.abs(target - current) <= maxDelta) return target;
    return current + Math.sign(target - current) * maxDelta;
  },
  moveTowardsAngle: function(current, target, maxDelta){
    const delta = MathUtils.deltaAngle(current, target);
    if(Math.abs(delta) <= maxDelta) return target;
    return current + Math.sign(delta) * maxDelta;
  },
  damp: function(current, target, lambda, dt){
    return MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
  },
  dampAngle: function(current, target, lambda, dt){
    return MathUtils.lerpAngle(current, target, 1 - Math.exp(-lambda * dt));
  },
  approach: function(current, target, delta){
    if(current < target) return Math.min(current + delta, target);
    return Math.max(current - delta, target);
  },
  isPowerOfTwo: function(value){
    return (value & (value - 1)) === 0 && value !== 0;
  },
  nextPowerOfTwo: function(value){
    let result = 1;
    while(result < value) result *= 2;
    return result;
  },
  factorial: function(n){
    if(n < 0) return NaN;
    if(n === 0 || n === 1) return 1;
    let result = 1;
    for(let i = 2; i <= n; i++) result *= i;
    return result;
  },
  combination: function(n, k){
    if(k < 0 || k > n) return 0;
    return MathUtils.factorial(n) / (MathUtils.factorial(k) * MathUtils.factorial(n - k));
  },
  permutation: function(n, k){
    if(k < 0 || k > n) return 0;
    return MathUtils.factorial(n) / MathUtils.factorial(n - k);
  },
  gcd: function(a, b){
    a = Math.abs(a);
    b = Math.abs(b);
    while(b){
      const t = b;
      b = a % b;
      a = t;
    }
    return a;
  },
  lcm: function(a, b){
    return Math.abs(a * b) / MathUtils.gcd(a, b);
  },
  mean: function(values){
    if(values.length === 0) return 0;
    return values.reduce(function(a, b){ return a + b; }, 0) / values.length;
  },
  median: function(values){
    const sorted = [...values].sort(function(a, b){ return a - b; });
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  mode: function(values){
    const frequency = {};
    let maxFreq = 0;
    let result = [];
    for(let i = 0; i < values.length; i++){
      frequency[values[i]] = (frequency[values[i]] || 0) + 1;
      if(frequency[values[i]] > maxFreq){
        maxFreq = frequency[values[i]];
        result = [values[i]];
      } else if(frequency[values[i]] === maxFreq){
        result.push(values[i]);
      }
    }
    return result;
  },
  variance: function(values){
    if(values.length === 0) return 0;
    const avg = MathUtils.mean(values);
    return values.reduce(function(sum, v){ return sum + (v - avg) * (v - avg); }, 0) / values.length;
  },
  standardDeviation: function(values){
    return Math.sqrt(MathUtils.variance(values));
  },
  min: function(values){
    return Math.min.apply(null, values);
  },
  max: function(values){
    return Math.max.apply(null, values);
  },
  range: function(values){
    return MathUtils.max(values) - MathUtils.min(values);
  },
  normalize: function(values){
    const min = MathUtils.min(values);
    const max = MathUtils.max(values);
    const range = max - min || 1;
    return values.map(function(v){ return (v - min) / range; });
  },
  percentile: function(values, p){
    const sorted = [...values].sort(function(a, b){ return a - b; });
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if(lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  },
  correlation: function(x, y){
    if(x.length !== y.length || x.length === 0) return 0;
    const meanX = MathUtils.mean(x), meanY = MathUtils.mean(y);
    let numerator = 0, denomX = 0, denomY = 0;
    for(let i = 0; i < x.length; i++){
      const dx = x[i] - meanX, dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }
    return numerator / Math.sqrt(denomX * denomY);
  },
  randomRange: function(min, max){
    return Math.random() * (max - min) + min;
  },
  randomInt: function(min, max){
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  randomChoice: function(array){
    return array[Math.floor(Math.random() * array.length)];
  },
  randomWeighted: function(items, weights){
    const total = weights.reduce(function(a, b){ return a + b; }, 0);
    let r = Math.random() * total;
    for(let i = 0; i < items.length; i++){
      r -= weights[i];
      if(r <= 0) return items[i];
    }
    return items[items.length - 1];
  },
  shuffle: function(array){
    const result = [...array];
    for(let i = result.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  degToRad: function(deg){
    return deg * Math.PI / 180;
  },
  radToDeg: function(rad){
    return rad * 180 / Math.PI;
  },
  distance: function(x1, y1, x2, y2){
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  },
  distance3D: function(x1, y1, z1, x2, y2, z2){
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
  },
  manhattanDistance: function(x1, y1, x2, y2){
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
  },
  chebyshevDistance: function(x1, y1, x2, y2){
    return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  },
  pointInCircle: function(px, py, cx, cy, r){
    return MathUtils.distance(px, py, cx, cy) <= r;
  },
  pointInRect: function(px, py, rx, ry, rw, rh){
    return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
  },
  circleCircleCollision: function(x1, y1, r1, x2, y2, r2){
    return MathUtils.distance(x1, y1, x2, y2) <= r1 + r2;
  },
  rectRectCollision: function(x1, y1, w1, h1, x2, y2, w2, h2){
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  },
  lineIntersection: function(x1, y1, x2, y2, x3, y3, x4, y4){
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if(denom === 0) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if(t >= 0 && t <= 1 && u >= 0 && u <= 1){
      return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1), t: t, u: u };
    }
    return null;
  },
  closestPointOnLine: function(px, py, x1, y1, x2, y2){
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if(lenSq === 0) return { x: x1, y: y1, t: 0 };
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = MathUtils.clamp(t, 0, 1);
    return { x: x1 + t * dx, y: y1 + t * dy, t: t };
  },
  areaOfTriangle: function(x1, y1, x2, y2, x3, y3){
    return Math.abs((x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2)) / 2);
  },
  centroidOfTriangle: function(x1, y1, x2, y2, x3, y3){
    return { x: (x1 + x2 + x3) / 3, y: (y1 + y2 + y3) / 3 };
  },
  circumcenterOfTriangle: function(x1, y1, x2, y2, x3, y3){
    const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    const ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d;
    const uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d;
    return { x: ux, y: uy };
  },
  incenterOfTriangle: function(x1, y1, x2, y2, x3, y3){
    const a = MathUtils.distance(x2, y2, x3, y3);
    const b = MathUtils.distance(x1, y1, x3, y3);
    const c = MathUtils.distance(x1, y1, x2, y2);
    const p = a + b + c;
    return { x: (a * x1 + b * x2 + c * x3) / p, y: (a * y1 + b * y2 + c * y3) / p };
  },
  polygonArea: function(points){
    let area = 0;
    for(let i = 0; i < points.length; i++){
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y;
      area -= points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
  },
  polygonCentroid: function(points){
    let cx = 0, cy = 0;
    const area = MathUtils.polygonArea(points);
    for(let i = 0; i < points.length; i++){
      const j = (i + 1) % points.length;
      const factor = points[i].x * points[j].y - points[j].x * points[i].y;
      cx += (points[i].x + points[j].x) * factor;
      cy += (points[i].y + points[j].y) * factor;
    }
    return { x: cx / (6 * area), y: cy / (6 * area) };
  },
  pointInPolygon: function(px, py, points){
    let inside = false;
    for(let i = 0, j = points.length - 1; i < points.length; j = i++){
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if(((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)){
        inside = !inside;
      }
    }
    return inside;
  }
};



/* ===== 剪贴板工具 =====
   支持: 复制 / 粘贴 / 监听 / 格式
*/
const ClipboardUtils = {
  copy: function(text){
    return new Promise(function(resolve, reject){
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(resolve).catch(reject);
      } else {
        try{
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          resolve();
        } catch(e){
          reject(e);
        }
      }
    });
  },
  paste: function(){
    return new Promise(function(resolve, reject){
      if(navigator.clipboard && navigator.clipboard.readText){
        navigator.clipboard.readText().then(resolve).catch(reject);
      } else {
        try{
          const textarea = document.createElement('textarea');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          document.execCommand('paste');
          const text = textarea.value;
          document.body.removeChild(textarea);
          resolve(text);
        } catch(e){
          reject(e);
        }
      }
    });
  },
  copyImage: function(image){
    return new Promise(function(resolve, reject){
      if(navigator.clipboard && window.ClipboardItem){
        image.toBlob(function(blob){
          if(!blob){ reject(new Error('Failed to create blob')); return; }
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(resolve).catch(reject);
        }, 'image/png');
      } else {
        reject(new Error('Clipboard API not supported'));
      }
    });
  },
  copyHTML: function(html){
    return new Promise(function(resolve, reject){
      try{
        const container = document.createElement('div');
        container.innerHTML = html;
        container.style.position = 'fixed';
        container.style.opacity = '0';
        document.body.appendChild(container);
        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('copy');
        selection.removeAllRanges();
        document.body.removeChild(container);
        resolve();
      } catch(e){
        reject(e);
      }
    });
  },
  onChange: function(callback){
    let lastText = '';
    setInterval(function(){
      ClipboardUtils.paste().then(function(text){
        if(text !== lastText){
          lastText = text;
          callback(text);
        }
      }).catch(function(){});
    }, 500);
  },
  isSupported: function(){
    return !!(navigator.clipboard && navigator.clipboard.writeText);
  }
};

/* ===== 通知工具 =====
   支持: 请求权限 / 发送 / 关闭 / 配置
*/
const NotificationUtils = {
  requestPermission: function(){
    return new Promise(function(resolve, reject){
      if(!('Notification' in window)){
        reject(new Error('Notifications not supported'));
        return;
      }
      Notification.requestPermission().then(resolve).catch(reject);
    });
  },
  getPermission: function(){
    if(!('Notification' in window)) return 'denied';
    return Notification.permission;
  },
  isSupported: function(){
    return 'Notification' in window;
  },
  send: function(title, options){
    return new Promise(function(resolve, reject){
      if(!('Notification' in window)){
        reject(new Error('Notifications not supported'));
        return;
      }
      if(Notification.permission !== 'granted'){
        reject(new Error('Permission not granted'));
        return;
      }
      const notification = new Notification(title, options || {});
      notification.onclick = function(){
        window.focus();
        notification.close();
      };
      resolve(notification);
    });
  },
  close: function(notification){
    if(notification) notification.close();
  },
  closeAll: function(){
  },
  configure: function(options){
    return {
      body: options.body || '',
      icon: options.icon || '',
      badge: options.badge || '',
      tag: options.tag || '',
      data: options.data || {},
      requireInteraction: options.requireInteraction || false,
      silent: options.silent || false,
      vibrate: options.vibrate || null,
      dir: options.dir || 'auto',
      lang: options.lang || 'en-US',
      renotify: options.renotify || false,
      sticky: options.sticky || false,
      image: options.image || '',
      actions: options.actions || []
    };
  }
};

/* ===== 全屏工具 =====
   支持: 进入 / 退出 / 切换 / 监听
*/
const FullscreenUtils = {
  request: function(element){
    const el = element || document.documentElement;
    if(el.requestFullscreen) return el.requestFullscreen();
    if(el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    if(el.mozRequestFullScreen) return el.mozRequestFullScreen();
    if(el.msRequestFullscreen) return el.msRequestFullscreen();
    return Promise.reject(new Error('Fullscreen not supported'));
  },
  exit: function(){
    if(document.exitFullscreen) return document.exitFullscreen();
    if(document.webkitExitFullscreen) return document.webkitExitFullscreen();
    if(document.mozCancelFullScreen) return document.mozCancelFullScreen();
    if(document.msExitFullscreen) return document.msExitFullscreen();
    return Promise.reject(new Error('Fullscreen not supported'));
  },
  toggle: function(element){
    if(FullscreenUtils.isActive()) return FullscreenUtils.exit();
    return FullscreenUtils.request(element);
  },
  isActive: function(){
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
  },
  getElement: function(){
    return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
  },
  isSupported: function(){
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || document.mozFullScreenEnabled || document.msFullscreenEnabled);
  },
  onChange: function(callback){
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    events.forEach(function(event){
      document.addEventListener(event, callback);
    });
    return function(){
      events.forEach(function(event){
        document.removeEventListener(event, callback);
      });
    };
  },
  onError: function(callback){
    const events = ['fullscreenerror', 'webkitfullscreenerror', 'mozfullscreenerror', 'MSFullscreenError'];
    events.forEach(function(event){
      document.addEventListener(event, callback);
    });
    return function(){
      events.forEach(function(event){
        document.removeEventListener(event, callback);
      });
    };
  }
};

/* ===== URL工具 =====
   支持: 解析 / 构建 / 参数 / 哈希
*/
const URLUtils = {
  parse: function(url){
    try{
      const u = new URL(url, window.location.origin);
      return {
        href: u.href,
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        host: u.host,
        origin: u.origin,
        username: u.username,
        password: u.password,
        params: URLUtils.getParams(u.search)
      };
    } catch(e){
      return null;
    }
  },
  build: function(parts){
    const url = new URL(window.location.origin);
    if(parts.protocol) url.protocol = parts.protocol;
    if(parts.hostname) url.hostname = parts.hostname;
    if(parts.port) url.port = parts.port;
    if(parts.pathname) url.pathname = parts.pathname;
    if(parts.params) URLUtils.setParams(url, parts.params);
    if(parts.hash) url.hash = parts.hash;
    return url.href;
  },
  getParams: function(search){
    const params = {};
    const query = search || window.location.search;
    const urlParams = new URLSearchParams(query);
    for(const [key, value] of urlParams.entries()){
      if(params[key]){
        if(!Array.isArray(params[key])) params[key] = [params[key]];
        params[key].push(value);
      } else {
        params[key] = value;
      }
    }
    return params;
  },
  getParam: function(name, search){
    const params = new URLSearchParams(search || window.location.search);
    return params.get(name);
  },
  setParam: function(name, value, search){
    const params = new URLSearchParams(search || window.location.search);
    params.set(name, value);
    return params.toString();
  },
  removeParam: function(name, search){
    const params = new URLSearchParams(search || window.location.search);
    params.delete(name);
    return params.toString();
  },
  hasParam: function(name, search){
    const params = new URLSearchParams(search || window.location.search);
    return params.has(name);
  },
  setParams: function(url, params){
    for(const key in params){
      if(Array.isArray(params[key])){
        url.searchParams.delete(key);
        params[key].forEach(function(v){ url.searchParams.append(key, v); });
      } else {
        url.searchParams.set(key, params[key]);
      }
    }
  },
  getHash: function(){
    return window.location.hash.substring(1);
  },
  setHash: function(hash){
    window.location.hash = hash;
  },
  removeHash: function(){
    history.pushState('', document.title, window.location.pathname + window.location.search);
  },
  getPath: function(){
    return window.location.pathname;
  },
  setPath: function(path){
    window.history.pushState({}, '', path);
  },
  redirect: function(url, target){
    if(target === '_blank') window.open(url, '_blank');
    else window.location.href = url;
  },
  reload: function(force){
    window.location.reload(force);
  },
  goBack: function(){
    window.history.back();
  },
  goForward: function(){
    window.history.forward();
  },
  go: function(steps){
    window.history.go(steps);
  },
  isAbsolute: function(url){
    return /^https?:\/\//i.test(url) || url.startsWith('//');
  },
  isRelative: function(url){
    return !URLUtils.isAbsolute(url);
  },
  isExternal: function(url){
    try{
      const u = new URL(url, window.location.origin);
      return u.origin !== window.location.origin;
    } catch(e){
      return false;
    }
  },
  join: function(){
    const parts = Array.prototype.slice.call(arguments);
    return parts.join('/').replace(/\/+/g, '/').replace(/:\//, '://');
  },
  normalize: function(url){
    try{
      return new URL(url, window.location.origin).href;
    } catch(e){
      return url;
    }
  },
  encode: function(str){
    return encodeURIComponent(str);
  },
  decode: function(str){
    return decodeURIComponent(str);
  },
  getBaseURL: function(){
    return window.location.origin + window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
  },
  getFileName: function(url){
    const path = url.split('?')[0].split('#')[0];
    return path.substring(path.lastIndexOf('/') + 1);
  },
  getExtension: function(url){
    const filename = URLUtils.getFileName(url);
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.substring(dot + 1).toLowerCase() : '';
  }
};

/* ===== 手势识别系统 =====
   支持: 触摸 / 鼠标 / 滑动 / 缩放 / 旋转
*/
function createGestureRecognizer(element, options){
  const gr = {
    element: element,
    _listeners: {},
    _touches: new Map(),
    _lastTouch: null,
    _startDistance: 0,
    _startAngle: 0,
    _threshold: (options && options.threshold) || 30,
    _velocityThreshold: (options && options.velocityThreshold) || 0.3,
    _enabled: true
  };

  function on(gesture, handler){
    if(!gr._listeners[gesture]) gr._listeners[gesture] = [];
    gr._listeners[gesture].push(handler);
  }

  function off(gesture, handler){
    if(!gr._listeners[gesture]) return;
    const idx = gr._listeners[gesture].indexOf(handler);
    if(idx >= 0) gr._listeners[gesture].splice(idx, 1);
  }

  function emit(gesture, data){
    if(gr._listeners[gesture]){
      gr._listeners[gesture].forEach(function(handler){
        try{ handler(data); } catch(e){ console.error('[Gesture] 处理器错误:', e); }
      });
    }
  }

  function getDistance(t1, t2){
    return Math.sqrt((t1.clientX - t2.clientX) ** 2 + (t1.clientY - t2.clientY) ** 2);
  }

  function getAngle(t1, t2){
    return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
  }

  function handleStart(e){
    if(!gr._enabled) return;
    const touches = e.touches || [e];
    for(let i = 0; i < touches.length; i++){
      gr._touches.set(touches[i].identifier || i, {
        x: touches[i].clientX,
        y: touches[i].clientY,
        startTime: Date.now(),
        startX: touches[i].clientX,
        startY: touches[i].clientY
      });
    }
    if(gr._touches.size === 1){
      const t = Array.from(gr._touches.values())[0];
      emit('tapstart', { x: t.x, y: t.y });
    } else if(gr._touches.size === 2){
      const touches = Array.from(gr._touches.values());
      gr._startDistance = getDistance(touches[0], touches[1]);
      gr._startAngle = getAngle(touches[0], touches[1]);
      emit('pinchstart', { distance: gr._startDistance, angle: gr._startAngle });
    }
  }

  function handleMove(e){
    if(!gr._enabled) return;
    e.preventDefault();
    const touches = e.touches || [e];
    for(let i = 0; i < touches.length; i++){
      const id = touches[i].identifier || i;
      const touch = gr._touches.get(id);
      if(touch){
        touch.x = touches[i].clientX;
        touch.y = touches[i].clientY;
      }
    }
    if(gr._touches.size === 1){
      const t = Array.from(gr._touches.values())[0];
      const dx = t.x - t.startX;
      const dy = t.y - t.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      emit('pan', { x: t.x, y: t.y, dx: dx, dy: dy, distance: distance });
      if(distance > gr._threshold){
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        let direction = 'none';
        if(angle >= -45 && angle <= 45) direction = 'right';
        else if(angle > 45 && angle < 135) direction = 'down';
        else if(angle >= 135 || angle <= -135) direction = 'left';
        else if(angle > -135 && angle < -45) direction = 'up';
        emit('swipe', { direction: direction, angle: angle, distance: distance, dx: dx, dy: dy });
      }
    } else if(gr._touches.size === 2){
      const touches = Array.from(gr._touches.values());
      const distance = getDistance(touches[0], touches[1]);
      const angle = getAngle(touches[0], touches[1]);
      const scale = distance / gr._startDistance;
      const rotation = (angle - gr._startAngle) * 180 / Math.PI;
      emit('pinch', { scale: scale, rotation: rotation, distance: distance });
      emit('rotate', { rotation: rotation, scale: scale });
    }
  }

  function handleEnd(e){
    if(!gr._enabled) return;
    const touches = e.changedTouches || [e];
    for(let i = 0; i < touches.length; i++){
      const id = touches[i].identifier || i;
      const touch = gr._touches.get(id);
      if(touch){
        const duration = Date.now() - touch.startTime;
        const dx = touches[i].clientX - touch.startX;
        const dy = touches[i].clientY - touch.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const velocity = distance / (duration || 1);
        if(duration < 300 && distance < 10){
          emit('tap', { x: touches[i].clientX, y: touches[i].clientY, duration: duration });
          if(duration < 200) emit('shorttap', { x: touches[i].clientX, y: touches[i].clientY });
        }
        if(duration > 500 && distance < 10){
          emit('longpress', { x: touches[i].clientX, y: touches[i].clientY, duration: duration });
        }
        if(velocity > gr._velocityThreshold && distance > gr._threshold){
          emit('flick', { x: touches[i].clientX, y: touches[i].clientY, velocity: velocity, dx: dx, dy: dy });
        }
        emit('panend', { x: touches[i].clientX, y: touches[i].clientY, dx: dx, dy: dy, distance: distance, velocity: velocity });
        gr._touches.delete(id);
      }
    }
    if(gr._touches.size === 0){
      emit('gestureend', {});
    }
  }

  function enable(){
    gr._enabled = true;
  }

  function disable(){
    gr._enabled = false;
    gr._touches.clear();
  }

  function destroy(){
    gr.element.removeEventListener('touchstart', handleStart);
    gr.element.removeEventListener('touchmove', handleMove);
    gr.element.removeEventListener('touchend', handleEnd);
    gr.element.removeEventListener('touchcancel', handleEnd);
    gr.element.removeEventListener('mousedown', handleStart);
    gr.element.removeEventListener('mousemove', handleMove);
    gr.element.removeEventListener('mouseup', handleEnd);
  }

  gr.element.addEventListener('touchstart', handleStart, { passive: false });
  gr.element.addEventListener('touchmove', handleMove, { passive: false });
  gr.element.addEventListener('touchend', handleEnd);
  gr.element.addEventListener('touchcancel', handleEnd);
  gr.element.addEventListener('mousedown', handleStart);
  gr.element.addEventListener('mousemove', handleMove);
  gr.element.addEventListener('mouseup', handleEnd);

  return { on, off, enable, disable, destroy, gr };
}


/* ===== 公开 API ===== */

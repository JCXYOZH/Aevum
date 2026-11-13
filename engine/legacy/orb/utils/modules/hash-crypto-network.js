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
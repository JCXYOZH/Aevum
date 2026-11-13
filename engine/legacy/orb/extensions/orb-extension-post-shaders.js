/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-post-shaders
 * 从 legacy/_orb_expand_part12.js 转换 (GBK->UTF-8)
 * @module orb-extension-post-shaders
 */
'use strict';



/* ===== 后处理着色器库=====
   支持: 色差 / 鱼眼 / 像素化/ 扫描线/ CRT / 故障 / 油画
*/
const PostProcessShaders = {
  fullscreenVertex: `
    attribute vec2 aPosition;
    varying vec2 vUV;
    void main(){
      vUV = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `,
  chromaticAberration: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uAmount;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 dir = vUV - 0.5;
      float dist = length(dir);
      vec2 offset = dir * dist * uAmount;
      float r = texture2D(uTexture, vUV + offset).r;
      float g = texture2D(uTexture, vUV).g;
      float b = texture2D(uTexture, vUV - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
  fisheye: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uStrength;
    varying vec2 vUV;
    void main(){
      vec2 uv = vUV - 0.5;
      float dist = length(uv);
      float z = sqrt(1.0 - dist * dist * uStrength);
      vec2 projected = uv / (z + 0.5);
      projected = projected * 0.5 + 0.5;
      if(projected.x < 0.0 || projected.x > 1.0 || projected.y < 0.0 || projected.y > 1.0){
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        gl_FragColor = texture2D(uTexture, projected);
      }
    }
  `,
  pixelate: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uPixelSize;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 pixel = uPixelSize / uResolution;
      vec2 uv = floor(vUV / pixel) * pixel;
      gl_FragColor = texture2D(uTexture, uv);
    }
  `,
  scanlines: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uIntensity;
    uniform float uLineWidth;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec4 color = texture2D(uTexture, vUV);
      float scanline = sin(vUV.y * uResolution.y * 3.14159 / uLineWidth) * 0.5 + 0.5;
      color.rgb *= 1.0 - scanline * uIntensity;
      gl_FragColor = color;
    }
  `,
  crt: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 uv = vUV;
      float scanline = sin(uv.y * uResolution.y * 3.14159) * 0.1;
      float noise = fract(sin(dot(uv * uTime, vec2(12.9898, 78.233))) * 43758.5453) * 0.02;
      vec4 color = texture2D(uTexture, uv);
      color.rgb -= scanline;
      color.rgb += noise - 0.01;
      float vignette = 1.0 - length(uv - 0.5) * 0.8;
      color.rgb *= vignette;
      color.rgb = (color.rgb - 0.5) * 1.1 + 0.5;
      gl_FragColor = color;
    }
  `,
  glitch: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uIntensity;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 uv = vUV;
      float block = floor(uv.y * 20.0 + uTime * 5.0);
      float offset = sin(block * 12.9898) * uIntensity * 0.1;
      uv.x += offset;
      vec4 color = texture2D(uTexture, uv);
      float r = texture2D(uTexture, uv + vec2(offset, 0.0)).r;
      float b = texture2D(uTexture, uv - vec2(offset, 0.0)).b;
      color.r = r;
      color.b = b;
      if(fract(uTime * 3.0) > 0.95){
        color.rgb = 1.0 - color.rgb;
      }
      gl_FragColor = color;
    }
  `,
  oilPainting: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uRadius;
    uniform int uLevels;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 texel = 1.0 / uResolution;
      vec3 mean = vec3(0.0);
      float count = 0.0;
      for(float y = -uRadius; y <= uRadius; y += 1.0){
        for(float x = -uRadius; x <= uRadius; x += 1.0){
          mean += texture2D(uTexture, vUV + vec2(x, y) * texel).rgb;
          count += 1.0;
        }
      }
      mean /= count;
      float levels = float(uLevels);
      mean = floor(mean * levels) / levels;
      gl_FragColor = vec4(mean, 1.0);
    }
  `,
  sketch: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uThreshold;
    uniform vec2 uResolution;
    varying vec2 vUV;
    void main(){
      vec2 texel = 1.0 / uResolution;
      vec3 center = texture2D(uTexture, vUV).rgb;
      vec3 left = texture2D(uTexture, vUV - vec2(texel.x, 0.0)).rgb;
      vec3 right = texture2D(uTexture, vUV + vec2(texel.x, 0.0)).rgb;
      vec3 up = texture2D(uTexture, vUV - vec2(0.0, texel.y)).rgb;
      vec3 down = texture2D(uTexture, vUV + vec2(0.0, texel.y)).rgb;
      float edge = length(center - left) + length(center - right) + length(center - up) + length(center - down);
      float gray = dot(center, vec3(0.299, 0.587, 0.114));
      float sketch = 1.0 - step(uThreshold, edge);
      gl_FragColor = vec4(vec3(sketch * gray), 1.0);
    }
  `,
  dream: `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUV;
    void main(){
      vec2 uv = vUV;
      uv.x += sin(uv.y * 10.0 + uTime) * 0.01 * uIntensity;
      uv.y += cos(uv.x * 10.0 + uTime) * 0.01 * uIntensity;
      vec4 color = texture2D(uTexture, uv);
      color.r = texture2D(uTexture, uv + vec2(0.01 * uIntensity, 0.0)).r;
      color.b = texture2D(uTexture, uv - vec2(0.01 * uIntensity, 0.0)).b;
      color.rgb = (color.rgb - 0.5) * 1.2 + 0.5;
      color.rgb += sin(uv.x * 20.0 + uTime) * 0.05 * uIntensity;
      gl_FragColor = color;
    }
  `,
  createProgram: function(gl, fragmentShader){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, PostProcessShaders.fullscreenVertex);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  },
  createAll: function(gl){
    return {
      chromaticAberration: PostProcessShaders.createProgram(gl, PostProcessShaders.chromaticAberration),
      fisheye: PostProcessShaders.createProgram(gl, PostProcessShaders.fisheye),
      pixelate: PostProcessShaders.createProgram(gl, PostProcessShaders.pixelate),
      scanlines: PostProcessShaders.createProgram(gl, PostProcessShaders.scanlines),
      crt: PostProcessShaders.createProgram(gl, PostProcessShaders.crt),
      glitch: PostProcessShaders.createProgram(gl, PostProcessShaders.glitch),
      oilPainting: PostProcessShaders.createProgram(gl, PostProcessShaders.oilPainting),
      sketch: PostProcessShaders.createProgram(gl, PostProcessShaders.sketch),
      dream: PostProcessShaders.createProgram(gl, PostProcessShaders.dream)
    };
  }
};

/* ===== 调试可视化着色器 =====
   支持: 法线 / 深度 / UV / 金属度/ 粗糙度/ 世界坐标
*/
const DebugShaders = {
  vertexShader: `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUV;
    uniform mat4 uModel;
    uniform mat4 uView;
    uniform mat4 uProj;
    uniform mat3 uNormalMatrix;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec2 vUV;
    void main(){
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vUV = aUV;
      gl_Position = uProj * uView * worldPos;
    }
  `,
  normalFragment: `
    precision mediump float;
    varying vec3 vNormal;
    void main(){
      gl_FragColor = vec4(vNormal * 0.5 + 0.5, 1.0);
    }
  `,
  uvFragment: `
    precision mediump float;
    varying vec2 vUV;
    void main(){
      gl_FragColor = vec4(vUV, 0.0, 1.0);
    }
  `,
  worldPositionFragment: `
    precision highp float;
    varying vec3 vWorldPos;
    void main(){
      gl_FragColor = vec4(vWorldPos * 0.1 + 0.5, 1.0);
    }
  `,
  depthFragment: `
    precision mediump float;
    varying vec4 vViewPos;
    uniform float uNear;
    uniform float uFar;
    void main(){
      float depth = (vViewPos.z - uNear) / (uFar - uNear);
      gl_FragColor = vec4(vec3(depth), 1.0);
    }
  `,
  wireframeFragment: `
    precision mediump float;
    uniform vec3 uColor;
    void main(){
      gl_FragColor = vec4(uColor, 1.0);
    }
  `,
  createProgram: function(gl, fragmentShader){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, DebugShaders.vertexShader);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragmentShader);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  },
  createAll: function(gl){
    return {
      normal: DebugShaders.createProgram(gl, DebugShaders.normalFragment),
      uv: DebugShaders.createProgram(gl, DebugShaders.uvFragment),
      worldPosition: DebugShaders.createProgram(gl, DebugShaders.worldPositionFragment),
      wireframe: DebugShaders.createProgram(gl, DebugShaders.wireframeFragment)
    };
  }
};

/* ===== 异步任务系统 =====
   支持: 任务队列 / 优先级/ 依赖 / 取消 / 进度
*/
function createTaskSystem(options){
  const ts = {
    _queue: [],
    _running: false,
    _maxConcurrent: (options && options.maxConcurrent) || 4,
    _activeTasks: 0,
    _taskIdCounter: 1,
    _listeners: []
  };

  function createTask(fn, options){
    const task = {
      id: ts._taskIdCounter++,
      fn: fn,
      priority: (options && options.priority) || 0,
      dependencies: (options && options.dependencies) || [],
      status: 'pending',
      progress: 0,
      result: null,
      error: null,
      startTime: 0,
      endTime: 0,
      onProgress: (options && options.onProgress) || null,
      onComplete: (options && options.onComplete) || null,
      onError: (options && options.onError) || null
    };
    return task;
  }

  function submit(task){
    ts._queue.push(task);
    ts._queue.sort(function(a, b){ return b.priority - a.priority; });
    emitEvent('taskSubmitted', task);
    processQueue();
    return task.id;
  }

  function processQueue(){
    if(!ts._running) return;
    while(ts._activeTasks < ts._maxConcurrent && ts._queue.length > 0){
      const task = ts._queue[0];
      let dependenciesMet = true;
      for(let i = 0; i < task.dependencies.length; i++){
        const dep = findTask(task.dependencies[i]);
        if(!dep || dep.status !== 'completed'){
          dependenciesMet = false;
          break;
        }
      }
      if(!dependenciesMet){
        ts._queue.push(ts._queue.shift());
        continue;
      }
      ts._queue.shift();
      executeTask(task);
    }
  }

  function executeTask(task){
    task.status = 'running';
    task.startTime = Date.now();
    ts._activeTasks++;
    emitEvent('taskStarted', task);
    try{
      const result = task.fn(function(progress){
        task.progress = progress;
        if(task.onProgress) task.onProgress(progress);
        emitEvent('taskProgress', task);
      });
      if(result && typeof result.then === 'function'){
        result.then(function(res){
          completeTask(task, res);
        }).catch(function(err){
          failTask(task, err);
        });
      } else {
        completeTask(task, result);
      }
    } catch(e){
      failTask(task, e);
    }
  }

  function completeTask(task, result){
    task.status = 'completed';
    task.result = result;
    task.endTime = Date.now();
    task.progress = 1;
    ts._activeTasks--;
    if(task.onComplete) task.onComplete(result);
    emitEvent('taskCompleted', task);
    processQueue();
  }

  function failTask(task, error){
    task.status = 'failed';
    task.error = error;
    task.endTime = Date.now();
    ts._activeTasks--;
    if(task.onError) task.onError(error);
    emitEvent('taskFailed', task);
    processQueue();
  }

  function cancelTask(id){
    for(let i = 0; i < ts._queue.length; i++){
      if(ts._queue[i].id === id){
        ts._queue[i].status = 'cancelled';
        ts._queue.splice(i, 1);
        emitEvent('taskCancelled', { id: id });
        return true;
      }
    }
    return false;
  }

  function findTask(id){
    for(let i = 0; i < ts._queue.length; i++){
      if(ts._queue[i].id === id) return ts._queue[i];
    }
    return null;
  }

  function getTaskStatus(id){
    const task = findTask(id);
    return task ? task.status : 'not_found';
  }

  function getTaskProgress(id){
    const task = findTask(id);
    return task ? task.progress : 0;
  }

  function start(){
    ts._running = true;
    processQueue();
  }

  function stop(){
    ts._running = false;
  }

  function waitForAll(callback){
    const check = setInterval(function(){
      if(ts._queue.length === 0 && ts._activeTasks === 0){
        clearInterval(check);
        callback();
      }
    }, 10);
  }

  function on(event, callback){
    ts._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < ts._listeners.length; i++){
      if(ts._listeners[i].event === event){
        try{ ts._listeners[i].callback(data); } catch(e){ console.error('[TaskSystem] 事件错误:', e); }
      }
    }
  }

  function getQueueLength(){
    return ts._queue.length;
  }

  function getActiveCount(){
    return ts._activeTasks;
  }

  function clear(){
    ts._queue = [];
    ts._activeTasks = 0;
  }

  return { createTask, submit, cancelTask, getTaskStatus, getTaskProgress, start, stop, waitForAll, on, getQueueLength, getActiveCount, clear, ts };
}

/* ===== 哈希与校验系统=====
   支持: CRC32 / MD5 / SHA1 / FNV / 字符串哈希*/
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

/* ===== 简单加密系统=====
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

/* ===== WebSocket客户端=====
   支持: 自动重连 / 心跳 / 消息队列 / 事件分发
*/
function createWebSocketClient(url, options){
  const ws = {
    url: url,
    _socket: null,
    _connected: false,
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
    try{
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
    stopHeartbeat();
    emitEvent('disconnected', { code: event.code, reason: event.reason });
    if(ws._reconnect && ws._reconnectAttempts < ws._maxReconnectAttempts){
      scheduleReconnect();
    }
  }

  function scheduleReconnect(){
    if(ws._reconnectTimer) clearTimeout(ws._reconnectTimer);
    ws._reconnectAttempts++;
    emitEvent('reconnecting', { attempt: ws._reconnectAttempts });
    ws._reconnectTimer = setTimeout(function(){
      connect();
    }, ws._reconnectDelay * Math.min(ws._reconnectAttempts, 5));
  }

  function send(data){
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    if(!ws._reconnect){
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
      ws._socket.close();
    }
  }

  function isConnected(){
    return ws._connected;
  }

  function getQueueLength(){
    return ws._messageQueue.length;
  }

  return { connect, send, on, off, disconnect, isConnected, getQueueLength, ws };
}

/* ===== HTTP客户端=====
   支持: GET/POST/PUT/DELETE / 超时 / 重试 / 拦截器*/
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

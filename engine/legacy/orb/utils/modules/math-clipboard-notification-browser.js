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
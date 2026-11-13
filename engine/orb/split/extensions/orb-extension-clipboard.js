/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-clipboard
 * 从 legacy/_orb_expand_part17.js 转换 (GBK->UTF-8)
 * @module orb-extension-clipboard
 */
'use strict';



/* ===== 剪贴板工具=====
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
   支持: 请求权限 / 发送/ 关闭 / 配置
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
   支持: 进入 / 退出/ 切换 / 监听
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
        try{ handler(data); } catch(e){ console.error('[Gesture] 处理器错误', e); }
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

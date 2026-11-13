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
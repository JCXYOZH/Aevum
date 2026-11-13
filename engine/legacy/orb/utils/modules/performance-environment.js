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
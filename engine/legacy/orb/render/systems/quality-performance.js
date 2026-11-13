const QualityLevel = { LOW: 0, MEDIUM: 1, HIGH: 2, ULTRA: 3, CUSTOM: 4 };

function createQualitySettings(options){
  const qs = {
    _level: (options && options.level) || QualityLevel.MEDIUM,
    _settings: {
      shadowResolution: 1024,
      shadowCascades: 4,
      antialiasing: 'FXAA',
      textureQuality: 1,
      particleBudget: 1000,
      postProcessing: true,
      bloom: true,
      ssao: false,
      dof: false,
      motionBlur: false,
      volumetricLight: false,
      lensFlare: false,
      outline: false,
      terrainDetail: 1,
      vegetationDensity: 1,
      lodBias: 0,
      viewDistance: 100,
      reflectionProbes: false,
      globalIllumination: false,
      tessellation: false,
      hdr: true,
      colorGrading: true,
      filmGrain: 0,
      vignette: 0.5
    },
    _presets: {}
  };

  function initPresets(){
    qs._presets[QualityLevel.LOW] = {
      shadowResolution: 512, shadowCascades: 2, antialiasing: 'NONE',
      textureQuality: 0.5, particleBudget: 500, postProcessing: false,
      bloom: false, ssao: false, dof: false, motionBlur: false,
      volumetricLight: false, lensFlare: false, outline: false,
      terrainDetail: 0.5, vegetationDensity: 0.3, lodBias: -1,
      viewDistance: 50, reflectionProbes: false, globalIllumination: false,
      tessellation: false, hdr: false, colorGrading: false,
      filmGrain: 0, vignette: 0.3
    };
    qs._presets[QualityLevel.MEDIUM] = {
      shadowResolution: 1024, shadowCascades: 4, antialiasing: 'FXAA',
      textureQuality: 1, particleBudget: 1000, postProcessing: true,
      bloom: true, ssao: false, dof: false, motionBlur: false,
      volumetricLight: false, lensFlare: false, outline: false,
      terrainDetail: 1, vegetationDensity: 0.7, lodBias: 0,
      viewDistance: 100, reflectionProbes: false, globalIllumination: false,
      tessellation: false, hdr: true, colorGrading: true,
      filmGrain: 0, vignette: 0.5
    };
    qs._presets[QualityLevel.HIGH] = {
      shadowResolution: 2048, shadowCascades: 4, antialiasing: 'SMAA',
      textureQuality: 1, particleBudget: 2000, postProcessing: true,
      bloom: true, ssao: true, dof: true, motionBlur: true,
      volumetricLight: true, lensFlare: true, outline: true,
      terrainDetail: 1.5, vegetationDensity: 1, lodBias: 0.5,
      viewDistance: 200, reflectionProbes: true, globalIllumination: false,
      tessellation: false, hdr: true, colorGrading: true,
      filmGrain: 0.05, vignette: 0.5
    };
    qs._presets[QualityLevel.ULTRA] = {
      shadowResolution: 4096, shadowCascades: 6, antialiasing: 'TAA',
      textureQuality: 1, particleBudget: 5000, postProcessing: true,
      bloom: true, ssao: true, dof: true, motionBlur: true,
      volumetricLight: true, lensFlare: true, outline: true,
      terrainDetail: 2, vegetationDensity: 1.5, lodBias: 1,
      viewDistance: 500, reflectionProbes: true, globalIllumination: true,
      tessellation: true, hdr: true, colorGrading: true,
      filmGrain: 0.1, vignette: 0.5
    };
  }

  function setQualityLevel(level){
    qs._level = level;
    if(qs._presets[level]){
      Object.assign(qs._settings, qs._presets[level]);
    }
  }

  function getQualityLevel(){
    return qs._level;
  }

  function set(name, value){
    qs._settings[name] = value;
    qs._level = QualityLevel.CUSTOM;
  }

  function get(name){
    return qs._settings[name];
  }

  function getAll(){
    return { ...qs._settings };
  }

  function getQualityName(level){
    const names = ['低', '中', '高', '极高', '自定义'];
    return names[level] || '未知';
  }

  function getAvailableLevels(){
    return [QualityLevel.LOW, QualityLevel.MEDIUM, QualityLevel.HIGH, QualityLevel.ULTRA];
  }

  function autoDetect(){
    const gl = document.createElement('canvas').getContext('webgl2');
    if(!gl) return QualityLevel.LOW;
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
    if(renderer.indexOf('RTX') >= 0 || renderer.indexOf('RX 7') >= 0) return QualityLevel.ULTRA;
    if(renderer.indexOf('GTX 1') >= 0 || renderer.indexOf('RX 5') >= 0 || renderer.indexOf('RTX 2') >= 0) return QualityLevel.HIGH;
    if(renderer.indexOf('Intel') >= 0 || renderer.indexOf('Mesa') >= 0) return QualityLevel.LOW;
    return QualityLevel.MEDIUM;
  }

  function save(){
    return JSON.stringify({ level: qs._level, settings: qs._settings });
  }

  function load(json){
    const data = JSON.parse(json);
    qs._level = data.level;
    Object.assign(qs._settings, data.settings);
  }

  initPresets();
  return { setQualityLevel, getQualityLevel, set, get, getAll, getQualityName, getAvailableLevels, autoDetect, save, load, qs };
}

/* ===== 性能自适应系统 =====
   支持: 帧率监控 / 动态降质 / 目标帧率
*/
function createAdaptivePerformance(qualitySettings, options){
  const ap = {
    quality: qualitySettings,
    _targetFPS: (options && options.targetFPS) || 60,
    _minFPS: (options && options.minFPS) || 30,
    _frameTimes: [],
    _maxSamples: (options && options.maxSamples) || 60,
    _currentLevel: qualitySettings.getQualityLevel(),
    _adjustmentInterval: (options && options.adjustmentInterval) || 5,
    _lastAdjustment: 0,
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true,
    _stats: { adjustments: 0, lastAction: 'none' }
  };

  function update(frameTime, currentTime){
    if(!ap._enabled) return;
    ap._frameTimes.push(frameTime);
    if(ap._frameTimes.length > ap._maxSamples) ap._frameTimes.shift();
    if(currentTime - ap._lastAdjustment < ap._adjustmentInterval) return;
    ap._lastAdjustment = currentTime;
    const avgFPS = calculateAverageFPS();
    if(avgFPS < ap._minFPS && ap._currentLevel > QualityLevel.LOW){
      ap._currentLevel--;
      ap.quality.setQualityLevel(ap._currentLevel);
      ap._stats.adjustments++;
      ap._stats.lastAction = 'downgrade to ' + ap.quality.getQualityName(ap._currentLevel);
      ap._frameTimes = [];
    } else if(avgFPS > ap._targetFPS * 1.2 && ap._currentLevel < QualityLevel.ULTRA){
      ap._currentLevel++;
      ap.quality.setQualityLevel(ap._currentLevel);
      ap._stats.adjustments++;
      ap._stats.lastAction = 'upgrade to ' + ap.quality.getQualityName(ap._currentLevel);
      ap._frameTimes = [];
    }
  }

  function calculateAverageFPS(){
    if(ap._frameTimes.length === 0) return 60;
    let sum = 0;
    for(let i = 0; i < ap._frameTimes.length; i++) sum += ap._frameTimes[i];
    const avgFrameTime = sum / ap._frameTimes.length;
    return 1000 / avgFrameTime;
  }

  function getCurrentLevel(){
    return ap._currentLevel;
  }

  function getStats(){
    return { ...ap._stats, avgFPS: calculateAverageFPS(), currentLevel: ap._currentLevel };
  }

  function setEnabled(enabled){
    ap._enabled = enabled;
  }

  function setTargetFPS(fps){
    ap._targetFPS = fps;
  }

  function reset(){
    ap._frameTimes = [];
    ap._stats = { adjustments: 0, lastAction: 'none' };
    ap._lastAdjustment = 0;
  }

  return { update, getCurrentLevel, getStats, setEnabled, setTargetFPS, reset, ap };
}

/* ===== 分辨率缩放系统 =====
   支持: 动态分辨率 / 渲染比例 / 锐化补偿
*/
function createResolutionScaler(gl, baseWidth, baseHeight, options){
  const rs = {
    gl: gl,
    baseWidth: baseWidth,
    baseHeight: baseHeight,
    _renderWidth: baseWidth,
    _renderHeight: baseHeight,
    _scale: (options && options.scale) || 1,
    _minScale: (options && options.minScale) || 0.5,
    _maxScale: (options && options.maxScale) || 1.5,
    _framebuffer: null,
    _texture: null,
    _upscaleProgram: null,
    _quadBuffer: null,
    _sharpness: (options && options.sharpness) || 0.3,
    _initialized: false
  };

  function init(){
    const gl = rs.gl;
    rs._framebuffer = gl.createFramebuffer();
    rs._texture = gl.createTexture();
    updateRenderTarget();
    const vs = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uTexture;
      uniform vec2 uTexelSize;
      uniform float uSharpness;
      varying vec2 vUV;
      void main(){
        vec3 color = texture2D(uTexture, vUV).rgb;
        if(uSharpness > 0.0){
          vec3 center = color;
          vec3 blur = texture2D(uTexture, vUV + vec2(uTexelSize.x, 0.0)).rgb * 0.25 +
                       texture2D(uTexture, vUV - vec2(uTexelSize.x, 0.0)).rgb * 0.25 +
                       texture2D(uTexture, vUV + vec2(0.0, uTexelSize.y)).rgb * 0.25 +
                       texture2D(uTexture, vUV - vec2(0.0, uTexelSize.y)).rgb * 0.25;
          color = center + (center - blur) * uSharpness;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    rs._upscaleProgram = gl.createProgram();
    gl.attachShader(rs._upscaleProgram, vsh);
    gl.attachShader(rs._upscaleProgram, fsh);
    gl.linkProgram(rs._upscaleProgram);
    const quad = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    rs._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rs._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    rs._initialized = true;
  }

  function updateRenderTarget(){
    const gl = rs.gl;
    rs._renderWidth = Math.floor(rs.baseWidth * rs._scale);
    rs._renderHeight = Math.floor(rs.baseHeight * rs._scale);
    gl.bindTexture(gl.TEXTURE_2D, rs._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rs._renderWidth, rs._renderHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rs._framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rs._texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function setScale(scale){
    rs._scale = Math.max(rs._minScale, Math.min(rs._maxScale, scale));
    updateRenderTarget();
  }

  function getScale(){
    return rs._scale;
  }

  function getRenderSize(){
    return { width: rs._renderWidth, height: rs._renderHeight };
  }

  function beginRender(){
    if(!rs._initialized) return;
    const gl = rs.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rs._framebuffer);
    gl.viewport(0, 0, rs._renderWidth, rs._renderHeight);
  }

  function endRender(){
    const gl = rs.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, rs.baseWidth, rs.baseHeight);
  }

  function present(){
    if(!rs._initialized) return;
    const gl = rs.gl;
    gl.useProgram(rs._upscaleProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rs._texture);
    gl.uniform1i(gl.getUniformLocation(rs._upscaleProgram, 'uTexture'), 0);
    gl.uniform2f(gl.getUniformLocation(rs._upscaleProgram, 'uTexelSize'), 1/rs._renderWidth, 1/rs._renderHeight);
    gl.uniform1f(gl.getUniformLocation(rs._upscaleProgram, 'uSharpness'), rs._sharpness);
    gl.bindBuffer(gl.ARRAY_BUFFER, rs._quadBuffer);
    const posLoc = gl.getAttribLocation(rs._upscaleProgram, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function setSharpness(v){
    rs._sharpness = v;
  }

  function dispose(){
    const gl = rs.gl;
    if(rs._framebuffer) gl.deleteFramebuffer(rs._framebuffer);
    if(rs._texture) gl.deleteTexture(rs._texture);
    if(rs._upscaleProgram) gl.deleteProgram(rs._upscaleProgram);
    if(rs._quadBuffer) gl.deleteBuffer(rs._quadBuffer);
  }

  return { init, setScale, getScale, getRenderSize, beginRender, endRender, present, setSharpness, dispose, rs };
}



/* ===== 实体组件系统 (ECS) =====
   支持: 实体管理 / 组件存储 / 系统调度 / 事件驱动
*/
/* ===== 资产导入管线 =====
   支持: 多格式加载 / 依赖解析 / 缓存 / 进度回调
*/
function createAssetPipeline(options){
  const pipeline = {
    _loaders: {},
    _cache: {},
    _loading: {},
    _baseUrl: (options && options.baseUrl) || '',
    _maxConcurrent: (options && options.maxConcurrent) || 4,
    _queue: [],
    _active: 0,
    _onProgress: null,
    _onComplete: null
  };

  function registerLoader(type, loader){
    pipeline._loaders[type] = loader;
  }

  function setBaseUrl(url){
    pipeline._baseUrl = url;
  }

  function getCacheKey(type, url){
    return type + ':' + url;
  }

  function load(type, url, options){
    const key = getCacheKey(type, url);
    if(pipeline._cache[key]){
      return Promise.resolve(pipeline._cache[key]);
    }
    if(pipeline._loading[key]){
      return pipeline._loading[key];
    }
    const loader = pipeline._loaders[type];
    if(!loader){
      return Promise.reject(new Error('未注册的加载器类型: ' + type));
    }
    const fullUrl = pipeline._baseUrl + url;
    const promise = loader(fullUrl, options).then(function(asset){
      pipeline._cache[key] = asset;
      delete pipeline._loading[key];
      return asset;
    }).catch(function(err){
      delete pipeline._loading[key];
      throw err;
    });
    pipeline._loading[key] = promise;
    return promise;
  }

  function loadBatch(items, onProgress){
    const results = {};
    let completed = 0;
    const total = items.length;
    return new Promise(function(resolve, reject){
      function next(){
        if(completed >= total){
          resolve(results);
          return;
        }
        const item = items[completed];
        load(item.type, item.url, item.options).then(function(asset){
          results[item.url] = asset;
          completed++;
          if(onProgress) onProgress(completed, total, item.url);
          next();
        }).catch(function(err){
          reject(err);
        });
      }
      next();
    });
  }

  function get(type, url){
    const key = getCacheKey(type, url);
    return pipeline._cache[key] || null;
  }

  function has(type, url){
    const key = getCacheKey(type, url);
    return pipeline._cache[key] !== undefined;
  }

  function release(type, url){
    const key = getCacheKey(type, url);
    delete pipeline._cache[key];
  }

  function clearCache(){
    pipeline._cache = {};
  }

  function getCacheInfo(){
    const info = {};
    for(const key in pipeline._cache){
      const parts = key.split(':');
      const type = parts[0];
      if(!info[type]) info[type] = 0;
      info[type]++;
    }
    return info;
  }

  function registerDefaultLoaders(gl){
    registerLoader('texture', function(url, options){
      return new Promise(function(resolve, reject){
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function(){
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.generateMipmap(gl.TEXTURE_2D);
          resolve({ texture: tex, width: img.width, height: img.height, image: img });
        };
        img.onerror = function(){ reject(new Error('纹理加载失败: ' + url)); };
        img.src = url;
      });
    });

    registerLoader('json', function(url){
      return fetch(url).then(function(r){ return r.json(); });
    });

    registerLoader('text', function(url){
      return fetch(url).then(function(r){ return r.text(); });
    });

    registerLoader('arraybuffer', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); });
    });

    registerLoader('pmx', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
        return parsePMX(buf);
      });
    });

    registerLoader('vmd', function(url){
      return fetch(url).then(function(r){ return r.arrayBuffer(); }).then(function(buf){
        return parseVMD(buf);
      });
    });
  }

  return {
    registerLoader, setBaseUrl, load, loadBatch, get, has, release,
    clearCache, getCacheInfo, registerDefaultLoaders, pipeline
  };
}



/* ===== 骨骼动画压缩系统 =====
   支持: 关键帧精简 / 量化 / 差值编码 / 运行时解压
*/
function createAnimationCompressor(options){
  const comp = {
    positionTolerance: (options && options.positionTolerance) || 0.001,
    rotationTolerance: (options && options.rotationTolerance) || 0.001,
    scaleTolerance: (options && options.scaleTolerance) || 0.001,
    positionBits: (options && options.positionBits) || 16,
    rotationBits: (options && options.rotationBits) || 16,
    _minPos: [Infinity, Infinity, Infinity],
    _maxPos: [-Infinity, -Infinity, -Infinity]
  };

  function compressClip(clip){
    const compressed = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      frameRate: clip.frameRate || 30
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const compressedTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: compressKeyframes(track.keyframes, track.type)
      };
      compressed.tracks.push(compressedTrack);
    }
    return compressed;
  }

  function compressKeyframes(keyframes, type){
    if(!keyframes || keyframes.length === 0) return [];
    const tolerance = type === 'rotation' ? comp.rotationTolerance :
                      type === 'scale' ? comp.scaleTolerance : comp.positionTolerance;
    const result = [keyframes[0]];
    for(let i = 1; i < keyframes.length - 1; i++){
      const prev = result[result.length - 1];
      const curr = keyframes[i];
      const next = keyframes[i + 1];
      const interpolated = interpolateKeyframe(prev, next, curr.time, type);
      if(!keyframesClose(curr, interpolated, tolerance)){
        result.push(curr);
      }
    }
    result.push(keyframes[keyframes.length - 1]);
    return result;
  }

  function interpolateKeyframe(a, b, time, type){
    const t = Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time || 1)));
    if(type === 'rotation'){
      const q = Q.create();
      Q.slerp(q, a.value, b.value, t);
      return { time: time, value: q };
    }
    const val = new Float32Array(a.value.length);
    for(let i = 0; i < a.value.length; i++){
      val[i] = a.value[i] + (b.value[i] - a.value[i]) * t;
    }
    return { time: time, value: val };
  }

  function keyframesClose(a, b, tolerance){
    if(a.value.length !== b.value.length) return false;
    for(let i = 0; i < a.value.length; i++){
      if(Math.abs(a.value[i] - b.value[i]) > tolerance) return false;
    }
    return true;
  }

  function quantizeClip(clip){
    const quantized = {
      name: clip.name,
      duration: clip.duration,
      tracks: [],
      positionMin: [...comp._minPos],
      positionMax: [...comp._maxPos]
    };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const qTrack = {
        boneName: track.boneName,
        type: track.type,
        keyframes: []
      };
      for(let k = 0; k < track.keyframes.length; k++){
        const kf = track.keyframes[k];
        const qkf = { time: kf.time, value: [] };
        for(let v = 0; v < kf.value.length; v++){
          const bits = track.type === 'rotation' ? comp.rotationBits : comp.positionBits;
          const maxVal = (1 << bits) - 1;
          if(track.type === 'position'){
            const range = comp._maxPos[v % 3] - comp._minPos[v % 3] || 1;
            qkf.value[v] = Math.round(((kf.value[v] - comp._minPos[v % 3]) / range) * maxVal);
          } else {
            qkf.value[v] = Math.round(((kf.value[v] + 1) / 2) * maxVal);
          }
        }
        qTrack.keyframes.push(qkf);
      }
      quantized.tracks.push(qTrack);
    }
    return quantized;
  }

  function decompressClip(compressed){
    const clip = {
      name: compressed.name,
      duration: compressed.duration,
      tracks: []
    };
    for(let t = 0; t < compressed.tracks.length; t++){
      const track = compressed.tracks[t];
      clip.tracks.push({
        boneName: track.boneName,
        type: track.type,
        keyframes: track.keyframes.map(function(kf){
          return { time: kf.time, value: new Float32Array(kf.value) };
        })
      });
    }
    return clip;
  }

  function getCompressionRatio(original, compressed){
    const origSize = estimateClipSize(original);
    const compSize = estimateClipSize(compressed);
    return { original: origSize, compressed: compSize, ratio: origSize / compSize };
  }

  function estimateClipSize(clip){
    let size = 0;
    for(let t = 0; t < clip.tracks.length; t++){
      size += clip.tracks[t].boneName.length;
      size += (clip.tracks[t].keyframes || []).length * 20;
    }
    return size;
  }

  return { compressClip, quantizeClip, decompressClip, getCompressionRatio, comp };
}

/* ===== 渲染队列系统 =====
   支持: 不透明/透明排序 / 批处理 / 状态切换优化
*/
function createRenderQueue(options){
  const queue = {
    _opaque: [],
    _transparent: [],
    _overlay: [],
    _stats: { submitted: 0, rendered: 0, stateChanges: 0 },
    _currentState: {}
  };

  function submit(item){
    queue._stats.submitted++;
    if(item.transparent){
      queue._transparent.push(item);
    } else if(item.overlay){
      queue._overlay.push(item);
    } else {
      queue._opaque.push(item);
    }
  }

  function sort(){
    queue._opaque.sort(function(a, b){
      if(a.materialId !== b.materialId) return a.materialId - b.materialId;
      if(a.depth !== b.depth) return a.depth - b.depth;
      return 0;
    });
    queue._transparent.sort(function(a, b){
      return b.depth - a.depth;
    });
  }

  function execute(gl, camera){
    sort();
    queue._stats.rendered = 0;
    queue._stats.stateChanges = 0;
    const all = [...queue._opaque, ...queue._transparent, ...queue._overlay];
    for(let i = 0; i < all.length; i++){
      const item = all[i];
      if(item.materialId !== queue._currentState.material){
        queue._currentState.material = item.materialId;
        queue._stats.stateChanges++;
        if(item.bindMaterial) item.bindMaterial(gl);
      }
      if(item.render) item.render(gl, camera);
      queue._stats.rendered++;
    }
    clear();
  }

  function clear(){
    queue._opaque = [];
    queue._transparent = [];
    queue._overlay = [];
    queue._currentState = {};
  }

  function getStats(){
    return { ...queue._stats };
  }

  return { submit, execute, clear, getStats, queue };
}

/* ===== 材质实例系统 =====
   支持: 材质继承 / 参数覆盖 / 实例共享
*/
function createMaterialInstance(baseMaterial, overrides){
  const inst = {
    base: baseMaterial,
    overrides: overrides || {},
    _dirty: true
  };

  function set(name, value){
    inst.overrides[name] = value;
    inst._dirty = true;
  }

  function get(name){
    if(inst.overrides[name] !== undefined) return inst.overrides[name];
    return baseMaterial ? baseMaterial[name] : undefined;
  }

  function has(name){
    return inst.overrides[name] !== undefined || (baseMaterial && baseMaterial[name] !== undefined);
  }

  function removeOverride(name){
    delete inst.overrides[name];
    inst._dirty = true;
  }

  function reset(){
    inst.overrides = {};
    inst._dirty = true;
  }

  function getResolved(){
    if(!baseMaterial) return { ...inst.overrides };
    const resolved = { ...baseMaterial };
    for(const key in inst.overrides){
      resolved[key] = inst.overrides[key];
    }
    return resolved;
  }

  function clone(){
    return createMaterialInstance(baseMaterial, { ...inst.overrides });
  }

  return { set, get, has, removeOverride, reset, getResolved, clone, inst };
}

/* ===== 光照贴图系统 =====
   支持: 烘焙光照 / 运行时采样 / 方向光照贴图
*/
function createLightmapSystem(gl, options){
  const lm = {
    gl: gl,
    width: (options && options.width) || 1024,
    height: (options && options.height) || 1024,
    _texture: null,
    _directionalTexture: null,
    _data: null,
    _directionalData: null,
    _objects: [],
    _baked: false
  };

  function init(){
    const gl = lm.gl;
    lm._data = new Uint8Array(lm.width * lm.height * 4);
    lm._directionalData = new Uint8Array(lm.width * lm.height * 4);
    lm._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lm.width, lm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function addObject(geometry, uvOffset, uvScale){
    lm._objects.push({ geometry: geometry, uvOffset: uvOffset || [0,0], uvScale: uvScale || [1,1] });
  }

  function bake(lights, samples){
    samples = samples || 64;
    for(let y = 0; y < lm.height; y++){
      for(let x = 0; x < lm.width; x++){
        const u = x / lm.width;
        const v = y / lm.height;
        let r = 0, g = 0, b = 0;
        for(let s = 0; s < samples; s++){
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const dir = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
          for(let l = 0; l < lights.length; l++){
            const light = lights[l];
            const ndotl = Math.max(0, dir[0]*light.direction[0] + dir[1]*light.direction[1] + dir[2]*light.direction[2]);
            r += light.color[0] * ndotl * light.intensity;
            g += light.color[1] * ndotl * light.intensity;
            b += light.color[2] * ndotl * light.intensity;
          }
        }
        const idx = (y * lm.width + x) * 4;
        lm._data[idx] = Math.min(255, r / samples * 255);
        lm._data[idx+1] = Math.min(255, g / samples * 255);
        lm._data[idx+2] = Math.min(255, b / samples * 255);
        lm._data[idx+3] = 255;
      }
    }
    const gl = lm.gl;
    gl.bindTexture(gl.TEXTURE_2D, lm._texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, lm.width, lm.height, gl.RGBA, gl.UNSIGNED_BYTE, lm._data);
    lm._baked = true;
  }

  function sample(uv){
    const x = Math.floor(uv[0] * (lm.width - 1));
    const y = Math.floor(uv[1] * (lm.height - 1));
    const idx = (y * lm.width + x) * 4;
    return [lm._data[idx]/255, lm._data[idx+1]/255, lm._data[idx+2]/255];
  }

  function getTexture(){
    return lm._texture;
  }

  function isBaked(){
    return lm._baked;
  }

  function dispose(){
    const gl = lm.gl;
    if(lm._texture) gl.deleteTexture(lm._texture);
  }

  return { init, addObject, bake, sample, getTexture, isBaked, dispose, lm };
}

/* ===== 相机效果系统 =====
   支持: 镜头抖动 / 焦距变化 / 运动模糊 / 景深
*/
function createCameraEffects(options){
  const fx = {
    _shake: { amplitude: 0, duration: 0, time: 0, frequency: 10 },
    _fov: { current: 60, target: 60, speed: 5 },
    _chromaticAberration: 0,
    _vignette: 0.5,
    _grain: 0,
    _motionBlur: 0,
    _dof: { focus: 10, aperture: 0.1, maxBlur: 0.05 },
    _time: 0
  };

  function update(dt, camera){
    fx._time += dt;
    if(fx._shake.time > 0){
      fx._shake.time -= dt;
      const t = fx._shake.time / fx._shake.duration;
      const amp = fx._shake.amplitude * t * t;
      camera.position[0] += (Math.random() - 0.5) * amp;
      camera.position[1] += (Math.random() - 0.5) * amp;
      camera.position[2] += (Math.random() - 0.5) * amp;
    }
    if(camera.fov !== undefined){
      camera.fov += (fx._fov.target - camera.fov) * Math.min(1, fx._fov.speed * dt);
    }
  }

  function shake(amplitude, duration, frequency){
    fx._shake.amplitude = amplitude || 0.1;
    fx._shake.duration = duration || 0.5;
    fx._shake.time = duration || 0.5;
    fx._shake.frequency = frequency || 10;
  }

  function setFov(target, speed){
    fx._fov.target = target;
    if(speed) fx._fov.speed = speed;
  }

  function setChromaticAberration(value){
    fx._chromaticAberration = value;
  }

  function setVignette(value){
    fx._vignette = value;
  }

  function setGrain(value){
    fx._grain = value;
  }

  function setMotionBlur(value){
    fx._motionBlur = value;
  }

  function setDOF(focus, aperture, maxBlur){
    fx._dof.focus = focus;
    fx._dof.aperture = aperture;
    fx._dof.maxBlur = maxBlur;
  }

  function getUniforms(){
    return {
      chromaticAberration: fx._chromaticAberration,
      vignette: fx._vignette,
      grain: fx._grain,
      motionBlur: fx._motionBlur,
      dofFocus: fx._dof.focus,
      dofAperture: fx._dof.aperture,
      dofMaxBlur: fx._dof.maxBlur,
      time: fx._time
    };
  }

  function reset(){
    fx._shake.time = 0;
    fx._fov.target = 60;
    fx._chromaticAberration = 0;
    fx._vignette = 0.5;
    fx._grain = 0;
    fx._motionBlur = 0;
  }

  return { update, shake, setFov, setChromaticAberration, setVignette, setGrain, setMotionBlur, setDOF, getUniforms, reset, fx };
}

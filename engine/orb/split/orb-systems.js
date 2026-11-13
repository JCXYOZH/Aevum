/**
 * MrHua 3D灵体渲染引擎 - orb-systems
 * 系统模块(日志/质量/ECS/事件总线/导航/AI)
 * 从 orb-renderer-main.js 拆分 (原行 L19503-L23043)
 * @module orb-systems
 */
'use strict';

const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };

function createLogger(options){
  const logger = {
    _level: (options && options.level) || LogLevel.INFO,
    _outputs: [],
    _buffer: [],
    _maxBuffer: (options && options.maxBuffer) || 1000,
    _includeTimestamp: (options && options.includeTimestamp !== undefined) ? options.includeTimestamp : true,
    _includeLevel: (options && options.includeLevel !== undefined) ? options.includeLevel : true
  };

  function setLevel(level){
    logger._level = level;
  }

  function addOutput(outputFunc){
    logger._outputs.push(outputFunc);
  }

  function log(level, args){
    if(level < logger._level) return;
    const parts = [];
    if(logger._includeTimestamp) parts.push('[' + new Date().toISOString() + ']');
    if(logger._includeLevel){
      const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      parts.push('[' + levels[level] + ']');
    }
    parts.push(...args);
    const message = parts.join(' ');
    logger._buffer.push({ level: level, message: message, time: Date.now() });
    if(logger._buffer.length > logger._maxBuffer) logger._buffer.shift();
    for(let i = 0; i < logger._outputs.length; i++){
      try{ logger._outputs[i](level, message); } catch(e){}
    }
    if(level >= LogLevel.ERROR) console.error(message);
    else if(level >= LogLevel.WARN) console.warn(message);
    else if(level >= LogLevel.INFO) console.log(message);
    else console.debug(message);
  }

  function debug(){ log(LogLevel.DEBUG, Array.from(arguments)); }
  function info(){ log(LogLevel.INFO, Array.from(arguments)); }
  function warn(){ log(LogLevel.WARN, Array.from(arguments)); }
  function error(){ log(LogLevel.ERROR, Array.from(arguments)); }

  function getBuffer(){
    return [...logger._buffer];
  }

  function clearBuffer(){
    logger._buffer = [];
  }

  function flush(){
    const messages = [...logger._buffer];
    logger._buffer = [];
    return messages;
  }

  return { setLevel, addOutput, debug, info, warn, error, getBuffer, clearBuffer, flush, logger };
}



/* ===== 高级骨骼重定向系统 =====
   支持: 自动骨骼映射 / T-Pose对齐 / 比例补偿 / 动画重定向
*/
function createAdvancedRetargeter(sourceSkeleton, targetSkeleton, options){
  const ret = {
    source: sourceSkeleton,
    target: targetSkeleton,
    _map: {},
    _sourceTPose: null,
    _targetTPose: null,
    _scaleCompensation: (options && options.scaleCompensation !== undefined) ? options.scaleCompensation : true,
    _translationRetargeting: (options && options.translationRetargeting) || 'relative',
    _rotationRetargeting: (options && options.rotationRetargeting) || 'relative',
    _pelvisLock: (options && options.pelvisLock) || false
  };

  const BONE_ALIASES = {
    'hips': ['pelvis', '下半身', 'root', 'Hips', 'Pelvis'],
    'spine': ['spine', '上半身', 'Spine', 'Spine1'],
    'chest': ['chest', '上半身2', 'Chest', 'Spine2'],
    'neck': ['neck', '首', 'Neck'],
    'head': ['head', '頭', 'Head'],
    'leftShoulder': ['leftShoulder', '左肩', 'LeftShoulder', 'L_Shoulder'],
    'leftUpperArm': ['leftUpperArm', '左腕', 'LeftArm', 'L_Arm'],
    'leftLowerArm': ['leftLowerArm', '左ひじ', 'LeftForeArm', 'L_ForeArm'],
    'leftHand': ['leftHand', '左手首', 'LeftHand', 'L_Hand'],
    'rightShoulder': ['rightShoulder', '右肩', 'RightShoulder', 'R_Shoulder'],
    'rightUpperArm': ['rightUpperArm', '右腕', 'RightArm', 'R_Arm'],
    'rightLowerArm': ['rightLowerArm', '右ひじ', 'RightForeArm', 'R_ForeArm'],
    'rightHand': ['rightHand', '右手首', 'RightHand', 'R_Hand'],
    'leftUpperLeg': ['leftUpperLeg', '左足', 'LeftUpLeg', 'L_UpLeg'],
    'leftLowerLeg': ['leftLowerLeg', '左ひざ', 'LeftLeg', 'L_Leg'],
    'leftFoot': ['leftFoot', '左足首', 'LeftFoot', 'L_Foot'],
    'leftToes': ['leftToes', '左つま先', 'LeftToeBase', 'L_Toe'],
    'rightUpperLeg': ['rightUpperLeg', '右足', 'RightUpLeg', 'R_UpLeg'],
    'rightLowerLeg': ['rightLowerLeg', '右ひざ', 'RightLeg', 'R_Leg'],
    'rightFoot': ['rightFoot', '右足首', 'RightFoot', 'R_Foot'],
    'rightToes': ['rightToes', '右つま先', 'RightToeBase', 'R_Toe']
  };

  function autoMap(){
    ret._map = {};
    const sourceBones = ret.source.bones || [];
    const targetBones = ret.target.bones || [];
    for(const semantic in BONE_ALIASES){
      const aliases = BONE_ALIASES[semantic];
      let sourceIdx = -1, targetIdx = -1;
      for(let i = 0; i < sourceBones.length; i++){
        const name = (sourceBones[i].name || '').toLowerCase();
        if(aliases.some(function(a){ return name === a.toLowerCase() || name.indexOf(a.toLowerCase()) >= 0; })){
          sourceIdx = i; break;
        }
      }
      for(let i = 0; i < targetBones.length; i++){
        const name = (targetBones[i].name || '').toLowerCase();
        if(aliases.some(function(a){ return name === a.toLowerCase() || name.indexOf(a.toLowerCase()) >= 0; })){
          targetIdx = i; break;
        }
      }
      if(sourceIdx >= 0 && targetIdx >= 0){
        ret._map[sourceIdx] = targetIdx;
      }
    }
    return ret._map;
  }

  function setMapping(sourceIndex, targetIndex){
    ret._map[sourceIndex] = targetIndex;
  }

  function getMapping(sourceIndex){
    return ret._map[sourceIndex] !== undefined ? ret._map[sourceIndex] : -1;
  }

  function clearMapping(){
    ret._map = {};
  }

  function computeTPose(skeleton){
    const bones = skeleton.bones || [];
    const rotations = [];
    const positions = [];
    for(let i = 0; i < bones.length; i++){
      rotations.push([0, 0, 0, 1]);
      positions.push(bones[i].position ? [...bones[i].position] : [0,0,0]);
    }
    for(const semantic in BONE_ALIASES){
      const aliases = BONE_ALIASES[semantic];
      for(let i = 0; i < bones.length; i++){
        const name = (bones[i].name || '').toLowerCase();
        if(aliases.some(function(a){ return name === a.toLowerCase() || name.indexOf(a.toLowerCase()) >= 0; })){
          if(semantic === 'leftUpperArm') rotations[i] = Q.fromEuler(Q.create(), 0, 0, Math.PI * 0.5);
          if(semantic === 'rightUpperArm') rotations[i] = Q.fromEuler(Q.create(), 0, 0, -Math.PI * 0.5);
        }
      }
    }
    return { rotations: rotations, positions: positions };
  }

  function init(){
    autoMap();
    ret._sourceTPose = computeTPose(ret.source);
    ret._targetTPose = computeTPose(ret.target);
  }

  function retargetPose(sourceRotations, sourcePositions){
    const targetBones = ret.target.bones || [];
    const targetRotations = [];
    const targetPositions = [];
    for(let i = 0; i < targetBones.length; i++){
      targetRotations.push([0, 0, 0, 1]);
      targetPositions.push(targetBones[i].position ? [...targetBones[i].position] : [0,0,0]);
    }
    for(const sourceIdxStr in ret._map){
      const sourceIdx = parseInt(sourceIdxStr);
      const targetIdx = ret._map[sourceIdx];
      if(targetIdx < 0) continue;
      if(ret._rotationRetargeting === 'relative'){
        const sourceLocal = sourceRotations[sourceIdx] || [0,0,0,1];
        const sourceTPose = ret._sourceTPose.rotations[sourceIdx] || [0,0,0,1];
        const targetTPose = ret._targetTPose.rotations[targetIdx] || [0,0,0,1];
        const delta = Q.create();
        Q.mult(delta, Q.invert(Q.create(), sourceTPose), sourceLocal);
        Q.mult(targetRotations[targetIdx], targetTPose, delta);
      } else {
        targetRotations[targetIdx] = [...sourceRotations[sourceIdx]];
      }
      if(ret._translationRetargeting === 'relative' && sourcePositions && targetPositions){
        if(ret._pelvisLock && targetIdx === ret._map[0]){
          targetPositions[targetIdx] = [...ret._targetTPose.positions[targetIdx]];
        } else if(ret._scaleCompensation){
          const sourceBone = ret.source.bones[sourceIdx];
          const targetBone = targetBones[targetIdx];
          if(sourceBone && targetBone && sourceBone.parent >= 0 && targetBone.parent >= 0){
            const sourceParent = ret.source.bones[sourceBone.parent];
            const targetParent = targetBones[targetBone.parent];
            if(sourceParent && targetParent){
              const sourceLen = V3.dist(sourceBone.position || [0,0,0], sourceParent.position || [0,0,0]);
              const targetLen = V3.dist(targetBone.position || [0,0,0], targetParent.position || [0,0,0]);
              const scale = targetLen / (sourceLen || 1);
              const sourceDelta = sourcePositions[sourceIdx] || [0,0,0];
              targetPositions[targetIdx] = [sourceDelta[0] * scale, sourceDelta[1] * scale, sourceDelta[2] * scale];
            }
          }
        }
      }
    }
    return { rotations: targetRotations, positions: targetPositions };
  }

  function retargetAnimation(sourceClip){
    const targetClip = {
      name: sourceClip.name + '_retargeted',
      duration: sourceClip.duration,
      tracks: []
    };
    for(let t = 0; t < sourceClip.tracks.length; t++){
      const track = sourceClip.tracks[t];
      const sourceBoneIdx = ret.source.boneNameToIndex ? ret.source.boneNameToIndex(track.boneName) : -1;
      if(sourceBoneIdx < 0) continue;
      const targetBoneIdx = getMapping(sourceBoneIdx);
      if(targetBoneIdx < 0) continue;
      const targetBoneName = ret.target.bones[targetBoneIdx].name;
      targetClip.tracks.push({
        boneName: targetBoneName,
        type: track.type,
        keyframes: track.keyframes.map(function(kf){ return { ...kf }; })
      });
    }
    return targetClip;
  }

  function getMappingReport(){
    const report = [];
    for(const sourceIdxStr in ret._map){
      const sourceIdx = parseInt(sourceIdxStr);
      const targetIdx = ret._map[sourceIdx];
      report.push({
        source: ret.source.bones[sourceIdx] ? ret.source.bones[sourceIdx].name : 'unknown',
        target: ret.target.bones[targetIdx] ? ret.target.bones[targetIdx].name : 'unknown'
      });
    }
    return report;
  }

  return { init, autoMap, setMapping, getMapping, clearMapping, retargetPose, retargetAnimation, getMappingReport, ret };
}

/* ===== 动画层混合系统 =====
   支持: 多层动画 / 遮罩 / 叠加 / 权重混合
*/
function createAnimationLayerSystem(boneSystem, options){
  const layers = {
    boneSystem: boneSystem,
    _layers: [],
    _baseLayer: null,
    _maskCache: {}
  };

  function createLayer(name, weight, mask){
    const layer = {
      name: name,
      weight: weight !== undefined ? weight : 1,
      mask: mask || null,
      _currentClip: null,
      _time: 0,
      _playing: false,
      _speed: 1,
      _blendMode: 'override'
    };
    layers._layers.push(layer);
    return layer;
  }

  function removeLayer(name){
    const idx = layers._layers.findIndex(function(l){ return l.name === name; });
    if(idx >= 0) layers._layers.splice(idx, 1);
  }

  function getLayer(name){
    return layers._layers.find(function(l){ return l.name === name; });
  }

  function setLayerWeight(name, weight){
    const layer = getLayer(name);
    if(layer) layer.weight = Math.max(0, Math.min(1, weight));
  }

  function setLayerMask(name, mask){
    const layer = getLayer(name);
    if(layer) layer.mask = mask;
  }

  function playClip(layerName, clip, options){
    const layer = getLayer(layerName);
    if(!layer) return false;
    layer._currentClip = clip;
    layer._time = 0;
    layer._playing = true;
    layer._speed = (options && options.speed) || 1;
    if(options && options.blendMode) layer._blendMode = options.blendMode;
    return true;
  }

  function stopClip(layerName){
    const layer = getLayer(layerName);
    if(layer){
      layer._playing = false;
      layer._currentClip = null;
    }
  }

  function update(dt){
    for(let i = 0; i < layers._layers.length; i++){
      const layer = layers._layers[i];
      if(layer._playing && layer._currentClip){
        layer._time += dt * layer._speed;
        if(layer._currentClip.duration && layer._time >= layer._currentClip.duration){
          layer._time = layer._time % layer._currentClip.duration;
        }
      }
    }
  }

  function evaluatePose(){
    const bones = layers.boneSystem.bones || [];
    const boneCount = bones.length;
    const finalRotations = [];
    const finalPositions = [];
    for(let i = 0; i < boneCount; i++){
      finalRotations.push([0, 0, 0, 1]);
      finalPositions.push([0, 0, 0]);
    }
    let baseApplied = false;
    for(let l = 0; l < layers._layers.length; l++){
      const layer = layers._layers[l];
      if(!layer._currentClip || layer.weight <= 0) continue;
      const layerPose = sampleClipPose(layer._currentClip, layer._time, boneCount);
      for(let i = 0; i < boneCount; i++){
        const masked = layer.mask && !layer.mask[i];
        if(masked) continue;
        if(!baseApplied || layer._blendMode === 'override'){
          finalRotations[i] = [...layerPose.rotations[i]];
          finalPositions[i] = [...layerPose.positions[i]];
        } else if(layer._blendMode === 'additive'){
          Q.mult(finalRotations[i], finalRotations[i], layerPose.rotations[i]);
          finalPositions[i][0] += layerPose.positions[i][0];
          finalPositions[i][1] += layerPose.positions[i][1];
          finalPositions[i][2] += layerPose.positions[i][2];
        } else {
          const w = layer.weight;
          Q.slerp(finalRotations[i], finalRotations[i], layerPose.rotations[i], w);
          finalPositions[i][0] += (layerPose.positions[i][0] - finalPositions[i][0]) * w;
          finalPositions[i][1] += (layerPose.positions[i][1] - finalPositions[i][1]) * w;
          finalPositions[i][2] += (layerPose.positions[i][2] - finalPositions[i][2]) * w;
        }
      }
      baseApplied = true;
    }
    return { rotations: finalRotations, positions: finalPositions };
  }

  function sampleClipPose(clip, time, boneCount){
    const rotations = [];
    const positions = [];
    for(let i = 0; i < boneCount; i++){
      rotations.push([0, 0, 0, 1]);
      positions.push([0, 0, 0]);
    }
    if(!clip || !clip.tracks) return { rotations, positions };
    for(let t = 0; t < clip.tracks.length; t++){
      const track = clip.tracks[t];
      const boneIdx = layers.boneSystem.boneNameToIndex ? layers.boneSystem.boneNameToIndex(track.boneName) : -1;
      if(boneIdx < 0) continue;
      const value = sampleTrackAt(track, time);
      if(value){
        if(track.type === 'rotation') rotations[boneIdx] = [...value];
        else if(track.type === 'position') positions[boneIdx] = [...value];
      }
    }
    return { rotations, positions };
  }

  function sampleTrackAt(track, time){
    if(!track.keyframes || track.keyframes.length === 0) return null;
    if(time <= track.keyframes[0].time) return track.keyframes[0].value;
    if(time >= track.keyframes[track.keyframes.length-1].time) return track.keyframes[track.keyframes.length-1].value;
    for(let i = 0; i < track.keyframes.length - 1; i++){
      const k0 = track.keyframes[i], k1 = track.keyframes[i+1];
      if(time >= k0.time && time <= k1.time){
        const t = (time - k0.time) / (k1.time - k0.time || 1);
        if(track.type === 'rotation'){
          const q = Q.create();
          Q.slerp(q, k0.value, k1.value, t);
          return q;
        }
        const val = new Float32Array(k0.value.length);
        for(let j = 0; j < k0.value.length; j++){
          val[j] = k0.value[j] + (k1.value[j] - k0.value[j]) * t;
        }
        return val;
      }
    }
    return track.keyframes[0].value;
  }

  function createBoneMask(boneNames, include){
    const bones = layers.boneSystem.bones || [];
    const mask = new Array(bones.length).fill(!include);
    for(let i = 0; i < bones.length; i++){
      if(boneNames.some(function(n){ return bones[i].name && bones[i].name.indexOf(n) >= 0; })){
        mask[i] = include;
      }
    }
    return mask;
  }

  function getLayerCount(){
    return layers._layers.length;
  }

  function reset(){
    layers._layers = [];
  }

  return { createLayer, removeLayer, getLayer, setLayerWeight, setLayerMask, playClip, stopClip, update, evaluatePose, createBoneMask, getLayerCount, reset, layers };
}

/* ===== 面部动画系统 =====
   支持: 表情单元 / 眼部动画 / 眉毛动画 / 嘴部动画
*/
function createFacialAnimator(model, options){
  const face = {
    model: model,
    _morphs: model && model.morphs ? model.morphs : [],
    _weights: {},
    _blink: { enabled: true, interval: 3, duration: 0.15, timer: 0, phase: 0 },
    _look: { x: 0, y: 0, targetX: 0, targetY: 0, smooth: 5 },
    _mouth: { open: 0, width: 0, smile: 0, frown: 0 },
    _brow: { left: 0, right: 0, inner: 0, outer: 0 },
    _presets: {}
  };

  function init(){
    for(let i = 0; i < face._morphs.length; i++){
      face._weights[face._morphs[i].name] = 0;
    }
  }

  function setWeight(name, value){
    if(face._weights[name] !== undefined){
      face._weights[name] = Math.max(0, Math.min(1, value));
    }
  }

  function getWeight(name){
    return face._weights[name] || 0;
  }

  function update(dt){
    if(face._blink.enabled){
      face._blink.timer += dt;
      if(face._blink.timer >= face._blink.interval){
        face._blink.timer = 0;
        face._blink.phase = 1;
      }
      if(face._blink.phase > 0){
        face._blink.phase -= dt / face._blink.duration;
        const blinkAmount = face._blink.phase > 0.5 ? (1 - face._blink.phase) * 2 : face._blink.phase * 2;
        setWeight('まばたき', blinkAmount);
        setWeight('ウィンク', blinkAmount * 0.5);
      }
    }
    face._look.x += (face._look.targetX - face._look.x) * Math.min(1, face._look.smooth * dt);
    face._look.y += (face._look.targetY - face._look.y) * Math.min(1, face._look.smooth * dt);
    applyEyeOffset(face._look.x, face._look.y);
    applyMouth(face._mouth);
    applyBrow(face._brow);
  }

  function applyEyeOffset(x, y){
    setWeight('目線X', x * 0.5 + 0.5);
    setWeight('目線Y', y * 0.5 + 0.5);
  }

  function applyMouth(mouth){
    setWeight('あ', mouth.open);
    setWeight('にっこり', mouth.smile);
    setWeight('口を横に広げる', mouth.width);
  }

  function applyBrow(brow){
    setWeight('眉上', Math.max(brow.left, brow.right));
    setWeight('眉下', Math.max(-brow.left, -brow.right));
  }

  function setLookTarget(x, y){
    face._look.targetX = Math.max(-1, Math.min(1, x));
    face._look.targetY = Math.max(-1, Math.min(1, y));
  }

  function setMouth(open, width, smile){
    face._mouth.open = open || 0;
    face._mouth.width = width || 0;
    face._mouth.smile = smile || 0;
  }

  function setBrow(left, right){
    face._brow.left = left || 0;
    face._brow.right = right || 0;
  }

  function triggerBlink(){
    face._blink.phase = 1;
    face._blink.timer = 0;
  }

  function setBlinkEnabled(enabled){
    face._blink.enabled = enabled;
  }

  function addPreset(name, weights){
    face._presets[name] = { ...weights };
  }

  function applyPreset(name, blend){
    const preset = face._presets[name];
    if(!preset) return false;
    const b = blend !== undefined ? blend : 1;
    for(const morphName in preset){
      const current = getWeight(morphName);
      setWeight(morphName, current + (preset[morphName] - current) * b);
    }
    return true;
  }

  function getPresetNames(){
    return Object.keys(face._presets);
  }

  function getMorphNames(){
    return face._morphs.map(function(m){ return m.name; });
  }

  function getWeights(){
    return { ...face._weights };
  }

  function reset(){
    for(const name in face._weights) face._weights[name] = 0;
    face._mouth = { open: 0, width: 0, smile: 0, frown: 0 };
    face._brow = { left: 0, right: 0, inner: 0, outer: 0 };
    face._look = { x: 0, y: 0, targetX: 0, targetY: 0, smooth: 5 };
  }

  return { init, setWeight, getWeight, update, setLookTarget, setMouth, setBrow, triggerBlink, setBlinkEnabled, addPreset, applyPreset, getPresetNames, getMorphNames, getWeights, reset, face };
}

/* ===== 口型同步系统 =====
   支持: 音素映射 / 音频驱动 / 时间轴同步 / 嘴型混合
*/
function createLipSyncSystem(facialAnimator, options){
  const lipsync = {
    facial: facialAnimator,
    _phonemes: [],
    _currentPhoneme: null,
    _time: 0,
    _volume: 0,
    _smoothing: (options && options.smoothing) || 0.9,
    _mouthOpen: 0,
    _mouthWidth: 0,
    _visemes: {
      'A': { open: 0.8, width: 0.2 },
      'E': { open: 0.5, width: 0.6 },
      'I': { open: 0.3, width: 0.8 },
      'O': { open: 0.7, width: 0.1 },
      'U': { open: 0.4, width: 0.0 },
      'M': { open: 0.0, width: 0.5 },
      'F': { open: 0.2, width: 0.3 },
      'L': { open: 0.3, width: 0.4 },
      'S': { open: 0.1, width: 0.5 },
      'TH': { open: 0.2, width: 0.4 },
      'R': { open: 0.3, width: 0.3 },
      'K': { open: 0.4, width: 0.2 },
      'N': { open: 0.2, width: 0.4 },
      'rest': { open: 0.0, width: 0.0 }
    }
  };

  const PHONEME_MAP = {
    'a': 'A', 'ā': 'A', 'á': 'A', 'à': 'A',
    'e': 'E', 'ē': 'E', 'é': 'E', 'è': 'E',
    'i': 'I', 'ī': 'I', 'í': 'I', 'ì': 'I',
    'o': 'O', 'ō': 'O', 'ó': 'O', 'ò': 'O',
    'u': 'U', 'ū': 'U', 'ú': 'U', 'ù': 'U',
    'm': 'M', 'b': 'M', 'p': 'M',
    'f': 'F', 'v': 'F',
    'l': 'L',
    's': 'S', 'z': 'S',
    'th': 'TH', 'dh': 'TH',
    'r': 'R',
    'k': 'K', 'g': 'K', 'ng': 'K',
    'n': 'N',
    't': 'K', 'd': 'K',
    'w': 'U', 'y': 'I',
    'h': 'rest',
    ' ': 'rest'
  };

  function setPhonemes(phonemes){
    lipsync._phonemes = phonemes || [];
    lipsync._time = 0;
  }

  function setVolume(volume){
    lipsync._volume = volume;
  }

  function update(dt){
    lipsync._time += dt;
    let targetViseme = lipsync._visemes['rest'];
    for(let i = 0; i < lipsync._phonemes.length; i++){
      const p = lipsync._phonemes[i];
      if(lipsync._time >= p.start && lipsync._time <= p.end){
        const visemeName = PHONEME_MAP[p.phoneme.toLowerCase()] || 'rest';
        targetViseme = lipsync._visemes[visemeName] || lipsync._visemes['rest'];
        lipsync._currentPhoneme = p;
        break;
      }
    }
    const volumeFactor = Math.min(1, lipsync._volume * 2);
    const targetOpen = targetViseme.open * volumeFactor;
    const targetWidth = targetViseme.width * volumeFactor;
    lipsync._mouthOpen += (targetOpen - lipsync._mouthOpen) * (1 - lipsync._smoothing);
    lipsync._mouthWidth += (targetWidth - lipsync._mouthWidth) * (1 - lipsync._smoothing);
    if(lipsync.facial){
      lipsync.facial.setMouth(lipsync._mouthOpen, lipsync._mouthWidth, 0);
    }
  }

  function getCurrentPhoneme(){
    return lipsync._currentPhoneme;
  }

  function getMouthState(){
    return { open: lipsync._mouthOpen, width: lipsync._mouthWidth, volume: lipsync._volume };
  }

  function textToPhonemes(text, speed){
    speed = speed || 0.1;
    const phonemes = [];
    let time = 0;
    const lower = text.toLowerCase();
    for(let i = 0; i < lower.length; i++){
      let ch = lower[i];
      if(ch === 't' && lower[i+1] === 'h'){ ch = 'th'; i++; }
      else if(ch === 'd' && lower[i+1] === 'h'){ ch = 'dh'; i++; }
      else if(ch === 'n' && lower[i+1] === 'g'){ ch = 'ng'; i++; }
      const duration = ch === ' ' ? speed * 0.5 : speed;
      phonemes.push({ phoneme: ch, start: time, end: time + duration });
      time += duration;
    }
    return phonemes;
  }

  function reset(){
    lipsync._phonemes = [];
    lipsync._currentPhoneme = null;
    lipsync._time = 0;
    lipsync._volume = 0;
    lipsync._mouthOpen = 0;
    lipsync._mouthWidth = 0;
  }

  return { setPhonemes, setVolume, update, getCurrentPhoneme, getMouthState, textToPhonemes, reset, lipsync };
}

/* ===== 骨骼约束系统 =====
   支持: 位置约束 / 旋转约束 / 缩放约束 / 目标约束 / 极向量约束
*/
function createConstraintSystem(boneSystem){
  const cs = {
    boneSystem: boneSystem,
    _constraints: []
  };

  function addPositionConstraint(boneIndex, targetBone, weight, offset){
    const c = {
      type: 'position',
      bone: boneIndex,
      target: targetBone,
      weight: weight !== undefined ? weight : 1,
      offset: offset || [0,0,0],
      maintainOffset: false
    };
    cs._constraints.push(c);
    return c;
  }

  function addRotationConstraint(boneIndex, targetBone, weight, offset){
    const c = {
      type: 'rotation',
      bone: boneIndex,
      target: targetBone,
      weight: weight !== undefined ? weight : 1,
      offset: offset || [0,0,0,1]
    };
    cs._constraints.push(c);
    return c;
  }

  function addAimConstraint(boneIndex, targetBone, upVector, weight){
    const c = {
      type: 'aim',
      bone: boneIndex,
      target: targetBone,
      upVector: upVector || [0,1,0],
      weight: weight !== undefined ? weight : 1,
      aimVector: [0,0,-1]
    };
    cs._constraints.push(c);
    return c;
  }

  function addPoleVectorConstraint(boneIndex, targetBone, weight){
    const c = {
      type: 'poleVector',
      bone: boneIndex,
      target: targetBone,
      weight: weight !== undefined ? weight : 1
    };
    cs._constraints.push(c);
    return c;
  }

  function addScaleConstraint(boneIndex, targetBone, weight){
    const c = {
      type: 'scale',
      bone: boneIndex,
      target: targetBone,
      weight: weight !== undefined ? weight : 1
    };
    cs._constraints.push(c);
    return c;
  }

  function removeConstraint(constraint){
    const idx = cs._constraints.indexOf(constraint);
    if(idx >= 0) cs._constraints.splice(idx, 1);
  }

  function clear(){
    cs._constraints = [];
  }

  function solve(poseRotations, posePositions){
    const bones = cs.boneSystem.bones || [];
    for(let i = 0; i < cs._constraints.length; i++){
      const c = cs._constraints[i];
      if(c.weight <= 0) continue;
      if(c.type === 'position'){
        const targetPos = getBoneWorldPosition(c.target, poseRotations, posePositions);
        const currentPos = getBoneWorldPosition(c.bone, poseRotations, posePositions);
        const newPos = [
          currentPos[0] + (targetPos[0] + c.offset[0] - currentPos[0]) * c.weight,
          currentPos[1] + (targetPos[1] + c.offset[1] - currentPos[1]) * c.weight,
          currentPos[2] + (targetPos[2] + c.offset[2] - currentPos[2]) * c.weight
        ];
        if(posePositions[c.bone]){
          posePositions[c.bone][0] = newPos[0];
          posePositions[c.bone][1] = newPos[1];
          posePositions[c.bone][2] = newPos[2];
        }
      } else if(c.type === 'rotation'){
        const targetRot = poseRotations[c.target] || [0,0,0,1];
        const currentRot = poseRotations[c.bone] || [0,0,0,1];
        const blended = Q.create();
        Q.slerp(blended, currentRot, targetRot, c.weight);
        poseRotations[c.bone] = [blended[0], blended[1], blended[2], blended[3]];
      } else if(c.type === 'aim'){
        const bonePos = getBoneWorldPosition(c.bone, poseRotations, posePositions);
        const targetPos = getBoneWorldPosition(c.target, poseRotations, posePositions);
        const dir = [targetPos[0]-bonePos[0], targetPos[1]-bonePos[1], targetPos[2]-bonePos[2]];
        const dl = Math.sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]) || 1;
        dir[0]/=dl; dir[1]/=dl; dir[2]/=dl;
        const aim = c.aimVector;
        const dot = aim[0]*dir[0] + aim[1]*dir[1] + aim[2]*dir[2];
        if(Math.abs(dot) > 0.9999){
          const axis = [0,1,0];
          const angle = dot > 0 ? 0 : Math.PI;
          const q = Q.fromAxisAngle(Q.create(), axis, angle);
          poseRotations[c.bone] = [q[0],q[1],q[2],q[3]];
        } else {
          const axis = [
            aim[1]*dir[2]-aim[2]*dir[1],
            aim[2]*dir[0]-aim[0]*dir[2],
            aim[0]*dir[1]-aim[1]*dir[0]
          ];
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          const q = Q.fromAxisAngle(Q.create(), axis, angle * c.weight);
          poseRotations[c.bone] = [q[0],q[1],q[2],q[3]];
        }
      }
    }
  }

  function getBoneWorldPosition(boneIndex, poseRotations, posePositions){
    const bones = cs.boneSystem.bones || [];
    let pos = [0, 0, 0];
    const chain = [];
    let current = boneIndex;
    while(current >= 0){
      chain.unshift(current);
      const bone = bones[current];
      current = bone ? bone.parent : -1;
    }
    for(let i = 0; i < chain.length; i++){
      const bi = chain[i];
      const bone = bones[bi];
      const localPos = posePositions && posePositions[bi] ? posePositions[bi] : (bone.position || [0,0,0]);
      pos[0] += localPos[0];
      pos[1] += localPos[1];
      pos[2] += localPos[2];
    }
    return pos;
  }

  function getConstraintCount(){
    return cs._constraints.length;
  }

  return { addPositionConstraint, addRotationConstraint, addAimConstraint, addPoleVectorConstraint, addScaleConstraint, removeConstraint, clear, solve, getConstraintCount, cs };
}

/* ===== 根运动系统 =====
   支持: 根骨骼提取 / 运动位移 / 旋转累积 / 碰撞响应
*/
function createRootMotionSystem(boneSystem, options){
  const rm = {
    boneSystem: boneSystem,
    _rootBoneIndex: (options && options.rootBoneIndex) || 0,
    _position: [0, 0, 0],
    _rotation: [0, 0, 0, 1],
    _velocity: [0, 0, 0],
    _angularVelocity: 0,
    _lastRootPosition: null,
    _lastRootRotation: null,
    _enabled: (options && options.enabled !== undefined) ? options.enabled : true,
    _extractX: (options && options.extractX !== undefined) ? options.extractX : true,
    _extractY: (options && options.extractY !== undefined) ? options.extractY : false,
    _extractZ: (options && options.extractZ !== undefined) ? options.extractZ : true,
    _extractRotation: (options && options.extractRotation !== undefined) ? options.extractRotation : true,
    _scale: (options && options.scale) || 1
  };

  function setEnabled(enabled){
    rm._enabled = enabled;
  }

  function setPosition(x, y, z){
    rm._position = [x, y, z];
  }

  function setRotation(x, y, z, w){
    rm._rotation = [x, y, z, w];
  }

  function getPosition(){
    return [...rm._position];
  }

  function getRotation(){
    return [...rm._rotation];
  }

  function getVelocity(){
    return [...rm._velocity];
  }

  function update(poseRotations, posePositions, dt){
    if(!rm._enabled || !posePositions) return;
    const rootPos = posePositions[rm._rootBoneIndex] || [0,0,0];
    const rootRot = poseRotations[rm._rootBoneIndex] || [0,0,0,1];
    if(rm._lastRootPosition){
      const dx = rootPos[0] - rm._lastRootPosition[0];
      const dy = rootPos[1] - rm._lastRootPosition[1];
      const dz = rootPos[2] - rm._lastRootPosition[2];
      const worldDelta = [
        rm._extractX ? dx * rm._scale : 0,
        rm._extractY ? dy * rm._scale : 0,
        rm._extractZ ? dz * rm._scale : 0
      ];
      const rotatedDelta = [0,0,0];
      const q = rm._rotation;
      rotatedDelta[0] = (1-2*(q[1]*q[1]+q[2]*q[2]))*worldDelta[0] + (2*(q[0]*q[1]-q[3]*q[2]))*worldDelta[1] + (2*(q[0]*q[2]+q[3]*q[1]))*worldDelta[2];
      rotatedDelta[1] = (2*(q[0]*q[1]+q[3]*q[2]))*worldDelta[0] + (1-2*(q[0]*q[0]+q[2]*q[2]))*worldDelta[1] + (2*(q[1]*q[2]-q[3]*q[0]))*worldDelta[2];
      rotatedDelta[2] = (2*(q[0]*q[2]-q[3]*q[1]))*worldDelta[0] + (2*(q[1]*q[2]+q[3]*q[0]))*worldDelta[1] + (1-2*(q[0]*q[0]+q[1]*q[1]))*worldDelta[2];
      rm._position[0] += rotatedDelta[0];
      rm._position[1] += rotatedDelta[1];
      rm._position[2] += rotatedDelta[2];
      rm._velocity = [rotatedDelta[0]/(dt||0.016), rotatedDelta[1]/(dt||0.016), rotatedDelta[2]/(dt||0.016)];
      if(rm._extractRotation && rm._lastRootRotation){
        const deltaQ = Q.create();
        Q.mult(deltaQ, rootRot, Q.invert(Q.create(), rm._lastRootRotation));
        Q.mult(rm._rotation, rm._rotation, deltaQ);
        const yaw = Math.atan2(2*(rm._rotation[3]*rm._rotation[1]+rm._rotation[0]*rm._rotation[2]), 1-2*(rm._rotation[1]*rm._rotation[1]+rm._rotation[2]*rm._rotation[2]));
        rm._angularVelocity = yaw / (dt || 0.016);
      }
      posePositions[rm._rootBoneIndex] = [0, rootPos[1], 0];
    }
    rm._lastRootPosition = [...rootPos];
    rm._lastRootRotation = [...rootRot];
  }

  function reset(){
    rm._position = [0, 0, 0];
    rm._rotation = [0, 0, 0, 1];
    rm._velocity = [0, 0, 0];
    rm._angularVelocity = 0;
    rm._lastRootPosition = null;
    rm._lastRootRotation = null;
  }

  function applyToTransform(transform){
    transform.position = [...rm._position];
    transform.rotation = [...rm._rotation];
  }

  return { setEnabled, setPosition, setRotation, getPosition, getRotation, getVelocity, update, reset, applyToTransform, rm };
}

/* ===== 动画事件系统 =====
   支持: 时间轴事件 / 条件触发 / 回调注册 / 事件队列
*/
function createAnimationEventSystem(){
  const aes = {
    _events: [],
    _handlers: {},
    _triggered: new Set(),
    _time: 0
  };

  function addEvent(name, time, data){
    aes._events.push({ name: name, time: time, data: data || {}, triggered: false });
    aes._events.sort(function(a, b){ return a.time - b.time; });
  }

  function removeEvent(name, time){
    for(let i = aes._events.length - 1; i >= 0; i--){
      if(aes._events[i].name === name && (time === undefined || aes._events[i].time === time)){
        aes._events.splice(i, 1);
      }
    }
  }

  function on(name, handler){
    if(!aes._handlers[name]) aes._handlers[name] = [];
    aes._handlers[name].push(handler);
  }

  function off(name, handler){
    if(!aes._handlers[name]) return;
    const idx = aes._handlers[name].indexOf(handler);
    if(idx >= 0) aes._handlers[name].splice(idx, 1);
  }

  function trigger(name, data){
    if(aes._handlers[name]){
      for(let i = 0; i < aes._handlers[name].length; i++){
        try{ aes._handlers[name][i](data); } catch(e){ console.error('[AnimEvent] 处理器错误:', e); }
      }
    }
  }

  function update(time){
    const prevTime = aes._time;
    aes._time = time;
    for(let i = 0; i < aes._events.length; i++){
      const evt = aes._events[i];
      if(evt.time >= prevTime && evt.time <= time && !evt.triggered){
        evt.triggered = true;
        trigger(evt.name, evt.data);
      }
    }
  }

  function reset(){
    aes._time = 0;
    for(let i = 0; i < aes._events.length; i++){
      aes._events[i].triggered = false;
    }
  }

  function clear(){
    aes._events = [];
    aes._handlers = {};
    aes._time = 0;
  }

  function getEvents(){
    return aes._events.map(function(e){ return { name: e.name, time: e.time, data: e.data }; });
  }

  return { addEvent, removeEvent, on, off, trigger, update, reset, clear, getEvents, aes };
}

/* ===== 时间轴系统 =====
   支持: 多轨道 / 关键帧 / 播放控制 / 缩放平移
*/
function createTimeline(options){
  const tl = {
    _tracks: [],
    _time: 0,
    _duration: (options && options.duration) || 10,
    _fps: (options && options.fps) || 30,
    _playing: false,
    _speed: 1,
    _loop: (options && options.loop !== undefined) ? options.loop : true,
    _startTime: 0,
    _endTime: (options && options.duration) || 10,
    _listeners: []
  };

  function addTrack(name, type, data){
    const track = {
      name: name,
      type: type || 'generic',
      keyframes: data || [],
      enabled: true,
      color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
    };
    tl._tracks.push(track);
    return track;
  }

  function removeTrack(name){
    const idx = tl._tracks.findIndex(function(t){ return t.name === name; });
    if(idx >= 0) tl._tracks.splice(idx, 1);
  }

  function getTrack(name){
    return tl._tracks.find(function(t){ return t.name === name; });
  }

  function addKeyframe(trackName, time, value){
    const track = getTrack(trackName);
    if(!track) return null;
    const kf = { time: time, value: value };
    track.keyframes.push(kf);
    track.keyframes.sort(function(a, b){ return a.time - b.time; });
    return kf;
  }

  function removeKeyframe(trackName, index){
    const track = getTrack(trackName);
    if(track && index >= 0 && index < track.keyframes.length){
      track.keyframes.splice(index, 1);
    }
  }

  function sample(trackName, time){
    const track = getTrack(trackName);
    if(!track || track.keyframes.length === 0) return null;
    if(time <= track.keyframes[0].time) return track.keyframes[0].value;
    if(time >= track.keyframes[track.keyframes.length-1].time) return track.keyframes[track.keyframes.length-1].value;
    for(let i = 0; i < track.keyframes.length - 1; i++){
      const k0 = track.keyframes[i], k1 = track.keyframes[i+1];
      if(time >= k0.time && time <= k1.time){
        const t = (time - k0.time) / (k1.time - k0.time || 1);
        if(typeof k0.value === 'number'){
          return k0.value + (k1.value - k0.value) * t;
        }
        if(Array.isArray(k0.value) || k0.value instanceof Float32Array){
          const result = new Float32Array(k0.value.length);
          for(let j = 0; j < k0.value.length; j++){
            result[j] = k0.value[j] + (k1.value[j] - k0.value[j]) * t;
          }
          return result;
        }
        return k0.value;
      }
    }
    return track.keyframes[0].value;
  }

  function play(){
    tl._playing = true;
  }

  function pause(){
    tl._playing = false;
  }

  function stop(){
    tl._playing = false;
    tl._time = tl._startTime;
  }

  function seek(time){
    tl._time = Math.max(tl._startTime, Math.min(tl._endTime, time));
    notifyListeners();
  }

  function update(dt){
    if(!tl._playing) return;
    tl._time += dt * tl._speed;
    if(tl._time >= tl._endTime){
      if(tl._loop){
        tl._time = tl._startTime + (tl._time - tl._endTime);
      } else {
        tl._time = tl._endTime;
        tl._playing = false;
      }
    }
    if(tl._time < tl._startTime) tl._time = tl._startTime;
    notifyListeners();
  }

  function notifyListeners(){
    for(let i = 0; i < tl._listeners.length; i++){
      tl._listeners[i](tl._time);
    }
  }

  function onChange(callback){
    tl._listeners.push(callback);
    return function(){
      const idx = tl._listeners.indexOf(callback);
      if(idx >= 0) tl._listeners.splice(idx, 1);
    };
  }

  function setSpeed(speed){
    tl._speed = speed;
  }

  function setLoop(loop){
    tl._loop = loop;
  }

  function setPlayRange(start, end){
    tl._startTime = start;
    tl._endTime = end;
  }

  function getTime(){
    return tl._time;
  }

  function getDuration(){
    return tl._duration;
  }

  function isPlaying(){
    return tl._playing;
  }

  function getTracks(){
    return tl._tracks;
  }

  function clear(){
    tl._tracks = [];
    tl._time = 0;
    tl._playing = false;
  }

  return { addTrack, removeTrack, getTrack, addKeyframe, removeKeyframe, sample, play, pause, stop, seek, update, onChange, setSpeed, setLoop, setPlayRange, getTime, getDuration, isPlaying, getTracks, clear, tl };
}



/* ===== 延迟渲染系统 =====
   支持: G-Buffer / 多光源 / 光照pass / 合成pass
*/
function createDeferredRenderer(gl, width, height, options){
  const dr = {
    gl: gl,
    width: width,
    height: height,
    _gBuffer: null,
    _positionTexture: null,
    _normalTexture: null,
    _albedoTexture: null,
    _depthRenderbuffer: null,
    _lightProgram: null,
    _compositeProgram: null,
    _quadBuffer: null,
    _lights: [],
    _maxLights: (options && options.maxLights) || 64,
    _initialized: false
  };

  function init(){
    const gl = dr.gl;
    dr._gBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, dr._gBuffer);
    dr._positionTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA16F, gl.FLOAT);
    dr._normalTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA16F, gl.FLOAT);
    dr._albedoTexture = createColorTexture(gl, dr.width, dr.height, gl.RGBA8, gl.UNSIGNED_BYTE);
    dr._depthRenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, dr.width, dr.height);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dr._positionTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, dr._normalTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, dr._albedoTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);

    const geomVS = `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      attribute vec2 aUV;
      uniform mat4 uModel;
      uniform mat4 uViewProj;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      void main(){
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(uModel) * aNormal;
        vUV = aUV;
        gl_Position = uViewProj * worldPos;
      }
    `;
    const geomFS = `
      precision highp float;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      uniform vec3 uAlbedo;
      void main(){
        gl_FragData[0] = vec4(vWorldPos, 1.0);
        gl_FragData[1] = vec4(normalize(vNormal), 1.0);
        gl_FragData[2] = vec4(uAlbedo, 1.0);
      }
    `;
    dr._geomProgram = createShaderProgram(gl, geomVS, geomFS);

    const lightVS = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const lightFS = `
      precision highp float;
      uniform sampler2D uPositionTex;
      uniform sampler2D uNormalTex;
      uniform sampler2D uAlbedoTex;
      uniform vec3 uCameraPos;
      uniform vec3 uLightPos[64];
      uniform vec3 uLightColor[64];
      uniform float uLightIntensity[64];
      uniform int uLightCount;
      varying vec2 vUV;
      void main(){
        vec3 worldPos = texture2D(uPositionTex, vUV).xyz;
        vec3 normal = normalize(texture2D(uNormalTex, vUV).xyz);
        vec3 albedo = texture2D(uAlbedoTex, vUV).rgb;
        vec3 viewDir = normalize(uCameraPos - worldPos);
        vec3 color = albedo * 0.1;
        for(int i = 0; i < 64; i++){
          if(i >= uLightCount) break;
          vec3 toLight = uLightPos[i] - worldPos;
          float dist = length(toLight);
          toLight /= dist;
          float ndotl = max(dot(normal, toLight), 0.0);
          float atten = uLightIntensity[i] / (dist * dist + 0.1);
          vec3 halfDir = normalize(toLight + viewDir);
          float spec = pow(max(dot(normal, halfDir), 0.0), 32.0);
          color += (albedo * ndotl + spec) * uLightColor[i] * atten;
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    dr._lightProgram = createShaderProgram(gl, lightVS, lightFS);
    const quadVerts = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    dr._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    dr._initialized = true;
  }

  function createColorTexture(gl, w, h, format, type){
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function createShaderProgram(gl, vsSrc, fsSrc){
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  }

  function addLight(position, color, intensity){
    if(dr._lights.length >= dr._maxLights) return null;
    const light = { position: [position[0],position[1],position[2]], color: [color[0],color[1],color[2]], intensity: intensity || 1 };
    dr._lights.push(light);
    return light;
  }

  function removeLight(light){
    const idx = dr._lights.indexOf(light);
    if(idx >= 0) dr._lights.splice(idx, 1);
  }

  function beginGeometryPass(){
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dr._gBuffer);
    gl.viewport(0, 0, dr.width, dr.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(dr._geomProgram);
  }

  function endGeometryPass(){
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function lightPass(cameraPosition){
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, dr.width, dr.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(dr._lightProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dr._positionTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uPositionTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dr._normalTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uNormalTex'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dr._albedoTexture);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uAlbedoTex'), 2);
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uCameraPos'), cameraPosition);
    const lightPos = new Float32Array(dr._maxLights * 3);
    const lightCol = new Float32Array(dr._maxLights * 3);
    const lightInt = new Float32Array(dr._maxLights);
    for(let i = 0; i < dr._lights.length; i++){
      lightPos[i*3] = dr._lights[i].position[0];
      lightPos[i*3+1] = dr._lights[i].position[1];
      lightPos[i*3+2] = dr._lights[i].position[2];
      lightCol[i*3] = dr._lights[i].color[0];
      lightCol[i*3+1] = dr._lights[i].color[1];
      lightCol[i*3+2] = dr._lights[i].color[2];
      lightInt[i] = dr._lights[i].intensity;
    }
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uLightPos'), lightPos);
    gl.uniform3fv(gl.getUniformLocation(dr._lightProgram, 'uLightColor'), lightCol);
    gl.uniform1fv(gl.getUniformLocation(dr._lightProgram, 'uLightIntensity'), lightInt);
    gl.uniform1i(gl.getUniformLocation(dr._lightProgram, 'uLightCount'), dr._lights.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, dr._quadBuffer);
    const posLoc = gl.getAttribLocation(dr._lightProgram, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.DEPTH_TEST);
  }

  function resize(w, h){
    dr.width = w; dr.height = h;
    if(!dr._initialized) return;
    const gl = dr.gl;
    gl.bindTexture(gl.TEXTURE_2D, dr._positionTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, dr._normalTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindTexture(gl.TEXTURE_2D, dr._albedoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, dr._depthRenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  }

  function dispose(){
    const gl = dr.gl;
    if(dr._gBuffer) gl.deleteFramebuffer(dr._gBuffer);
    if(dr._positionTexture) gl.deleteTexture(dr._positionTexture);
    if(dr._normalTexture) gl.deleteTexture(dr._normalTexture);
    if(dr._albedoTexture) gl.deleteTexture(dr._albedoTexture);
    if(dr._depthRenderbuffer) gl.deleteRenderbuffer(dr._depthRenderbuffer);
    if(dr._lightProgram) gl.deleteProgram(dr._lightProgram);
    if(dr._geomProgram) gl.deleteProgram(dr._geomProgram);
    if(dr._quadBuffer) gl.deleteBuffer(dr._quadBuffer);
  }

  return { init, addLight, removeLight, beginGeometryPass, endGeometryPass, lightPass, resize, dispose, dr };
}

/* ===== 级联阴影贴图系统 =====
   支持: 多级阴影 / 视锥分割 / 混合过渡
*/
function createCascadedShadowMaps(gl, options){
  const csm = {
    gl: gl,
    _cascades: [],
    _cascadeCount: (options && options.cascadeCount) || 4,
    _resolution: (options && options.resolution) || 1024,
    _splitScheme: (options && options.splitScheme) || 'practical',
    _lambda: (options && options.lambda) || 0.5,
    _bias: (options && options.bias) || 0.005,
    _normalBias: (options && options.normalBias) || 0.02,
    _lightDirection: [0.5, 1, 0.3],
    _initialized: false
  };

  function init(){
    const gl = csm.gl;
    for(let i = 0; i < csm._cascadeCount; i++){
      const fb = gl.createFramebuffer();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, csm._resolution, csm._resolution, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      csm._cascades.push({ framebuffer: fb, texture: tex, split: 0, viewProj: M4.create() });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    csm._initialized = true;
  }

  function setLightDirection(x, y, z){
    csm._lightDirection = [x, y, z];
  }

  function computeCascadeSplits(near, far){
    const splits = [];
    const ratio = far / near;
    for(let i = 1; i <= csm._cascadeCount; i++){
      const p = i / csm._cascadeCount;
      const logSplit = near * Math.pow(ratio, p);
      const uniSplit = near + (far - near) * p;
      const split = csm._lambda * logSplit + (1 - csm._lambda) * uniSplit;
      splits.push(split);
    }
    return splits;
  }

  function update(camera, near, far){
    if(!csm._initialized) return;
    const splits = computeCascadeSplits(near, far);
    for(let i = 0; i < csm._cascadeCount; i++){
      csm._cascades[i].split = splits[i];
      const cascadeNear = i === 0 ? near : splits[i-1];
      const cascadeFar = splits[i];
      const lightView = M4.lookAt(M4.create(), csm._lightDirection, [0,0,0], [0,1,0]);
      const lightProj = M4.orthographic ? M4.orthographic(M4.create(), -10, 10, -10, 10, 0.1, 100) : M4.create();
      M4.mult(csm._cascades[i].viewProj, lightProj, lightView);
    }
  }

  function beginCascade(index){
    if(!csm._initialized || index >= csm._cascadeCount) return;
    const gl = csm.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, csm._cascades[index].framebuffer);
    gl.viewport(0, 0, csm._resolution, csm._resolution);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.cullFace(gl.FRONT);
  }

  function endCascade(){
    const gl = csm.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.cullFace(gl.BACK);
  }

  function getCascadeMatrix(index){
    return csm._cascades[index] ? csm._cascades[index].viewProj : null;
  }

  function getCascadeSplit(index){
    return csm._cascades[index] ? csm._cascades[index].split : 0;
  }

  function getShadowMaps(){
    return csm._cascades.map(function(c){ return c.texture; });
  }

  function dispose(){
    const gl = csm.gl;
    for(let i = 0; i < csm._cascades.length; i++){
      gl.deleteFramebuffer(csm._cascades[i].framebuffer);
      gl.deleteTexture(csm._cascades[i].texture);
    }
  }

  return { init, setLightDirection, update, beginCascade, endCascade, getCascadeMatrix, getCascadeSplit, getShadowMaps, dispose, csm };
}

/* ===== 体积光系统 =====
   支持: 光线散射 / 深度参与 / 噪声扰动
*/
function createVolumetricLight(gl, width, height, options){
  const vl = {
    gl: gl,
    width: width,
    height: height,
    _framebuffer: null,
    _texture: null,
    _program: null,
    _quadBuffer: null,
    _density: (options && options.density) || 0.5,
    _decay: (options && options.decay) || 0.95,
    _weight: (options && options.weight) || 0.3,
    _samples: (options && options.samples) || 64,
    _lightPosition: [0, 1, 0],
    _lightColor: [1, 0.95, 0.8],
    _initialized: false
  };

  function init(){
    const gl = vl.gl;
    vl._framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, vl._framebuffer);
    vl._texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, vl._texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, vl.width, vl.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vl._texture, 0);
    const vs = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uSceneTex;
      uniform sampler2D uDepthTex;
      uniform vec2 uLightScreenPos;
      uniform vec3 uLightColor;
      uniform float uDensity;
      uniform float uDecay;
      uniform float uWeight;
      uniform int uSamples;
      varying vec2 vUV;
      void main(){
        vec2 texCoord = vUV;
        vec2 deltaTexCoord = (texCoord - uLightScreenPos) / float(uSamples);
        vec3 color = texture2D(uSceneTex, texCoord).rgb;
        float illuminationDecay = 1.0;
        for(int i = 0; i < 128; i++){
          if(i >= uSamples) break;
          texCoord -= deltaTexCoord;
          vec3 sampleColor = texture2D(uSceneTex, texCoord).rgb;
          sampleColor *= illuminationDecay * uWeight;
          color += sampleColor;
          illuminationDecay *= uDecay;
        }
        gl_FragColor = vec4(color * uLightColor * uDensity, 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    vl._program = gl.createProgram();
    gl.attachShader(vl._program, vsh);
    gl.attachShader(vl._program, fsh);
    gl.linkProgram(vl._program);
    const quad = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    vl._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vl._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    vl._initialized = true;
  }

  function setLightPosition(x, y){
    vl._lightPosition = [x, y];
  }

  function setLightColor(r, g, b){
    vl._lightColor = [r, g, b];
  }

  function setDensity(v){ vl._density = v; }
  function setDecay(v){ vl._decay = v; }
  function setWeight(v){ vl._weight = v; }
  function setSamples(v){ vl._samples = v; }

  function render(sceneTexture, depthTexture){
    if(!vl._initialized) return;
    const gl = vl.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, vl._framebuffer);
    gl.viewport(0, 0, vl.width, vl.height);
    gl.useProgram(vl._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(vl._program, 'uSceneTex'), 0);
    if(depthTexture){
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, depthTexture);
      gl.uniform1i(gl.getUniformLocation(vl._program, 'uDepthTex'), 1);
    }
    gl.uniform2fv(gl.getUniformLocation(vl._program, 'uLightScreenPos'), vl._lightPosition);
    gl.uniform3fv(gl.getUniformLocation(vl._program, 'uLightColor'), vl._lightColor);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uDensity'), vl._density);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uDecay'), vl._decay);
    gl.uniform1f(gl.getUniformLocation(vl._program, 'uWeight'), vl._weight);
    gl.uniform1i(gl.getUniformLocation(vl._program, 'uSamples'), vl._samples);
    gl.bindBuffer(gl.ARRAY_BUFFER, vl._quadBuffer);
    const posLoc = gl.getAttribLocation(vl._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function getTexture(){
    return vl._texture;
  }

  function dispose(){
    const gl = vl.gl;
    if(vl._framebuffer) gl.deleteFramebuffer(vl._framebuffer);
    if(vl._texture) gl.deleteTexture(vl._texture);
    if(vl._program) gl.deleteProgram(vl._program);
    if(vl._quadBuffer) gl.deleteBuffer(vl._quadBuffer);
  }

  return { init, setLightPosition, setLightColor, setDensity, setDecay, setWeight, setSamples, render, getTexture, dispose, vl };
}

/* ===== 镜头光晕系统 =====
   支持: 鬼影 / 光环 / 自动位置 / 强度控制
*/
function createLensFlare(gl, options){
  const lf = {
    gl: gl,
    _elements: [],
    _program: null,
    _quadBuffer: null,
    _intensity: (options && options.intensity) || 1,
    _threshold: (options && options.threshold) || 0.5,
    _initialized: false
  };

  function init(){
    const gl = lf.gl;
    const vs = `
      attribute vec2 aPosition;
      attribute vec2 aUV;
      attribute vec4 aColor;
      attribute float aSize;
      uniform vec2 uResolution;
      uniform vec2 uLightPos;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 dir = aPosition - uLightPos;
        vec2 pos = uLightPos + dir * (aSize * 2.0);
        vec2 screenPos = pos / uResolution * 2.0 - 1.0;
        screenPos.y = -screenPos.y;
        gl_Position = vec4(screenPos, 0.0, 1.0);
        gl_PointSize = aSize;
        vUV = aUV;
        vColor = aColor;
      }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uFlareTexture;
      varying vec2 vUV;
      varying vec4 vColor;
      void main(){
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if(dist > 0.5) discard;
        float alpha = smoothstep(0.5, 0.1, dist);
        gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    lf._program = gl.createProgram();
    gl.attachShader(lf._program, vsh);
    gl.attachShader(lf._program, fsh);
    gl.linkProgram(lf._program);
    lf._quadBuffer = gl.createBuffer();
    lf._initialized = true;
    addDefaultElements();
  }

  function addDefaultElements(){
    const colors = [
      [1.0, 0.8, 0.6, 0.8],
      [0.6, 0.8, 1.0, 0.6],
      [1.0, 0.6, 0.8, 0.5],
      [0.8, 1.0, 0.6, 0.4],
      [0.6, 0.6, 1.0, 0.7],
      [1.0, 1.0, 0.8, 0.9]
    ];
    const sizes = [80, 40, 60, 30, 50, 100];
    const distances = [0.2, 0.5, 0.8, 1.2, 1.5, 2.0];
    for(let i = 0; i < 6; i++){
      lf._elements.push({
        color: colors[i],
        size: sizes[i],
        distance: distances[i],
        texture: null
      });
    }
  }

  function addElement(color, size, distance, texture){
    lf._elements.push({ color: color, size: size, distance: distance, texture: texture });
  }

  function setIntensity(v){
    lf._intensity = v;
  }

  function render(lightScreenX, lightScreenY, width, height){
    if(!lf._initialized) return;
    const gl = lf.gl;
    if(lightScreenX < 0 || lightScreenX > width || lightScreenY < 0 || lightScreenY > height) return;
    const centerX = width / 2, centerY = height / 2;
    const dirX = centerX - lightScreenX, dirY = centerY - lightScreenY;
    gl.useProgram(lf._program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform2f(gl.getUniformLocation(lf._program, 'uResolution'), width, height);
    gl.uniform2f(gl.getUniformLocation(lf._program, 'uLightPos'), lightScreenX, lightScreenY);
    const verts = new Float32Array(lf._elements.length * 4 * 9);
    for(let i = 0; i < lf._elements.length; i++){
      const el = lf._elements[i];
      const ex = lightScreenX + dirX * el.distance;
      const ey = lightScreenY + dirY * el.distance;
      const base = i * 36;
      const corners = [[-1,-1],[1,-1],[1,1],[-1,1]];
      const uvs = [[0,0],[1,0],[1,1],[0,1]];
      for(let c = 0; c < 4; c++){
        verts[base+c*9] = ex + corners[c][0] * el.size;
        verts[base+c*9+1] = ey + corners[c][1] * el.size;
        verts[base+c*9+2] = uvs[c][0];
        verts[base+c*9+3] = uvs[c][1];
        verts[base+c*9+4] = el.color[0];
        verts[base+c*9+5] = el.color[1];
        verts[base+c*9+6] = el.color[2];
        verts[base+c*9+7] = el.color[3] * lf._intensity;
        verts[base+c*9+8] = el.size;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, lf._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(lf._program, 'aPosition');
    const uvLoc = gl.getAttribLocation(lf._program, 'aUV');
    const colLoc = gl.getAttribLocation(lf._program, 'aColor');
    const sizeLoc = gl.getAttribLocation(lf._program, 'aSize');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 36, 8);
    gl.enableVertexAttribArray(colLoc);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 36, 16);
    gl.enableVertexAttribArray(sizeLoc);
    gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 36, 32);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, lf._elements.length * 4);
    gl.disable(gl.BLEND);
  }

  function dispose(){
    const gl = lf.gl;
    if(lf._program) gl.deleteProgram(lf._program);
    if(lf._quadBuffer) gl.deleteBuffer(lf._quadBuffer);
  }

  return { init, addElement, setIntensity, render, dispose, lf };
}

/* ===== 轮廓渲染系统 =====
   支持: 描边 / 轮廓光 / 后处理边缘检测
*/
function createOutlineRenderer(gl, options){
  const outline = {
    gl: gl,
    _program: null,
    _quadBuffer: null,
    _color: (options && options.color) || [0, 0, 0, 1],
    _thickness: (options && options.thickness) || 2,
    _threshold: (options && options.threshold) || 0.1,
    _initialized: false
  };

  function init(){
    const gl = outline.gl;
    const vs = `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main(){ vUV = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
    `;
    const fs = `
      precision mediump float;
      uniform sampler2D uSceneTex;
      uniform sampler2D uDepthTex;
      uniform vec2 uTexelSize;
      uniform vec4 uOutlineColor;
      uniform float uThreshold;
      varying vec2 vUV;
      void main(){
        float depth = texture2D(uDepthTex, vUV).r;
        float depthL = texture2D(uDepthTex, vUV - vec2(uTexelSize.x, 0.0)).r;
        float depthR = texture2D(uDepthTex, vUV + vec2(uTexelSize.x, 0.0)).r;
        float depthU = texture2D(uDepthTex, vUV - vec2(0.0, uTexelSize.y)).r;
        float depthD = texture2D(uDepthTex, vUV + vec2(0.0, uTexelSize.y)).r;
        float edge = abs(depth - depthL) + abs(depth - depthR) + abs(depth - depthU) + abs(depth - depthD);
        vec3 color = texture2D(uSceneTex, vUV).rgb;
        float colorEdge = 0.0;
        vec3 colorL = texture2D(uSceneTex, vUV - vec2(uTexelSize.x, 0.0)).rgb;
        vec3 colorR = texture2D(uSceneTex, vUV + vec2(uTexelSize.x, 0.0)).rgb;
        colorEdge = length(color - colorL) + length(color - colorR);
        float isEdge = step(uThreshold, edge + colorEdge * 0.5);
        gl_FragColor = vec4(mix(color, uOutlineColor.rgb, isEdge * uOutlineColor.a), 1.0);
      }
    `;
    const vsh = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vsh, vs); gl.compileShader(vsh);
    const fsh = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fsh, fs); gl.compileShader(fsh);
    outline._program = gl.createProgram();
    gl.attachShader(outline._program, vsh);
    gl.attachShader(outline._program, fsh);
    gl.linkProgram(outline._program);
    const quad = new Float32Array([-1,-1, 1,-1, 1,1, -1,-1, 1,1, -1,1]);
    outline._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, outline._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    outline._initialized = true;
  }

  function setColor(r, g, b, a){
    outline._color = [r, g, b, a];
  }

  function setThickness(v){
    outline._thickness = v;
  }

  function setThreshold(v){
    outline._threshold = v;
  }

  function render(sceneTexture, depthTexture, width, height){
    if(!outline._initialized) return;
    const gl = outline.gl;
    gl.useProgram(outline._program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
    gl.uniform1i(gl.getUniformLocation(outline._program, 'uSceneTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.uniform1i(gl.getUniformLocation(outline._program, 'uDepthTex'), 1);
    gl.uniform2f(gl.getUniformLocation(outline._program, 'uTexelSize'), outline._thickness / width, outline._thickness / height);
    gl.uniform4fv(gl.getUniformLocation(outline._program, 'uOutlineColor'), outline._color);
    gl.uniform1f(gl.getUniformLocation(outline._program, 'uThreshold'), outline._threshold);
    gl.bindBuffer(gl.ARRAY_BUFFER, outline._quadBuffer);
    const posLoc = gl.getAttribLocation(outline._program, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function dispose(){
    const gl = outline.gl;
    if(outline._program) gl.deleteProgram(outline._program);
    if(outline._quadBuffer) gl.deleteBuffer(outline._quadBuffer);
  }

  return { init, setColor, setThickness, setThreshold, render, dispose, outline };
}

/* ===== 质量设置系统 =====
   支持: 预设质量 / 动态调整 / 性能监控
*/
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
function createECS(options){
  const ecs = {
    _entities: new Map(),
    _components: new Map(),
    _systems: [],
    _nextEntityId: 1,
    _eventBus: createEventBus(),
    _running: false,
    _time: 0,
    _deltaTime: 0,
    _entityQueries: new Map()
  };

  function createEntity(name){
    const id = ecs._nextEntityId++;
    const entity = {
      id: id,
      name: name || ('Entity_' + id),
      components: new Set(),
      active: true,
      tags: new Set()
    };
    ecs._entities.set(id, entity);
    ecs._eventBus.emit('entityCreated', { entity: entity });
    return entity;
  }

  function destroyEntity(id){
    const entity = ecs._entities.get(id);
    if(!entity) return false;
    entity.components.forEach(function(compType){
      const compStore = ecs._components.get(compType);
      if(compStore) compStore.delete(id);
    });
    ecs._entities.delete(id);
    ecs._eventBus.emit('entityDestroyed', { id: id });
    invalidateQueries();
    return true;
  }

  function getEntity(id){
    return ecs._entities.get(id) || null;
  }

  function findEntityByName(name){
    for(const [id, entity] of ecs._entities){
      if(entity.name === name) return entity;
    }
    return null;
  }

  function registerComponent(type){
    if(!ecs._components.has(type)){
      ecs._components.set(type, new Map());
    }
  }

  function addComponent(entityId, type, data){
    registerComponent(type);
    const entity = ecs._entities.get(entityId);
    if(!entity) return null;
    const compStore = ecs._components.get(type);
    const component = { ...data, _entityId: entityId, _type: type };
    compStore.set(entityId, component);
    entity.components.add(type);
    ecs._eventBus.emit('componentAdded', { entityId: entityId, type: type, component: component });
    invalidateQueries();
    return component;
  }

  function removeComponent(entityId, type){
    const entity = ecs._entities.get(entityId);
    if(!entity) return false;
    const compStore = ecs._components.get(type);
    if(compStore) compStore.delete(entityId);
    entity.components.delete(type);
    ecs._eventBus.emit('componentRemoved', { entityId: entityId, type: type });
    invalidateQueries();
    return true;
  }

  function getComponent(entityId, type){
    const compStore = ecs._components.get(type);
    return compStore ? compStore.get(entityId) || null : null;
  }

  function hasComponent(entityId, type){
    const entity = ecs._entities.get(entityId);
    return entity ? entity.components.has(type) : false;
  }

  function getAllComponentsOfType(type){
    const compStore = ecs._components.get(type);
    if(!compStore) return [];
    return Array.from(compStore.values());
  }

  function query(componentTypes){
    const key = componentTypes.sort().join(',');
    if(ecs._entityQueries.has(key)) return ecs._entityQueries.get(key);
    const results = [];
    for(const [id, entity] of ecs._entities){
      if(!entity.active) continue;
      let hasAll = true;
      for(let i = 0; i < componentTypes.length; i++){
        if(!entity.components.has(componentTypes[i])){ hasAll = false; break; }
      }
      if(hasAll){
        const comps = {};
        for(let i = 0; i < componentTypes.length; i++){
          comps[componentTypes[i]] = getComponent(id, componentTypes[i]);
        }
        results.push({ entity: entity, components: comps });
      }
    }
    ecs._entityQueries.set(key, results);
    return results;
  }

  function invalidateQueries(){
    ecs._entityQueries.clear();
  }

  function addSystem(system){
    ecs._systems.push(system);
    if(system.init) system.init(ecs);
  }

  function removeSystem(system){
    const idx = ecs._systems.indexOf(system);
    if(idx >= 0){
      if(system.destroy) system.destroy(ecs);
      ecs._systems.splice(idx, 1);
    }
  }

  function update(dt){
    ecs._deltaTime = dt;
    ecs._time += dt;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].update) ecs._systems[i].update(ecs, dt);
    }
  }

  function render(renderer){
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].render) ecs._systems[i].render(ecs, renderer);
    }
  }

  function start(){
    ecs._running = true;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].start) ecs._systems[i].start(ecs);
    }
  }

  function stop(){
    ecs._running = false;
    for(let i = 0; i < ecs._systems.length; i++){
      if(ecs._systems[i].stop) ecs._systems[i].stop(ecs);
    }
  }

  function getEntityCount(){
    return ecs._entities.size;
  }

  function getSystemCount(){
    return ecs._systems.length;
  }

  function getEventBus(){
    return ecs._eventBus;
  }

  function clear(){
    ecs._entities.clear();
    ecs._components.clear();
    ecs._systems = [];
    ecs._entityQueries.clear();
    ecs._nextEntityId = 1;
    ecs._time = 0;
  }

  return { createEntity, destroyEntity, getEntity, findEntityByName, registerComponent, addComponent, removeComponent, getComponent, hasComponent, getAllComponentsOfType, query, addSystem, removeSystem, update, render, start, stop, getEntityCount, getSystemCount, getEventBus, clear, ecs };
}

/* ===== 事件总线 =====
   支持: 订阅 / 发布 / 优先级 / 一次性监听
*/
function createEventBus(){
  const bus = {
    _listeners: new Map(),
    _onceListeners: new Map(),
    _eventHistory: [],
    _maxHistory: 100,
    _enabled: true
  };

  function on(event, callback, priority){
    if(!bus._listeners.has(event)) bus._listeners.set(event, []);
    const listener = { callback: callback, priority: priority || 0 };
    bus._listeners.get(event).push(listener);
    bus._listeners.get(event).sort(function(a, b){ return b.priority - a.priority; });
    return function(){ off(event, callback); };
  }

  function once(event, callback){
    if(!bus._onceListeners.has(event)) bus._onceListeners.set(event, []);
    bus._onceListeners.get(event).push(callback);
  }

  function off(event, callback){
    const listeners = bus._listeners.get(event);
    if(listeners){
      const idx = listeners.findIndex(function(l){ return l.callback === callback; });
      if(idx >= 0) listeners.splice(idx, 1);
    }
  }

  function emit(event, data){
    if(!bus._enabled) return;
    bus._eventHistory.push({ event: event, data: data, time: Date.now() });
    if(bus._eventHistory.length > bus._maxHistory) bus._eventHistory.shift();
    const listeners = bus._listeners.get(event);
    if(listeners){
      for(let i = 0; i < listeners.length; i++){
        try{ listeners[i].callback(data); } catch(e){ console.error('[EventBus] 处理器错误:', e); }
      }
    }
    const onceListeners = bus._onceListeners.get(event);
    if(onceListeners){
      for(let i = 0; i < onceListeners.length; i++){
        try{ onceListeners[i](data); } catch(e){ console.error('[EventBus] 一次性处理器错误:', e); }
      }
      bus._onceListeners.delete(event);
    }
  }

  function clear(event){
    if(event){
      bus._listeners.delete(event);
      bus._onceListeners.delete(event);
    } else {
      bus._listeners.clear();
      bus._onceListeners.clear();
    }
  }

  function getListenerCount(event){
    const listeners = bus._listeners.get(event);
    return listeners ? listeners.length : 0;
  }

  function getHistory(){
    return [...bus._eventHistory];
  }

  function setEnabled(enabled){
    bus._enabled = enabled;
  }

  return { on, once, off, emit, clear, getListenerCount, getHistory, setEnabled, bus };
}

/* ===== 导航网格系统 =====
   支持: 网格构建 / 路径查找 / 平滑路径 / 动态障碍
*/
function createNavMesh(options){
  const nav = {
    _cells: [],
    _width: (options && options.width) || 100,
    _height: (options && options.height) || 100,
    _cellSize: (options && options.cellSize) || 1,
    _obstacles: [],
    _initialized: false
  };

  function init(){
    const cols = Math.ceil(nav._width / nav._cellSize);
    const rows = Math.ceil(nav._height / nav._cellSize);
    nav._cells = [];
    for(let y = 0; y < rows; y++){
      const row = [];
      for(let x = 0; x < cols; x++){
        row.push({ x: x, y: y, walkable: true, cost: 1, region: 0 });
      }
      nav._cells.push(row);
    }
    nav._initialized = true;
  }

  function setWalkable(x, z, walkable){
    const cell = getCellAt(x, z);
    if(cell) cell.walkable = walkable;
  }

  function getCellAt(x, z){
    if(!nav._initialized) return null;
    const cx = Math.floor(x / nav._cellSize);
    const cz = Math.floor(z / nav._cellSize);
    if(cz < 0 || cz >= nav._cells.length || cx < 0 || cx >= nav._cells[0].length) return null;
    return nav._cells[cz][cx];
  }

  function addObstacle(x, z, radius){
    nav._obstacles.push({ x: x, z: z, radius: radius });
    for(let dz = -radius; dz <= radius; dz += nav._cellSize){
      for(let dx = -radius; dx <= radius; dx += nav._cellSize){
        const dist = Math.sqrt(dx*dx + dz*dz);
        if(dist <= radius){
          setWalkable(x + dx, z + dz, false);
        }
      }
    }
  }

  function removeObstacle(x, z, radius){
    for(let i = nav._obstacles.length - 1; i >= 0; i--){
      const obs = nav._obstacles[i];
      if(Math.abs(obs.x - x) < 0.1 && Math.abs(obs.z - z) < 0.1 && Math.abs(obs.radius - radius) < 0.1){
        nav._obstacles.splice(i, 1);
      }
    }
    rebuild();
  }

  function rebuild(){
    init();
    for(let i = 0; i < nav._obstacles.length; i++){
      const obs = nav._obstacles[i];
      for(let dz = -obs.radius; dz <= obs.radius; dz += nav._cellSize){
        for(let dx = -obs.radius; dx <= obs.radius; dx += nav._cellSize){
          const dist = Math.sqrt(dx*dx + dz*dz);
          if(dist <= obs.radius){
            setWalkable(obs.x + dx, obs.z + dz, false);
          }
        }
      }
    }
  }

  function findPath(startX, startZ, endX, endZ){
    if(!nav._initialized) return [];
    const startCell = getCellAt(startX, startZ);
    const endCell = getCellAt(endX, endZ);
    if(!startCell || !endCell || !startCell.walkable || !endCell.walkable) return [];
    const openSet = [startCell];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const cellKey = function(c){ return c.x + ',' + c.y; };
    gScore.set(cellKey(startCell), 0);
    fScore.set(cellKey(startCell), heuristic(startCell, endCell));
    while(openSet.length > 0){
      let current = openSet[0];
      let currentIdx = 0;
      for(let i = 1; i < openSet.length; i++){
        if((fScore.get(cellKey(openSet[i])) || Infinity) < (fScore.get(cellKey(current)) || Infinity)){
          current = openSet[i];
          currentIdx = i;
        }
      }
      if(current === endCell){
        return reconstructPath(cameFrom, current);
      }
      openSet.splice(currentIdx, 1);
      closedSet.add(cellKey(current));
      const neighbors = getNeighbors(current);
      for(let i = 0; i < neighbors.length; i++){
        const neighbor = neighbors[i];
        if(closedSet.has(cellKey(neighbor)) || !neighbor.walkable) continue;
        const tentativeG = (gScore.get(cellKey(current)) || 0) + neighbor.cost;
        if(!openSet.includes(neighbor)){
          openSet.push(neighbor);
        } else if(tentativeG >= (gScore.get(cellKey(neighbor)) || Infinity)){
          continue;
        }
        cameFrom.set(cellKey(neighbor), current);
        gScore.set(cellKey(neighbor), tentativeG);
        fScore.set(cellKey(neighbor), tentativeG + heuristic(neighbor, endCell));
      }
    }
    return [];
  }

  function heuristic(a, b){
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function getNeighbors(cell){
    const neighbors = [];
    const dirs = [[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
    for(let i = 0; i < dirs.length; i++){
      const nx = cell.x + dirs[i][0];
      const ny = cell.y + dirs[i][1];
      if(ny >= 0 && ny < nav._cells.length && nx >= 0 && nx < nav._cells[0].length){
        neighbors.push(nav._cells[ny][nx]);
      }
    }
    return neighbors;
  }

  function reconstructPath(cameFrom, current){
    const path = [{ x: current.x * nav._cellSize, z: current.y * nav._cellSize }];
    const cellKey = function(c){ return c.x + ',' + c.y; };
    while(cameFrom.has(cellKey(current))){
      current = cameFrom.get(cellKey(current));
      path.unshift({ x: current.x * nav._cellSize, z: current.y * nav._cellSize });
    }
    return path;
  }

  function smoothPath(path){
    if(path.length <= 2) return path;
    const smoothed = [path[0]];
    let lastValid = 0;
    for(let i = 1; i < path.length; i++){
      if(!hasLineOfSight(smoothed[smoothed.length-1], path[i])){
        smoothed.push(path[i-1]);
      }
    }
    smoothed.push(path[path.length-1]);
    return smoothed;
  }

  function hasLineOfSight(a, b){
    const dx = b.x - a.x, dz = b.z - a.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const steps = Math.ceil(dist / nav._cellSize);
    for(let i = 0; i <= steps; i++){
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      const cell = getCellAt(x, z);
      if(!cell || !cell.walkable) return false;
    }
    return true;
  }

  function getRandomWalkablePosition(){
    if(!nav._initialized) return null;
    for(let attempts = 0; attempts < 100; attempts++){
      const x = Math.random() * nav._width;
      const z = Math.random() * nav._height;
      const cell = getCellAt(x, z);
      if(cell && cell.walkable) return { x: x, z: z };
    }
    return null;
  }

  function clear(){
    nav._cells = [];
    nav._obstacles = [];
    nav._initialized = false;
  }

  return { init, setWalkable, getCellAt, addObstacle, removeObstacle, rebuild, findPath, smoothPath, getRandomWalkablePosition, clear, nav };
}

/* ===== 群体行为系统 =====
   支持: 分离 / 对齐 / 聚合 / 避障 / 追逐
*/
function createFlockingSystem(options){
  const flock = {
    _agents: [],
    _separationWeight: (options && options.separationWeight) || 1.5,
    _alignmentWeight: (options && options.alignmentWeight) || 1,
    _cohesionWeight: (options && options.cohesionWeight) || 1,
    _avoidanceWeight: (options && options.avoidanceWeight) || 2,
    _maxSpeed: (options && options.maxSpeed) || 5,
    _maxForce: (options && options.maxForce) || 0.5,
    _perceptionRadius: (options && options.perceptionRadius) || 5,
    _separationRadius: (options && options.separationRadius) || 2,
    _obstacles: [],
    _bounds: (options && options.bounds) || { minX: -50, maxX: 50, minY: -50, maxY: 50, minZ: -50, maxZ: 50 }
  };

  function createAgent(position, velocity){
    const agent = {
      position: position ? [...position] : [0,0,0],
      velocity: velocity ? [...velocity] : [Math.random()-0.5, 0, Math.random()-0.5],
      acceleration: [0,0,0],
      maxSpeed: flock._maxSpeed,
      maxForce: flock._maxForce,
      active: true
    };
    flock._agents.push(agent);
    return agent;
  }

  function removeAgent(agent){
    const idx = flock._agents.indexOf(agent);
    if(idx >= 0) flock._agents.splice(idx, 1);
  }

  function addObstacle(position, radius){
    flock._obstacles.push({ position: [...position], radius: radius });
  }

  function update(dt){
    for(let i = 0; i < flock._agents.length; i++){
      const agent = flock._agents[i];
      if(!agent.active) continue;
      const separation = computeSeparation(agent);
      const alignment = computeAlignment(agent);
      const cohesion = computeCohesion(agent);
      const avoidance = computeAvoidance(agent);
      const bounds = computeBounds(agent);
      agent.acceleration[0] += separation[0] * flock._separationWeight;
      agent.acceleration[1] += separation[1] * flock._separationWeight;
      agent.acceleration[2] += separation[2] * flock._separationWeight;
      agent.acceleration[0] += alignment[0] * flock._alignmentWeight;
      agent.acceleration[1] += alignment[1] * flock._alignmentWeight;
      agent.acceleration[2] += alignment[2] * flock._alignmentWeight;
      agent.acceleration[0] += cohesion[0] * flock._cohesionWeight;
      agent.acceleration[1] += cohesion[1] * flock._cohesionWeight;
      agent.acceleration[2] += cohesion[2] * flock._cohesionWeight;
      agent.acceleration[0] += avoidance[0] * flock._avoidanceWeight;
      agent.acceleration[1] += avoidance[1] * flock._avoidanceWeight;
      agent.acceleration[2] += avoidance[2] * flock._avoidanceWeight;
      agent.acceleration[0] += bounds[0];
      agent.acceleration[1] += bounds[1];
      agent.acceleration[2] += bounds[2];
      agent.velocity[0] += agent.acceleration[0] * dt;
      agent.velocity[1] += agent.acceleration[1] * dt;
      agent.velocity[2] += agent.acceleration[2] * dt;
      const speed = Math.sqrt(agent.velocity[0]**2 + agent.velocity[1]**2 + agent.velocity[2]**2);
      if(speed > agent.maxSpeed){
        agent.velocity[0] = agent.velocity[0] / speed * agent.maxSpeed;
        agent.velocity[1] = agent.velocity[1] / speed * agent.maxSpeed;
        agent.velocity[2] = agent.velocity[2] / speed * agent.maxSpeed;
      }
      agent.position[0] += agent.velocity[0] * dt;
      agent.position[1] += agent.velocity[1] * dt;
      agent.position[2] += agent.velocity[2] * dt;
      agent.acceleration = [0,0,0];
    }
  }

  function computeSeparation(agent){
    const steer = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._separationRadius){
        const diff = [
          (agent.position[0] - other.position[0]) / d,
          (agent.position[1] - other.position[1]) / d,
          (agent.position[2] - other.position[2]) / d
        ];
        steer[0] += diff[0];
        steer[1] += diff[1];
        steer[2] += diff[2];
        count++;
      }
    }
    if(count > 0){
      steer[0] /= count; steer[1] /= count; steer[2] /= count;
      return limitForce(steer, agent);
    }
    return steer;
  }

  function computeAlignment(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.velocity[0];
        sum[1] += other.velocity[1];
        sum[2] += other.velocity[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] * agent.maxSpeed, sum[1] * agent.maxSpeed, sum[2] * agent.maxSpeed];
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeCohesion(agent){
    const sum = [0,0,0];
    let count = 0;
    for(let i = 0; i < flock._agents.length; i++){
      const other = flock._agents[i];
      if(other === agent || !other.active) continue;
      const d = dist3(agent.position, other.position);
      if(d > 0 && d < flock._perceptionRadius){
        sum[0] += other.position[0];
        sum[1] += other.position[1];
        sum[2] += other.position[2];
        count++;
      }
    }
    if(count > 0){
      sum[0] /= count; sum[1] /= count; sum[2] /= count;
      const desired = [sum[0] - agent.position[0], sum[1] - agent.position[1], sum[2] - agent.position[2]];
      const dl = Math.sqrt(desired[0]**2 + desired[1]**2 + desired[2]**2) || 1;
      desired[0] = desired[0]/dl * agent.maxSpeed;
      desired[1] = desired[1]/dl * agent.maxSpeed;
      desired[2] = desired[2]/dl * agent.maxSpeed;
      const steer = [desired[0] - agent.velocity[0], desired[1] - agent.velocity[1], desired[2] - agent.velocity[2]];
      return limitForce(steer, agent);
    }
    return [0,0,0];
  }

  function computeAvoidance(agent){
    const steer = [0,0,0];
    for(let i = 0; i < flock._obstacles.length; i++){
      const obs = flock._obstacles[i];
      const d = dist3(agent.position, obs.position);
      if(d < obs.radius + flock._perceptionRadius){
        const diff = [
          (agent.position[0] - obs.position[0]) / (d || 1),
          (agent.position[1] - obs.position[1]) / (d || 1),
          (agent.position[2] - obs.position[2]) / (d || 1)
        ];
        const strength = 1 - (d / (obs.radius + flock._perceptionRadius));
        steer[0] += diff[0] * strength;
        steer[1] += diff[1] * strength;
        steer[2] += diff[2] * strength;
      }
    }
    return limitForce(steer, agent);
  }

  function computeBounds(agent){
    const steer = [0,0,0];
    const b = flock._bounds;
    const margin = 5;
    if(agent.position[0] < b.minX + margin) steer[0] = 1;
    if(agent.position[0] > b.maxX - margin) steer[0] = -1;
    if(agent.position[1] < b.minY + margin) steer[1] = 1;
    if(agent.position[1] > b.maxY - margin) steer[1] = -1;
    if(agent.position[2] < b.minZ + margin) steer[2] = 1;
    if(agent.position[2] > b.maxZ - margin) steer[2] = -1;
    return steer;
  }

  function dist3(a, b){
    return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
  }

  function limitForce(force, agent){
    const mag = Math.sqrt(force[0]**2 + force[1]**2 + force[2]**2);
    if(mag > agent.maxForce){
      force[0] = force[0]/mag * agent.maxForce;
      force[1] = force[1]/mag * agent.maxForce;
      force[2] = force[2]/mag * agent.maxForce;
    }
    return force;
  }

  function getAgents(){
    return flock._agents;
  }

  function setWeights(separation, alignment, cohesion, avoidance){
    if(separation !== undefined) flock._separationWeight = separation;
    if(alignment !== undefined) flock._alignmentWeight = alignment;
    if(cohesion !== undefined) flock._cohesionWeight = cohesion;
    if(avoidance !== undefined) flock._avoidanceWeight = avoidance;
  }

  function clear(){
    flock._agents = [];
    flock._obstacles = [];
  }

  return { createAgent, removeAgent, addObstacle, update, getAgents, setWeights, clear, flock };
}

/* ===== 感知系统 =====
   支持: 视觉 / 听觉 / 触觉 / 记忆 / 威胁评估
*/
function createPerceptionSystem(owner, options){
  const perc = {
    owner: owner,
    _senses: {
      vision: { enabled: true, range: 20, fov: Math.PI * 0.5, rayCount: 8 },
      hearing: { enabled: true, range: 15, threshold: 0.5 },
      touch: { enabled: true, range: 1 },
      smell: { enabled: false, range: 10 }
    },
    _memory: [],
    _maxMemory: (options && options.maxMemory) || 50,
    _memoryDuration: (options && options.memoryDuration) || 30,
    _threats: [],
    _knownEntities: new Map(),
    _lastUpdate: 0
  };

  function setSenseEnabled(sense, enabled){
    if(perc._senses[sense]) perc._senses[sense].enabled = enabled;
  }

  function setSenseRange(sense, range){
    if(perc._senses[sense]) perc._senses[sense].range = range;
  }

  function update(position, forward, entities, dt, currentTime){
    perc._lastUpdate = currentTime;
    perc._threats = [];
    perc._knownEntities.clear();
    if(perc._senses.vision.enabled){
      senseVision(position, forward, entities, currentTime);
    }
    if(perc._senses.hearing.enabled){
      senseHearing(position, entities, currentTime);
    }
    if(perc._senses.touch.enabled){
      senseTouch(position, entities, currentTime);
    }
    updateMemory(currentTime);
  }

  function senseVision(position, forward, entities, currentTime){
    const vision = perc._senses.vision;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const toEntity = [
        entity.position[0] - position[0],
        entity.position[1] - position[1],
        entity.position[2] - position[2]
      ];
      const dist = Math.sqrt(toEntity[0]**2 + toEntity[1]**2 + toEntity[2]**2);
      if(dist > vision.range) continue;
      const dir = [toEntity[0]/dist, toEntity[1]/dist, toEntity[2]/dist];
      const dot = forward[0]*dir[0] + forward[1]*dir[1] + forward[2]*dir[2];
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if(angle <= vision.fov * 0.5){
        const awareness = 1 - (dist / vision.range);
        perc._knownEntities.set(entity.id || i, {
          entity: entity,
          position: [...entity.position],
          lastSeen: currentTime,
          awareness: awareness,
          sense: 'vision'
        });
        if(entity.isThreat){
          perc._threats.push({ entity: entity, position: [...entity.position], threatLevel: awareness });
        }
      }
    }
  }

  function senseHearing(position, entities, currentTime){
    const hearing = perc._senses.hearing;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      if(!entity.noiseLevel || entity.noiseLevel < hearing.threshold) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist > hearing.range) continue;
      const awareness = entity.noiseLevel * (1 - dist / hearing.range);
      const key = entity.id || ('heard_' + i);
      if(!perc._knownEntities.has(key)){
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastHeard: currentTime,
          awareness: awareness,
          sense: 'hearing'
        });
      }
    }
  }

  function senseTouch(position, entities, currentTime){
    const touch = perc._senses.touch;
    for(let i = 0; i < entities.length; i++){
      const entity = entities[i];
      if(entity === perc.owner) continue;
      const dist = Math.sqrt(
        (entity.position[0]-position[0])**2 +
        (entity.position[1]-position[1])**2 +
        (entity.position[2]-position[2])**2
      );
      if(dist <= touch.range){
        const key = entity.id || ('touched_' + i);
        perc._knownEntities.set(key, {
          entity: entity,
          position: [...entity.position],
          lastTouched: currentTime,
          awareness: 1,
          sense: 'touch'
        });
      }
    }
  }

  function updateMemory(currentTime){
    for(const [key, info] of perc._knownEntities){
      perc._memory.push({
        key: key,
        entity: info.entity,
        position: [...info.position],
        time: currentTime,
        sense: info.sense,
        awareness: info.awareness
      });
    }
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(currentTime - perc._memory[i].time > perc._memoryDuration){
        perc._memory.splice(i, 1);
      }
    }
    if(perc._memory.length > perc._maxMemory){
      perc._memory.splice(0, perc._memory.length - perc._maxMemory);
    }
  }

  function getKnownEntities(){
    return Array.from(perc._knownEntities.values());
  }

  function getThreats(){
    return [...perc._threats];
  }

  function getHighestThreat(){
    if(perc._threats.length === 0) return null;
    return perc._threats.reduce(function(max, t){ return t.threatLevel > max.threatLevel ? t : max; });
  }

  function getMemory(){
    return [...perc._memory];
  }

  function isAwareOf(entity){
    return perc._knownEntities.has(entity.id) || perc._memory.some(function(m){ return m.entity === entity; });
  }

  function getLastKnownPosition(entity){
    const known = perc._knownEntities.get(entity.id);
    if(known) return [...known.position];
    for(let i = perc._memory.length - 1; i >= 0; i--){
      if(perc._memory[i].entity === entity) return [...perc._memory[i].position];
    }
    return null;
  }

  function clear(){
    perc._memory = [];
    perc._threats = [];
    perc._knownEntities.clear();
  }

  return { setSenseEnabled, setSenseRange, update, getKnownEntities, getThreats, getHighestThreat, getMemory, isAwareOf, getLastKnownPosition, clear, perc };
}

/* ===== 对话系统 =====
   支持: 对话树 / 条件分支 / 选项 / 变量
*/
function createDialogueSystem(options){
  const dlg = {
    _nodes: new Map(),
    _currentNode: null,
    _variables: {},
    _history: [],
    _listeners: [],
    _speaker: ''
  };

  function addNode(id, data){
    dlg._nodes.set(id, { id: id, ...data });
  }

  function removeNode(id){
    dlg._nodes.delete(id);
  }

  function start(nodeId){
    const node = dlg._nodes.get(nodeId);
    if(!node) return false;
    dlg._currentNode = node;
    dlg._speaker = node.speaker || '';
    dlg._history.push({ nodeId: nodeId, time: Date.now() });
    emitEvent('nodeStart', node);
    if(node.onEnter) node.onEnter(dlg);
    return true;
  }

  function selectOption(index){
    if(!dlg._currentNode || !dlg._currentNode.options) return false;
    const option = dlg._currentNode.options[index];
    if(!option) return false;
    if(option.condition && !option.condition(dlg)) return false;
    if(option.onSelect) option.onSelect(dlg);
    if(option.next){
      return start(option.next);
    }
    return true;
  }

  function advance(){
    if(!dlg._currentNode) return false;
    if(dlg._currentNode.next){
      return start(dlg._currentNode.next);
    }
    return false;
  }

  function getCurrentNode(){
    return dlg._currentNode;
  }

  function getText(){
    return dlg._currentNode ? dlg._currentNode.text : '';
  }

  function getSpeaker(){
    return dlg._currentNode ? dlg._currentNode.speaker || '' : '';
  }

  function getOptions(){
    if(!dlg._currentNode || !dlg._currentNode.options) return [];
    return dlg._currentNode.options.filter(function(opt){
      return !opt.condition || opt.condition(dlg);
    }).map(function(opt){
      return { text: opt.text, available: !opt.condition || opt.condition(dlg) };
    });
  }

  function setVariable(name, value){
    dlg._variables[name] = value;
    emitEvent('variableChange', { name: name, value: value });
  }

  function getVariable(name){
    return dlg._variables[name];
  }

  function getHistory(){
    return [...dlg._history];
  }

  function hasVisited(nodeId){
    return dlg._history.some(function(h){ return h.nodeId === nodeId; });
  }

  function on(event, callback){
    dlg._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < dlg._listeners.length; i++){
      if(dlg._listeners[i].event === event){
        try{ dlg._listeners[i].callback(data); } catch(e){ console.error('[Dialogue] 事件错误:', e); }
      }
    }
  }

  function isFinished(){
    return !dlg._currentNode;
  }

  function reset(){
    dlg._currentNode = null;
    dlg._variables = {};
    dlg._history = [];
    dlg._speaker = '';
  }

  function clear(){
    dlg._nodes.clear();
    reset();
    dlg._listeners = [];
  }

  return { addNode, removeNode, start, selectOption, advance, getCurrentNode, getText, getSpeaker, getOptions, setVariable, getVariable, getHistory, hasVisited, on, isFinished, reset, clear, dlg };
}

/* ===== 存档系统 =====
   支持: 多槽位 / 自动存档 / 序列化 / 元数据
*/
function createSaveSystem(options){
  const save = {
    _slots: new Map(),
    _maxSlots: (options && options.maxSlots) || 10,
    _autoSaveSlot: (options && options.autoSaveSlot) || 0,
    _currentSlot: -1,
    _serializers: new Map(),
    _storageKey: (options && options.storageKey) || 'game_saves',
    _listeners: []
  };

  function registerSerializer(type, serializeFn, deserializeFn){
    save._serializers.set(type, { serialize: serializeFn, deserialize: deserializeFn });
  }

  function saveGame(slotIndex, data, metadata){
    if(slotIndex < 0 || slotIndex >= save._maxSlots) return false;
    const slot = {
      index: slotIndex,
      data: serializeData(data),
      metadata: metadata || {},
      timestamp: Date.now(),
      version: (options && options.version) || '1.0'
    };
    save._slots.set(slotIndex, slot);
    save._currentSlot = slotIndex;
    persist();
    emitEvent('saved', { slot: slotIndex, metadata: slot.metadata });
    return true;
  }

  function loadGame(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    save._currentSlot = slotIndex;
    emitEvent('loaded', { slot: slotIndex, metadata: slot.metadata });
    return deserializeData(slot.data);
  }

  function autoSave(data, metadata){
    return saveGame(save._autoSaveSlot, data, { ...metadata, autoSave: true });
  }

  function deleteSave(slotIndex){
    if(save._slots.delete(slotIndex)){
      persist();
      emitEvent('deleted', { slot: slotIndex });
      return true;
    }
    return false;
  }

  function getSaveInfo(slotIndex){
    const slot = save._slots.get(slotIndex);
    if(!slot) return null;
    return {
      index: slot.index,
      metadata: slot.metadata,
      timestamp: slot.timestamp,
      version: slot.version,
      date: new Date(slot.timestamp).toLocaleString()
    };
  }

  function getAllSaves(){
    const saves = [];
    for(const [index, slot] of save._slots){
      saves.push(getSaveInfo(index));
    }
    return saves.sort(function(a, b){ return b.timestamp - a.timestamp; });
  }

  function getCurrentSlot(){
    return save._currentSlot;
  }

  function hasSave(slotIndex){
    return save._slots.has(slotIndex);
  }

  function serializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = { _type: value._type, _data: serializer.serialize(value) };
      } else {
        result[key] = JSON.parse(JSON.stringify(value));
      }
    }
    return result;
  }

  function deserializeData(data){
    const result = {};
    for(const key in data){
      const value = data[key];
      if(value && value._type && save._serializers.has(value._type)){
        const serializer = save._serializers.get(value._type);
        result[key] = serializer.deserialize(value._data);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  function persist(){
    try{
      const data = {};
      for(const [index, slot] of save._slots){
        data[index] = slot;
      }
      localStorage.setItem(save._storageKey, JSON.stringify(data));
    } catch(e){
      console.error('[SaveSystem] 持久化失败:', e);
    }
  }

  function restore(){
    try{
      const data = localStorage.getItem(save._storageKey);
      if(data){
        const parsed = JSON.parse(data);
        for(const index in parsed){
          save._slots.set(parseInt(index), parsed[index]);
        }
      }
    } catch(e){
      console.error('[SaveSystem] 恢复失败:', e);
    }
  }

  function on(event, callback){
    save._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < save._listeners.length; i++){
      if(save._listeners[i].event === event){
        try{ save._listeners[i].callback(data); } catch(e){ console.error('[SaveSystem] 事件错误:', e); }
      }
    }
  }

  function exportSave(slotIndex){
    const slot = save._slots.get(slotIndex);
    return slot ? JSON.stringify(slot) : null;
  }

  function importSave(json){
    try{
      const slot = JSON.parse(json);
      if(slot.index !== undefined){
        save._slots.set(slot.index, slot);
        persist();
        return true;
      }
    } catch(e){
      console.error('[SaveSystem] 导入失败:', e);
    }
    return false;
  }

  function clearAll(){
    save._slots.clear();
    save._currentSlot = -1;
    persist();
  }

  restore();
  return { registerSerializer, saveGame, loadGame, autoSave, deleteSave, getSaveInfo, getAllSaves, getCurrentSlot, hasSave, on, exportSave, importSave, clearAll, save };
}

/* ===== 本地化系统 =====
   支持: 多语言 / 文本替换 / 变量插值 / 复数形式
*/
function createLocalization(options){
  const loc = {
    _currentLanguage: (options && options.defaultLanguage) || 'zh-CN',
    _languages: new Map(),
    _fallbackLanguage: (options && options.fallbackLanguage) || 'en-US',
    _listeners: []
  };

  function addLanguage(code, strings){
    loc._languages.set(code, { ...strings });
  }

  function setLanguage(code){
    if(loc._languages.has(code)){
      loc._currentLanguage = code;
      emitEvent('languageChange', code);
      return true;
    }
    return false;
  }

  function getLanguage(){
    return loc._currentLanguage;
  }

  function getAvailableLanguages(){
    return Array.from(loc._languages.keys());
  }

  function t(key, variables){
    const strings = loc._languages.get(loc._currentLanguage);
    let text = strings ? strings[key] : undefined;
    if(text === undefined){
      const fallback = loc._languages.get(loc._fallbackLanguage);
      text = fallback ? fallback[key] : undefined;
    }
    if(text === undefined) return key;
    if(variables){
      for(const varName in variables){
        text = text.replace(new RegExp('\\{' + varName + '\\}', 'g'), variables[varName]);
      }
    }
    return text;
  }

  function tPlural(key, count, variables){
    const pluralKey = key + '_' + getPluralForm(count);
    let text = t(pluralKey, { count: count, ...variables });
    if(text === pluralKey){
      text = t(key, { count: count, ...variables });
    }
    return text;
  }

  function getPluralForm(count){
    const lang = loc._currentLanguage;
    if(lang === 'zh-CN' || lang === 'ja' || lang === 'ko'){
      return 'other';
    }
    if(lang === 'en-US' || lang === 'en-GB'){
      return count === 1 ? 'one' : 'other';
    }
    if(lang === 'ru' || lang === 'pl'){
      if(count % 10 === 1 && count % 100 !== 11) return 'one';
      if(count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20)) return 'few';
      return 'many';
    }
    return count === 1 ? 'one' : 'other';
  }

  function hasKey(key){
    const strings = loc._languages.get(loc._currentLanguage);
    if(strings && strings[key] !== undefined) return true;
    const fallback = loc._languages.get(loc._fallbackLanguage);
    return fallback && fallback[key] !== undefined;
  }

  function addString(lang, key, value){
    if(!loc._languages.has(lang)) loc._languages.set(lang, {});
    loc._languages.get(lang)[key] = value;
  }

  function on(event, callback){
    loc._listeners.push({ event: event, callback: callback });
  }

  function emitEvent(event, data){
    for(let i = 0; i < loc._listeners.length; i++){
      if(loc._listeners[i].event === event){
        try{ loc._listeners[i].callback(data); } catch(e){ console.error('[Localization] 事件错误:', e); }
      }
    }
  }

  function getLanguageName(code){
    const names = {
      'zh-CN': '简体中文',
      'zh-TW': '繁體中文',
      'en-US': 'English (US)',
      'en-GB': 'English (UK)',
      'ja': '日本語',
      'ko': '한국어',
      'fr': 'Français',
      'de': 'Deutsch',
      'es': 'Español',
      'ru': 'Русский'
    };
    return names[code] || code;
  }

  return { addLanguage, setLanguage, getLanguage, getAvailableLanguages, t, tPlural, hasKey, addString, on, getLanguageName, loc };
}



/* ===== 复数数学系统 =====
   支持: 基本运算 / 极坐标 / 根 / 对数 / 三角函数
*/

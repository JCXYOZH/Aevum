/**
 * MrHua 3D灵体渲染引擎 - 扩展模块: orb-extension-bone-retargeting
 * 从 legacy/_orb_expand_part7.js 转换 (GBK->UTF-8)
 * @module orb-extension-bone-retargeting
 */
'use strict';



/* ===== 高级骨骼重定向系统=====
   支持: 自动骨骼映射 / T-Pose对齐 / 比例补偿 / 动画重定向*/
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
    'chest': ['chest', '上半身', 'Chest', 'Spine2'],
    'neck': ['neck', '首', 'Neck'],
    'head': ['head', '头', 'Head'],
    'leftShoulder': ['leftShoulder', '左肩', 'LeftShoulder', 'L_Shoulder'],
    'leftUpperArm': ['leftUpperArm', '左腕', 'LeftArm', 'L_Arm'],
    'leftLowerArm': ['leftLowerArm', '左ひじ', 'LeftForeArm', 'L_ForeArm'],
    'leftHand': ['leftHand', '左手首', 'LeftHand', 'L_Hand'],
    'rightShoulder': ['rightShoulder', '右肩', 'RightShoulder', 'R_Shoulder'],
    'rightUpperArm': ['rightUpperArm', '右腕', 'RightArm', 'R_Arm'],
    'rightLowerArm': ['rightLowerArm', '右ひじ', 'RightForeArm', 'R_ForeArm'],
    'rightHand': ['rightHand', '右手首', 'RightHand', 'R_Hand'],
    'leftUpperLeg': ['leftUpperLeg', '左足', 'LeftUpLeg', 'L_UpLeg'],
    'leftLowerLeg': ['leftLowerLeg', '左ひじ', 'LeftLeg', 'L_Leg'],
    'leftFoot': ['leftFoot', '左足首', 'LeftFoot', 'L_Foot'],
    'leftToes': ['leftToes', '左つま先', 'LeftToeBase', 'L_Toe'],
    'rightUpperLeg': ['rightUpperLeg', '右足', 'RightUpLeg', 'R_UpLeg'],
    'rightLowerLeg': ['rightLowerLeg', '右ひじ', 'RightLeg', 'R_Leg'],
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

/* ===== 动画层混合系统=====
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
   支持: 音素映射 / 音频驱动 / 时间轴同步/ 嘴型混合
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
   支持: 位置约束 / 旋转约束 / 缩放约束 / 目标约束 / 极向量约束*/
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

/* ===== 根运动系统=====
   支持: 根骨骼提取/ 运动位移 / 旋转累积 / 碰撞响应
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
   支持: 时间轴事件/ 条件触发 / 回调注册 / 事件队列
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
        try{ aes._handlers[name][i](data); } catch(e){ console.error('[AnimEvent] 处理器错误', e); }
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

/* ===== 时间轴系统=====
   支持: 多轨道/ 关键帧/ 播放控制 / 缩放平移
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

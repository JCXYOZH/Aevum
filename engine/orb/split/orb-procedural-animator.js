/**
 * MrHua 3D灵体渲染引擎 - orb-procedural-animator
 * 程序化闲置动画生成器
 * 从 orb-renderer-main.js 拆分 (原行 L2814-L3289)
 * @module orb-procedural-animator
 */
'use strict';

/* ===== 程序化闲置动画 ===== */
function createProceduralAnimator(boneSystem, model){
  const bones = boneSystem.bones;
  const n = bones.length;
  // 调试：输出前30个骨骼名称，帮助定位匹配问题
  const boneNames = bones.slice(0, 30).map((b,i) => i+':'+(b.name||'')+'/'+(b.nameEn||''));
  console.log('[ProceduralAnimator] 骨骼列表(前30):', boneNames.join(' | '));
  const poseRotations = new Array(n);
  const posePositions = new Array(n);
  const blinkMorphs = [];
  const smileMorphs = [];
  let blinkTimer = 0.3, blinkState = 0, blinkValue = 0, blinkCount = 0;
  let breathPhase = 1.5;
  let idlePhase = 2.0;
  let lookTimer = 0, lookTargetX = 0, lookTargetY = 0, lookCurX = 0, lookCurY = 0;

  // 动作覆盖队列：存储临时骨骼旋转，优先级高于update()的基础姿态
  // 每个元素: { boneIdx, rotation: Quat, expireTime, easeIn, easeOut }
  const _boneOverrides = [];
  // 说话状态
  let _talking = false;
  let _talkPhase = 0;
  // 情绪状态
  let _emotion = 'neutral';
  let _emotionBlend = 0; // 0-1 情绪混合进度

  const boneMap = {};
  for(let i=0;i<n;i++){ boneMap[bones[i].name] = i; }

  function findBone(patterns){
    // 先从boneMap（日文名）匹配
    for(const p of patterns){
      for(const name in boneMap){
        if(name.includes(p)) return boneMap[name];
      }
    }
    // 再从bones数组匹配nameEn（英文名）
    for(const p of patterns){
      for(let i=0;i<bones.length;i++){
        const b = bones[i];
        if((b.nameEn && b.nameEn.includes(p)) || (b.name && b.name.includes(p))) return i;
      }
    }
    return -1;
  }
  function findBones(patterns){
    const result = [];
    const seen = new Set();
    for(const p of patterns){
      for(const name in boneMap){
        if(name.includes(p)){
          const idx = boneMap[name];
          if(!seen.has(idx)){ seen.add(idx); result.push(idx); }
        }
      }
    }
    for(const p of patterns){
      for(let i=0;i<bones.length;i++){
        const b = bones[i];
        if(((b.nameEn && b.nameEn.includes(p)) || (b.name && b.name.includes(p))) && !seen.has(i)){
          seen.add(i); result.push(i);
        }
      }
    }
    return result;
  }

  const headBone = findBone(['頭','头','头部','头骨','head','Head','首','颈部上']);
  const neckBone = findBone(['首','颈','颈部','脖子','neck','Neck','頸']);
  const spineBones = findBones(['上半身2','上半身','下半身','腰','腰部','脊柱','脊椎','胸口','胸部','spine','Spine','chest','Chest']);
  const hipBone = findBone(['センター','下半身','腰部中心','中心','髋','髋部','hip','Hip','center','Center']);
  // 分离肩/肘/腕 - 增强匹配模式
  const leftShoulder = findBone(['左肩','左肩P','左肩C','左肩膀','左肩胛','leftShoulder','LeftShoulder','shoulder_L','Shoulder_L']);
  const leftUpperArm = findBone(['左腕','左大臂','左上臂','左胳膊','leftArm','LeftArm','arm_L','Arm_L','上腕_L']);
  const leftElbow = findBone(['左ひじ','左肘','左肘部','左胳膊肘','leftElbow','LeftElbow','elbow_L','Elbow_L','ひじ_L']);
  const leftWrist = findBone(['左手首','左手腕','左腕部','leftWrist','LeftWrist','wrist_L','Wrist_L','手首_L']);
  const rightShoulder = findBone(['右肩','右肩P','右肩C','右肩膀','右肩胛','rightShoulder','RightShoulder','shoulder_R','Shoulder_R']);
  const rightUpperArm = findBone(['右腕','右大臂','右上臂','右胳膊','rightArm','RightArm','arm_R','Arm_R','上腕_R']);
  const rightElbow = findBone(['右ひじ','右肘','右肘部','右胳膊肘','rightElbow','RightElbow','elbow_R','Elbow_R','ひじ_R']);
  const rightWrist = findBone(['右手首','右手腕','右腕部','rightWrist','RightWrist','wrist_R','Wrist_R','手首_R']);
  const leftLeg = [findBone(['左足','左腿','左大腿','leftLeg','LeftLeg']),findBone(['左ひざ','左膝','左膝盖','leftKnee','LeftKnee']),findBone(['左足首','左脚腕','左踝','leftAnkle','LeftAnkle'])];
  const rightLeg = [findBone(['右足','右腿','右大腿','rightLeg','RightLeg']),findBone(['右ひざ','右膝','右膝盖','rightKnee','RightKnee']),findBone(['右足首','右脚腕','右踝','rightAnkle','RightAnkle'])];
  const leftEye = findBone(['左目','左眼','左眼球','左眼骨','leftEye','LeftEye']);
  const rightEye = findBone(['右目','右眼','右眼球','右眼骨','rightEye','RightEye']);

  // 父骨骼兜底：如果肩/肘没找到，用腕/肘的父骨骼
  let _resolvedLeftShoulder = leftShoulder;
  let _resolvedRightShoulder = rightShoulder;
  let _resolvedLeftElbow = leftElbow;
  let _resolvedRightElbow = rightElbow;
  if(_resolvedLeftShoulder < 0 && leftUpperArm >= 0 && bones[leftUpperArm].parent >= 0){
    _resolvedLeftShoulder = bones[leftUpperArm].parent;
  }
  if(_resolvedRightShoulder < 0 && rightUpperArm >= 0 && bones[rightUpperArm].parent >= 0){
    _resolvedRightShoulder = bones[rightUpperArm].parent;
  }
  if(_resolvedLeftElbow < 0 && leftWrist >= 0 && bones[leftWrist].parent >= 0){
    _resolvedLeftElbow = bones[leftWrist].parent;
  }
  if(_resolvedRightElbow < 0 && rightWrist >= 0 && bones[rightWrist].parent >= 0){
    _resolvedRightElbow = bones[rightWrist].parent;
  }

  // ========== 轻量骨骼诊断（延迟执行，只输出关键信息，使用console.debug避免错误监控捕获） ==========
  setTimeout(function(){
    const _armKeys = ['右肩','右腕','右ひじ','右手首','右足','右ひざ','右足首','左肩','左腕','左ひじ','左手首'];
    const _found = [];
    for(let i=0;i<n;i++){
      const nm = bones[i].name || '';
      for(const k of _armKeys){
        if(nm.includes(k)){ _found.push({idx:i, name:nm, parent:bones[i].parent, pos:bones[i].position}); break; }
      }
    }
    console.debug('[BoneDiag] 右臂关键骨骼 (' + _found.length + '个):');
    _found.forEach(function(b){
      const pn = b.parent >= 0 && bones[b.parent] ? bones[b.parent].name : '根';
      console.debug('  #' + b.idx + ' ' + b.name + ' 父=#' + b.parent + '(' + pn + ') pos=[' + b.pos.map(function(v){return v.toFixed(2);}).join(',') + ']');
    });
    console.debug('[BoneDiag] 解析结果: 右肩=' + _resolvedRightShoulder + ' 右上臂=' + rightUpperArm + ' 右肘=' + _resolvedRightElbow + ' 右腕=' + rightWrist);
  }, 800);

  // 立即输出关键骨骼映射结果（用于诊断动画是否生效）
  console.log('[ProceduralAnimator] 关键骨骼映射结果:');
  console.log('  头部(headBone):', headBone, headBone >= 0 ? ('✓ ' + (bones[headBone] ? bones[headBone].name : '?')) : '✗ 未找到');
  console.log('  颈部(neckBone):', neckBone, neckBone >= 0 ? ('✓ ' + (bones[neckBone] ? bones[neckBone].name : '?')) : '✗ 未找到');
  console.log('  左眼(leftEye):', leftEye, leftEye >= 0 ? ('✓ ' + (bones[leftEye] ? bones[leftEye].name : '?')) : '✗ 未找到');
  console.log('  右眼(rightEye):', rightEye, rightEye >= 0 ? ('✓ ' + (bones[rightEye] ? bones[rightEye].name : '?')) : '✗ 未找到');
  console.log('  左上臂:', leftUpperArm, leftUpperArm >= 0 ? ('✓ ' + (bones[leftUpperArm] ? bones[leftUpperArm].name : '?')) : '✗ 未找到');
  console.log('  右上臂:', rightUpperArm, rightUpperArm >= 0 ? ('✓ ' + (bones[rightUpperArm] ? bones[rightUpperArm].name : '?')) : '✗ 未找到');
  console.log('  眨眼形态键(blinkMorphs):', blinkMorphs.length, '个', blinkMorphs.length > 0 ? '✓' : '✗ 未找到');
  console.log('  脊柱骨骼(spineBones):', spineBones.length, '个');
  console.log('[ProceduralAnimator] 动画状态: 头部=' + (headBone>=0?'启用':'禁用') + ' 眨眼=' + (blinkMorphs.length>0?'启用':'禁用') + ' 眼球=' + (leftEye>=0&&rightEye>=0?'启用':'禁用') + ' 手臂=禁用(已注释)');

  // 手动触发完整诊断（控制台调用 animator.dumpBoneDiagnostics()）
  function dumpBoneDiagnostics(){
    console.log('========== [BoneDiag] 完整骨骼诊断 ==========');
    // 所有包含"右"的骨骼
    const rightBones = [];
    for(let i=0;i<n;i++){
      const b = bones[i];
      const name = b.name || '';
      if(name.includes('右') || name.includes('right') || name.includes('_r')){
        rightBones.push({idx:i, name:name, parent:b.parent, pos:b.position});
      }
    }
    console.log('[BoneDiag] 包含"右"的骨骼 (' + rightBones.length + '个):');
    rightBones.forEach(function(b){
      const pn = b.parent >= 0 && bones[b.parent] ? bones[b.parent].name : '根';
      console.log('  #' + b.idx + ' ' + b.name + ' 父=#' + b.parent + '(' + pn + ') pos=[' + b.pos.map(function(v){return v.toFixed(2);}).join(',') + ']');
    });
    // X坐标>2的骨骼
    console.log('[BoneDiag] X坐标>2的骨骼:');
    const xRightBones = [];
    for(let i=0;i<n;i++){
      const b = bones[i];
      if(b.position && b.position[0] > 2){
        const pn = b.parent >= 0 && bones[b.parent] ? bones[b.parent].name : '根';
        console.log('  #' + i + ' ' + (b.name || '?') + ' X=' + b.position[0].toFixed(2) + ' 父=#' + b.parent + '(' + pn + ')');
        xRightBones.push({idx:i, name:b.name, x:b.position[0]});
      }
    }
    console.log('========== [BoneDiag] 结束 ==========');
    return { rightBones: rightBones, xRightBones: xRightBones };
  }

  const _allMorphs = boneSystem.morphs || [];
  console.log('[ProceduralAnimator] 模型形态键总数:', _allMorphs.length);
  if(_allMorphs.length > 0 && _allMorphs.length <= 30){
    console.log('[ProceduralAnimator] 形态键列表:', _allMorphs.map(function(m){return m.name || m.nameEn || '?';}).join(' | '));
  } else if(_allMorphs.length > 30){
    console.log('[ProceduralAnimator] 形态键列表(前30):', _allMorphs.slice(0,30).map(function(m){return m.name || m.nameEn || '?';}).join(' | '));
  }
  for(const m of _allMorphs){
    const name = (m.name || m.nameEn || '').toLowerCase();
    // 眨眼形态键：MMD标准 + 中文 + 英文
    if(name.includes('眨眼')||name.includes('blink')||name.includes('まばたき')||
       name.includes('目閉じ')||name.includes('闭眼')||name.includes('wink')||name.includes('ウィンク')||
       name.includes('あ')||name.includes('い')||name.includes('う')||name.includes('え')||name.includes('お')){
      // 排除非眨眼的形态键（比如"あご"、"いじわる"等）
      if(!name.includes('あご')&&!name.includes('いじわる')&&!name.includes('うれし')&&!name.includes('えがお')&&!name.includes('おこ')){
        blinkMorphs.push(m);
      }
    }
    // 笑形态键
    if(name.includes('笑')||name.includes('smile')||name.includes('わらい')||
       name.includes('にっこり')||name.includes('ぺこり')||name.includes('ω')||name.includes('えがお')){
      smileMorphs.push(m);
    }
  }
  console.log('[ProceduralAnimator] 匹配到眨眼形态键:', blinkMorphs.length, '个', blinkMorphs.map(function(m){return m.name || m.nameEn || '?';}).join(','));
  console.log('[ProceduralAnimator] 匹配到笑形态键:', smileMorphs.length, '个', smileMorphs.map(function(m){return m.name || m.nameEn || '?';}).join(','));

  function initPose(){
    for(let i=0;i<n;i++){
      poseRotations[i] = Q.identity(Q.create());
      posePositions[i] = bones[i].position.slice();
    }
  }
  initPose();

  function setRot(idx, x, y, z){
    if(idx < 0) return;
    Q.fromEuler(poseRotations[idx], x, y, z);
  }
  function setPos(idx, x, y, z){
    if(idx < 0) return;
    posePositions[idx][0] = x;
    posePositions[idx][1] = y;
    posePositions[idx][2] = z;
  }
  function addPos(idx, dx, dy, dz){
    if(idx < 0) return;
    posePositions[idx][0] += dx;
    posePositions[idx][1] += dy;
    posePositions[idx][2] += dz;
  }

  function update(dt, time){
    breathPhase += dt * 0.9;
    idlePhase += dt * 0.5;
    const breath = (Math.sin(breathPhase) + 1) * 0.5;
    const breathSlow = (Math.sin(breathPhase * 0.5 + 1.3) + 1) * 0.5;

    // 呼吸：腰部保持稳定
    const waistBones = findBones(['下半身','腰','waist','Waist']);
    for(const wi of waistBones){
      setRot(wi, 0, 0, 0);
    }
    // 胸腔起伏和重心微移暂时禁用，排查模型消失问题
    // const chestBones = findBones(['上半身2','上半身','chest','Chest']);
    // const breathOffset = breath * 0.04;
    // for(const ci of chestBones){
    //   const base = bones[ci].position;
    //   setPos(ci, base[0], base[1] + breathOffset, base[2]);
    // }
    // if(hipBone >= 0){
    //   const base = bones[hipBone].position;
    //   const swayX = Math.sin(idlePhase) * 0.02;
    //   const swayZ = Math.cos(idlePhase * 0.7) * 0.015;
    //   const swayY = Math.sin(idlePhase * 1.3) * 0.008;
    //   setPos(hipBone, base[0] + swayX, base[1] + swayY, base[2] + swayZ);
    // }

    // 头部：基础微摆 + 偶尔环视
    lookTimer -= dt;
    if(lookTimer <= 0){
      lookTargetX = (Math.random() - 0.5) * 0.4;
      lookTargetY = (Math.random() - 0.5) * 0.2;
      lookTimer = 2.5 + Math.random() * 4;
    }
    lookCurX += (lookTargetX - lookCurX) * Math.min(1, dt * 1.5);
    lookCurY += (lookTargetY - lookCurY) * Math.min(1, dt * 1.5);
    const headSwayX = Math.sin(time * 0.7) * 0.06 + lookCurX;
    const headSwayZ = Math.sin(time * 0.5 + 1.0) * 0.04 + lookCurY;
    if(headBone >= 0){
      setRot(headBone, headSwayZ, headSwayX, Math.sin(time*0.6)*0.02);
    }
    if(neckBone >= 0 && neckBone !== headBone){
      setRot(neckBone, headSwayZ*0.4, headSwayX*0.4, 0);
    }

    // 手臂：暂时禁用强制旋转，不同模型骨骼初始姿态不同，统一旋转会导致扭曲
    // TODO: 根据模型骨骼初始姿态动态计算旋转角度
    const armSwing = Math.sin(time * 0.8) * 0.03;
    const armBreath = breath * 0.015;
    // 左肩+左臂：仅保留微小呼吸摆动，不做强制下垂
    // if(_resolvedLeftShoulder >= 0) setRot(_resolvedLeftShoulder, 0, 0, 1.4 + armBreath);
    // if(leftUpperArm >= 0) setRot(leftUpperArm, 0.1 + armSwing, 0, 0.2 + armBreath);
    // if(_resolvedLeftElbow >= 0) setRot(_resolvedLeftElbow, 0.3 + Math.sin(time*0.9)*0.02, 0, 0.1);
    // if(leftWrist >= 0) setRot(leftWrist, -0.05 + Math.sin(time*1.1)*0.015, 0, -0.1);
    // 右肩+右臂：仅保留微小呼吸摆动，不做强制下垂
    // if(_resolvedRightShoulder >= 0) setRot(_resolvedRightShoulder, 0, 0, -1.4 - armBreath);
    // if(rightUpperArm >= 0) setRot(rightUpperArm, 0.1 - armSwing, 0, -0.2 - armBreath);
    // if(_resolvedRightElbow >= 0) setRot(_resolvedRightElbow, 0.3 - Math.sin(time*0.9)*0.02, 0, -0.1);
    // if(rightWrist >= 0) setRot(rightWrist, -0.05 - Math.sin(time*1.1)*0.015, 0, 0.1);

    // 腿部：保持直立，不做弯曲（避免腰弯折）
    for(const li of leftLeg){
      if(li >= 0) setRot(li, 0, 0, 0);
    }
    for(const ri of rightLeg){
      if(ri >= 0) setRot(ri, 0, 0, 0);
    }

    // 眨眼：自然随机间隔 + 偶尔双眨
    blinkTimer -= dt;
    if(blinkTimer <= 0){
      if(blinkState === 0){
        blinkState = 1; blinkTimer = 0.06;
      } else if(blinkState === 1){
        blinkState = 2; blinkTimer = 0.03;
      } else if(blinkState === 2){
        blinkCount++;
        if(blinkCount < 2 && Math.random() < 0.25){
          // 双眨：快速再眨一次
          blinkState = 0; blinkTimer = 0.12;
        } else {
          blinkState = 0; blinkCount = 0; blinkTimer = 2.5 + Math.random() * 4.5;
        }
      }
    }
    blinkValue = blinkState === 1 ? 0.5 : blinkState === 2 ? 1.0 : 0.0;

    // 眼球随头部环视方向微动
    if(leftEye >= 0) setRot(leftEye, lookCurY * 0.5, lookCurX * 0.5, 0);
    if(rightEye >= 0) setRot(rightEye, lookCurY * 0.5, lookCurX * 0.5, 0);

    // 应用动作覆盖队列（优先级高于基础姿态）
    const _now = performance.now();
    if(_boneOverrides.length > 0){
      console.log('[ProceduralAnimator] applying overrides count=' + _boneOverrides.length + ' now=' + Math.floor(_now));
    }
    for(let _i = _boneOverrides.length - 1; _i >= 0; _i--){
      const _ov = _boneOverrides[_i];
      if(_now >= _ov.expireTime){
        _boneOverrides.splice(_i, 1);
        continue;
      }
      if(_ov.boneIdx < 0 || _ov.boneIdx >= n) continue;
      // 计算混合权重：easeIn（前20%渐入）+ easeOut（后20%渐出）
      const _elapsed = _ov.startTime ? (_now - _ov.startTime) : 0;
      const _total = _ov.duration || 500;
      let _weight = 1.0;
      if(_elapsed < _total * 0.2) _weight = _elapsed / (_total * 0.2); // 渐入
      else if(_elapsed > _total * 0.8) _weight = (_total - _elapsed) / (_total * 0.2); // 渐出
      _weight = Math.max(0, Math.min(1, _weight));
      if(_weight <= 0) continue;
      // 四元数插值混合
      const _base = poseRotations[_ov.boneIdx];
      const _target = _ov.rotation;
      // 详细调试：只在每个覆盖的第一帧输出
      if(!_ov._logged){
        _ov._logged = true;
        const _boneName = bones[_ov.boneIdx] ? (bones[_ov.boneIdx].name || bones[_ov.boneIdx].nameEn || '?') : 'invalid';
        console.log('[ProceduralAnimator] override detail:', {
          boneIdx: _ov.boneIdx, boneName: _boneName,
          baseRot: [_base[0].toFixed(3), _base[1].toFixed(3), _base[2].toFixed(3), _base[3].toFixed(3)],
          targetRot: [_target[0].toFixed(3), _target[1].toFixed(3), _target[2].toFixed(3), _target[3].toFixed(3)],
          weight: _weight.toFixed(3), elapsed: Math.floor(_elapsed), total: _total
        });
      }
      Q.slerp(_base, _base, _target, _weight);
    }

    // 说话口型：通过头部骨骼微动模拟（如果没有嘴部形态键）
    if(_talking){
      _talkPhase += dt * 12;
      const _jawOpen = (Math.sin(_talkPhase) * 0.5 + 0.5) * 0.08;
      // 下颌骨如果存在，轻微旋转
      const _jawBone = findBone(['下顎','下顎2','jaw','Jaw','あご']);
      if(_jawBone >= 0){
        const _jawBase = poseRotations[_jawBone];
        const _jawTarget = Q.create();
        Q.fromEuler(_jawTarget, _jawOpen, 0, 0);
        Q.slerp(_jawBase, _jawBase, _jawTarget, 0.8);
      }
    }

    return { poseRotations, posePositions, blinkValue, blinkMorphs, smileMorphs };
  }

  function setLookTarget(x, y){
    lookTargetX = x;
    lookTargetY = y;
    lookTimer = 999; // 禁用随机环视，使用外部目标
  }

  function triggerBlink(){
    blinkState = 0;
    blinkTimer = 0;
    blinkCount = 0;
  }

  function triggerWave(side){
    // 挥手：使用覆盖队列，避免被update()覆盖
    const target = side === 'left' ? leftUpperArm : rightUpperArm;
    const targetName = target >= 0 && bones[target] ? (bones[target].name || bones[target].nameEn || '?') : 'not found';
    console.log('[ProceduralAnimator] triggerWave called side=' + side + ' targetBone=' + target + ' name=' + targetName + ' overridesBefore=' + _boneOverrides.length);
    if(target < 0) return;
    const waveRot = Q.create();
    // 挥手：在自然下垂(Z轴±1.35)基础上，Z轴减少让手臂抬起，X轴增加让手臂向前
    if(side === 'left'){
      Q.fromEuler(waveRot, 0.5, 0, 0.6); // 左臂抬起约60度
    } else {
      Q.fromEuler(waveRot, 0.5, 0, -0.6); // 右臂抬起约60度
    }
    _boneOverrides.push({
      boneIdx: target,
      rotation: waveRot,
      startTime: performance.now(),
      duration: 900,
      expireTime: performance.now() + 900
    });
    // 手腕也跟着动
    const wrist = side === 'left' ? leftWrist : rightWrist;
    if(wrist >= 0){
      const wristRot = Q.create();
      Q.fromEuler(wristRot, -0.3, 0, side === 'left' ? 0.2 : -0.2);
      _boneOverrides.push({
        boneIdx: wrist,
        rotation: wristRot,
        startTime: performance.now(),
        duration: 900,
        expireTime: performance.now() + 900
      });
    }
  }

  // 点头：头部X轴旋转（上下）
  function triggerNod(){
    if(headBone < 0) return;
    const nodRot = Q.create();
    Q.fromEuler(nodRot, 0.25, 0, 0); // 低头约14度
    _boneOverrides.push({
      boneIdx: headBone,
      rotation: nodRot,
      startTime: performance.now(),
      duration: 600,
      expireTime: performance.now() + 600
    });
  }

  // 摇头：头部Y轴旋转（左右）
  function triggerShake(){
    if(headBone < 0) return;
    const shakeRot = Q.create();
    Q.fromEuler(shakeRot, 0, 0.3, 0); // 转头约17度
    _boneOverrides.push({
      boneIdx: headBone,
      rotation: shakeRot,
      startTime: performance.now(),
      duration: 700,
      expireTime: performance.now() + 700
    });
  }

  // 通用添加动作：指定骨骼索引和欧拉角
  function addMotion(boneIdx, eulerX, eulerY, eulerZ, duration){
    if(boneIdx < 0 || boneIdx >= n) return;
    const rot = Q.create();
    Q.fromEuler(rot, eulerX || 0, eulerY || 0, eulerZ || 0);
    _boneOverrides.push({
      boneIdx: boneIdx,
      rotation: rot,
      startTime: performance.now(),
      duration: duration || 500,
      expireTime: performance.now() + (duration || 500)
    });
  }

  // 设置说话状态
  function setTalking(talking){
    _talking = !!talking;
    if(_talking) _talkPhase = 0;
  }

  // 设置情绪（通过眉毛和嘴部骨骼微调，简单实现）
  function setEmotion(emotion){
    _emotion = emotion || 'neutral';
    // 简单情绪：通过头部倾斜和眉毛骨骼（如果有）实现
    if(emotion === 'happy' && headBone >= 0){
      const happyRot = Q.create();
      Q.fromEuler(happyRot, -0.08, 0, 0); // 微微抬头
      _boneOverrides.push({
        boneIdx: headBone,
        rotation: happyRot,
        startTime: performance.now(),
        duration: 1500,
        expireTime: performance.now() + 1500
      });
    } else if(emotion === 'sad' && headBone >= 0){
      const sadRot = Q.create();
      Q.fromEuler(sadRot, 0.12, 0, 0); // 微微低头
      _boneOverrides.push({
        boneIdx: headBone,
        rotation: sadRot,
        startTime: performance.now(),
        duration: 1500,
        expireTime: performance.now() + 1500
      });
    }
  }

  // 清除所有动作覆盖
  function clearMotions(){
    _boneOverrides.length = 0;
  }

  let _mouseLookBound = false;
  function bindMouseLook(canvas){
    if(_mouseLookBound || !canvas) return;
    _mouseLookBound = true;
    canvas.addEventListener('mousemove', function(e){
      const rect = canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      setLookTarget(nx * 0.5, -ny * 0.3);
      _mouseLookActive = true;
    });
    canvas.addEventListener('mouseleave', function(){
      _mouseLookActive = false;
      lookTimer = 0;
    });
    console.log('[ProceduralAnimator] 鼠标看向交互已绑定');
  }

  return { update, poseRotations, posePositions, boneMap, headBone, spineBones, leftArm: [leftUpperArm, leftElbow, leftWrist], rightArm: [rightUpperArm, rightElbow, rightWrist], leftEye, rightEye, blinkMorphs, smileMorphs, setLookTarget, triggerBlink, triggerWave, triggerNod, triggerShake, addMotion, setTalking, setEmotion, clearMotions, bindMouseLook, dumpBoneDiagnostics };
}


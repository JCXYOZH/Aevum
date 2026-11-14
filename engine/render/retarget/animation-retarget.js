/**
 * Mixamo / glTF 动作重定向到 VRM Humanoid。
 *
 * 动作文件里的节点名是 Mixamo 骨架（mixamorig:Hips 等），VRM 的骨骼名是
 * hips / spine / chest 这类语义名。这里按语义把动作旋转迁移到目标骨架：
 *
 *   targetLocal = sourceAnimated * inverse(sourceRest) * targetRest
 *
 * 先扣掉源骨架的休息旋转，再套回目标骨架的休息旋转，避免把 T-pose 的
 * 局部轴直接搬到 A-pose 的角色上。旋转之外只迁移髋部平移，按两边髋高比例
 * 把厘米换算成米；其余骨骼的位移和缩放保持目标模型原值。
 *
 * 纯计算，不依赖 WebGL。
 *
 * @module Aevum/render/animation-retarget
 */
(function (root) {
  'use strict';

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../../math/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  // 重定向内部的数值边界集中在这里，避免散落在各分支里。
  const ARM_RAISE_HEIGHT = 0.08;
  const GROUND_LIMIT = 0.5;
  // 腿前后摆共用的幅度增益：前摆和后摆同时收，不改变俯仰方向。
  const LEG_PITCH_GAIN = 0.8;
  // 目标左大腿的局部轴比右腿更偏，0.8 会把左步幅压到源的六成；
  // 只补左大腿前摆，膝角仍由源腿和抬脚 IK 决定。
  const WALK_LEFT_UPLEG_GAIN = 1.30;
  const WALK_RIGHT_LOWER_GAIN = 1.0;
  // 走路手臂/躯干校正角：目标骨架的左右局部轴方向不同，单纯套源动作会
  // 让右臂外展、左臂摆幅被压小、躯干整体左倾。以下角度由 60 Hz 采样
  // 的肩、肘、腕和头/髋位置反推，只在 walk 生效。
  const WALK_ARM_OUT_LEFT = 0.18;
  const WALK_ARM_OUT_RIGHT = 0.0;
  // 右前臂局部 Y 轴：把右肘从 40° 压回约 36.6°（源 35.5°），几乎不改变
  // 腕部侧向位置，用来消除左右肘弯曲量不一致。
  const WALK_RIGHT_ELBOW_FLEX = -0.06;
  const WALK_LEFT_FOREARM_ROLL = 0.26;
  const WALK_RIGHT_FOREARM_ROLL = 0.15;
  const WALK_TORSO_ROLL = 0.042;
  const WALK_TORSO_PITCH = 0.10;
  // 走路时源动作的肩线和骨盆是反向扭转的（源相对 yaw 约 20°），但目标
  // 的肩骨为了不干扰手臂被固定在休息姿态，胸腔又和骨盆同相，整段上身
  // 像一块板。这里按源肩线相对骨盆的 yaw 给 chest 加一个反向扭转。
  const WALK_TORSO_YAW_GAIN = 0.95;
  const WALK_LEFT_ARM_SWING_GAIN = 0.80;
  // 右臂的局部轴和源镜像相反，完整差值在目标上会过冲成 100° 摆幅；
  // 这里只补胸腔反扭造成的摆幅损失，保留源右臂的相位。
  const WALK_RIGHT_ARM_SWING_GAIN = 0.20;
  // 走路腿部低通时间常数：只在 walk 生效，压掉小腿在大腿接近伸直时的单帧弹动。
  const WALK_LEG_SMOOTH_TAU = 0.03;
  // 走路固定内收角：左右腿局部轴不同，分开给角，只压站距，不做逐帧阈值修正，
  // 避免大腿局部 Z 单帧冲击。
  const WALK_LEG_ADDUCT_LEFT = 0.048;
  const WALK_LEG_ADDUCT_RIGHT = 0.112;

  const MIXAMO_TO_VRM = {
    Hips: 'hips',
    Spine: 'spine',
    Spine1: 'chest',
    Spine2: null,
    Neck: 'neck',
    Head: 'head',
    LeftShoulder: 'leftShoulder',
    LeftArm: 'leftUpperArm',
    LeftForeArm: 'leftLowerArm',
    LeftHand: 'leftHand',
    RightShoulder: 'rightShoulder',
    RightArm: 'rightUpperArm',
    RightForeArm: 'rightLowerArm',
    RightHand: 'rightHand',
    LeftUpLeg: 'leftUpperLeg',
    LeftLeg: 'leftLowerLeg',
    LeftFoot: 'leftFoot',
    LeftToeBase: 'leftToes',
    RightUpLeg: 'rightUpperLeg',
    RightLeg: 'rightLowerLeg',
    RightFoot: 'rightFoot',
    RightToeBase: 'rightToes',
    LeftHandThumb1: 'leftThumbProximal',
    LeftHandThumb2: 'leftThumbIntermediate',
    LeftHandThumb3: 'leftThumbDistal',
    LeftHandIndex1: 'leftIndexProximal',
    LeftHandIndex2: 'leftIndexIntermediate',
    LeftHandIndex3: 'leftIndexDistal',
    LeftHandMiddle1: 'leftMiddleProximal',
    LeftHandMiddle2: 'leftMiddleIntermediate',
    LeftHandMiddle3: 'leftMiddleDistal',
    LeftHandRing1: 'leftRingProximal',
    LeftHandRing2: 'leftRingIntermediate',
    LeftHandRing3: 'leftRingDistal',
    LeftHandPinky1: 'leftLittleProximal',
    LeftHandPinky2: 'leftLittleIntermediate',
    LeftHandPinky3: 'leftLittleDistal',
    RightHandThumb1: 'rightThumbProximal',
    RightHandThumb2: 'rightThumbIntermediate',
    RightHandThumb3: 'rightThumbDistal',
    RightHandIndex1: 'rightIndexProximal',
    RightHandIndex2: 'rightIndexIntermediate',
    RightHandIndex3: 'rightIndexDistal',
    RightHandMiddle1: 'rightMiddleProximal',
    RightHandMiddle2: 'rightMiddleIntermediate',
    RightHandMiddle3: 'rightMiddleDistal',
    RightHandRing1: 'rightRingProximal',
    RightHandRing2: 'rightRingIntermediate',
    RightHandRing3: 'rightRingDistal',
    RightHandPinky1: 'rightLittleProximal',
    RightHandPinky2: 'rightLittleIntermediate',
    RightHandPinky3: 'rightLittleDistal'
  };

  function normalizeQuat(q) {
    const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
  }

  function scaleQuatAngle(q, gain) {
    let x = q[0], y = q[1], z = q[2], w = q[3];
    if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
    const length = Math.hypot(x, y, z);
    if (length < 1e-8) return [0, 0, 0, 1];
    const angle = 2 * Math.atan2(length, Math.max(-1, Math.min(1, w))) * gain;
    const axis = [x / length, y / length, z / length];
    const half = angle / 2;
    return normalizeQuat([
      axis[0] * Math.sin(half),
      axis[1] * Math.sin(half),
      axis[2] * Math.sin(half),
      Math.cos(half)
    ]);
  }

  function inverseQuat(q) {
    return [-q[0], -q[1], -q[2], q[3]];
  }

  function normalizeVector(v) {
    const length = Math.hypot(v[0], v[1], v[2]);
    if (!length) return null;
    return [v[0] / length, v[1] / length, v[2] / length];
  }

  function rotateVector(q, v) {
    const u = [q[0], q[1], q[2]];
    const t = [
      2 * (u[1] * v[2] - u[2] * v[1]),
      2 * (u[2] * v[0] - u[0] * v[2]),
      2 * (u[0] * v[1] - u[1] * v[0])
    ];
    const crossUT = [
      u[1] * t[2] - u[2] * t[1],
      u[2] * t[0] - u[0] * t[2],
      u[0] * t[1] - u[1] * t[0]
    ];
    return [v[0] + q[3] * t[0] + crossUT[0], v[1] + q[3] * t[1] + crossUT[1], v[2] + q[3] * t[2] + crossUT[2]];
  }

  // 取骨骼到第一个子骨骼的方向，用来校正两边骨架相反的局部轴。
  // 子骨骼平移写在骨骼自身坐标系里，必须先套骨骼的休息旋转，不能拿裸平移比较。
  function childDirection(json, index) {
    const node = json.nodes[index];
    if (!node || !node.children || !node.children.length) return null;
    const child = json.nodes[node.children[0]];
    if (!child || !child.translation) return null;
    const rest = node.rotation || [0, 0, 0, 1];
    return normalizeVector(rotateVector(rest, child.translation));
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  // 把方向 a 转到方向 b 的最短弧四元数。
  function rotationBetween(a, b) {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (dot > 0.999999) return [0, 0, 0, 1];
    if (dot < -0.999999) {
      const axis = normalizeVector([a[1], -a[0], 0]) || [0, 0, 1];
      return [axis[0], axis[1], axis[2], 0];
    }
    const n = cross(a, b);
    return normalizeQuat([n[0], n[1], n[2], 1 + dot]);
  }

  // 取骨骼和下一级子骨骼组成的平面，方向之外再带一条弯折法线。
  function limbFrame(json, index) {
    const node = json.nodes[index];
    if (!node || !node.children || !node.children.length) return null;
    const first = json.nodes[node.children[0]];
    if (!first || !first.children || !first.children.length) return null;
    const second = json.nodes[first.children[0]];
    if (!second || !second.translation) return null;
    const rest = node.rotation || [0, 0, 0, 1];
    const firstRest = first.rotation || [0, 0, 0, 1];
    const dir = normalizeVector(rotateVector(rest, first.translation));
    const secondDir = normalizeVector(rotateVector(rest, rotateVector(firstRest, second.translation)));
    if (!dir || !secondDir) return null;
    return { dir, normal: normalizeVector(cross(dir, secondDir)) };
  }

  function frameOffset(sourceFrame, targetFrame) {
    if (!sourceFrame || !targetFrame) return [0, 0, 0, 1];
    const q1 = rotationBetween(sourceFrame.dir, targetFrame.dir);
    const midNormal = rotateVector(q1, sourceFrame.normal);
    const q2 = rotationBetween(midNormal, targetFrame.normal);
    return normalizeQuat([
      q2[0] * q1[3] + q2[3] * q1[0] + q2[1] * q1[2] - q2[2] * q1[1],
      q2[1] * q1[3] + q2[3] * q1[1] + q2[2] * q1[0] - q2[0] * q1[2],
      q2[2] * q1[3] + q2[3] * q1[2] + q2[0] * q1[1] - q2[1] * q1[0],
      q2[3] * q1[3] - q2[0] * q1[0] - q2[1] * q1[1] - q2[2] * q1[2]
    ]);
  }

  function sourceBoneName(name) {
    if (!name) return null;
    const colon = name.indexOf(':');
    return colon >= 0 ? name.slice(colon + 1) : name;
  }

  // 行向量约定下，节点世界矩阵是 local * parent，世界位置取第 13 到 15 个分量。
  // 只用来把最低脚踝拉回绑定高度，不参与蒙皮。
  function nodeWorldMatrices(json, pose) {
    const math = getMath();
    const nodes = json.nodes || [];
    const parents = new Array(nodes.length).fill(-1);
    for (let i = 0; i < nodes.length; i += 1) {
      const children = nodes[i].children || [];
      for (let c = 0; c < children.length; c += 1) parents[children[c]] = i;
    }
    const cache = new Array(nodes.length);
    function world(index) {
      if (cache[index]) return cache[index];
      const node = nodes[index];
      const translation = (pose && pose.translation && pose.translation[index]) || node.translation || [0, 0, 0];
      const rotation = (pose && pose.rotation && pose.rotation[index]) || node.rotation || [0, 0, 0, 1];
      const scale = node.scale || [1, 1, 1];
      const local = math.M4.fromTRS(math.M4.create(), translation, rotation, scale);
      const parent = parents[index];
      cache[index] = parent >= 0 ? math.M4.mult(math.M4.create(), local, world(parent)) : local;
      return cache[index];
    }
    return world;
  }

  function nodeWorldPositions(json, pose) {
    const world = nodeWorldMatrices(json, pose);
    return function (index) {
      const matrix = world(index);
      return [matrix[12], matrix[13], matrix[14]];
    };
  }

  // 世界朝向只用于姿态修正，不参与蒙皮矩阵。
  function nodeWorldQuaternions(json, pose, math) {
    const nodes = json.nodes || [];
    const parents = new Array(nodes.length).fill(-1);
    for (let i = 0; i < nodes.length; i += 1) {
      const children = nodes[i].children || [];
      for (let c = 0; c < children.length; c += 1) parents[children[c]] = i;
    }
    const cache = new Array(nodes.length);
    const world = function (index) {
      if (cache[index]) return cache[index];
      const node = nodes[index];
      const local = normalizeQuat(
        (pose && pose.rotation && pose.rotation[index]) || node.rotation || [0, 0, 0, 1]
      );
      const parent = parents[index];
      cache[index] = parent >= 0
        ? normalizeQuat(math.Q.mult(math.Q.create(), world(parent), local))
        : local;
      return cache[index];
    };
    return world;
  }

  function needsAxisOffset(semantic) {
    return /Arm|Hand|Shoulder|UpLeg|Leg|Foot|Hips|Spine|Chest|Neck|Head/.test(semantic);
  }

  // 走路时目标腿长短、左右局部轴不同，直接按角度重定向会把左脚压在支撑相里。
  // 这里以源动作的左右脚离地高度为参考，用两段腿 IK 把脚踝抬到对应高度，
  // 脚的前后位置保持原样，不改变步幅节奏。
  function liftSwingFeet(vrm, sourceJson, humanoid, pose, sourcePose, math) {
    if (humanoid.leftUpperLeg === undefined || humanoid.leftFoot === undefined ||
        humanoid.rightUpperLeg === undefined || humanoid.rightFoot === undefined ||
        humanoid.leftLowerLeg === undefined || humanoid.rightLowerLeg === undefined) return;
    const targetRest = nodeWorldPositions(vrm.json);
    const sourceRest = nodeWorldPositions(sourceJson);
    const targetRestGround = Math.min(targetRest(humanoid.leftFoot)[1], targetRest(humanoid.rightFoot)[1]);
    const sourceLeftFoot = sourceJson.nodes.findIndex(node => /LeftFoot$/.test(node.name || ''));
    const sourceRightFoot = sourceJson.nodes.findIndex(node => /RightFoot$/.test(node.name || ''));
    if (sourceLeftFoot < 0 || sourceRightFoot < 0) return;
    const sourceLeftUpLeg = sourceJson.nodes.findIndex(node => /LeftUpLeg$/.test(node.name || ''));
    const sourceRestGround = Math.min(sourceRest(sourceLeftFoot)[1], sourceRest(sourceRightFoot)[1]);
    const targetWorld = nodeWorldPositions(vrm.json, pose);
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const targetWorldQuat = nodeWorldQuaternions(vrm.json, pose, math);
    const targetLeg = Math.hypot(
      targetRest(humanoid.leftUpperLeg)[0] - targetRest(humanoid.leftFoot)[0],
      targetRest(humanoid.leftUpperLeg)[1] - targetRest(humanoid.leftFoot)[1],
      targetRest(humanoid.leftUpperLeg)[2] - targetRest(humanoid.leftFoot)[2]
    );
    const sourceLeg = sourceLeftUpLeg >= 0
      ? Math.hypot(
        sourceRest(sourceLeftUpLeg)[0] - sourceRest(sourceLeftFoot)[0],
        sourceRest(sourceLeftUpLeg)[1] - sourceRest(sourceLeftFoot)[1],
        sourceRest(sourceLeftUpLeg)[2] - sourceRest(sourceLeftFoot)[2]
      )
      : 0;
    if (targetLeg <= 1e-4 || sourceLeg <= 1e-4) return;
    const legScale = Math.min(1, targetLeg / sourceLeg);
    const legs = [
      [humanoid.leftUpperLeg, humanoid.leftLowerLeg, humanoid.leftFoot, sourceLeftFoot],
      [humanoid.rightUpperLeg, humanoid.rightLowerLeg, humanoid.rightFoot, sourceRightFoot]
    ];
    for (let i = 0; i < legs.length; i += 1) {
      const upper = legs[i][0], lower = legs[i][1], foot = legs[i][2], sourceFoot = legs[i][3];
      const sourceClear = sourceWorld(sourceFoot)[1] - sourceRestGround;
      if (sourceClear <= 0) continue;
      // 触地附近连续渐入渐出，避免在 20 mm 阈值上把修正量瞬间开关，造成单帧跳腿。
      const ramp = Math.min(1, sourceClear / 0.02);
      const weight = ramp * ramp * (3 - 2 * ramp);
      const targetClear = targetWorld(foot)[1] - targetRestGround;
      const desired = Math.min(0.2, sourceClear * legScale * weight);
      const lift = desired - targetClear;
      if (lift < 0.001) continue;
      const knee = targetWorld(lower);
      const ankle = targetWorld(foot);
      const hip = targetWorld(upper);
      const thigh = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
      const shin = [ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]];
      const thighLength = Math.hypot(thigh[0], thigh[1], thigh[2]);
      const shinLength = Math.hypot(shin[0], shin[1], shin[2]);
      if (thighLength <= 1e-4 || shinLength <= 1e-4) continue;
      const desiredAnkle = [ankle[0], ankle[1] + lift, ankle[2]];
      const reach = [desiredAnkle[0] - hip[0], desiredAnkle[1] - hip[1], desiredAnkle[2] - hip[2]];
      let distance = Math.hypot(reach[0], reach[1], reach[2]);
      distance = Math.max(Math.abs(thighLength - shinLength) + 1e-3,
        Math.min(thighLength + shinLength - 1e-3, distance));
      const dir = normalizeQuat([reach[0] / (distance || 1), reach[1] / (distance || 1), reach[2] / (distance || 1), 0]);
      const nextAnkle = [
        hip[0] + dir[0] * distance,
        hip[1] + dir[1] * distance,
        hip[2] + dir[2] * distance
      ];
      const ankleDirection = normalizeQuat([
        ankle[0] - hip[0], ankle[1] - hip[1], ankle[2] - hip[2], 0
      ]);
      const alongThigh = thigh[0] * ankleDirection[0] + thigh[1] * ankleDirection[1] +
        thigh[2] * ankleDirection[2];
      const pole = [
        knee[0] - hip[0] - ankleDirection[0] * alongThigh,
        knee[1] - hip[1] - ankleDirection[1] * alongThigh,
        knee[2] - hip[2] - ankleDirection[2] * alongThigh
      ];
      const poleLength = Math.hypot(pole[0], pole[1], pole[2]);
      if (poleLength <= 1e-4) continue;
      // 用当前膝盖相对髋踝连线的偏移方向当弯折平面，不用叉积符号；
      // 腿接近伸直时叉积会翻转，膝盖会突然弹到另一侧。
      const normal = [pole[0] / poleLength, pole[1] / poleLength, pole[2] / poleLength];
      const along = (thighLength * thighLength - shinLength * shinLength + distance * distance) /
        (2 * distance);
      const bend = Math.sqrt(Math.max(0, thighLength * thighLength - along * along));
      const nextKnee = [
        hip[0] + dir[0] * along + normal[0] * bend,
        hip[1] + dir[1] * along + normal[1] * bend,
        hip[2] + dir[2] * along + normal[2] * bend
      ];
      const nextShin = [nextAnkle[0] - nextKnee[0], nextAnkle[1] - nextKnee[1], nextAnkle[2] - nextKnee[2]];
      const nextShinLength = Math.hypot(nextShin[0], nextShin[1], nextShin[2]) || 1;
      const worldLower = targetWorldQuat(lower);
      const worldUpper = targetWorldQuat(upper);
      const parentIndex = (vrm.json.nodes.findIndex(node =>
        (node.children || []).indexOf(upper) >= 0));
      const parentWorld = parentIndex >= 0 ? nodeWorldQuaternions(vrm.json, pose, math)(parentIndex) : [0, 0, 0, 1];
      const nextThigh = [nextKnee[0] - hip[0], nextKnee[1] - hip[1], nextKnee[2] - hip[2]];
      const nextThighLength = Math.hypot(nextThigh[0], nextThigh[1], nextThigh[2]) || 1;
      const upperFix = rotationBetween(
        normalizeQuat([thigh[0] / thighLength, thigh[1] / thighLength, thigh[2] / thighLength, 0]),
        normalizeQuat([nextThigh[0] / nextThighLength, nextThigh[1] / nextThighLength, nextThigh[2] / nextThighLength, 0])
      );
      const lowerFix = rotationBetween(
        normalizeQuat([shin[0] / shinLength, shin[1] / shinLength, shin[2] / shinLength, 0]),
        normalizeQuat([nextShin[0] / nextShinLength, nextShin[1] / nextShinLength, nextShin[2] / nextShinLength, 0])
      );
      const nextWorldUpper = normalizeQuat(
        math.Q.mult(math.Q.create(), upperFix, worldUpper)
      );
      const nextWorldLower = normalizeQuat(
        math.Q.mult(math.Q.create(), lowerFix, worldLower)
      );
      pose.rotation[upper] = normalizeQuat(
        math.Q.mult(math.Q.create(), inverseQuat(parentWorld), nextWorldUpper)
      );
      pose.rotation[lower] = normalizeQuat(
        math.Q.mult(math.Q.create(), inverseQuat(nextWorldUpper), nextWorldLower)
      );
    }
  }

  // 两段腿 IK 在腿接近伸直时，脚踝抬一点就需要较大的膝角变化；
  // 帧率越低，这个变化越容易看成一帧的“弹腿”。用固定的时间常数对
  // 左右大腿/小腿局部旋转做低通，保留步幅，只削掉单帧尖峰。
  function smoothWalkLegs(humanoid, pose, state, dt, math) {
    if (!state || !(dt > 0)) return;
    const alpha = 1 - Math.exp(-Math.min(0.05, dt) / WALK_LEG_SMOOTH_TAU);
    const bones = ['leftUpperLeg', 'leftLowerLeg', 'rightUpperLeg', 'rightLowerLeg'];
    for (let i = 0; i < bones.length; i += 1) {
      const index = humanoid[bones[i]];
      if (index === undefined) continue;
      const current = pose.rotation[index];
      if (!current) continue;
      const previous = state[bones[i]];
      if (!previous) {
        state[bones[i]] = current.slice();
        continue;
      }
      const out = math.Q.create();
      math.Q.slerp(out, previous, current, alpha);
      pose.rotation[index] = out;
      state[bones[i]] = out;
    }
  }

  // 支撑脚在接触地面时锁定前后位置，髋部反向平移抵消滑步。
  // 状态跨帧保存在 ikState 中，支撑脚切换时重新取锚点。
  function lockSupportFoot(vrm, humanoid, pose, ikState, restGround) {
    if (!ikState || humanoid.leftFoot === undefined || humanoid.rightFoot === undefined) return null;
    const positions = nodeWorldPositions(vrm.json, pose);
    const left = positions(humanoid.leftFoot);
    const right = positions(humanoid.rightFoot);
    const support = left[1] <= right[1] ? 'left' : 'right';
    const current = support === 'left' ? left : right;
    if (Math.abs(current[1] - restGround) > 0.05) {
      ikState.foot = null;
      ikState.anchor = null;
      return null;
    }
    if (!ikState.foot || ikState.foot !== support || !ikState.anchor) {
      ikState.foot = support;
      ikState.anchor = [current[0], current[2]];
    }
    const dz = ikState.anchor[1] - current[2];
    // 只锁前后方向：横向位移直接平移髋部会把站距撑开。
    if (Math.abs(dz) > 0.25) {
      ikState.anchor = [current[0], current[2]];
      return null;
    }
    if (Math.abs(dz) < 1e-5) return null;
    const hipsIndex = humanoid.hips;
    if (hipsIndex === undefined) return null;
    const currentTranslation = pose.translation[hipsIndex] ||
      (vrm.json.nodes[hipsIndex].translation || [0, 0, 0]).slice();
    pose.translation[hipsIndex] = [currentTranslation[0], currentTranslation[1], currentTranslation[2] + dz];
    pose.ik = { support, anchor: ikState.anchor.slice(), shift: [0, dz] };
    return pose.ik;
  }

  function rotateArmWorld(json, humanoid, pose, math, leftAngle, rightAngle) {
    rotateBoneWorld(json, pose, math, humanoid.leftUpperArm, [0, 0, 1], -leftAngle);
    rotateBoneWorld(json, pose, math, humanoid.rightUpperArm, [0, 0, 1], rightAngle);
  }

  function rotateBoneWorld(json, pose, math, index, axis, angle) {
    if (index === undefined) return;
    const s = Math.sin(angle / 2);
    const corr = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
    const world = nodeWorldQuaternions(json, pose, math);
    const parent = json.nodes.findIndex(n => (n.children || []).includes(index));
    const parentWorld = parent >= 0 ? world(parent) : [0, 0, 0, 1];
    const newWorld = normalizeQuat(math.Q.mult(math.Q.create(), corr, world(index)));
    pose.rotation[index] = normalizeQuat(math.Q.mult(math.Q.create(), inverseQuat(parentWorld), newWorld));
  }

  function rotateBoneLocal(pose, math, index, axis, angle) {
    if (index === undefined) return;
    const s = Math.sin(angle / 2);
    const local = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
    pose.rotation[index] = normalizeQuat(math.Q.mult(math.Q.create(), local, pose.rotation[index]));
  }

  function jointYaw(world, left, right) {
    return Math.atan2(world(right)[2] - world(left)[2], world(right)[0] - world(left)[0]) * 180 / Math.PI;
  }

  function wrapDegrees(value) {
    let angle = value;
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  function alignWalkTorsoYaw(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.chest === undefined) return;
    if (humanoid.leftShoulder === undefined || humanoid.rightShoulder === undefined ||
        humanoid.leftUpperLeg === undefined || humanoid.rightUpperLeg === undefined) return;
    const sourceNodes = sourceJson.nodes || [];
    const sourceShoulderL = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'LeftShoulder');
    const sourceShoulderR = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'RightShoulder');
    const sourceHipL = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'LeftUpLeg');
    const sourceHipR = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'RightUpLeg');
    if (sourceShoulderL < 0 || sourceShoulderR < 0 || sourceHipL < 0 || sourceHipR < 0) return;
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const sourceRel = wrapDegrees(
      jointYaw(sourceWorld, sourceShoulderL, sourceShoulderR) -
      jointYaw(sourceWorld, sourceHipL, sourceHipR)
    );
    // 源骨架与 VRM 朝向相反，源的肩线相对骨盆 yaw 在目标里要取反。
    const desiredRel = wrapDegrees(-sourceRel * WALK_TORSO_YAW_GAIN);
    for (let i = 0; i < 2; i += 1) {
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const currentRel = wrapDegrees(
        jointYaw(targetWorld, humanoid.leftShoulder, humanoid.rightShoulder) -
        jointYaw(targetWorld, humanoid.leftUpperLeg, humanoid.rightUpperLeg)
      );
      const error = wrapDegrees(desiredRel - currentRel);
      if (Math.abs(error) < 0.25) break;
      const angle = Math.max(-0.3, Math.min(0.3, -error * Math.PI / 180));
      rotateBoneWorld(vrm.json, pose, math, humanoid.chest, [0, 1, 0], angle);
    }
  }

  // 源走路由髋部横移带动全身，但肩线/头部只保留约 1/3 的横向摆动；目标
  // 目前肩线和头几乎跟着髋部平移。这里按源肩-髋、头-髋的横向偏移给 spine
  // 和 neck 补反向侧倾，让上身稳定在支撑面上方。
  function alignWalkTorsoLateral(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.spine === undefined || humanoid.hips === undefined || humanoid.head === undefined ||
        humanoid.neck === undefined || humanoid.leftShoulder === undefined ||
        humanoid.rightShoulder === undefined) return;
    const sourceNodes = sourceJson.nodes || [];
    const sourceShoulderL = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'LeftShoulder');
    const sourceShoulderR = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'RightShoulder');
    const sourceHip = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'Hips');
    const sourceHead = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'Head');
    if (sourceShoulderL < 0 || sourceShoulderR < 0 || sourceHip < 0 || sourceHead < 0) return;
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const sourceHipX = sourceWorld(sourceHip)[0];
    const sourceShoulderX = (sourceWorld(sourceShoulderL)[0] + sourceWorld(sourceShoulderR)[0]) * 0.5;
    const sourceHeadX = sourceWorld(sourceHead)[0];
    const desiredShoulderOffset = sourceShoulderX - sourceHipX;
    const desiredHeadOffset = sourceHeadX - sourceHipX;
    for (let i = 0; i < 2; i += 1) {
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const hips = targetWorld(humanoid.hips);
      const head = targetWorld(humanoid.head);
      const torsoHeight = Math.max(0.6, head[1] - hips[1]);
      const shoulderOffset = (targetWorld(humanoid.leftShoulder)[0] + targetWorld(humanoid.rightShoulder)[0]) * 0.5 - hips[0];
      const error = desiredShoulderOffset - shoulderOffset;
      if (Math.abs(error) < 0.0015) break;
      const angle = Math.max(-0.05, Math.min(0.05, -error / torsoHeight));
      rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [0, 0, 1], angle);
    }
    // 肩线稳定后，颈/头还要再补一次，让头部不跟着肩线左右甩。
    for (let i = 0; i < 2; i += 1) {
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const hips = targetWorld(humanoid.hips);
      const head = targetWorld(humanoid.head);
      const error = (hips[0] + desiredHeadOffset) - head[0];
      if (Math.abs(error) < 0.0015) break;
      const angle = Math.max(-0.04, Math.min(0.04, -error / Math.max(0.3, head[1] - hips[1])));
      rotateBoneWorld(vrm.json, pose, math, humanoid.neck, [0, 0, 1], angle);
    }
  }

  function armSagittal(json, pose, upper, elbow) {
    const w = nodeWorldPositions(json, pose);
    const a = w(upper), b = w(elbow);
    return Math.atan2(b[2] - a[2], -(b[1] - a[1])) * 180 / Math.PI;
  }

  function alignLeftArmSwing(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.leftUpperArm === undefined || humanoid.leftLowerArm === undefined) return;
    const sourceUpper = sourceJson.nodes.findIndex(n => /(?:^|:)LeftArm$/.test(n.name || ''));
    const sourceElbow = sourceJson.nodes.findIndex(n => /(?:^|:)LeftForeArm$/.test(n.name || ''));
    if (sourceUpper < 0 || sourceElbow < 0) return;
    const sourceAngle = armSagittal(sourceJson, sourcePose, sourceUpper, sourceElbow);
    const targetAngle = armSagittal(vrm.json, pose, humanoid.leftUpperArm, humanoid.leftLowerArm);
    const diff = (sourceAngle - targetAngle) * Math.PI / 180;
    rotateBoneWorld(vrm.json, pose, math, humanoid.leftUpperArm, [1, 0, 0], diff * WALK_LEFT_ARM_SWING_GAIN);
  }

  function alignRightArmSwing(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.rightUpperArm === undefined || humanoid.rightLowerArm === undefined) return;
    const sourceUpper = sourceJson.nodes.findIndex(n => /(?:^|:)RightArm$/.test(n.name || ''));
    const sourceElbow = sourceJson.nodes.findIndex(n => /(?:^|:)RightForeArm$/.test(n.name || ''));
    if (sourceUpper < 0 || sourceElbow < 0) return;
    const sourceAngle = armSagittal(sourceJson, sourcePose, sourceUpper, sourceElbow);
    const targetAngle = armSagittal(vrm.json, pose, humanoid.rightUpperArm, humanoid.rightLowerArm);
    const diff = wrapDegrees(sourceAngle - targetAngle) * Math.PI / 180;
    rotateBoneWorld(vrm.json, pose, math, humanoid.rightUpperArm, [1, 0, 0], diff * WALK_RIGHT_ARM_SWING_GAIN);
  }

  // 走路时目标腿的局部轴会把脚踝带到髋外 120 mm 以上，源动作只有 50 mm
  // 左右。这里用固定角度把大腿向内侧收，不用逐帧阈值判断：固定偏移在相邻
  // 帧之间不会产生局部 Z 冲击，也不会把脚踝横向轨迹改成二次折返。
  function adductWalkLegs(humanoid, pose, math, leftAngle, rightAngle) {
    if (humanoid.leftUpperLeg === undefined || humanoid.rightUpperLeg === undefined) return;
    const towardCenterLeft = [0, 0, Math.sin(leftAngle / 2), Math.cos(leftAngle / 2)];
    const towardCenterRight = [0, 0, -Math.sin(rightAngle / 2), Math.cos(rightAngle / 2)];
    if (pose.rotation[humanoid.leftUpperLeg]) {
      pose.rotation[humanoid.leftUpperLeg] = normalizeQuat(
        math.Q.mult(math.Q.create(), pose.rotation[humanoid.leftUpperLeg], towardCenterLeft)
      );
    }
    if (pose.rotation[humanoid.rightUpperLeg]) {
      pose.rotation[humanoid.rightUpperLeg] = normalizeQuat(
        math.Q.mult(math.Q.create(), pose.rotation[humanoid.rightUpperLeg], towardCenterRight)
      );
    }
  }

  // 待机和部分动作源本身会让左右脚换边。这里同时约束脚间距和膝盖位置：
  // 只保证两只脚分开不够，膝盖仍可能越过髋部中线，正面看就是腿交叉。
  function keepLegsApart(vrm, humanoid, pose, math) {
    if (humanoid.leftUpperLeg === undefined || humanoid.rightUpperLeg === undefined ||
        humanoid.leftFoot === undefined || humanoid.rightFoot === undefined ||
        humanoid.leftLowerLeg === undefined || humanoid.rightLowerLeg === undefined) return;
    for (let iter = 0; iter < 3; iter += 1) {
      const world = nodeWorldPositions(vrm.json, pose);
      const left = world(humanoid.leftFoot);
      const right = world(humanoid.rightFoot);
      const leftKnee = world(humanoid.leftLowerLeg);
      const rightKnee = world(humanoid.rightLowerLeg);
      const hipLeft = world(humanoid.leftUpperLeg);
      const hipRight = world(humanoid.rightUpperLeg);
      const hipWidth = Math.abs(hipRight[0] - hipLeft[0]);
      const minGap = Math.max(0.06, hipWidth * 0.9);
      const kneeEdge = Math.max(0.03, hipWidth * 0.3);
      const gap = right[0] - left[0];
      const kneeOverLeft = leftKnee[0] - (hipLeft[0] - kneeEdge);
      const kneeOverRight = (hipRight[0] + kneeEdge) - rightKnee[0];
      const need = Math.max(0, minGap - gap, kneeOverLeft, kneeOverRight);
      if (need <= 1e-4) break;
      const legLength = (
        Math.hypot(left[0] - hipLeft[0], left[1] - hipLeft[1], left[2] - hipLeft[2]) +
        Math.hypot(right[0] - hipRight[0], right[1] - hipRight[1], right[2] - hipRight[2])
      ) * 0.5;
      const angle = Math.min(0.35, Math.asin(Math.min(1, need / Math.max(legLength * 2, 0.2))));
      const out = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
      const inward = [0, 0, -Math.sin(angle / 2), Math.cos(angle / 2)];
      const leftRest = vrm.json.nodes[humanoid.leftUpperLeg].rotation || [0, 0, 0, 1];
      const rightRest = vrm.json.nodes[humanoid.rightUpperLeg].rotation || [0, 0, 0, 1];
      if (minGap - gap > 0 || kneeOverLeft > 0) {
        pose.rotation[humanoid.leftUpperLeg] = normalizeQuat(
          math.Q.mult(math.Q.create(), pose.rotation[humanoid.leftUpperLeg] || leftRest, inward)
        );
      }
      if (minGap - gap > 0 || kneeOverRight > 0) {
        pose.rotation[humanoid.rightUpperLeg] = normalizeQuat(
          math.Q.mult(math.Q.create(), pose.rotation[humanoid.rightUpperLeg] || rightRest, out)
        );
      }
    }
  }

  /**
   * 把动作采样得到的旋转和髋部平移迁移到目标 VRM。
   * @param {Object} vrm parseVRM 的结果
   * @param {Object} sourceJson 动作文件 glTF JSON
   * @param {Object} sourcePose { rotation: { nodeIndex: quat }, translation: { nodeIndex: vec3 } }
   * @returns {Object} target pose：{ rotation, translation }
   */
  function retargetPose(vrm, sourceJson, sourcePose, options) {
    const math = getMath();
    const pose = { rotation: Object.create(null), translation: Object.create(null) };
    if (!sourcePose) return pose;

    const humanoid = Object.create(null);
    const bones = vrm.humanBones || [];
    for (let i = 0; i < bones.length; i += 1) {
      humanoid[bones[i].bone] = bones[i].node;
    }

    const sourceNodes = sourceJson.nodes || [];
    const hipsTargetIndex = humanoid.hips;
    const hipsSourceIndex = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'Hips');
    let hipsScale = 0.01;
    if (hipsTargetIndex !== undefined && hipsSourceIndex >= 0) {
      const targetRest = vrm.json.nodes[hipsTargetIndex].translation || [0, 0, 0];
      const sourceRest = sourceNodes[hipsSourceIndex].translation || [0, 0, 0];
      // 参考 three-vrm 的 VRMAnimation：用髋部高度比换算位移，而不是拿整段位移向量长度比。
      const targetHeight = Math.abs(targetRest[1]);
      const sourceHeight = Math.abs(sourceRest[1]);
      if (sourceHeight > 1e-6 && targetHeight > 1e-6) {
        hipsScale = targetHeight / sourceHeight;
      } else {
        const targetLength = Math.hypot(targetRest[0], targetRest[1], targetRest[2]);
        const sourceLength = Math.hypot(sourceRest[0], sourceRest[1], sourceRest[2]);
        if (sourceLength > 0 && targetLength > 0) hipsScale = targetLength / sourceLength;
      }
    }

    const sourceWorldPosition = nodeWorldPositions(sourceJson, sourcePose);
    // 动作文件的节点顺序是脚→小腿→大腿，子骨排在父骨前面。
    // 腿部偏移必须父骨先算、子骨后算，否则小腿取不到大腿的平面。
    const parents = new Array(sourceNodes.length).fill(-1);
    for (let i = 0; i < sourceNodes.length; i += 1) {
      const children = sourceNodes[i].children || [];
      for (let c = 0; c < children.length; c += 1) parents[children[c]] = i;
    }
    const depthOf = new Array(sourceNodes.length).fill(0);
    const depth = (index) => {
      const stack = [];
      let cursor = index;
      while (cursor >= 0 && !depthOf[cursor]) {
        stack.push(cursor);
        cursor = parents[cursor];
      }
      let base = cursor >= 0 ? depthOf[cursor] : 0;
      for (let s = stack.length - 1; s >= 0; s -= 1) {
        depthOf[stack[s]] = ++base;
      }
      return depthOf[index];
    };
    const orderedIndices = sourceNodes.map((_, index) => index)
      .sort((a, b) => depth(a) - depth(b) || a - b);
    const neutralStance = Boolean(options && options.neutralStance);
    for (const i of orderedIndices) {
      const semantic = sourceBoneName(sourceNodes[i].name);
      const targetBone = MIXAMO_TO_VRM[semantic];
      if (!targetBone) continue;
      const targetIndex = humanoid[targetBone];
      if (targetIndex === undefined) continue;
      // 源动作每根手指有 4 节，VRM 只有 3 节；沿用整帧对齐会把指骨扭成张开反折的爪形。
      // 指骨先不逐节重定向，只继承手掌旋转，保持目标模型的自然手型。
      if (/(Thumb|Index|Middle|Ring|Pinky)/.test(semantic)) continue;

      const animated = sourcePose.rotation && sourcePose.rotation[i];
      // 站立类动作（待机、打招呼）保留目标骨架自己的站姿：源 idle 是宽站距，
      // 直接套到窄站距模型上会把一条腿外展、头部带偏；行走/跑步不启用。
      const lowerBody = /^(Hips|Left(UpLeg|Leg|Foot)|Right(UpLeg|Leg|Foot))$/.test(semantic);
      // 脚趾没有下一级子骨骼，方向由脚掌带动；只给脚掌做方向对齐。
      if (animated && !/Toe/.test(semantic) && !(neutralStance && lowerBody)) {
        const sourceRest = sourceNodes[i].rotation || [0, 0, 0, 1];
        const targetRest = vrm.json.nodes[targetIndex].rotation || [0, 0, 0, 1];
        const targetDir = needsAxisOffset(semantic) ? childDirection(vrm.json, targetIndex) : null;
        const sourceDir = needsAxisOffset(semantic) ? childDirection(sourceJson, i) : null;
        // 手臂用骨骼和下一级子骨骼组成的平面做完整对齐，避免只对齐方向时把肘和手折到胸前。
        // 脚掌的脚趾方向在源骨架和目标骨架里相反，不能做整帧对齐；
        // 只保留踝关节自身的俯仰增量，避免脚掌被翻转 180°。
        let axisOffset;
        let armRaised = false;
        if (/^(Left|Right)(Arm|ForeArm)$/.test(semantic)) {
          const upper = /ForeArm/.test(semantic) && sourceNodes[i].parent !== undefined
            ? sourceNodes[i].parent
            : i;
          const forearm = sourceNodes[upper] && sourceNodes[upper].children
            ? sourceNodes[upper].children[0]
            : undefined;
          const hand = forearm !== undefined && sourceNodes[forearm].children
            ? sourceNodes[forearm].children[0]
            : undefined;
          if (hand !== undefined) {
            const rise = sourceWorldPosition(hand)[1] - sourceWorldPosition(upper)[1];
            armRaised = rise > ARM_RAISE_HEIGHT;
          }
        }
        if (/Foot/.test(semantic)) {
          axisOffset = [0, 0, 0, 1];
        } else if (/^(Left|Right)UpLeg$/.test(semantic)) {
          axisOffset = targetDir && sourceDir ? rotationBetween(targetDir, sourceDir) : [0, 0, 0, 1];
        } else if (/^(Left|Right)Leg$/.test(semantic)) {
          axisOffset = targetDir && sourceDir ? rotationBetween(targetDir, sourceDir) : [0, 0, 0, 1];
        } else if (/^(Left|Right)(Arm|ForeArm)$/.test(semantic) && armRaised) {
          // 只有源动作真的把手抬到肩上方时才按方向对齐；平时的垂手仍用整帧对齐，
          // 否则待机手臂会被拉开。高度阈值来自契约。
          axisOffset = targetDir && sourceDir ? rotationBetween(targetDir, sourceDir) : [0, 0, 0, 1];
        } else if (/^(Neck|Head)$/.test(semantic)) {
          // 头/颈没有可靠的“下一级骨架方向”可用：目标 head 的第一个子节点常是
          // 头发或饰件，按子节点方向对齐会把头带出 5° 左右的侧倾。直接套源动作的
          // 局部增量，头的朝向由目标自己的颈—头轴决定。
          axisOffset = [0, 0, 0, 1];
        } else if (/Shoulder/.test(semantic)) {
          // 肩骨保持目标休息姿态。源动作的肩部旋转直接套过来会把上臂抬到脸前，
          // 跑步和打招呼都受影响；手臂高度交给上臂/前臂处理。
          axisOffset = [0, 0, 0, 1];
        } else if (/Arm|Hand/.test(semantic)) {
          axisOffset = frameOffset(limbFrame(sourceJson, i), limbFrame(vrm.json, targetIndex));
        } else {
          axisOffset = targetDir && sourceDir ? rotationBetween(targetDir, sourceDir) : [0, 0, 0, 1];
        }
        // 行向量约定下，把源动作先转成相对休息姿态的增量，再对齐局部轴、套回目标休息姿态。
        let delta = math.Q.mult(math.Q.create(), animated, inverseQuat(sourceRest));
        // 源骨架面向 +Z、VRM 面向 -Z，腿的前后俯仰在局部 X 轴上要取反；
        // 取反后再按统一增益收幅度，避免把源动作的前后摆原样放大成甩腿。
        if (/^(Left|Right)(UpLeg|Leg)$/.test(semantic)) {
          let legGain = LEG_PITCH_GAIN;
          if (options && options.footClearance) {
            if (semantic === 'LeftUpLeg') legGain = WALK_LEFT_UPLEG_GAIN;
            else if (semantic === 'RightLeg') legGain = WALK_RIGHT_LOWER_GAIN;
          }
          // 腿只保留局部 X 俯仰：源大腿的局部 Z 位移为零，把 Y/Z 分量一起
          // 压掉可避免目标局部轴把俯仰转成大腿 Z 单帧冲击。
          delta = scaleQuatAngle([-delta[0], 0, 0, delta[3]], legGain);
        }
        // 脚掌只保留踝关节俯仰；源脚掌的 Y/Z 分量在目标局部轴上会变成
        // 脚尖外撇，走路时左右脚朝向因此不平行。
        if (/Foot/.test(semantic) && options && options.footClearance) {
          delta = scaleQuatAngle([delta[0], 0, 0, delta[3]], 1);
        }
        // 左臂在目标骨架里与源骨架的局部 Z 轴相反，直接套用增量会把上臂抬到胸口。
        if (/^Left(Arm|ForeArm|Hand|Shoulder)/.test(semantic) && (!options || options.mirrorLeftArm !== false)) {
          delta[0] = -delta[0];
          delta[2] = -delta[2];
        }
        const conjugated = math.Q.mult(math.Q.create(), axisOffset, delta);
        const aligned = math.Q.mult(math.Q.create(), conjugated, inverseQuat(axisOffset));
        pose.rotation[targetIndex] = normalizeQuat(math.Q.mult(math.Q.create(), aligned, targetRest));
      }

      // 只迁移髋部竖直起伏：源动作的水平位移是整段位移，原地播放会把人带出画面。
      // 但完全锁死水平位移会让跑步时躯干钉在休息位，只保留小幅前后/左右摆动并限幅。
      if (semantic === 'Hips' && sourcePose.translation && sourcePose.translation[i]) {
        const targetNode = vrm.json.nodes[targetIndex];
        const targetRest = targetNode.translation || [0, 0, 0];
        const sourceRest = sourceNodes[i].translation || [0, 0, 0];
        const animatedTranslation = sourcePose.translation[i];
        const clampShift = (value) => Math.max(-0.12, Math.min(0.12, value));
        const dx = clampShift((animatedTranslation[0] - sourceRest[0]) * hipsScale);
        // 源骨架面向 +Z、目标面向 -Z，前后位移要换向。
        const dz = clampShift(-(animatedTranslation[2] - sourceRest[2]) * hipsScale);
        pose.translation[targetIndex] = [
          targetRest[0] + dx,
          targetRest[1] + (animatedTranslation[1] - sourceRest[1]) * hipsScale,
          targetRest[2] + dz
        ];
      }
    }

    // 待机是静止对称姿态：源 idle 左右手臂本身对称，但目标两侧手臂局部轴不同，
    // 逐侧重定向会把一只手抬高/外展。这里用目标左臂镜像右臂，只用于站立类动作。
    if (options && options.symmetricArms) {
      const armPairs = [
        ['leftShoulder', 'rightShoulder'],
        ['leftUpperArm', 'rightUpperArm'],
        ['leftLowerArm', 'rightLowerArm'],
        ['leftHand', 'rightHand']
      ];
      for (const pair of armPairs) {
        const leftIndex = humanoid[pair[0]];
        const rightIndex = humanoid[pair[1]];
        if (leftIndex === undefined || rightIndex === undefined) continue;
        const left = pose.rotation[leftIndex];
        if (!left) continue;
        pose.rotation[rightIndex] = normalizeQuat([left[0], -left[1], -left[2], left[3]]);
      }
    }

    // 走路时两条手臂在目标局部轴上的外展量不一致，而且共同内收会把双手
    // 收进外套/裙摆。这里左右分别绕世界 Z 轴向外展开，先把左右腕放到
    // 身体轮廓外，再让前臂校正把腕拉回同一侧向线。
    if (options && options.footClearance) {
      alignWalkTorsoYaw(sourceJson, sourcePose, vrm, humanoid, pose, math);
      alignWalkTorsoLateral(sourceJson, sourcePose, vrm, humanoid, pose, math);
      alignLeftArmSwing(sourceJson, sourcePose, vrm, humanoid, pose, math);
      alignRightArmSwing(sourceJson, sourcePose, vrm, humanoid, pose, math);
      rotateArmWorld(vrm.json, humanoid, pose, math, WALK_ARM_OUT_LEFT, WALK_ARM_OUT_RIGHT);
      rotateBoneWorld(vrm.json, pose, math, humanoid.leftLowerArm, [0, 0, 1], -WALK_LEFT_FOREARM_ROLL);
      rotateBoneWorld(vrm.json, pose, math, humanoid.rightLowerArm, [0, 0, 1], -WALK_RIGHT_FOREARM_ROLL);
      rotateBoneLocal(pose, math, humanoid.rightLowerArm, [0, 1, 0], WALK_RIGHT_ELBOW_FLEX);
      rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [0, 0, 1], -WALK_TORSO_ROLL);
      rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [1, 0, 0], -WALK_TORSO_PITCH);
    }

    // 髋部按源动作起伏后，目标腿长和站距不同，脚会悬空；把最低脚踝拉回绑定高度。
    if (hipsTargetIndex !== undefined && humanoid.leftFoot !== undefined && humanoid.rightFoot !== undefined) {
      const restPos = nodeWorldPositions(vrm.json, null);
      const posePos = nodeWorldPositions(vrm.json, pose);
      const restGround = Math.min(restPos(humanoid.leftFoot)[1], restPos(humanoid.rightFoot)[1]);
      const poseGround = Math.min(posePos(humanoid.leftFoot)[1], posePos(humanoid.rightFoot)[1]);
      // 走路没有腾空期，只在下沉时抬髋；否则两只脚都被摆高时会把髋往下拉，
      // 形成每步一次的上下弹。跑步保留双向接地修正。
      const offset = options && options.footClearance
        ? Math.max(0, restGround - poseGround)
        : restGround - poseGround;
      const boundedOffset = Math.min(GROUND_LIMIT, Math.max(-GROUND_LIMIT, offset));
      if (Math.abs(boundedOffset) > 1e-4) {
        const current = pose.translation[hipsTargetIndex] ||
          (vrm.json.nodes[hipsTargetIndex].translation || [0, 0, 0]).slice();
        pose.translation[hipsTargetIndex] = [current[0], current[1] + boundedOffset, current[2]];
      }
      if (options && options.ikState) {
        lockSupportFoot(vrm, humanoid, pose, options.ikState, restGround);
      }
    }

    keepLegsApart(vrm, humanoid, pose, math);
    if (options && options.footClearance) {
      adductWalkLegs(humanoid, pose, math, WALK_LEG_ADDUCT_LEFT, WALK_LEG_ADDUCT_RIGHT);
      liftSwingFeet(vrm, sourceJson, humanoid, pose, sourcePose, math);
      smoothWalkLegs(humanoid, pose, options.legSmoothState, options.dt, math);
    }
    return pose;
  }

  const api = { retargetPose, MIXAMO_TO_VRM, nodeWorldPositions };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.AnimationRetarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

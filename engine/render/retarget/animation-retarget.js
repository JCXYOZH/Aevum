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
  // 1.50 让左腿前后摆回到源动作 45.8° 附近，膝角仍由源腿和抬脚 IK 决定。
  const WALK_LEFT_UPLEG_GAIN = 1.50;
  // 左大腿增益 1.50 同时放大了源动作的均值偏移，60 Hz 实测左脚平均落在
  // 髋前 134 mm（源在髋后 30 mm），整条左腿看起来走在身体前面。
  // 在腿部平滑之后把左大腿绕局部 X 向后回摆 11.5°，只平移均值、不改摆幅。
  const WALK_LEFT_UPLEG_PITCH_BIAS_DEG = -11.5;
  // 右腿均值比源偏后约 20 mm，向前补 3°，让左右膝/踝平均位置都贴近源动作。
  const WALK_RIGHT_UPLEG_PITCH_BIAS_DEG = 3.0;
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
  // 源走路本身带约 1.8° 的后仰；目标模型脊柱休息曲线更明显，只对齐源
  // 仍会看起来向后。给俯仰目标加一点前倾偏置，让上身落在髋部正上方。
  const WALK_TORSO_PITCH_BIAS_DEG = 2.0;
  // 走路时源动作的肩线和骨盆是反向扭转的（源相对 yaw 约 20°），但目标
  // 的肩骨为了不干扰手臂被固定在休息姿态，胸腔又和骨盆同相，整段上身
  // 像一块板。这里按源肩线相对骨盆的 yaw 给 chest 加一个反向扭转。
  const WALK_TORSO_YAW_GAIN = 0.95;
  // 目标左右上臂的局部轴不同；0.78/0.15 是 60 Hz 实测把两臂摆幅
  // 拉到源动作 35.8°/49.4° 附近的折中，左臂不再超过源，右臂不再外甩。
  const WALK_LEFT_ARM_SWING_GAIN = 0.78;
  // 右臂的局部轴和源镜像相反，完整差值在目标上会过冲成 100° 摆幅；
  // 0.15 只补胸腔反扭造成的摆幅损失，保留源右臂的相位，实测 48.4°。
  const WALK_RIGHT_ARM_SWING_GAIN = 0.15;
  // 左臂摆幅已经对齐，但 60 Hz 下峰值角速度仍明显高于源；用 200°/s
  // 的单帧上限削掉 0.48–0.57 s 的连续甩臂，摆幅仍保持 36.6°。
  const WALK_ARM_MAX_DEG_PER_SEC = 200;
  // 走路腿部低通时间常数：只在 walk 生效。50 ms 比原来的 30 ms 更能压掉
  // 左腿在大腿接近伸直时的单帧弹动，同时保留 40° 以上的前后摆。
  const WALK_LEG_SMOOTH_TAU = 0.05;
  // 走路固定内收角：左右腿局部轴不同，分开给角，只压站距，不做逐帧阈值修正，
  // 避免大腿局部 Z 单帧冲击。
  const WALK_LEG_ADDUCT_LEFT = 0.048;
  const WALK_LEG_ADDUCT_RIGHT = 0.112;
  // 跑步单独解算：源动作左右腿在目标局部轴上相位错位（目标左腿与源右腿
  // 相关 0.90），不能再按局部旋转逐骨套用。这里直接用源脚相对髋的世界
  // 位置做两段腿 IK，保证左对左、右对右，并保留源动作的腾空期。
  const RUN_TORSO_ITERS = 8;
  const RUN_ARM_MAX_DEG_PER_SEC = 800;
  const RUN_GROUND_LIMIT = 0.5;

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

  // 左右腿均值校正：只绕大腿局部 X 平移俯仰均值，不改前后摆幅。
  function biasWalkLegsPitch(humanoid, pose, math) {
    if (humanoid.leftUpperLeg !== undefined) {
      rotateBoneLocal(pose, math, humanoid.leftUpperLeg, [1, 0, 0],
        WALK_LEFT_UPLEG_PITCH_BIAS_DEG * Math.PI / 180);
    }
    if (humanoid.rightUpperLeg !== undefined) {
      rotateBoneLocal(pose, math, humanoid.rightUpperLeg, [1, 0, 0],
        WALK_RIGHT_UPLEG_PITCH_BIAS_DEG * Math.PI / 180);
    }
  }

  // 单帧摆速封顶：按左臂当前 sagittal 角和上一帧限幅后的角比较，
  // 超过上限就把上臂沿世界 X 回退相应角度，避免削顶后又慢慢追回去。
  function limitWalkLeftArmSpeed(vrm, humanoid, pose, state, dt, math) {
    if (!state || !(dt > 0)) return;
    if (humanoid.leftUpperArm === undefined || humanoid.leftLowerArm === undefined) return;
    const current = armSagittal(vrm.json, pose, humanoid.leftUpperArm, humanoid.leftLowerArm);
    const previous = state.leftArmSagittal;
    if (previous === undefined) {
      state.leftArmSagittal = current;
      return;
    }
    const maxStep = WALK_ARM_MAX_DEG_PER_SEC * Math.min(0.05, dt);
    const delta = current - previous;
    const limited = Math.max(-maxStep, Math.min(maxStep, delta));
    if (Math.abs(delta - limited) > 1e-4) {
      rotateBoneWorld(vrm.json, pose, math, humanoid.leftUpperArm, [1, 0, 0], (delta - limited) * Math.PI / 180);
    }
    state.leftArmSagittal = previous + limited;
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
  function alignWalkTorsoPitch(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.spine === undefined || humanoid.hips === undefined || humanoid.head === undefined) return;
    const sourceNodes = sourceJson.nodes || [];
    const sourceHip = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'Hips');
    const sourceHead = sourceNodes.findIndex((node) => sourceBoneName(node.name) === 'Head');
    if (sourceHip < 0 || sourceHead < 0) return;
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const sourceHipPos = sourceWorld(sourceHip);
    const sourceHeadPos = sourceWorld(sourceHead);
    const sourcePitch = Math.atan2(
      -(sourceHeadPos[2] - sourceHipPos[2]),
      sourceHeadPos[1] - sourceHipPos[1]
    ) * 180 / Math.PI;
    // 源骨架面向 +Z，目标面向 -Z，同一个“前倾”在俯仰符号上相反。
    const desiredPitch = -sourcePitch + WALK_TORSO_PITCH_BIAS_DEG;
    let applied = 0;
    for (let i = 0; i < 2; i += 1) {
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const hips = targetWorld(humanoid.hips);
      const head = targetWorld(humanoid.head);
      const currentPitch = Math.atan2(-(head[2] - hips[2]), head[1] - hips[1]) * 180 / Math.PI;
      const error = desiredPitch - currentPitch;
      if (Math.abs(error) < 0.35) break;
      const angle = Math.max(-0.2, Math.min(0.2, -error * Math.PI / 180));
      rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [1, 0, 0], angle);
      applied += angle;
    }
    // 胸腔俯仰会带着手臂一起前后转；把上臂反向转回来，保持已经对齐好的
    // 手臂世界朝向不变，只修躯干/头部的前后倾。
    if (Math.abs(applied) > 1e-6 && humanoid.leftUpperArm !== undefined && humanoid.rightUpperArm !== undefined) {
      rotateBoneWorld(vrm.json, pose, math, humanoid.leftUpperArm, [1, 0, 0], -applied);
      rotateBoneWorld(vrm.json, pose, math, humanoid.rightUpperArm, [1, 0, 0], -applied);
    }
  }

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

  // 把一段骨骼的世界方向对准目标方向；比绕固定轴补角更稳定，
  // 不会在腿/臂接近伸直时因为叉积方向翻转产生单帧弹跳。
  function aimBoneWorld(json, pose, math, index, currentDir, desiredDir) {
    if (index === undefined) return;
    const current = normalizeVector(currentDir);
    const desired = normalizeVector(desiredDir);
    if (!current || !desired) return;
    const fix = rotationBetween(
      [current[0], current[1], current[2], 0],
      [desired[0], desired[1], desired[2], 0]
    );
    const world = nodeWorldQuaternions(json, pose, math);
    const parent = json.nodes.findIndex(node => (node.children || []).indexOf(index) >= 0);
    const parentWorld = parent >= 0 ? world(parent) : [0, 0, 0, 1];
    const nextWorld = normalizeQuat(math.Q.mult(math.Q.create(), fix, world(index)));
    pose.rotation[index] = normalizeQuat(math.Q.mult(math.Q.create(), inverseQuat(parentWorld), nextWorld));
  }

  function sourceNodeIndex(sourceJson, name) {
    const nodes = sourceJson.nodes || [];
    return nodes.findIndex(node => sourceBoneName(node.name) === name);
  }

  function basisToQuat(right, up, forward) {
    const m00 = right[0], m01 = up[0], m02 = forward[0];
    const m10 = right[1], m11 = up[1], m12 = forward[1];
    const m20 = right[2], m21 = up[2], m22 = forward[2];
    const trace = m00 + m11 + m22;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      return normalizeQuat([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]);
    }
    if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      return normalizeQuat([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
    }
    if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      return normalizeQuat([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
    }
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return normalizeQuat([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
  }

  // 头/颈没有可靠的下一级子骨，按源骨骼的三条世界轴整体拷贝朝向；
  // 源骨架面向 +Z、目标面向 -Z，右轴和前轴都要取反。
  function alignRunBoneOrientation(vrm, sourceJson, sourcePose, humanoid, pose, math, targetName, sourceName) {
    const targetIndex = humanoid[targetName];
    const sourceIndex = sourceNodeIndex(sourceJson, sourceName);
    if (targetIndex === undefined || sourceIndex < 0) return;
    const sourceWorld = nodeWorldQuaternions(sourceJson, sourcePose, math);
    const sourceQuat = sourceWorld(sourceIndex);
    const sourceRight = rotateVector(sourceQuat, [1, 0, 0]);
    const sourceUp = rotateVector(sourceQuat, [0, 1, 0]);
    const sourceForward = rotateVector(sourceQuat, [0, 0, 1]);
    const desiredRight = runFacing(sourceRight);
    const desiredUp = runFacing(sourceUp);
    const desiredFace = runFacing(sourceForward);
    // 目标头骨的局部 +Z 是后脑，脸朝 -Z；basis 的 forward 轴对应局部 +Z，
    // 所以要放“脸的相反方向”，否则头会整体转 180°。
    const basisForward = [-desiredFace[0], desiredFace[1], -desiredFace[2]];
    const desired = basisToQuat(desiredRight, desiredUp, basisForward);
    const parent = vrm.json.nodes.findIndex(node => (node.children || []).indexOf(targetIndex) >= 0);
    const world = nodeWorldQuaternions(vrm.json, pose, math);
    const parentWorld = parent >= 0 ? world(parent) : [0, 0, 0, 1];
    pose.rotation[targetIndex] = normalizeQuat(
      math.Q.mult(math.Q.create(), inverseQuat(parentWorld), desired)
    );
  }

  // 源骨架面向 +Z，目标面向 -Z；同一动作在目标世界要绕 Y 转 180°。
  function runFacing(value) {
    return [-value[0], value[1], -value[2]];
  }

  function segmentDirection(from, to) {
    const value = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    return normalizeVector(value) || [0, -1, 0];
  }

  // 跑步腿链用源脚相对源髋的位置驱动目标两段腿 IK。源和目标腿长不同，
  // 只按腿长比例缩放，不改变源动作的前后相位、站距和腾空高度。
  function solveRunLeg(vrm, humanoid, pose, math, upper, lower, foot, sourceHip, sourceKnee, sourceAnkle, legScale) {
    const world = nodeWorldPositions(vrm.json, pose);
    const hip = world(upper);
    const knee = world(lower);
    const ankle = world(foot);
    const thighLength = Math.hypot(knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]);
    const shinLength = Math.hypot(ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]);
    if (thighLength <= 1e-4 || shinLength <= 1e-4) return;
    const relative = runFacing([
      sourceAnkle[0] - sourceHip[0],
      sourceAnkle[1] - sourceHip[1],
      sourceAnkle[2] - sourceHip[2]
    ]);
    const desiredAnkle = [
      hip[0] + relative[0] * legScale,
      hip[1] + relative[1] * legScale,
      hip[2] + relative[2] * legScale
    ];
    const reach = [desiredAnkle[0] - hip[0], desiredAnkle[1] - hip[1], desiredAnkle[2] - hip[2]];
    let distance = Math.hypot(reach[0], reach[1], reach[2]);
    distance = Math.max(Math.abs(thighLength - shinLength) + 1e-3,
      Math.min(thighLength + shinLength - 1e-3, distance));
    const dir = normalizeVector(reach) || [0, -1, 0];
    const clampedAnkle = [hip[0] + dir[0] * distance, hip[1] + dir[1] * distance, hip[2] + dir[2] * distance];
    // 膝盖弯折方向从源膝盖相对髋-踝连线的偏移取，投影到目标连线上；
    // 退化时用前方，避免腿伸直时膝盖突然翻到另一侧。
    const sourceLine = segmentDirection(sourceHip, sourceAnkle);
    const sourceAlong = (sourceKnee[0] - sourceHip[0]) * sourceLine[0] +
      (sourceKnee[1] - sourceHip[1]) * sourceLine[1] +
      (sourceKnee[2] - sourceHip[2]) * sourceLine[2];
    const sourcePole = runFacing([
      sourceKnee[0] - sourceHip[0] - sourceLine[0] * sourceAlong,
      sourceKnee[1] - sourceHip[1] - sourceLine[1] * sourceAlong,
      sourceKnee[2] - sourceHip[2] - sourceLine[2] * sourceAlong
    ]);
    let pole = normalizeVector(sourcePole) || [0, 0, -1];
    const along = (thighLength * thighLength - shinLength * shinLength + distance * distance) /
      (2 * distance);
    const bend = Math.sqrt(Math.max(0, thighLength * thighLength - along * along));
    const alongDir = [dir[0] * along, dir[1] * along, dir[2] * along];
    const poleOnPlane = normalizeVector([
      pole[0] - dir[0] * (pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2]),
      pole[1] - dir[1] * (pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2]),
      pole[2] - dir[2] * (pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2])
    ]) || [0, 0, -1];
    const desiredKnee = [
      hip[0] + alongDir[0] + poleOnPlane[0] * bend,
      hip[1] + alongDir[1] + poleOnPlane[1] * bend,
      hip[2] + alongDir[2] + poleOnPlane[2] * bend
    ];
    aimBoneWorld(vrm.json, pose, math, upper, [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]],
      [desiredKnee[0] - hip[0], desiredKnee[1] - hip[1], desiredKnee[2] - hip[2]]);
    const nextWorld = nodeWorldPositions(vrm.json, pose);
    const nextKnee = nextWorld(lower);
    const nextAnkle = nextWorld(foot);
    aimBoneWorld(vrm.json, pose, math, lower,
      [nextAnkle[0] - nextKnee[0], nextAnkle[1] - nextKnee[1], nextAnkle[2] - nextKnee[2]],
      [clampedAnkle[0] - nextKnee[0], clampedAnkle[1] - nextKnee[1], clampedAnkle[2] - nextKnee[2]]);
  }

  function alignRunLegs(vrm, sourceJson, sourcePose, humanoid, pose, math) {
    if (humanoid.leftUpperLeg === undefined || humanoid.rightUpperLeg === undefined ||
        humanoid.leftLowerLeg === undefined || humanoid.rightLowerLeg === undefined ||
        humanoid.leftFoot === undefined || humanoid.rightFoot === undefined) return;
    const sourceLeftUpLeg = sourceNodeIndex(sourceJson, 'LeftUpLeg');
    const sourceRightUpLeg = sourceNodeIndex(sourceJson, 'RightUpLeg');
    const sourceLeftLeg = sourceNodeIndex(sourceJson, 'LeftLeg');
    const sourceRightLeg = sourceNodeIndex(sourceJson, 'RightLeg');
    const sourceLeftFoot = sourceNodeIndex(sourceJson, 'LeftFoot');
    const sourceRightFoot = sourceNodeIndex(sourceJson, 'RightFoot');
    if (sourceLeftUpLeg < 0 || sourceRightUpLeg < 0 || sourceLeftLeg < 0 ||
        sourceRightLeg < 0 || sourceLeftFoot < 0 || sourceRightFoot < 0) return;
    const targetRest = nodeWorldPositions(vrm.json);
    const sourceRest = nodeWorldPositions(sourceJson);
    const targetLegLength = Math.hypot(
      targetRest(humanoid.leftUpperLeg)[0] - targetRest(humanoid.leftFoot)[0],
      targetRest(humanoid.leftUpperLeg)[1] - targetRest(humanoid.leftFoot)[1],
      targetRest(humanoid.leftUpperLeg)[2] - targetRest(humanoid.leftFoot)[2]
    );
    const sourceLegLength = Math.hypot(
      sourceRest(sourceLeftUpLeg)[0] - sourceRest(sourceLeftFoot)[0],
      sourceRest(sourceLeftUpLeg)[1] - sourceRest(sourceLeftFoot)[1],
      sourceRest(sourceLeftUpLeg)[2] - sourceRest(sourceLeftFoot)[2]
    );
    if (targetLegLength <= 1e-4 || sourceLegLength <= 1e-4) return;
    const legScale = targetLegLength / sourceLegLength;
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    solveRunLeg(vrm, humanoid, pose, math, humanoid.leftUpperLeg, humanoid.leftLowerLeg,
      humanoid.leftFoot, sourceWorld(sourceLeftUpLeg), sourceWorld(sourceLeftLeg),
      sourceWorld(sourceLeftFoot), legScale);
    solveRunLeg(vrm, humanoid, pose, math, humanoid.rightUpperLeg, humanoid.rightLowerLeg,
      humanoid.rightFoot, sourceWorld(sourceRightUpLeg), sourceWorld(sourceRightLeg),
      sourceWorld(sourceRightFoot), legScale);
  }

  // 手臂按源肩-肘、肘-腕的世界方向对齐，不继续套局部旋转。跑步用它
  // 消除 16→18 帧的 -78°→+24° 跳变；打招呼用它消除上臂低 10°、
  // 前臂多抬 23° 导致的右腕偏低和提前落臂。
  function alignArmDirections(vrm, sourceJson, sourcePose, humanoid, pose, math) {
    const pairs = [
      [humanoid.leftUpperArm, humanoid.leftLowerArm, humanoid.leftHand, 'LeftArm', 'LeftForeArm', 'LeftHand'],
      [humanoid.rightUpperArm, humanoid.rightLowerArm, humanoid.rightHand, 'RightArm', 'RightForeArm', 'RightHand']
    ];
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    for (const pair of pairs) {
      const upper = pair[0], lower = pair[1], hand = pair[2];
      const sourceUpper = sourceNodeIndex(sourceJson, pair[3]);
      const sourceLower = sourceNodeIndex(sourceJson, pair[4]);
      const sourceHand = sourceNodeIndex(sourceJson, pair[5]);
      if (upper === undefined || lower === undefined || sourceUpper < 0 ||
          sourceLower < 0 || sourceHand < 0) continue;
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const shoulder = targetWorld(upper);
      const elbow = targetWorld(lower);
      const sourceShoulder = sourceWorld(sourceUpper);
      const sourceElbow = sourceWorld(sourceLower);
      const sourceWrist = sourceWorld(sourceHand);
      aimBoneWorld(vrm.json, pose, math, upper,
        [elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]],
        runFacing([
          sourceElbow[0] - sourceShoulder[0],
          sourceElbow[1] - sourceShoulder[1],
          sourceElbow[2] - sourceShoulder[2]
        ]));
      const nextWorld = nodeWorldPositions(vrm.json, pose);
      const nextElbow = nextWorld(lower);
      const nextWrist = nextWorld(hand);
      aimBoneWorld(vrm.json, pose, math, lower,
        [nextWrist[0] - nextElbow[0], nextWrist[1] - nextElbow[1], nextWrist[2] - nextElbow[2]],
        runFacing([
          sourceWrist[0] - sourceElbow[0],
          sourceWrist[1] - sourceElbow[1],
          sourceWrist[2] - sourceElbow[2]
        ]));
    }
  }

  // 先把肩→肘、肘→腕方向精确对齐，再绕各骨轴补滚转：只套世界四元数
  // 会被目标臂骨局部轴与 +X 的几度偏差带偏，单独 aim 又不控制自转。
  function alignBoneRollWorld(json, pose, math, index, axis, sourceQuat, lateral) {
    if (index === undefined) return;
    const d = normalizeVector(axis);
    if (!d) return;
    const world = nodeWorldQuaternions(json, pose, math);
    const targetQ = world(index);
    const rotate = (q, v) => {
      const [x, y, z, w] = q;
      const tx = 2 * (y * v[2] - z * v[1]);
      const ty = 2 * (z * v[0] - x * v[2]);
      const tz = 2 * (x * v[1] - y * v[0]);
      return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx)
      ];
    };
    const targetLateral = rotate(targetQ, lateral);
    const sourceLateral = runFacing(rotate(sourceQuat, lateral));
    const dot = targetLateral[0] * sourceLateral[0] + targetLateral[1] * sourceLateral[1] +
      targetLateral[2] * sourceLateral[2];
    const cross = [
      targetLateral[1] * sourceLateral[2] - targetLateral[2] * sourceLateral[1],
      targetLateral[2] * sourceLateral[0] - targetLateral[0] * sourceLateral[2],
      targetLateral[0] * sourceLateral[1] - targetLateral[1] * sourceLateral[0]
    ];
    const angle = Math.atan2(
      cross[0] * d[0] + cross[1] * d[1] + cross[2] * d[2],
      dot
    );
    if (Math.abs(angle) > 1e-4) rotateBoneWorld(json, pose, math, index, d, angle);
  }

  function alignRightArmOrientation(vrm, sourceJson, sourcePose, humanoid, pose, math) {
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const sourceQuats = nodeWorldQuaternions(sourceJson, sourcePose, math);
    const upper = humanoid.rightUpperArm;
    const lower = humanoid.rightLowerArm;
    const hand = humanoid.rightHand;
    const sourceUpper = sourceNodeIndex(sourceJson, 'RightArm');
    const sourceLower = sourceNodeIndex(sourceJson, 'RightForeArm');
    const sourceHand = sourceNodeIndex(sourceJson, 'RightHand');
    if (upper === undefined || lower === undefined || hand === undefined ||
        sourceUpper < 0 || sourceLower < 0 || sourceHand < 0) return;
    const shoulder = sourceWorld(sourceUpper);
    const elbow = sourceWorld(sourceLower);
    const wrist = sourceWorld(sourceHand);
    const upperDir = runFacing([elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]]);
    const lowerDir = runFacing([wrist[0] - elbow[0], wrist[1] - elbow[1], wrist[2] - elbow[2]]);
    const targetWorld = nodeWorldPositions(vrm.json, pose);
    const targetShoulder = targetWorld(upper);
    const targetElbow = targetWorld(lower);
    aimBoneWorld(vrm.json, pose, math, upper,
      [targetElbow[0] - targetShoulder[0], targetElbow[1] - targetShoulder[1], targetElbow[2] - targetShoulder[2]],
      upperDir);
    alignBoneRollWorld(vrm.json, pose, math, upper, upperDir, sourceQuats(sourceUpper), [0, 1, 0]);
    const nextWorld = nodeWorldPositions(vrm.json, pose);
    const nextElbow = nextWorld(lower);
    const nextWrist = nextWorld(hand);
    aimBoneWorld(vrm.json, pose, math, lower,
      [nextWrist[0] - nextElbow[0], nextWrist[1] - nextElbow[1], nextWrist[2] - nextElbow[2]],
      lowerDir);
    alignBoneRollWorld(vrm.json, pose, math, lower, lowerDir, sourceQuats(sourceLower), [0, 1, 0]);
    const turn = [0, 1, 0, 0];
    const turned = math.Q.mult(math.Q.create(), turn, sourceQuats(sourceHand));
    const desiredHand = math.Q.mult(math.Q.create(), turned, turn);
    const handParent = vrm.json.nodes.findIndex(node => (node.children || []).indexOf(hand) >= 0);
    const handWorld = nodeWorldQuaternions(vrm.json, pose, math);
    const handParentWorld = handParent >= 0 ? handWorld(handParent) : [0, 0, 0, 1];
    pose.rotation[hand] = normalizeQuat(
      math.Q.mult(math.Q.create(), inverseQuat(handParentWorld), desiredHand)
    );
  }

  // 用多次小步反馈替代原跑步分支的单次 0.2 rad，避免把脊柱来回甩。
  function alignRunTorsoPitch(sourceJson, sourcePose, vrm, humanoid, pose, math) {
    if (humanoid.spine === undefined || humanoid.hips === undefined || humanoid.head === undefined) return;
    const sourceHip = sourceNodeIndex(sourceJson, 'Hips');
    const sourceHead = sourceNodeIndex(sourceJson, 'Head');
    if (sourceHip < 0 || sourceHead < 0) return;
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const sourceHipPos = sourceWorld(sourceHip);
    const sourceHeadPos = sourceWorld(sourceHead);
    const sourcePitch = Math.atan2(
      -(sourceHeadPos[2] - sourceHipPos[2]),
      sourceHeadPos[1] - sourceHipPos[1]
    ) * 180 / Math.PI;
    const desiredPitch = -sourcePitch;
    // 源跑步上身基本竖直（Hips→Head 横向角约 0.3°）；目标局部轴把
    // 躯干带到左倾约 10°，正面的“歪着跑”主要来自这里。
    const sourceLateral = Math.atan2(
      sourceHeadPos[0] - sourceHipPos[0],
      sourceHeadPos[1] - sourceHipPos[1]
    ) * 180 / Math.PI;
    const desiredLateral = -sourceLateral;
    for (let i = 0; i < RUN_TORSO_ITERS; i += 1) {
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      const hips = targetWorld(humanoid.hips);
      const head = targetWorld(humanoid.head);
      const currentPitch = Math.atan2(-(head[2] - hips[2]), head[1] - hips[1]) * 180 / Math.PI;
      const currentLateral = Math.atan2(head[0] - hips[0], head[1] - hips[1]) * 180 / Math.PI;
      const pitchError = desiredPitch - currentPitch;
      const lateralError = desiredLateral - currentLateral;
      if (Math.abs(pitchError) < 0.15 && Math.abs(lateralError) < 0.15) break;
      if (Math.abs(pitchError) >= 0.15) {
        const pitchAngle = Math.max(-0.12, Math.min(0.12, -pitchError * Math.PI / 180));
        rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [1, 0, 0], pitchAngle);
      }
      if (Math.abs(lateralError) >= 0.15) {
        const lateralAngle = Math.max(-0.1, Math.min(0.1, -lateralError * Math.PI / 180));
        rotateBoneWorld(vrm.json, pose, math, humanoid.spine, [0, 0, 1], lateralAngle);
      }
    }
  }

  // 脚掌方向用踝→脚尖的世界方向对齐，脚尖不再外撇/内扣；这一步必须在
  // 腿 IK 之后，脚尖落点才跟脚踝一致。
  function alignRunFeet(vrm, sourceJson, sourcePose, humanoid, pose, math) {
    const pairs = [
      [humanoid.leftFoot, humanoid.leftToes, 'LeftFoot', 'LeftToeBase'],
      [humanoid.rightFoot, humanoid.rightToes, 'RightFoot', 'RightToeBase']
    ];
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    for (const pair of pairs) {
      const foot = pair[0], toes = pair[1];
      const sourceFoot = sourceNodeIndex(sourceJson, pair[2]);
      const sourceToes = sourceNodeIndex(sourceJson, pair[3]);
      if (foot === undefined || toes === undefined || sourceFoot < 0 || sourceToes < 0) continue;
      const targetWorld = nodeWorldPositions(vrm.json, pose);
      aimBoneWorld(vrm.json, pose, math, foot,
        [targetWorld(toes)[0] - targetWorld(foot)[0],
          targetWorld(toes)[1] - targetWorld(foot)[1],
          targetWorld(toes)[2] - targetWorld(foot)[2]],
        runFacing([
          sourceWorld(sourceToes)[0] - sourceWorld(sourceFoot)[0],
          sourceWorld(sourceToes)[1] - sourceWorld(sourceFoot)[1],
          sourceWorld(sourceToes)[2] - sourceWorld(sourceFoot)[2]
        ]));
    }
  }

  // 跑步接地按脚尖高度算，并保留源动作的腾空期：源最低脚尖离地多少，
  // 目标最低脚尖也离地多少；不再每帧把脚踝强行压回地面。
  function alignRunGround(vrm, sourceJson, sourcePose, humanoid, pose, math) {
    if (humanoid.hips === undefined) return;
    const targetToes = [humanoid.leftToes, humanoid.rightToes].filter(index => index !== undefined);
    if (!targetToes.length) return;
    const sourceToes = [
      sourceNodeIndex(sourceJson, 'LeftToeBase'),
      sourceNodeIndex(sourceJson, 'RightToeBase')
    ].filter(index => index >= 0);
    if (!sourceToes.length) return;
    const targetRest = nodeWorldPositions(vrm.json);
    const sourceRest = nodeWorldPositions(sourceJson);
    const targetGround = Math.min(...targetToes.map(index => targetRest(index)[1]));
    const sourceGround = Math.min(...sourceToes.map(index => sourceRest(index)[1]));
    const targetWorld = nodeWorldPositions(vrm.json, pose);
    const sourceWorld = nodeWorldPositions(sourceJson, sourcePose);
    const targetClear = Math.min(...targetToes.map(index => targetWorld(index)[1])) - targetGround;
    const sourceClear = Math.min(...sourceToes.map(index => sourceWorld(index)[1])) - sourceGround;
    const sourceHip = sourceNodeIndex(sourceJson, 'Hips');
    if (sourceHip < 0) return;
    const scale = targetRest(humanoid.hips)[1] /
      Math.max(1e-6, Math.abs(sourceRest(sourceHip)[1]));
    const desiredClear = Math.max(0, sourceClear * scale);
    const offset = Math.min(RUN_GROUND_LIMIT, Math.max(-RUN_GROUND_LIMIT, desiredClear - targetClear));
    if (Math.abs(offset) < 1e-4) return;
    const current = pose.translation[humanoid.hips] ||
      (vrm.json.nodes[humanoid.hips].translation || [0, 0, 0]).slice();
    pose.translation[humanoid.hips] = [current[0], current[1] + offset, current[2]];
  }

  function limitRunRightArmSpeed(vrm, humanoid, pose, state, dt, math) {
    if (!state || !(dt > 0)) return;
    if (humanoid.rightUpperArm === undefined || humanoid.rightLowerArm === undefined) return;
    const current = armSagittal(vrm.json, pose, humanoid.rightUpperArm, humanoid.rightLowerArm);
    const previous = state.rightArmSagittal;
    if (previous === undefined) {
      state.rightArmSagittal = current;
      return;
    }
    const maxStep = RUN_ARM_MAX_DEG_PER_SEC * Math.min(0.05, dt);
    const delta = current - previous;
    const limited = Math.max(-maxStep, Math.min(maxStep, delta));
    if (Math.abs(delta - limited) > 1e-4) {
      rotateBoneWorld(vrm.json, pose, math, humanoid.rightUpperArm, [1, 0, 0], (delta - limited) * Math.PI / 180);
    }
    state.rightArmSagittal = previous + limited;
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
      alignWalkTorsoPitch(sourceJson, sourcePose, vrm, humanoid, pose, math);
    }

    if (options && options.runPose) {
      // 先让躯干俯仰/横向对齐，再覆盖头部朝向。颈部保持源局部旋转，
      // 不用目标不同的颈骨长度去强行拷贝世界朝向，否则头会被带向一侧。
      alignRunTorsoPitch(sourceJson, sourcePose, vrm, humanoid, pose, math);
      alignRunBoneOrientation(vrm, sourceJson, sourcePose, humanoid, pose, math, 'head', 'Head');
      alignArmDirections(vrm, sourceJson, sourcePose, humanoid, pose, math);
      alignRunLegs(vrm, sourceJson, sourcePose, humanoid, pose, math);
      alignRunFeet(vrm, sourceJson, sourcePose, humanoid, pose, math);
      alignRunGround(vrm, sourceJson, sourcePose, humanoid, pose, math);
      limitRunRightArmSpeed(vrm, humanoid, pose, options.armLimitState, options.dt, math);
    }

    // 打招呼本质是右臂手势，套局部轴会让上臂低约 10°、前臂多抬约 23°，
    // 右腕整体低 79 mm 且提前 0.73 s 落到最低点。这里改用源肩→肘、
    // 肘→腕的世界方向重解两臂；左臂随后由 idle 结果覆盖，不受影响。
    if (options && options.greetPose) {
      alignRightArmOrientation(vrm, sourceJson, sourcePose, humanoid, pose, math);
    }

    // 髋部按源动作起伏后，目标腿长和站距不同，脚会悬空；把最低脚踝拉回绑定高度。
    if (!(options && options.runPose) && hipsTargetIndex !== undefined &&
        humanoid.leftFoot !== undefined && humanoid.rightFoot !== undefined) {
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

    if (!(options && options.runPose)) keepLegsApart(vrm, humanoid, pose, math);
    if (options && options.footClearance) {
      adductWalkLegs(humanoid, pose, math, WALK_LEG_ADDUCT_LEFT, WALK_LEG_ADDUCT_RIGHT);
      liftSwingFeet(vrm, sourceJson, humanoid, pose, sourcePose, math);
      smoothWalkLegs(humanoid, pose, options.legSmoothState, options.dt, math);
      biasWalkLegsPitch(humanoid, pose, math);
      limitWalkLeftArmSpeed(vrm, humanoid, pose, options.armLimitState, options.dt, math);
    }
    return pose;
  }

  const api = { retargetPose, MIXAMO_TO_VRM, nodeWorldPositions };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.AnimationRetarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

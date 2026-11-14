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

  function needsAxisOffset(semantic) {
    return /Arm|Hand|Shoulder|UpLeg|Leg|Foot|Hips|Spine|Chest|Neck|Head/.test(semantic);
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
      // 脚趾没有下一级子骨骼，方向由脚掌带动；只给脚掌做方向对齐。
      if (animated && !/Toe/.test(semantic)) {
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
          delta = scaleQuatAngle([-delta[0], delta[1], delta[2], delta[3]], LEG_PITCH_GAIN);
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

    // 髋部按源动作起伏后，目标腿长和站距不同，脚会悬空；把最低脚踝拉回绑定高度。
    if (hipsTargetIndex !== undefined && humanoid.leftFoot !== undefined && humanoid.rightFoot !== undefined) {
      const restPos = nodeWorldPositions(vrm.json, null);
      const posePos = nodeWorldPositions(vrm.json, pose);
      const restGround = Math.min(restPos(humanoid.leftFoot)[1], restPos(humanoid.rightFoot)[1]);
      const poseGround = Math.min(posePos(humanoid.leftFoot)[1], posePos(humanoid.rightFoot)[1]);
      const offset = restGround - poseGround;
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
    return pose;
  }

  const api = { retargetPose, MIXAMO_TO_VRM, nodeWorldPositions };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.AnimationRetarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

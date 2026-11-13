/**
 * Aevum 程序化动作
 *
 * 不依赖外部动画文件，用时间函数生成呼吸、重心微摆、头部、手臂和步行/跑步动作。
 * 输出是“相对休息姿态的增量”，由各渲染器合并到自己的骨骼层级：
 *   - PMX：makePMXPose 返回 { boneIndex: { rotation, translation } }
 *   - VRM：makeVRMPose 返回 { nodeIndex: quaternion }
 *
 * 眨眼走 PMX Morph：makeBlinkWeights 找到 `まばたき / ウィンク / blink` 等表情，
 * 返回 { morphIndex: weight }，交给 WebGLRenderer.setMorphWeights。
 *
 * @module Aevum/render/procedural-animation
 */
(function (root) {
  'use strict';

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../../math/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  const PMX_PATTERNS = {
    hips: [/センター/, /center/i, /腰|骨盤|下半身/],
    spine: [/上半身$/, /spine/i],
    chest: [/上半身2/, /chest/i],
    neck: [/首$/, /neck/i],
    head: [/頭$/, /head/i],
    leftShoulder: [/左肩/, /left.*shoulder/i],
    rightShoulder: [/右肩/, /right.*shoulder/i],
    leftArm: [/左腕/, /left.*arm/i],
    rightArm: [/右腕/, /right.*arm/i],
    leftForearm: [/左ひじ|左肘/, /left.*(forearm|elbow)/i],
    rightForearm: [/右ひじ|右肘/, /right.*(forearm|elbow)/i],
    leftHand: [/左手首/, /left.*(hand|wrist)/i],
    rightHand: [/右手首/, /right.*(hand|wrist)/i],
    leftLeg: [/左足D$/, /左足$/, /left.*(leg|thigh)/i],
    rightLeg: [/右足D$/, /右足$/, /right.*(leg|thigh)/i],
    leftLowerLeg: [/左ひざD$/, /左ひざ|左膝/, /left.*(lowerleg|knee)/i],
    rightLowerLeg: [/右ひざD$/, /右ひざ|右膝/, /right.*(lowerleg|knee)/i],
    leftFoot: [/左足首D$/, /左足首/, /left.*(foot|ankle)/i],
    rightFoot: [/右足首D$/, /右足首/, /right.*(foot|ankle)/i]
  };

  const PMX_D_PATTERNS = {
    leftLeg: /左足D$/,
    rightLeg: /右足D$/,
    leftLowerLeg: /左ひざD$/,
    rightLowerLeg: /右ひざD$/,
    leftFoot: /左足首D$/,
    rightFoot: /右足首D$/
  };

  const VRM_KEYS = {
    hips: 'hips',
    spine: 'spine',
    chest: 'chest',
    neck: 'neck',
    head: 'head',
    leftShoulder: 'leftShoulder',
    rightShoulder: 'rightShoulder',
    leftArm: 'leftUpperArm',
    rightArm: 'rightUpperArm',
    leftForearm: 'leftLowerArm',
    rightForearm: 'rightLowerArm',
    leftHand: 'leftHand',
    rightHand: 'rightHand',
    leftLeg: 'leftUpperLeg',
    rightLeg: 'rightUpperLeg',
    leftLowerLeg: 'leftLowerLeg',
    rightLowerLeg: 'rightLowerLeg',
    leftFoot: 'leftFoot',
    rightFoot: 'rightFoot'
  };

  const MORPH_BLINK = [/(まばたき|ウィンク|瞬き|目を閉じる|闭眼|眨眼)/, /^(blink|wink|eyeclose)/i];

  function matchName(name, patterns) {
    if (!name) return false;
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(name)) return true;
    }
    return false;
  }

  function detectPMXBones(model) {
    const result = {};
    const bones = model.bones || [];
    for (const part in PMX_PATTERNS) {
      let best = -1;
      // MMD 模型常给腿留两套骨骼：控制骨 `左足` 和带蒙皮权重的变形骨 `左足D`。
      // 变形骨优先，否则动作会落在没有顶点的骨头上，画面完全不动。
      const deform = PMX_D_PATTERNS[part];
      if (deform) {
        for (let i = 0; i < bones.length; i += 1) {
          const bone = bones[i];
          if (deform.test(bone.name || '') || deform.test(bone.nameEn || '')) {
            best = i;
            break;
          }
        }
      }
      if (best >= 0) {
        result[part] = best;
        continue;
      }
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (matchName(bone.name, PMX_PATTERNS[part]) || matchName(bone.nameEn, PMX_PATTERNS[part])) {
          best = i;
          break;
        }
      }
      if (best >= 0) result[part] = best;
    }
    return result;
  }

  function detectVRMBones(vrm) {
    const result = {};
    const nodes = vrm && vrm.humanBoneNodes ? vrm.humanBoneNodes : {};
    for (const part in VRM_KEYS) {
      const node = nodes[VRM_KEYS[part]];
      if (node !== undefined) result[part] = node;
    }
    return result;
  }

  /**
   * 时间函数 -> 各部位的增量欧拉角。
   * state 包含 idle / walk / run / happy / thinking；未知状态按 idle。
   * walk / run 用步频、左右腿反相、膝盖屈伸和躯干前倾生成循环姿态。
   */
  function sampleDeltas(time, state, options) {
    const t = time || 0;
    const opts = options || {};
    const armDown = opts.armDown === undefined ? 0 : opts.armDown;
    const breath = Math.sin(t * 1.1);
    const sway = Math.sin(t * 0.65);
    const head = Math.sin(t * 0.9 + 0.4);
    const arm = Math.sin(t * 1.15 + 1.2);
    const mode = state || 'idle';
    const d = {};

    d.hips = [0, sway * 0.025, 0];
    d.spine = [breath * 0.012, sway * 0.018, 0];
    d.chest = [breath * 0.018, sway * 0.012, 0];
    d.neck = [head * 0.02, head * 0.025, 0];
    d.head = [head * 0.018, Math.sin(t * 0.7) * 0.03, 0];

    const armBase = armDown + arm * 0.04;
    if (opts.armAxis === 'shoulder') {
      d.leftShoulder = [0, 0, armBase];
      d.rightShoulder = [0, 0, -armBase];
      d.leftArm = [0, 0, 0];
      d.rightArm = [0, 0, 0];
      d.leftForearm = [0, 0, 0];
      d.rightForearm = [0, 0, 0];
    } else if (opts.armAxis === 'x') {
      d.leftArm = [armBase, 0, 0];
      d.rightArm = [armBase, 0, 0];
      d.leftForearm = [0, 0, 0];
      d.rightForearm = [0, 0, 0];
    } else {
      d.leftArm = [0, 0, armBase];
      d.rightArm = [0, 0, -armBase];
      d.leftForearm = [0, 0, 0];
      d.rightForearm = [0, 0, 0];
    }

    d.leftLeg = [Math.sin(t * 0.55) * 0.01, 0, 0];
    d.rightLeg = [-Math.sin(t * 0.55) * 0.01, 0, 0];

    if (mode === 'walk' || mode === 'run') {
      const fast = mode === 'run';
      const cycle = Math.sin(t * (fast ? 5.2 : 3.8));
      const legScale = armBase >= 0.3 ? 1 : 0.33;
      const legAmp = (fast ? 0.5 : 0.3) * legScale;
      const armAmp = fast ? 0.34 : 0.22;
      const kneeAmp = (fast ? 0.8 : 0.45) * legScale;
      const lean = fast ? 0.09 : 0.035;
      // PMX 的腕骨局部轴与 VRM 不同，大角度绕 X 会把手臂折到胸前；
      // 手臂已经明显下垂（armDown >= 0.3，典型为 VRM）时才叠加前后摆。
      const armSwing = armBase >= 0.3 ? armAmp : 0;

      d.hips = [0, 0, Math.sin(t * (fast ? 1.3 : 0.95)) * 0.035];
      d.spine = [lean + breath * 0.008, cycle * 0.018, 0];
      d.chest = [breath * 0.012, -cycle * 0.012, 0];
      d.neck = [head * 0.012, -cycle * 0.015, 0];
      d.head = [head * 0.012, Math.sin(t * 0.7) * 0.02, 0];

      d.leftLeg = [cycle * legAmp, 0, 0];
      d.rightLeg = [-cycle * legAmp, 0, 0];
      d.leftLowerLeg = [Math.max(0, -cycle) * kneeAmp, 0, 0];
      d.rightLowerLeg = [Math.max(0, cycle) * kneeAmp, 0, 0];
      d.leftFoot = [-Math.max(0, -cycle) * kneeAmp * 0.35, 0, 0];
      d.rightFoot = [-Math.max(0, cycle) * kneeAmp * 0.35, 0, 0];

      if (opts.armAxis === 'shoulder') {
        d.leftShoulder = [0, 0, armBase];
        d.rightShoulder = [0, 0, -armBase];
        d.leftArm = [cycle * armSwing, 0, 0];
        d.rightArm = [-cycle * armSwing, 0, 0];
      } else {
        d.leftArm = [cycle * armSwing, 0, armBase];
        d.rightArm = [-cycle * armSwing, 0, -armBase];
      }
    }

    if (mode === 'happy') {
      d.head[0] -= 0.08;
      d.head[1] += 0.1;
      d.leftArm[2] -= 0.18;
      d.rightArm[2] += 0.18;
    } else if (mode === 'thinking') {
      d.head[0] += 0.12;
      d.head[1] -= 0.16;
      d.rightForearm[2] += 0.35;
    } else if (mode === 'wave') {
      const o = opts.wave || {};
      const armLift = o.arm === undefined ? 0.60 : o.arm;
      const elbow = o.elbow === undefined ? 0.12 : o.elbow;
      const swing = o.swing === undefined ? 0.34 : o.swing;
      const amp = o.amp === undefined ? 0.06 : o.amp;
      const speed = o.speed === undefined ? 3.4 : o.speed;
      const handX = o.handX === undefined ? 0 : o.handX;
      const handY = o.handY === undefined ? 0 : o.handY;
      const handZ = o.handZ === undefined ? 0.10 : o.handZ;
      const wave = Math.sin(t * speed);
      d.head = [head * 0.01, 0.06, 0.05];
      d.chest = [breath * 0.01, -0.04, 0];
      d.leftArm = [0, 0, 1.15];
      d.leftForearm = [0, 0, 0];
      const shoulderShare = o.shoulder === undefined ? 0.3 : o.shoulder;
      d.rightShoulder = [armLift * shoulderShare, 0, 0];
      d.rightArm = [0.08, 0, armLift * (1 - shoulderShare) + wave * amp];
      d.rightForearm = [0, 0, elbow];
      d.rightHand = [handX, handY, handZ + wave * swing];
    }

    if (opts.look) {
      const weight = Math.max(0, Math.min(1, opts.look.weight === undefined ? 1 : opts.look.weight));
      const yawSign = opts.lookYawSign === undefined ? 1 : (opts.lookYawSign < 0 ? -1 : 1);
      const yaw = (Number(opts.look.yaw) || 0) * weight * yawSign;
      const pitch = (Number(opts.look.pitch) || 0) * weight;
      d.chest[1] += yaw * 0.15;
      d.neck[0] += pitch * 0.3;
      d.neck[1] += yaw * 0.25;
      d.head[0] += pitch * 0.5;
      d.head[1] += yaw * 0.6;
    }
    return d;
  }

  /**
   * 按权重混合两套增量姿态。权重 0 取 from，1 取 to。
   * 只混合两边都出现的部位；缺失部位按 0 增量处理，避免一个状态的手臂动作被另一个状态吞掉。
   */
  function blendDeltas(from, to, weight) {
    const w = Math.max(0, Math.min(1, weight || 0));
    const result = {};
    const keys = Object.keys(from || {});
    for (const key in to || {}) {
      if (keys.indexOf(key) < 0) keys.push(key);
    }
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const a = from[key] || [0, 0, 0];
      const b = to[key] || [0, 0, 0];
      result[key] = [
        a[0] + (b[0] - a[0]) * w,
        a[1] + (b[1] - a[1]) * w,
        a[2] + (b[2] - a[2]) * w
      ];
    }
    return result;
  }

  /**
   * 按动作状态机的混合快照采样。
   * blend = { from, to, weight }，直接来自 ActionStateMachine.getBlend()。
   */
  function sampleBlendedDeltas(time, blend, options) {
    if (!blend || blend.from === blend.to || blend.weight >= 1) {
      return sampleDeltas(time, blend ? blend.to : (options && options.state), options);
    }
    if (blend.weight <= 0) {
      return sampleDeltas(time, blend.from, options);
    }
    return blendDeltas(
      sampleDeltas(time, blend.from, options),
      sampleDeltas(time, blend.to, options),
      blend.weight
    );
  }

  /**
   * 眨眼曲线：默认每 4.2 秒一次，闭合 0.28 秒。
   * 返回 0（睁眼）到 1（闭眼）。
   */
  function blinkAt(time, period, closeDuration) {
    const p = period || 4.2;
    const close = closeDuration || 0.28;
    const phase = (time || 0) % p;
    if (phase < close * 0.45) return phase / (close * 0.45);
    if (phase < close * 0.75) return 1;
    if (phase < close) return (close - phase) / (close * 0.25);
    return 0;
  }

  function makePMXPose(model, time, options) {
    const math = getMath();
    const opts = options || {};
    const bindings = opts.bindings || detectPMXBones(model);
    const deltas = sampleBlendedDeltas(time, opts.blend, {
      state: opts.state,
      armDown: opts.armDown === undefined ? 0.08 : opts.armDown,
      armAxis: opts.armAxis,
      look: opts.look,
      lookYawSign: opts.lookYawSign === undefined ? -1 : opts.lookYawSign
    });
    const pose = Object.create(null);
    for (const part in bindings) {
      const index = bindings[part];
      const degrees = deltas[part];
      if (!degrees) continue;
      pose[index] = {
        rotation: math.Q.fromEuler(math.Q.create(), degrees[0], degrees[1], degrees[2])
      };
    }
    return pose;
  }

  function makeVRMPose(vrm, time, options) {
    const math = getMath();
    const opts = options || {};
    const bindings = opts.bindings || detectVRMBones(vrm);
    const deltas = sampleBlendedDeltas(time, opts.blend, {
      state: opts.state,
      armDown: opts.armDown === undefined ? 0.75 : opts.armDown,
      armAxis: opts.armAxis || 'z',
      look: opts.look,
      lookYawSign: opts.lookYawSign === undefined ? 1 : opts.lookYawSign,
      wave: opts.wave
    });
    const pose = Object.create(null);
    for (const part in bindings) {
      const index = bindings[part];
      const degrees = deltas[part];
      if (!degrees) continue;
      const node = vrm.json.nodes[index];
      const rest = node.rotation || [0, 0, 0, 1];
      const delta = math.Q.fromEuler(math.Q.create(), degrees[0], degrees[1], degrees[2]);
      pose[index] = math.Q.mult(math.Q.create(), rest, delta);
    }
    return pose;
  }

  function makeBlinkWeights(model, time, options) {
    const opts = options || {};
    const morphs = model.morphs || [];
    let index = opts.morphIndex;
    if (index === undefined) {
      for (let i = 0; i < morphs.length; i++) {
        if (matchName(morphs[i].name, MORPH_BLINK) || matchName(morphs[i].nameEn, MORPH_BLINK)) {
          index = i;
          break;
        }
      }
    }
    if (index === undefined) return null;
    const weight = blinkAt(time, opts.period, opts.closeDuration);
    const weights = {};
    weights[index] = weight;
    return { index, weight, weights };
  }

  const api = {
    detectPMXBones,
    detectVRMBones,
    sampleDeltas,
    blendDeltas,
    sampleBlendedDeltas,
    blinkAt,
    makePMXPose,
    makeVRMPose,
    makeBlinkWeights
  };

  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.ProceduralAnimation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

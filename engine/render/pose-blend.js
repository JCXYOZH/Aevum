/**
 * 人形姿态分层混合：下半身沿用基础动作，上半身叠加另一段动作或程序化姿态。
 *
 * 只做局部旋转的替换和插值，不改变骨骼层级。髋部旋转与平移始终来自基础层，
 * 腿、脚、脚趾由基础层负责；脊柱以上到手臂、手指由叠加层负责。
 * 这样走路、跑步可以继续驱动腿脚和落地，上半身独立做挥手、点头或视线。
 *
 * 纯计算，不依赖 WebGL。
 *
 * @module Aevum/render/pose-blend
 */
(function (root) {
  'use strict';

  function getMath() {
    if (root.AEVUM && root.AEVUM.math) return root.AEVUM.math;
    if (typeof require === 'function') return require('../orb/math.js');
    throw new Error('Aevum math core is not loaded');
  }

  const LOWER_BONES = [
    'hips',
    'leftUpperLeg',
    'leftLowerLeg',
    'leftFoot',
    'leftToes',
    'rightUpperLeg',
    'rightLowerLeg',
    'rightFoot',
    'rightToes'
  ];

  function lowerBoneSet(vrm, options) {
    const set = Object.create(null);
    const names = (options && options.lowerBones) || LOWER_BONES;
    for (let i = 0; i < names.length; i += 1) set[names[i]] = true;
    const bones = (vrm && vrm.humanBones) || [];
    const byNode = Object.create(null);
    for (let i = 0; i < bones.length; i += 1) byNode[bones[i].node] = bones[i].bone;
    return function (nodeIndex) {
      return !!set[byNode[nodeIndex]];
    };
  }

  function copyRotation(source, target) {
    if (!source) return;
    for (const key of Object.keys(source)) {
      const q = source[key];
      target[key] = [q[0], q[1], q[2], q[3]];
    }
  }

  function copyTranslation(source, target) {
    if (!source) return;
    for (const key of Object.keys(source)) {
      const v = source[key];
      target[key] = [v[0], v[1], v[2]];
    }
  }

  /**
   * 把上半身姿态叠加到下半身姿态。
   * @param {Object} vrm parseVRM 的结果，用 humanBones 判断节点属于下半身还是上半身
   * @param {Object} lowerPose 基础姿态：{ rotation, translation }
   * @param {Object} upperPose 叠加姿态：{ rotation }
   * @param {Object} options { weight: 0..1, lowerBones: ['hips', ...] }
   * @returns {Object} 新姿态，不修改输入
   */
  function blendHumanoidPose(vrm, lowerPose, upperPose, options) {
    const math = getMath();
    const weight = options && options.weight !== undefined
      ? Math.max(0, Math.min(1, options.weight))
      : 1;
    const pose = { rotation: Object.create(null), translation: Object.create(null) };
    const isLower = lowerBoneSet(vrm, options);

    copyRotation(lowerPose && lowerPose.rotation, pose.rotation);
    copyTranslation(lowerPose && lowerPose.translation, pose.translation);

    if (!upperPose || !upperPose.rotation || weight <= 0) return pose;

    for (const key of Object.keys(upperPose.rotation)) {
      const index = Number(key);
      if (isLower(index)) continue;
      const upper = upperPose.rotation[key];
      const lower = pose.rotation[key];
      if (!lower || weight >= 1) {
        pose.rotation[key] = [upper[0], upper[1], upper[2], upper[3]];
        continue;
      }
      pose.rotation[key] = math.Q.slerp(math.Q.create(), lower, upper, weight);
    }

    // 叠加层没有写到的上半身骨骼回退到模型绑定姿态，避免残留基础动作造成手腕、手指错位。
    if (!options || options.resetUpper !== false) {
      const bones = (vrm && vrm.humanBones) || [];
      for (let i = 0; i < bones.length; i += 1) {
        const node = bones[i].node;
        if (isLower(node)) continue;
        if (upperPose.rotation[node]) continue;
        delete pose.rotation[node];
      }
    }

    return pose;
  }

  const api = { blendHumanoidPose, LOWER_BONES };
  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.PoseBlend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Aevum 指针视线控制器
 *
 * 把归一化的指针位置映射成头部朝向，负责“连续跟随”的平滑和衰减：
 *   - 输入：指针相对视口中心的 x / y，范围 -1（左/上）到 1（右/下）；
 *   - 输出：yaw / pitch 弧度，交给程序化动作叠加到颈、头、胸；
 *   - 指针移开后权重平滑回 0，模型不会瞬间扭头。
 *
 * 本模块只做数学，不读 DOM、不操作骨骼，Node 测试和浏览器 smoke 共用。
 *
 * @module Aevum/render/look-controller
 */
(function (root) {
  'use strict';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * 创建视线控制器。
   *
   * @param {Object} [options]
   * @param {number} [options.maxYaw=0.55] 最大左右转角，弧度
   * @param {number} [options.maxPitch=0.3] 最大上下转角，弧度
   * @param {number} [options.smoothing=0.18] 平滑时间常数，秒；越大越慢
   * @param {number} [options.deadZone=0.08] 中心死区，避免轻微抖动就扭头
   */
  function createLookController(options) {
    const opts = options || {};
    const maxYaw = opts.maxYaw === undefined ? 0.55 : Math.max(0, opts.maxYaw);
    const maxPitch = opts.maxPitch === undefined ? 0.3 : Math.max(0, opts.maxPitch);
    const smoothing = opts.smoothing === undefined ? 0.18 : Math.max(0.001, opts.smoothing);
    const deadZone = opts.deadZone === undefined ? 0.08 : clamp(opts.deadZone, 0, 0.9);

    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let active = false;
    let weight = 0;

    function setPointer(pointerX, pointerY) {
      targetX = clamp(Number(pointerX) || 0, -1, 1);
      targetY = clamp(Number(pointerY) || 0, -1, 1);
      active = true;
      return api;
    }

    function clearPointer() {
      active = false;
      targetX = 0;
      targetY = 0;
      return api;
    }

    /**
     * 推进平滑。
     * @param {number} dt 秒
     */
    function update(dt) {
      const step = Math.max(0, Number(dt) || 0);
      const alpha = step <= 0 ? 0 : 1 - Math.exp(-step / smoothing);
      x += (targetX - x) * alpha;
      y += (targetY - y) * alpha;
      weight += ((active ? 1 : 0) - weight) * alpha;
      if (!active && weight < 0.001) weight = 0;
      return api;
    }

    function applyDeadZone(value) {
      const abs = Math.abs(value);
      if (abs <= deadZone) return 0;
      const scaled = (abs - deadZone) / (1 - deadZone);
      return value < 0 ? -scaled : scaled;
    }

    /**
     * 当前视线快照。yaw 为正表示看向右侧，pitch 为正表示抬头。
     * 调用方按 weight 乘以自身幅度，weight=0 时完全回到原姿态。
     */
    function getLook() {
      const dx = applyDeadZone(x);
      const dy = applyDeadZone(y);
      const yaw = dx * maxYaw * weight;
      const pitch = -dy * maxPitch * weight;
      return {
        yaw: yaw === 0 ? 0 : yaw,
        pitch: pitch === 0 ? 0 : pitch,
        weight,
        active,
        x,
        y,
        targetX,
        targetY
      };
    }

    function reset() {
      targetX = 0;
      targetY = 0;
      x = 0;
      y = 0;
      active = false;
      weight = 0;
      return api;
    }

    const api = {
      setPointer,
      clearPointer,
      update,
      getLook,
      reset,
      get active() { return active; },
      get weight() { return weight; }
    };

    return api;
  }

  const api = { createLookController };

  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.LookController = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

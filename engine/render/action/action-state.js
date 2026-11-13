/**
 * Aevum 人形动作状态机
 *
 * 负责“当前做哪个动作”和“动作之间怎么过渡”，不直接操作骨骼：
 *   - 状态：idle / walk / run / happy / thinking 等，由调用方按模型能力注册；
 *   - 过渡：切换状态时记录 from / to / weight，姿态层按权重混合两套程序化动作；
 *   - 条件：每帧用上下文判断是否满足某条转移，例如 speed > 0.2 进入 walk。
 *
 * 姿态混合由 render/procedural-animation.js 的 sampleBlendedDeltas 完成，
 * 本模块只输出可序列化的状态快照，方便 Node 测试和浏览器渲染共用。
 *
 * @module Aevum/render/action-state
 */
(function (root) {
  'use strict';

  /**
   * 创建一个动作状态机。
   *
   * @param {Object} [options]
   * @param {string} [options.initial='idle'] 初始状态名
   * @param {number} [options.transitionDuration=0.3] 默认过渡时长，单位秒
   * @param {Function} [options.onChange] 状态变化回调 (next, previous, blend)
   */
  function createActionStateMachine(options) {
    const opts = options || {};
    const states = new Map();
    const transitions = [];
    let current = opts.initial || 'idle';
    let previous = null;
    let stateTime = 0;
    let blendDuration = opts.transitionDuration === undefined ? 0.3 : Math.max(0, opts.transitionDuration);
    let blendElapsed = blendDuration;
    let transitionInfo = null;

    function ensureState(name) {
      if (!states.has(name)) {
        throw new Error('action state not registered: ' + name);
      }
    }

    /**
     * 注册状态。config 只保存元信息，不绑定渲染器。
     * @param {string} name
     * @param {Object} [config]
     * @param {number} [config.duration] 自动转移检查前的停留时间，0 表示每帧检查
     */
    function addState(name, config) {
      states.set(name, {
        name,
        duration: config && config.duration ? config.duration : 0
      });
      if (!states.has(current)) current = name;
      return api;
    }

    /**
     * 注册一条状态转移。
     * @param {string} from
     * @param {string} to
     * @param {Function|boolean} condition 接收 update 传入的 context
     * @param {Object} [config]
     * @param {number} [config.duration] 本条转移的过渡时长
     * @param {number} [config.priority] 多个条件同时满足时取最大值
     */
    function addTransition(from, to, condition, config) {
      const cfg = config || {};
      transitions.push({
        from,
        to,
        condition,
        duration: cfg.duration,
        priority: cfg.priority || 0
      });
      return api;
    }

    /**
     * 直接切换状态，不经过条件判断。
     * @param {string} name
     * @param {Object} [config]
     * @param {number} [config.duration] 本次过渡时长
     * @returns {boolean} 是否真的发生了状态变化
     */
    function setState(name, config) {
      ensureState(name);
      if (name === current) return false;
      previous = current;
      current = name;
      stateTime = 0;
      const cfg = config || {};
      blendDuration = cfg.duration === undefined ? opts.transitionDuration : cfg.duration;
      if (blendDuration === undefined) blendDuration = 0.3;
      blendDuration = Math.max(0, blendDuration);
      blendElapsed = 0;
      transitionInfo = { from: previous, to: current, duration: blendDuration };
      if (opts.onChange) opts.onChange(current, previous, getBlend());
      return true;
    }

    function evaluate(context) {
      const state = states.get(current);
      if (state && state.duration > 0 && stateTime < state.duration) return false;
      let best = null;
      for (let i = 0; i < transitions.length; i += 1) {
        const item = transitions[i];
        if (item.from !== current) continue;
        let ok = false;
        try {
          ok = typeof item.condition === 'function' ? !!item.condition(context || {}) : !!item.condition;
        } catch (error) {
          ok = false;
        }
        if (!ok) continue;
        if (!best || item.priority > best.priority) best = item;
      }
      if (!best) return false;
      setState(best.to, { duration: best.duration });
      return true;
    }

    /**
     * 推进状态机。
     * @param {number} dt 秒
     * @param {Object} [context] 条件判断用的上下文，如 { speed: 0.8 }
     */
    function update(dt, context) {
      const step = Math.max(0, Number(dt) || 0);
      stateTime += step;
      if (blendElapsed < blendDuration) {
        blendElapsed = Math.min(blendDuration, blendElapsed + step);
      }
      evaluate(context);
      return api;
    }

    /**
     * 返回当前混合快照。weight=0 是 from，weight=1 是 to。
     * 没发生过渡时 from === to、weight = 1，姿态层会走单状态分支。
     */
    function getBlend() {
      if (!previous || previous === current) {
        return { from: current, to: current, weight: 1 };
      }
      const weight = blendDuration <= 0 ? 1 : Math.min(1, blendElapsed / blendDuration);
      return { from: previous, to: current, weight };
    }

    function getState() {
      return current;
    }

    function getPreviousState() {
      return previous;
    }

    function getStateTime() {
      return stateTime;
    }

    function isTransitioning() {
      return !!previous && previous !== current && blendElapsed < blendDuration;
    }

    function reset(initial) {
      current = initial || opts.initial || 'idle';
      previous = null;
      stateTime = 0;
      blendElapsed = blendDuration;
      transitionInfo = null;
      return api;
    }

    const api = {
      addState,
      addTransition,
      setState,
      update,
      getBlend,
      getState,
      getPreviousState,
      getStateTime,
      isTransitioning,
      reset,
      get transitions() {
        return transitions.slice();
      },
      get states() {
        return Array.from(states.keys());
      },
      get transitionInfo() {
        return transitionInfo;
      }
    };

    return api;
  }

  const api = { createActionStateMachine };

  if (!root.AEVUM) root.AEVUM = {};
  if (!root.AEVUM.render) root.AEVUM.render = {};
  root.AEVUM.render.ActionStateMachine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

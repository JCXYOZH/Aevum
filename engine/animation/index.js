/**
 * Aevum 人形动作系列入口。
 *
 * 八个模块按内容命名，各自保留完整实现：
 * Core、Capture、Chain、CaptureStream、CaptureData、Matcher、JointIK、Procedural。
 */
(function (root) {
  'use strict';

  const hasRequire = typeof require === 'function';
  const api = hasRequire
    ? {
        Core: require('./core/action-core.js'),
        Capture: require('./capture/action-capture.js'),
        Chain: require('./chain/action-chain.js'),
        CaptureStream: require('./capture/action-capture-stream.js'),
        CaptureData: require('./capture/action-capture-data.js'),
        Matcher: require('./matcher/action-matcher.js'),
        JointIK: require('./ik/action-joint-ik.js'),
        Procedural: require('./procedural/procedural-animator.js')
      }
    : {
        Core: root.AEVUM.action.Core,
        Capture: root.AEVUM.action.Capture,
        Chain: root.AEVUM.action.Chain,
        CaptureStream: root.AEVUM.action.CaptureStream,
        CaptureData: root.AEVUM.action.CaptureData,
        Matcher: root.AEVUM.action.Matcher,
        JointIK: root.AEVUM.action.JointIK,
        Procedural: root.AEVUM.action.Procedural
      };

  root.AEVUM = root.AEVUM || {};
  root.AEVUM.action = Object.assign(root.AEVUM.action || {}, api);

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

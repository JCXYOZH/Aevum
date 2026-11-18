/* Character model locations for the desktop scene.
   Change these paths when the cloud host stores models somewhere else.
   Every path is resolved at runtime; the HTML page does not need a rebuild. */
(function (global) {
  "use strict";
  global.AEVUM_MODEL_CONFIG = {
    base: "/engine/assets/models/",
    vrm: {
      directory: "furina",
      filename: "f芙宁娜.vrm"
    },
    pmx: {
      directory: "ganyu",
      filename: "甘雨.pmx"
    },
    live2d: {
      directory: "live2d/xiaoyue",
      filename: "xiaoyue.model3.json"
    },
    actions: "/engine/assets/all_animations.glb"
  };
})(window);

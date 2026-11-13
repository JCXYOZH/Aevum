/**
 * MrHua 3D灵体渲染引擎 - 模块化入口
 * 从 orb-renderer-main.js 拆分而来；后续按功能目录继续拆分。
 *
 * 目录约定：
 * - math/          数学与常量
 * - model/         模型解析与骨骼
 * - animation/     动画、VMD、程序化动作
 * - render/        渲染核心与系统
 * - utils/         工具函数
 * - core/          入口、诊断、导出
 *
 * @module orb-index
 */

'use strict';

(function () {
  // 本文件位于 engine/legacy/orb/core/，模块分布在同级上级目录。
  // 旧加载器可能从不同页面路径引入，这里按脚本自身 URL 推导 orb 根目录，
  // 不再依赖页面地址。
  const BASE = (function () {
    const script = document.currentScript || Array.prototype.slice
      .call(document.getElementsByTagName('script'))
      .filter(function (s) { return /orb-index\.js(?:\?|$)/.test(s.src); })[0];
    if (script && script.src) {
      return script.src.replace(/\/core\/orb-index\.js(?:\?.*)?$/, '/');
    }
    return '../';
  })();

  // 严格按依赖顺序排列。
  const FILES = [
    // 第一层：基础数学（无依赖）
    'math/orb-math.js',
    'math/orb-advanced-math.js',

    // 第二层：模型格式解析器（依赖数学库）
    'model/orb-pmx-parser.js',
    'model/orb-pmd-parser.js',
    'model/orb-tga-decoder.js',

    // 第三层：骨骼与动画系统（依赖解析器输出的数据结构）
    'model/orb-bone-system.js',
    'animation/orb-vmd-parser.js',
    'animation/orb-vmd-player.js',
    'model/orb-morph.js',
    'animation/modules/spline-state.js',
    'animation/modules/cloth-hair-decal.js',
    'animation/modules/dual-quaternion-text.js',
    'animation/modules/imgui-instancing-rendergraph.js',
    'animation/modules/pathtracer-volume-fluid.js',
    'animation/modules/ragdoll-softbody-atlas-lod.js',
    'animation/modules/scene-procedural-geometry.js',
    'animation/modules/ik-shader-curve.js',
    'animation/modules/impostor-occlusion-virtualtexture.js',
    'animation/modules/gpu-particles-morph-profiler.js',
    'animation/modules/asset-import-compression-queue.js',
    'animation/modules/input-behavior-navmesh-runtime.js',

    // 第四层：渲染核心（依赖数学库和骨骼系统）
    'render/orb-renderer-core.js',
    'render/orb-shaders.js',
    'render/orb-model-renderer.js',
    'render/orb-wireframe.js',
    'core/orb-diagnose.js',

    // 第五层：交互与控制（依赖渲染核心）
    'render/orb-orbit-camera.js',
    'render/orb-raycast.js',
    'animation/orb-procedural-animator.js',
    'model/orb-model-loader.js',

    // 第六层：常量、系统与高级能力（依赖前面所有模块）
    'math/constants/lighting-camera.js',
    'math/constants/postprocess-core.js',
    'math/constants/debug-scene.js',
    'math/constants/resources-physics-ik.js',
    'math/constants/particles-geometry-animation.js',
    'math/constants/math-noise-texture.js',
    'math/constants/lod-stats-runtime.js',
    'math/constants/material-shader-targets.js',
    'math/constants/morph-retarget-pipeline.js',
    'math/constants/world-probes-color.js',
    'math/constants/postfx-color-basic.js',
    'math/constants/postfx-spatial.js',
    'math/constants/postfx-tone-curves.js',
    'math/constants/postfx-grade.js',
    'math/constants/postfx-filters-pipeline.js',
    'render/systems/animation-runtime.js',
    'render/systems/deferred-lighting.js',
    'render/systems/quality-performance.js',
    'render/systems/ecs-eventbus.js',
    'render/systems/navigation-ai.js',
    'render/systems/dialogue-save-localization.js',

    // 第七层：工具函数（无依赖，但放在最后避免命名冲突）
    'utils/modules/hash-crypto-network.js',
    'utils/modules/random-input-cache.js',
    'utils/modules/string-array-color-time-object.js',
    'utils/modules/performance-environment.js',
    'utils/modules/dom-storage-file-image.js',
    'utils/modules/keyboard-easing-tween.js',
    'utils/modules/math-clipboard-notification-browser.js',

    // 第八层：导出（必须最后加载）
    'core/orb-export.js'
  ];

  // 按依赖层级分组（同一层无依赖，可并行加载；层间必须按顺序）
  const LAYERS = [
    ['math/orb-math.js', 'math/orb-advanced-math.js'],
    ['model/orb-pmx-parser.js', 'model/orb-pmd-parser.js', 'model/orb-tga-decoder.js'],
    [
      'model/orb-bone-system.js',
      'animation/orb-vmd-parser.js',
      'animation/orb-vmd-player.js',
      'model/orb-morph.js',
      'animation/modules/spline-state.js',
      'animation/modules/cloth-hair-decal.js',
      'animation/modules/dual-quaternion-text.js',
      'animation/modules/imgui-instancing-rendergraph.js',
      'animation/modules/pathtracer-volume-fluid.js',
      'animation/modules/ragdoll-softbody-atlas-lod.js',
      'animation/modules/scene-procedural-geometry.js',
      'animation/modules/ik-shader-curve.js',
      'animation/modules/impostor-occlusion-virtualtexture.js',
      'animation/modules/gpu-particles-morph-profiler.js',
      'animation/modules/asset-import-compression-queue.js',
      'animation/modules/input-behavior-navmesh-runtime.js'
    ],
    ['render/orb-renderer-core.js', 'render/orb-shaders.js', 'render/orb-model-renderer.js', 'render/orb-wireframe.js', 'core/orb-diagnose.js'],
    ['render/orb-orbit-camera.js', 'render/orb-raycast.js', 'animation/orb-procedural-animator.js', 'model/orb-model-loader.js'],
    [
      'math/constants/lighting-camera.js',
      'math/constants/postprocess-core.js',
      'math/constants/debug-scene.js',
      'math/constants/resources-physics-ik.js',
      'math/constants/particles-geometry-animation.js',
      'math/constants/math-noise-texture.js',
      'math/constants/lod-stats-runtime.js',
      'math/constants/material-shader-targets.js',
      'math/constants/morph-retarget-pipeline.js',
      'math/constants/world-probes-color.js',
      'math/constants/postfx-color-basic.js',
      'math/constants/postfx-spatial.js',
      'math/constants/postfx-tone-curves.js',
      'math/constants/postfx-grade.js',
      'math/constants/postfx-filters-pipeline.js',
      'render/systems/animation-runtime.js',
      'render/systems/deferred-lighting.js',
      'render/systems/quality-performance.js',
      'render/systems/ecs-eventbus.js',
      'render/systems/navigation-ai.js',
      'render/systems/dialogue-save-localization.js'
    ],
    [
      'utils/modules/hash-crypto-network.js',
      'utils/modules/random-input-cache.js',
      'utils/modules/string-array-color-time-object.js',
      'utils/modules/performance-environment.js',
      'utils/modules/dom-storage-file-image.js',
      'utils/modules/keyboard-easing-tween.js',
      'utils/modules/math-clipboard-notification-browser.js'
    ],
    ['core/orb-export.js']
  ];

  function loadFile(filename, layerIdx) {
    return new Promise(function (resolve) {
      const script = document.createElement('script');
      script.src = BASE + filename;
      script.async = false;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        errors.push(filename);
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  let loaded = 0;
  const total = FILES.length;
  const errors = [];

  async function loadLayers(callback) {
    for (let layerIdx = 0; layerIdx < LAYERS.length; layerIdx++) {
      const layer = LAYERS[layerIdx];
      const errorsBefore = errors.length;
      await Promise.all(layer.map(function (f) { return loadFile(f, layerIdx); }));
      if (errors.length > errorsBefore) {
        const failedHere = errors.slice(errorsBefore);
        console.warn('[OrbLoader] 第 ' + (layerIdx + 1) + ' 层加载失败，已停止后续层:', failedHere);
        break;
      }
    }
    if (callback) callback({ success: errors.length === 0, loaded: total, total: total, errors: errors });
  }

  function loadAll(callback) {
    loadLayers(callback);
  }

  function getLoadOrder() {
    return FILES.map(function (f) { return BASE + f; });
  }

  function checkLoaded() {
    const checks = {
      math: typeof V3 !== 'undefined' && typeof M4 !== 'undefined',
      pmx: typeof parsePMX !== 'undefined',
      pmd: typeof parsePMD !== 'undefined',
      bone: typeof buildBoneSystem !== 'undefined',
      vmd: typeof parseVMD !== 'undefined' && typeof createVMDPlayer !== 'undefined',
      renderer: typeof createRenderer !== 'undefined',
      animator: typeof createProceduralAnimator !== 'undefined',
      raycast: typeof raycastModel !== 'undefined',
      loader: typeof loadPMXModel !== 'undefined',
      modelRender: typeof renderModel !== 'undefined',
      camera: typeof createOrbitCamera !== 'undefined',
      morph: typeof computeMorphOffsets !== 'undefined',
      shaders: typeof PBRShaders !== 'undefined',
      utils: typeof HashUtils !== 'undefined',
      exported: typeof window !== 'undefined' && typeof window.MrHuaRenderer !== 'undefined'
    };
    const allLoaded = Object.values(checks).every(function (v) { return v; });
    return { allLoaded: allLoaded, modules: checks };
  }

  window.OrbLoader = {
    loadAll: loadAll,
    getLoadOrder: getLoadOrder,
    checkLoaded: checkLoaded,
    FILES: FILES,
    BASE: BASE,
    moduleCount: FILES.length
  };

  console.log('[orb-index] 模块化入口已就绪，共 ' + FILES.length + ' 个模块文件');
  console.log('[orb-index] 调用 OrbLoader.loadAll(callback) 动态加载，或按顺序手动引入');
})();

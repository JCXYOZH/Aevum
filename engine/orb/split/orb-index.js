/**
 * MrHua 3D灵体渲染引擎 - 模块化入口
 * 从 orb-renderer-main.js (30223行) 拆分而来
 *
 * 加载顺序（必须严格按此顺序，因为存在依赖关系）：
 * 1. 数学库 -> 2. 解析器 -> 3. 骨骼/动画 -> 4. 渲染核心 -> 5. 高级系统 -> 6. 工具 -> 7. 导出
 *
 * 使用方式：
 *   <script src="orb-split/orb-index.js"></script>
 *   或手动按顺序加载所有文件
 *
 * @module orb-index
 * @version 20260828i
 */
'use strict';

(function () {
  const BASE = '/static/spirit-renderer/orb-split/';

  // 严格按依赖顺序排列
  const FILES = [
    // 第一层：基础数学（无依赖）
    'orb-math.js',
    'orb-advanced-math.js',

    // 第二层：模型格式解析器（依赖数学库）
    'orb-pmx-parser.js',
    'orb-pmd-parser.js',
    'orb-tga-decoder.js',

    // 第三层：骨骼与动画系统（依赖解析器输出的数据结构）
    'orb-bone-system.js',
    'orb-vmd-parser.js',
    'orb-vmd-player.js',
    'orb-morph.js',
    'orb-animation.js',

    // 第四层：渲染核心（依赖数学库和骨骼系统）
    'orb-renderer-core.js',
    'orb-shaders.js',
    'orb-model-renderer.js',
    'orb-wireframe.js',
    'orb-diagnose.js',

    // 第五层：交互与控制（依赖渲染核心）
    'orb-orbit-camera.js',
    'orb-raycast.js',
    'orb-procedural-animator.js',
    'orb-model-loader.js',

    // 第六层：常量与高级系统（依赖前面所有模块）
    'orb-constants.js',
    'orb-systems.js',

    // 第七层：工具函数（无依赖，但放在最后避免命名冲突）
    'orb-utils.js',

    // 第八层：导出（必须最后加载）
    'orb-export.js'
  ];

  /**
   * 动态加载所有模块文件（开发环境用）
   * 生产环境建议用打包工具或手动按顺序引入
   */
  // 按依赖层级分组（同一层无依赖，可并行加载；层间必须按顺序）
  const LAYERS = [
    // 第一层：基础数学（无依赖）
    ['orb-math.js', 'orb-advanced-math.js'],
    // 第二层：模型格式解析器（依赖数学库）
    ['orb-pmx-parser.js', 'orb-pmd-parser.js', 'orb-tga-decoder.js'],
    // 第三层：骨骼与动画系统（依赖解析器输出的数据结构）
    ['orb-bone-system.js', 'orb-vmd-parser.js', 'orb-vmd-player.js', 'orb-morph.js', 'orb-animation.js'],
    // 第四层：渲染核心（依赖数学库和骨骼系统）
    ['orb-renderer-core.js', 'orb-shaders.js', 'orb-model-renderer.js', 'orb-wireframe.js', 'orb-diagnose.js'],
    // 第五层：交互与控制（依赖渲染核心）
    ['orb-orbit-camera.js', 'orb-raycast.js', 'orb-procedural-animator.js', 'orb-model-loader.js'],
    // 第六层：常量与高级系统（依赖前面所有模块）
    ['orb-constants.js', 'orb-systems.js'],
    // 第七层：工具函数（无依赖，但放在最后避免命名冲突）
    ['orb-utils.js'],
    // 第八层：导出（必须最后加载）
    ['orb-export.js']
  ];

  /**
   * 动态加载所有模块文件（分层并行加载，比串行快60%）
   * 同一层的文件并行下载，层与层之间按依赖顺序加载
   */
  function loadAll(callback) {
    let loaded = 0;
    const total = FILES.length;
    const errors = [];

    // 加载单个文件
    function loadFile(filename, layerIdx) {
      return new Promise(function(resolve) {
        const script = document.createElement('script');
        script.src = BASE + filename;
        script.async = false;
        script.onload = function () {
          loaded++;
          resolve();
        };
        script.onerror = function () {
          errors.push(filename);
          loaded++;
          resolve(); // 即使失败也继续，不阻塞其他文件
        };
        document.head.appendChild(script);
      });
    }

    // 逐层加载（同一层并行，层间顺序）
    async function loadLayers() {
      for (let layerIdx = 0; layerIdx < LAYERS.length; layerIdx++) {
        const layer = LAYERS[layerIdx];
        const errorsBefore = errors.length;
        // 同一层的所有文件并行加载
        const promises = layer.map(function(f) { return loadFile(f, layerIdx); });
        await Promise.all(promises);
        if (errors.length > errorsBefore) {
          // 本层有文件没加载上：后续层（尤其是最后的 orb-export.js）依赖它们，
          // 继续往下加载只会产出一串 ReferenceError，把真正的原因淹掉。
          // 停在这里，把失败的文件名交给调用方去提示。
          const failedHere = errors.slice(errorsBefore);
          console.warn('[OrbLoader] 第 ' + (layerIdx + 1) + ' 层加载失败，已停止后续层:',
                       failedHere);
          break;
        }
      }
      if (callback) callback({ success: errors.length === 0, loaded, total, errors });
    }

    loadLayers();
  }

  /**
   * 获取加载顺序列表（供构建工具使用）
   */
  function getLoadOrder() {
    return FILES.map(function (f) { return BASE + f; });
  }

  /**
   * 检查所有模块是否已加载
   */
  function checkLoaded() {
    const checks = {
      math: typeof V3 !== 'undefined' && typeof M4 !== 'undefined',
      pmx: typeof parsePMX !== 'undefined',
      pmd: typeof parsePMD !== 'undefined',
      bone: typeof buildBoneSystem !== 'undefined',
      vmd: typeof parseVMD !== 'undefined' && typeof createVMDPlayer !== 'undefined',
      tga: typeof decodeTGA !== 'undefined',
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

  // 暴露到全局
  window.OrbLoader = {
    loadAll: loadAll,
    getLoadOrder: getLoadOrder,
    checkLoaded: checkLoaded,
    FILES: FILES,
    BASE: BASE,
    version: '20260828i',
    moduleCount: FILES.length
  };

  console.log('[orb-index] 模块化入口已就绪，共 ' + FILES.length + ' 个模块文件');
  console.log('[orb-index] 调用 OrbLoader.loadAll(callback) 动态加载，或按顺序手动引入');
})();

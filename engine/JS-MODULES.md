# Aevum 引擎 JS 模块清单

范围：`D:\Aevum\engine` 下除 `assets/` 外的 164 个 `.js` 文件（含 `vendor/` 官方运行时）。  
分类口径不是“当前页面有没有加载”，而是模块本身属于哪一层：

- **引擎能力**：数学、图形、格式解析、加载、动画、渲染、角色、地形、天气、水体、LOD、世界管线、旧 Orb 实现。
- **验证工具**：只服务本地 `validate.html` 的页面脚本。
- **测试**：只服务自动测试。
- **官方运行时**：第三方 Live2D Cubism Core，不属于自研代码。

原先放在 `engine/` 的 UI 外壳、Orb 交互、皮肤业务、世界演示、对话枢纽已移到 `interface/console/`，不再计入引擎模块。

## 1. 总数

| 类别 | 文件数 | 说明 |
|---|---:|---|
| 引擎能力 | 160 | `engine` 根目录下全部模块，包括旧 Orb 与当前未接入验证页的地形、天气、水体、LOD、世界管线 |
| 验证工具 | 1 | `app/validate/validate.js` |
| 测试 | 2 | `tests/action-boundary.test.js`、`tests/action-contract.test.js` |
| 官方运行时 | 1 | `vendor/live2dcubismcore.min.js` |
| 合计 | 164 | 不含 `assets/` |

`validate.html` 当前直接加载 23 个脚本，只覆盖实际运行链；没有加载不等于不是引擎。

引擎侧当前最大单文件为 1,563 行（`character/skin/skin-system.js`）。原先 5 个超大合集已按功能拆分，原文件已移除。

## 2. 目录与文件

### 2.1 `app/validate/`（验证工具，1 个）

| 文件 | 行数 | 作用 |
|---|---:|---|
| `validate.js` | 1,025 | 读取 YAML 清单、格式筛选、模型/动作/情绪选择、分组渲染开关、Live2D 交互、模块分类覆盖 |

### 2.2 `math/`（1 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `math.js` | 500 | `V3`、`M4`、四元数、矩阵组合、投影与相机基础运算 |

### 2.3 `core/`（11 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `index.js` | 575 | 引擎启动、事件总线、模块管理、配置管理 |
| `loop/render-loop.js` | 739 | 更新/渲染/后渲染回调、资源管线 |
| `loop/renderer-integration.js` | 441 | 渲染器接入层 |
| `ecs/scene-ecs.js` | 779 | Entity、组件、World、层级变换 |
| `ecs/entity-events.js` | 665 | 实体事件与事件总线 |
| `resources/resource-pipeline.js` | 817 | 异步资源加载、缓存、队列、并发控制 |
| `resources/memory-budget.js` | 426 | GPU/CPU 内存预算、纹理/缓冲追踪 |
| `resources/object-pools.js` | 772 | 对象池、热路径缓存 |
| `scheduling/task-scheduler.js` | 354 | 分帧任务、优先级、延迟执行 |
| `diagnostics/performance-monitor.js` | 732 | 帧时间、历史采样、性能统计 |
| `toolkit/core-toolkit.js` | 1,235 | 数学、字符串、数组、对象、颜色、时间工具 |

### 2.4 `graphics/`（14 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `core/gl-core/index.js` | 22 | `gl-core` 统一出口 |
| `core/gl-core/math.js` | 698 | 图形层矩阵、向量、包围体 |
| `core/gl-core/skeleton.js` | 709 | 骨骼纹理、蒙皮矩阵上传 |
| `core/gl-core/animation.js` | 866 | 动画采样与骨骼更新适配 |
| `core/gl-core/physics.js` | 705 | 物理/碰撞的 GPU 数据组织 |
| `core/gl-core/interaction.js` | 639 | 拾取、射线、交互状态 |
| `core/gl-core/behavior.js` | 545 | 行为/状态驱动 |
| `core/gl-core/pbr.js` | 491 | PBR 材质与光照参数 |
| `core/gl-core/post.js` | 565 | 后处理链图形侧封装 |
| `core/gl-core/shader.js` | 644 | 着色器源码、uniform/attribute 装配 |
| `extensions/gl-extensions.js` | 1,182 | WebGL 扩展检测与能力封装 |
| `shaders/shader-geometry.js` | 688 | 几何装配/网格生成（唯一几何 owner） |
| `textures/texture-buffer-pipeline.js` | 649 | 纹理、顶点/索引缓冲与 FBO（唯一 render pipeline owner） |
| `post/gl-compute-post.js` | 574 | 计算式后处理与后处理链 |

职责归并说明：`shader-pipeline.js`（V4）与 `shader-geometry-gpu.js`（V6）的类/方法集与 `shader-geometry.js`（V2）一致，已删除；`targets/render-targets.js`（V3）的 `RenderPipeline / TextureManager / BufferManager` 与 `textures/texture-buffer-pipeline.js`（V5）同职责，V5 额外提供 `FramebufferManager`，因此保留 V5 作为唯一 render pipeline owner。

`core/gl-core/` 由原 5,884 行 `gl-core.js` 按功能拆分而来，共 10 个文件（9 个实现文件 + `index.js` 出口），拼接后与原文一致，全部通过 `node --check`。

### 2.5 `formats/`（8 个，纯解析）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `gltf/glb.js` | 89 | GLB 容器拆 JSON chunk 与二进制 chunk |
| `gltf/gltf-accessor.js` | 85 | glTF accessor 读取与类型转换 |
| `gltf/gltf-animation.js` | 214 | glTF 动画采样与播放器 |
| `vrm/vrm.js` | 76 | VRM/GLB 人形骨骼与元数据解析 |
| `pmx/pmx.js` | 642 | PMX 网格、材质、骨骼、Morph 解析 |
| `vmd/vmd.js` | 178 | VMD 动作关键帧解析 |
| `texture/tga.js` | 110 | TGA 贴图解码 |
| `live2d/live2d-motion.js` | 143 | motion3.json 曲线解析与参数采样 |

解析层不做 GPU 调用，也不做动作混合；输入文件字节，输出普通对象和 TypedArray。

### 2.6 `loaders/`（9 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `animation-mesh.js` | 593 | 网格、蒙皮、动画数据组织 |
| `fbx/fbx-vrm-formats.js` | 1,033 | FBX/VRM 格式适配 |
| `gltf/gltf-loader.js` | 763 | glTF 模型加载 |
| `gltf/gltf-obj-vmd-loaders.js` | 747 | glTF/OBJ/VMD 加载适配 |
| `pmx/pmx-parser.js` | 540 | PMX 解析封装 |
| `registry/loader-registry.js` | 400 | 加载器注册表与格式分派 |
| `registry/loader-convert-cache.js` | 760 | 加载器转换结果缓存 |
| `retarget/retarget-compress.js` | 800 | 重定向数据压缩 |
| `retarget/retarget-lod.js` | 690 | 重定向 LOD |

`formats/` 只解析，`loaders/` 负责接入资源与缓存，两者不混用。

### 2.7 `animation/`（9 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `index.js` | 34 | 模块聚合与 Node 测试入口 |
| `core/action-core.js` | 798 | 动作状态机、状态、过渡、条件、优先级 |
| `capture/action-capture.js` | 783 | 从当前姿态捕捉动作片段 |
| `capture/action-capture-stream.js` | 718 | 流式捕捉输入 |
| `capture/action-capture-data.js` | 913 | 捕捉数据整理与重放 |
| `chain/action-chain.js` | 509 | 多段动作串联与衔接 |
| `matcher/action-matcher.js` | 521 | 动作匹配与选择 |
| `ik/action-joint-ik.js` | 453 | 关节 IK 求解 |
| `procedural/procedural-animator.js` | 732 | 程序化动作生成 |

### 2.8 `render/`（11 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `pmx/webgl-renderer.js` | 807 | PMX 的 WebGL2 蒙皮渲染器 |
| `vrm/vrm-renderer.js` | 472 | VRM/glTF 蒙皮渲染器 |
| `live2d/live2d-renderer.js` | 1,219 | Live2D Cubism 渲染器 |
| `retarget/animation-retarget.js` | 465 | Mixamo 人形动作 → VRM Humanoid 重定向 |
| `vmd/vmd-player.js` | 87 | VMD 时间轴推进与循环 |
| `vmd/vmd-pose.js` | 62 | VMD 采样转 PMX 骨骼姿态 |
| `blend/pose-blend.js` | 101 | 多姿态按骨骼分区融合 |
| `action/action-state.js` | 188 | 动作状态与过渡轻量封装 |
| `procedural/procedural-animation.js` | 368 | 程序化待机、呼吸、摆动 |
| `morph/pmx-morph.js` | 151 | PMX Morph 权重应用 |
| `look/look-controller.js` | 115 | 视线/头部朝向控制 |

### 2.9 `character/`（13 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `live2d/live2d-bridge.js` | 1,107 | Live2D 模型与渲染桥接 |
| `skin/skin-system.js` | 1,563 | 皮肤系统装配 |
| `skin/skin-material.js` | 838 | 皮肤材质 |
| `skin/skin-texture.js` | 851 | 皮肤纹理 |
| `skin/skin-physics.js` | 704 | 皮肤物理 |
| `skin/skin-physics-makeup.js` | 687 | 物理与妆容 |
| `skin/skin-humidity.js` | 667 | 湿度表现 |
| `deferred/render-pipeline.js` | 1,100 | 延迟渲染管线 |
| `deferred/deferred-queue.js` | 776 | 延迟渲染队列 |
| `deferred/deferred-gi.js` | 641 | 延迟 GI |
| `deferred/deferred-hair-cloth.js` | 725 | 头发/布料 |
| `deferred/deferred-particles.js` | 944 | 粒子 |
| `deferred/material-extensions.js` | 1,193 | 材质扩展 |

### 2.10 `world/`（2 个）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `pipeline/world-pipeline.js` | 998 | 世界渲染管线与阶段编排 |
| `advanced/world-advanced.js` | 423 | 体积雾与高级水 |

地形、天气、水体、LOD、世界管线属于引擎能力，不因为 `validate.html` 没有加载就判定为非引擎。旧 `terrain/` 下的 5 个平行实现已删除，避免同一职责多套代码。

### 2.11 `legacy/orb/`（74 个，旧 Orb 引擎）

| 目录 | 文件数 | 行数 | 说明 |
|---|---:|---:|---|
| `core/` | 3 | 571 | `orb-index` 加载器、诊断、导出 |
| `math/` | 2 | 1,503 | 旧数学库 |
| `math/constants/` | 15 | 7,793 | 由原 `orb-constants.js` 拆分 |
| `model/` | 6 | 1,994 | PMX/PMD/TGA、骨骼、Morph、模型加载 |
| `animation/` | 3 | 703 | VMD 解析/播放、程序化动作 |
| `animation/modules/` | 12 | 6,707 | 由原 `orb-animation.js` 拆分 |
| `render/` | 6 | 2,282 | 渲染核心、着色器、模型、相机、线框 |
| `render/systems/` | 6 | 3,193 | 由原 `orb-systems.js` 拆分 |
| `utils/modules/` | 7 | 4,279 | 由原 `orb-utils.js` 拆分 |
| `extensions/` | 14 | 14,565 | 旧 Orb 扩展能力（样条、文本、流体、ECS、PBR 等） |

`legacy/orb/` 是与当前 `formats`、`render` 并行的旧实现，保留用于对照和兼容，不是业务代码。

拆分目录：

| 原合集 | 拆分目录 | 文件数 |
|---|---|---:|
| `gl-core.js` | `graphics/core/gl-core/` | 10（含 index） |
| `orb-constants.js` | `legacy/orb/math/constants/` | 15 |
| `orb-animation.js` | `legacy/orb/animation/modules/` | 12 |
| `orb-utils.js` | `legacy/orb/utils/modules/` | 7 |
| `orb-systems.js` | `legacy/orb/render/systems/` | 6 |

拆分文件按原顺序拼接后与原文逐字符一致；全部通过 `node --check`。原合集已移除，避免双份实现。

### 2.12 契约、测试与 `vendor/`

| 文件 | 行数 | 说明 |
|---|---:|---|
| `contracts/action-contract.js` | 68 | 动作字段所有权、冲突码与越界钳制；验证脚本已清理，不入库 |
| `vendor/live2dcubismcore.min.js` | 9 | Live2D Cubism Core 官方运行时，不提交修改 |

## 3. 非引擎应用代码（已移出 `engine/`）

`interface/console/` 下的 5 个单闭包应用文件不在引擎统计内：

| 文件 | 行数 | 业务逻辑 |
|---|---:|---|
| `shell/app-shell.js` | 23,332 | MrHua 通用前端外壳：`mrReport` 结果卡片、fetch 终端记录、`/api/media/local` 媒体预览、复制/下载、页签联动 |
| `skin/skin-app.js` | 5,863 | 灵体皮肤业务：blob、自定义 SVG、上传 SVG、导入 Live2D，按用户身份保存皮肤档案 |
| `world/world-app.js` | 3,326 | 全屏 3D 世界演示：DOM 窗口浮在 Three.js 场景上，GLB 模型在屏幕空间移动 |
| `orb/orb-ui.js` | 2,354 | Orb 交互枢纽：光球、波形、粒子、拖拽提示、聊天窗口联动 |
| `dialogue/interaction-hub.js` | 1,007 | 统一输入输出枢纽：文本、语音、动作、界面事件 |

另有 `dialogue/` 的对话、情绪、记忆、语音模块，以及 `tools/` 的剪贴板、DOM、键盘快捷键工具，均属于应用层。

这些文件仍是单闭包，内部共享大量 DOM 引用与状态变量；要拆成功能文件必须做闭包重构，不能按行号机械切断。它们不影响 `validate.html` 与引擎运行。

## 4. 运行链与加载顺序

`validate.html` 只加载 23 个脚本：

```text
math/math.js
formats/gltf/glb.js
formats/gltf/gltf-accessor.js
formats/gltf/gltf-animation.js
formats/vrm/vrm.js
formats/pmx/pmx.js
formats/texture/tga.js
vendor/live2dcubismcore.min.js
formats/live2d/live2d-motion.js
render/vrm/vrm-renderer.js
render/pmx/webgl-renderer.js
render/live2d/live2d-renderer.js
render/retarget/animation-retarget.js
animation/core/action-core.js
animation/capture/action-capture.js
animation/chain/action-chain.js
animation/capture/action-capture-stream.js
animation/capture/action-capture-data.js
animation/matcher/action-matcher.js
animation/ik/action-joint-ik.js
animation/procedural/procedural-animator.js
animation/index.js
app/validate/validate.js
```

这些是经典脚本，通过 `window.AEVUM` 组装；没有打包器。新增脚本必须同时更新 `validate.html` 顺序与 `animation/index.js` 的 `require` 路径。

`legacy/orb/core/orb-index.js` 是旧 Orb 加载器，按 `FILES` / `LAYERS` 顺序加载 `../math`、`../model`、`../animation`、`../render`、`../utils` 下的拆分文件；它不参与 `validate.html`。

## 5. 分类结论

- **引擎**：`engine` 根目录下全部 160 个文件，含地形、天气、水体、LOD、世界管线、`legacy/orb` 旧实现。
- **验证工具**：`app/validate/validate.js`。
- **测试**：`tests/` 2 个。
- **官方运行时**：`vendor/live2dcubismcore.min.js`。
- **非引擎应用**：`interface/console/` 的 shell、orb、skin、world、dialogue、tools。

判定依据是模块职责与依赖链，不是 `validate.html` 是否加载。

# Aevum 渲染引擎架构

本文面向第一次接触仓库的参与者，说明 `engine/` 的分层、模块职责、运行入口和数据流。按本文启动本地服务后，可以直接打开 `validate.html` 观察 VRM / PMX / Live2D 效果，不需要先读源码。

逐文件清单与“引擎 / 应用 / 工具”分类见 [`JS-MODULES.md`](JS-MODULES.md)。

## 1. 定位

Aevum 是一个独立的 WebGL 角色渲染引擎，支持三类角色资产：

- **VRM / glTF 人形**：骨骼蒙皮、Humanoid、动作采样与动作重定向。
- **PMX / MMD**：PMX 网格与材质、VMD 动作、Morph、卡通着色、球面贴图、描边。
- **Live2D Cubism**：moc3 模型、纹理、参数、drawable、motion3 动作。

三种格式共用数学、资源加载和渲染循环约定，但各自保留格式解析与 GPU 管线，不把一种格式强行转换成另一种。

`engine/` 只保留引擎与验证入口。MrHua 的通用 UI 外壳、Orb 交互、皮肤业务、世界演示、对话枢纽已移到 `interface/console/`，不再计入引擎模块。

## 2. 本地运行

在仓库根目录启动静态服务：

```powershell
python -m http.server 8766 --directory D:\Aevum
```

然后打开：

```text
http://127.0.0.1:8766/engine/validate.html
```

必须通过 HTTP 打开，不要直接双击 HTML；模型和动作都通过 `fetch` 读取，`file://` 会被浏览器拦截。

### 2.1 页面参数

| 参数 | 含义 |
| --- | --- |
| `model` | 模型清单里的路径，例如 `assets/model.vrm` |
| `action` | `idle` / `walk` / `run` / `greet` |
| `flip` | `1` 时翻转 PMX 贴图 UV 的 Y 方向 |
| `catalog` | 另一份模型清单的相对 URL，默认 `models.yaml` |

示例：

```text
/engine/validate.html?catalog=assets/models.local.yaml
/engine/validate.html?catalog=assets/models.local.yaml&model=assets/models/ganyu/%E7%94%98%E9%9B%A8.pmx
```

模型路径只出现在清单里，页面和 JS 不写死具体模型。

## 3. 目录总览

```text
engine/
├─ validate.html              唯一运行入口
├─ models.yaml                对外演示清单（只写相对路径）
├─ ARCHITECTURE.md            本文
├─ JS-MODULES.md              逐目录模块清单
├─ app/
│  └─ validate/               验证页业务脚本
├─ math/                      向量、矩阵、四元数
├─ core/                      ECS、循环、资源、调度、诊断、工具
├─ graphics/                  WebGL 上下文、扩展、着色器、纹理、FBO、后处理
├─ formats/                   GLB / glTF / VRM / PMX / VMD / TGA / motion3 解析
├─ loaders/                   加载器注册、格式适配、重定向压缩/LOD
├─ animation/                 动作状态机、捕捉、串联、匹配、IK、程序化动作
├─ render/                    VRM / PMX / Live2D / VMD / Morph / 视线 / 融合渲染
├─ character/                 Live2D 桥接、皮肤材质、延迟渲染扩展
├─ world/                     地形、天气、水体、植被、LOD、世界管线
├─ legacy/orb/                旧 Orb 引擎与拆分模块（并行实现，按需加载）
├─ vendor/                    Live2D Cubism Core 官方运行时
└─ tests/                     动作边界与契约测试
```

应用业务代码不再放在 `engine/`：

```text
interface/console/
├─ shell/                     MrHua 通用 UI 外壳、结果卡片、媒体预览
├─ orb/                       Orb 交互枢纽 UI
├─ skin/                      皮肤定制业务
├─ world/                     全屏世界演示应用
├─ dialogue/                  对话、情绪、记忆、语音枢纽
└─ tools/                     剪贴板、DOM、键盘快捷键工具
```

## 4. `validate.html` 的运行链

页面只加载完成验证所需的脚本，顺序如下（与 `validate.html` 中的 `script` 顺序一致）：

1. `math/math.js`
2. `formats/gltf/glb.js`、`gltf-accessor.js`、`gltf-animation.js`
3. `formats/vrm/vrm.js`
4. `formats/pmx/pmx.js`
5. `formats/texture/tga.js`
6. `vendor/live2dcubismcore.min.js`
7. `formats/live2d/live2d-motion.js`
8. `render/vrm/vrm-renderer.js`
9. `render/pmx/webgl-renderer.js`
10. `render/live2d/live2d-renderer.js`
11. `render/retarget/animation-retarget.js`
12. `animation/core/action-core.js`
13. `animation/capture/action-capture.js`
14. `animation/chain/action-chain.js`
15. `animation/capture/action-capture-stream.js`
16. `animation/capture/action-capture-data.js`
17. `animation/matcher/action-matcher.js`
18. `animation/ik/action-joint-ik.js`
19. `animation/procedural/procedural-animator.js`
20. `animation/index.js`
21. `app/validate/validate.js`

这些脚本是经典脚本，通过全局命名空间 `window.AEVUM` 组装；没有打包器。新增脚本必须同时更新 `validate.html` 的顺序和 `animation/index.js` 的 `require` 路径（如果该模块被 Node 测试引用）。

## 5. 模块分层

### 5.1 `math/`

| 文件 | 职责 |
| --- | --- |
| `math.js` | `V3`、`M4`、四元数、矩阵组合、投影与相机基础运算 |

### 5.2 `formats/`：只负责解析与采样

| 目录 / 文件 | 职责 |
| --- | --- |
| `gltf/glb.js` | 解析 GLB 容器，拆出 JSON chunk 与二进制 chunk |
| `gltf/gltf-accessor.js` | 读取 glTF accessor，统一成 TypedArray |
| `gltf/gltf-animation.js` | 解析 glTF animation，提供 `createPlayer`、clip 切换、循环、按时间取姿态 |
| `vrm/vrm.js` | 解析 VRM 0.x / 1.0 Humanoid，输出 `humanBones` 与节点映射 |
| `pmx/pmx.js` | 解析 PMX 顶点、面、材质、骨骼、Morph、刚体、显示框 |
| `vmd/vmd.js` | 解析 VMD 骨骼关键帧与 Morph 关键帧 |
| `texture/tga.js` | 解析 TGA 贴图，供 PMX 材质使用 |
| `live2d/live2d-motion.js` | 解析 motion3.json 曲线，按时间求参数值 |

解析层不做 GPU 调用，也不做动作混合；输入是文件字节，输出是普通对象和 TypedArray。

### 5.3 `render/`：把数据变成画面

| 目录 / 文件 | 职责 |
| --- | --- |
| `pmx/webgl-renderer.js` | PMX 的 WebGL2 蒙皮渲染器：顶点缓冲、骨骼纹理、材质、toon、sphere、outline、线框、Morph |
| `vrm/vrm-renderer.js` | VRM/glTF 蒙皮渲染器：节点世界矩阵、skin、贴图、相机、地面网格 |
| `live2d/live2d-renderer.js` | Live2D Cubism 渲染器：moc3、drawable、参数、纹理、motion3、表情与动作 |
| `retarget/animation-retarget.js` | Mixamo 人形动作 → VRM Humanoid 的重定向，输出目标骨骼局部旋转与髋部位移 |
| `vmd/vmd-player.js` | VMD 时间轴推进与循环 |
| `vmd/vmd-pose.js` | VMD 采样结果转换成 PMX 骨骼姿态 |
| `blend/pose-blend.js` | 多姿态按骨骼分区融合 |
| `action/action-state.js` | 动作状态与过渡的轻量封装 |
| `procedural/procedural-animation.js` | 程序化待机、呼吸、摆动等附加动作 |
| `morph/pmx-morph.js` | PMX Morph 权重应用 |
| `look/look-controller.js` | 视线/头部朝向控制 |

### 5.4 `animation/`：人形动作系列

| 目录 / 文件 | 职责 |
| --- | --- |
| `core/action-core.js` | 动作状态机、状态、过渡、条件、优先级 |
| `capture/action-capture.js` | 从当前姿态捕捉动作片段 |
| `chain/action-chain.js` | 多段动作串联与衔接 |
| `capture/action-capture-stream.js` | 流式捕捉输入 |
| `capture/action-capture-data.js` | 捕捉数据整理与重放 |
| `matcher/action-matcher.js` | 动作匹配与选择 |
| `ik/action-joint-ik.js` | 关节 IK 求解 |
| `procedural/procedural-animator.js` | 程序化动作生成 |
| `index.js` | 模块聚合与 Node 测试入口 |

`validate.html` 的动作链是：glTF clip 采样 → `AnimationRetarget.retargetPose` → `VRMRenderer.render`；状态切换由 `ActionStateMachine` 管理。

### 5.5 `core/`：应用级基础设施

| 目录 / 文件 | 职责 |
| --- | --- |
| `index.js` | 引擎启动、事件总线、模块管理、配置管理 |
| `loop/render-loop.js` | 更新/渲染/后渲染回调、资源管线 |
| `loop/renderer-integration.js` | 渲染器接入层 |
| `ecs/scene-ecs.js` | Entity、组件、World、层级变换 |
| `ecs/entity-events.js` | 实体事件与事件总线 |
| `resources/resource-pipeline.js` | 异步资源加载、缓存、场景管理 |
| `resources/memory-budget.js` | 内存预算与回收阈值 |
| `resources/object-pools.js` | 对象池 |
| `scheduling/task-scheduler.js` | 分帧任务调度 |
| `diagnostics/performance-monitor.js` | 帧时间与性能统计 |
| `toolkit/core-toolkit.js` | 数学、字符串、数组、对象、颜色、时间等基础工具 |

`core/` 不依赖 `validate.html`；它供更大的应用组装使用。

### 5.6 `graphics/`：当前 world/desktop 的实际图形依赖

`engine/graphics` 是唯一图形模块 owner。world/desktop 不再保留与之等价的 inline 实现：

| 文件 | 唯一职责 | 实际调用点 |
| --- | --- | --- |
| `core/gl-core/math.js` | `OrbMath` 向量与矩阵 | `world-vegetation.js` `normalize3()` |
| `core/gl-core/shader.js` | `OrbShader.ShaderManager` | `world-context.js` `program()` |
| `core/gl-core/post.js` | `OrbPost.RenderTarget` | `world-shaders.js` `createSceneTarget()` 的 post FBO |
| `shaders/shader-geometry.js` | V2 `GeometryProcessor` / `PipelineState` | `world-shaders.js` `makeSkySphere()` |
| `textures/texture-buffer-pipeline.js` | V5 `BufferManager` / `FramebufferManager` / `TextureManager` / `RenderPipeline` | `world-context.js` `managedBuffer()`；`world-shaders.js` scene/shadow FBO、depth 纹理、FXAA pass |
| `extensions/gl-extensions.js` | `GeometryGenerator` 等 | `world-shaders.js` `makeSkySphere()` 球体生成 |
| `core/gl-core/pbr.js` | `PBRMaterial` / `DirectionalLight` / `Light` | `world-pipeline.js` `LightSystem` 的方向光与环境光 |
| `core/gl-core/behavior.js` | `BehaviorTree` / `Action` | `world-runtime.js` `spawnBirds()` 的鸟群巡航 |
| `core/gl-core/skeleton.js` | `Skeleton` / `Bone` | `world-runtime.js` 角色呼吸骨架 |
| `core/gl-core/animation.js` | `ProceduralMotion` / `BreathingMotion` | `world-runtime.js` 角色呼吸层 |
| `core/gl-core/physics.js` | `Particle` / Verlet | `world-runtime.js` 萤火虫运动 |
| `core/gl-core/interaction.js` | `Picker` / `Pickable` | `world-runtime.js` `initBirdPicker()` 鼠标拾取鸟群 |
| `post/gl-compute-post.js` | `ComputeSimulator` | `world-runtime.js` `initGrassWindCompute()` / `updateGrassWind()`：每帧 transform feedback 生成 64 个风场偏移，作为 `GrassWind` UBO 供草顶点着色器读取 |
| `core/gl-core/index.js` | `OrbWebGLCore` 入口 | 页面加载，供以上模块统一命名空间 |

world 源码中已无 `gl.createBuffer()`、`gl.createFramebuffer()`、`gl.createProgram()`；bundle 由 `world-context.js`、`world-shaders.js`、`world-terrain.js`、`world-vegetation.js`、`world-runtime.js` 顺序拼接生成。14 个 graphics 文件均有真实调用点；草摆动唯一实现位于 `world-runtime.js` 的 `ComputeSimulator` 风场，`world-shaders.js` 草顶点着色器只读取 `GrassWind` UBO，不再保留 inline `sin(uTime...)` 等价实现。

### 5.7 `loaders/`：模型加载与适配

| 目录 / 文件 | 职责 |
| --- | --- |
| `registry/loader-registry.js` | 按扩展名选择加载器，统一缓存、重试、批量加载 |
| `registry/loader-convert-cache.js` | 转换结果缓存 |
| `gltf/gltf-loader.js` | glTF/GLB 加载与 accessor 构建 |
| `gltf/gltf-obj-vmd-loaders.js` | glTF、OBJ、VMD 的加载适配 |
| `fbx/fbx-vrm-formats.js` | FBX / VRM 格式适配 |
| `pmx/pmx-parser.js` | PMX 解析封装 |
| `animation-mesh.js` | 动画网格数据 |
| `retarget/retarget-compress.js` | 重定向数据压缩 |
| `retarget/retarget-lod.js` | 重定向 LOD |

`formats/` 是纯解析，`loaders/` 负责把解析结果接入资源与缓存；两者不要混用。

### 5.8 `character/` 与 `world/`

- `character/live2d/`：Live2D 模型与渲染桥接。
- `character/skin/`：皮肤材质、纹理、物理、妆容、湿度。
- `character/deferred/`：延迟渲染队列、GI、头发/布料、粒子、材质扩展。
- `world/terrain/`：地形、LOD、天气、水体、植被、大气。
- `world/pipeline/`：世界渲染管线与阶段编排。
- `world/advanced/`：世界高级能力与实验实现。

地形、天气、水体、LOD、世界管线属于引擎能力，不因为 `validate.html` 没有加载就判定为非引擎。

### 5.9 `legacy/orb/`：旧 Orb 引擎

`legacy/orb/` 是与现有 `formats`、`render` 并行的旧实现，保留用于对照和兼容，不是业务代码。

原先的 5 个合集文件已按功能拆分：

| 原文件 | 拆分目录 | 文件数 |
| --- | --- | ---: |
| `graphics/core/gl-core.js` | `graphics/core/gl-core/` | 10 |
| `math/orb-constants.js` | `math/constants/` | 15 |
| `animation/orb-animation.js` | `animation/modules/` | 12 |
| `utils/orb-utils.js` | `utils/modules/` | 7 |
| `render/orb-systems.js` | `render/systems/` | 6 |

拆分文件按原文件顺序拼接后与原文逐字符一致，全部通过 `node --check`。旧合集文件已移除，避免同一实现出现两份。

`legacy/orb/core/orb-index.js` 是旧模块加载器，按分层顺序加载拆分后的文件；`BASE` 由脚本自身 URL 推导到 `legacy/orb/` 根目录，不再依赖页面路径。它只服务旧 Orb 链，不是 `validate.html` 的入口。

### 5.10 `interface/console/`：非引擎 UI

这些文件不属于渲染引擎，已移出 `engine/`：

| 目录 | 业务 |
| --- | --- |
| `shell/` | MrHua 通用前端外壳：`mrReport` 结果卡片、fetch 终端记录、`/api/media/local` 媒体预览、复制/下载、页签联动 |
| `orb/` | Orb 交互枢纽：光球、波形、粒子、拖拽提示、聊天窗口联动 |
| `skin/` | 灵体皮肤业务：blob、自定义 SVG、上传 SVG、导入 Live2D、按用户身份保存皮肤档案 |
| `world/` | 全屏 3D 世界演示：DOM 窗口浮在 Three.js 场景上，GLB 模型在屏幕空间移动 |
| `dialogue/` | 对话、情绪、记忆、语音、交互枢纽 |
| `tools/` | 剪贴板、DOM、键盘快捷键工具 |

这些单闭包应用文件仍保持整包结构，不再放回 `engine/`。若后续要继续拆成功能文件，应按应用重构单独提交，不能按行号机械切断。

## 6. 数据流

### 6.1 模型加载

```text
URL（相对路径）
  → fetch ArrayBuffer / JSON
  → formats 解析（GLB / VRM / PMX / model3.json）
  → 统一模型描述（节点、网格、材质、骨骼、Humanoid、Morph）
  → renderer 创建 GPU 资源（VBO / IBO / 纹理 / 骨骼纹理）
  → 首帧绘制
```

### 6.2 每帧渲染

```text
动作时间推进
  → 采样源骨骼旋转 / 位移
  → 重定向或姿态转换
  → 融合、IK、接地修正
  → 目标骨骼局部旋转
  → 节点世界矩阵
  → 骨骼矩阵写入纹理
  → 顶点蒙皮 → 片元着色 → 后处理
```

VRM 与 PMX 的骨骼更新都遵循“局部旋转 → 父链世界矩阵 → 蒙皮矩阵”的顺序；区别只在数据结构与着色器输入。

### 6.3 Live2D

```text
models.yaml → 选中的路径
  → model3.json
  → moc3 + 纹理
  → Cubism Core 创建模型
  → drawable / parameter
  → motion3 / 表情 / 视线
  → 正交投影绘制
```

## 7. 模型清单

模型路径只在 `engine/models.yaml` 里出现，页面和 JS 不保存具体路径。清单只写路径，格式由后缀判断：

```yaml
actions: assets/all_animations.glb

models:
  - assets/models/demo/model.vrm
  - assets/models/demo/model.pmx
  - assets/models/demo/model3.json
```

- `.vrm` 走 VRM，`.pmx` 走 PMX，`.json` 走 Live2D，不需要额外写类型。
- 路径相对 `engine/`；PMX 的贴图目录自动取模型文件所在目录。
- `actions` 是动作库路径，供人形动作使用。
- 新增模型只在 `models` 下追加一行路径；`validate.html` 的下拉会自动增加对应选择项。
- 演示路径只是占位，参与者换成自己的模型目录即可，不需要改 JS。
- 本地真实模型清单可以用 `assets/models.local.yaml`，该文件已被 `.gitignore` 忽略，不提交。

## 8. 拆分与加载约定

1. **按功能目录放文件**：解析放 `formats/`，渲染放 `render/`，动作放 `animation/`，基础设施放 `core/`。
2. **一个功能一个文件**：合集文件按功能段拆分，不按行号平均切；拆分后的目录用 `index.js` 或 `orb-index.js` 说明加载顺序。
3. **拆分文件保持原顺序**：经典脚本依赖全局符号，加载顺序错会直接 `ReferenceError`；新增文件必须同时更新入口列表。
4. **不留下双份实现**：原合集文件已移除；旧实现保留在 `legacy/`，新实现放在 engine 根目录对应的功能目录，文档要写清哪一份是当前运行链。
5. **应用代码不回流引擎**：UI 外壳、业务页面、对话/皮肤/世界演示放 `interface/console/`，不因“引擎也能用”就放回 `engine/`。

## 9. 验证与贡献

| 手段 | 用途 |
| --- | --- |
| `validate.html` 左侧分组开关 | 按模型与格式、材质与光照、网格与调试、姿态与动作、相机分组；VRM / PMX / Live2D 自动启用对应项 |
| `validate.html?format=vrm\|pmx\|live2d` | 只显示指定格式的模型 |
| `validate.html?catalog=assets/models.local.yaml` | 指向外部 YAML 清单；路径末尾误带的 `\` 会自动归一化 |
| `validate.html?flip=1` | 对照 PMX 贴图 UV 的 Y 方向 |
| `validate.html` Live2D 交互 | 眨眼、挥手、点头、摇头、情绪选择，只对 Live2D 模型启用 |
| 浏览器控制台 | 解析、着色器、纹理和模型加载错误 |
| `node --check <file>` | 单文件语法检查；拆分文件必须逐个检查 |

提交前：

- 确认工作区没有真实模型、动作、Live2D 资产和第三方源码。
- 页面与 JS 不写死模型路径；新增模型只改 `models.yaml`。
- 修改渲染行为时，先保证静止姿态正确，再验证 `idle`、`walk`、`run`、`greet`，最后检查 PMX 与 Live2D 入口不受影响。

## 10. 当前实现边界

- PMX 脚踝使用髋部接地补偿，未做逐骨骼足部 IK。
- 动作融合按骨骼分区，未引入接触状态权重。
- VRM 未接 SpringBone、MToon、表情 Morph。
- Live2D 未接 physics3、PartOpacity 与完整 Cubism Framework 控制器。
- `legacy/orb` 是并行旧实现，不与当前 `validate.html` 运行链合并。
- `interface/console/` 的单闭包应用文件尚未按功能拆分，属于应用层后续工作，不影响引擎运行。

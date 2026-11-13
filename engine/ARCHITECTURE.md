# Aevum 渲染引擎架构

本文面向第一次接触本仓库的参与者，说明 `engine/` 的分层、模块职责、运行入口和数据流。按本文启动本地服务后，可以直接打开页面观察效果，不需要先读实现源码。

## 1. 引擎定位

Aevum 是一个独立的 WebGL 角色渲染引擎，支持三类角色资产：

- **VRM / glTF 人形**：骨骼蒙皮、Humanoid、动作采样与动作重定向。
- **PMX / MMD**：PMX 网格与材质、VMD 动作、Morph、卡通着色、球面贴图、描边。
- **Live2D Cubism**：moc3 模型、纹理、参数、drawable、motion3 动作。

三套角色共用同一套数学、资源加载和渲染循环约定，但各自保留格式解析与 GPU 管线，不把一种格式强行转换成另一种。

`engine/` 里同时存在两类代码：

1. **可直接运行的演示链**：`validate.html`，只加载需要的 `formats/`、`render/`、`action/` 模块，适合快速验证。
2. **完整引擎层**：`core/`、`gl/`、`model/`、`world/`、`spirit/`、`orb/`，提供 ECS、资源缓存、渲染循环、后处理、地形、角色表现等能力，供更大的应用组装使用。

演示页不依赖完整引擎层；完整引擎层也不要求演示页的脚本顺序。

## 2. 本地运行

在仓库根目录启动静态服务：

```powershell
python -m http.server 8766 --directory D:\Aevum
```

然后打开：

| 页面 | 用途 | 地址 |
| --- | --- | --- |
| 渲染验证 | VRM / PMX / Live2D 多模型、逐项渲染开关、骨骼调试 | `http://127.0.0.1:8766/engine/validate.html` |

必须通过 HTTP 打开，不要直接双击 HTML；模型和动作都通过 `fetch` 读取，`file://` 会被浏览器拦截。

## 3. 运行参数

### 3.1 渲染验证 `validate.html`

| 参数 | 含义 |
| --- | --- |
| `model` | 模型清单里的路径，例如 `assets/model.vrm` |
| `action` | `idle` / `walk` / `run` / `greet` |
| `flip` | `1` 时翻转 PMX 贴图 UV 的 Y 方向 |
| `catalog` | 另一份模型清单的相对 URL，默认 `models.yaml` |

页面左侧的模型下拉、动作下拉和每个开关，都会直接改动当前运行状态；右侧是同一画布的实时结果。视角用鼠标拖拽和滚轮调整。

### 3.2 模型清单 `models.yaml`

模型路径只在清单里出现，页面和 JS 不保存具体路径。清单只写路径，格式由后缀判断：

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

清单里的 `assets/models/demo/` 只是演示路径，参与者换成自己的模型目录即可，不需要改 JS。

也可以用 `?catalog=<url>` 临时换一份清单做对照。

## 4. 分层结构

```text
入口页
  validate.html
        │
        ├─ formats/        文件格式 → 统一数据
        ├─ render/         数据 → GPU 蒙皮 / 角色帧
        ├─ action/         人形动作状态、采样、融合、IK
        └─ orb/math.js     向量、矩阵、四元数
                │
完整引擎层（供应用组装）
  core/      ECS、渲染循环、资源管线、内存、调度、UI 外壳
  gl/        WebGL 上下文、着色器、缓冲、纹理、后处理
  model/     模型加载注册表、缓存、格式适配、重定向压缩/LOD
  world/     地形、天气、水体、LOD、世界应用
  spirit/    渲染管线、延迟渲染、材质、皮肤、对话与 Live2D 桥
  orb/split/ 上游拆分模块与扩展
```

### 4.1 `formats/`：只负责解析与采样

| 文件 | 职责 |
| --- | --- |
| `glb.js` | 解析 GLB 容器，拆出 JSON chunk 与二进制 chunk |
| `gltf-accessor.js` | 读取 glTF accessor，统一成 TypedArray |
| `gltf-animation.js` | 解析 glTF animation，提供 `createPlayer`、clip 切换、循环、按时间取姿态 |
| `vrm.js` | 解析 VRM 0.x / 1.0 Humanoid，输出 `humanBones` 与节点映射 |
| `pmx.js` | 解析 PMX 顶点、面、材质、骨骼、Morph、刚体、显示框 |
| `vmd.js` | 解析 VMD 骨骼关键帧与 Morph 关键帧 |
| `tga.js` | 解析 TGA 贴图，供 PMX 材质使用 |
| `live2d-motion.js` | 解析 motion3.json 曲线，按时间求参数值 |

解析层不做 GPU 调用，也不做动作混合；输入是文件字节，输出是普通对象和 TypedArray。

### 4.2 `render/`：把数据变成画面

| 文件 | 职责 |
| --- | --- |
| `webgl-renderer.js` | PMX 的 WebGL2 蒙皮渲染器：顶点缓冲、骨骼纹理、材质、toon、sphere、outline、线框、Morph |
| `vrm-renderer.js` | VRM/glTF 蒙皮渲染器：节点世界矩阵、skin、贴图、相机、地面网格 |
| `animation-retarget.js` | Mixamo 人形动作 → VRM Humanoid 的重定向，输出目标骨骼局部旋转与髋部位移 |
| `vmd-player.js` | VMD 时间轴推进与循环 |
| `vmd-pose.js` | VMD 采样结果转换成 PMX 骨骼姿态 |
| `pose-blend.js` | 多姿态按骨骼分区融合 |
| `action-state.js` | 动作状态与过渡的轻量封装 |
| `procedural-animation.js` | 程序化待机、呼吸、摆动等附加动作 |
| `pmx-morph.js` | PMX Morph 权重应用 |
| `look-controller.js` | 视线/头部朝向控制 |
| `live2d-renderer.js` | Live2D Cubism 渲染器：moc3、drawable、参数、纹理、motion3、表情与动作 |

### 4.3 `action/`：人形动作系列

| 模块 | 职责 |
| --- | --- |
| `action-core.js` | 动作状态机、状态、过渡、条件、优先级 |
| `action-capture.js` | 从当前姿态捕捉动作片段 |
| `action-chain.js` | 多段动作串联与衔接 |
| `action-capture-stream.js` | 流式捕捉输入 |
| `action-capture-data.js` | 捕捉数据整理与重放 |
| `action-matcher.js` | 动作匹配与选择 |
| `action-joint-ik.js` | 关节 IK 求解 |
| `procedural-animator.js` | 程序化动作生成 |

`validate.html` 的动作链是：glTF clip 采样 → `AnimationRetarget.retargetPose` → `VRMRenderer.render`；状态切换由 `ActionStateMachine` 管理。

### 4.4 `core/`：应用级基础设施

| 文件 | 职责 |
| --- | --- |
| `index.js` | 引擎启动、事件总线、模块管理、配置管理 |
| `render-loop.js` | 更新/渲染/后渲染回调、资源管线 |
| `scene-ecs.js` | Entity、组件、World、层级变换 |
| `resource-pipeline.js` | 异步资源加载、缓存、场景管理 |
| `memory-budget.js` | 内存预算与回收阈值 |
| `object-pools.js` | 对象池 |
| `task-scheduler.js` | 分帧任务调度 |
| `performance-monitor.js` | 帧时间与性能统计 |
| `renderer-integration.js` | 渲染器接入层 |
| `app-shell.js` / `orb-ui.js` | 应用外壳与 UI 组件 |

### 4.5 `gl/`：WebGL 能力层

| 文件 | 职责 |
| --- | --- |
| `gl-core.js` | WebGL 上下文、着色器编译、缓冲、纹理、状态与绘制封装 |
| `shader-pipeline.js` | 着色器管线 |
| `shader-geometry.js` | 几何着色/网格生成 |
| `texture-buffer-pipeline.js` | 纹理与缓冲上传 |
| `render-targets.js` | FBO、离屏目标 |
| `gl-extensions.js` | 扩展检测与能力封装 |
| `gl-compute-post.js` | 计算/后处理 |

### 4.6 `model/`：模型加载与适配

| 文件 | 职责 |
| --- | --- |
| `loader-registry.js` | 按扩展名选择加载器，统一缓存、重试、批量加载 |
| `gltf-loader.js` | glTF/GLB 加载与 accessor 构建 |
| `gltf-obj-vmd-loaders.js` | glTF、OBJ、VMD 的加载适配 |
| `fbx-vrm-formats.js` | FBX / VRM 格式适配 |
| `pmx-parser.js` | PMX 解析封装 |
| `retarget-compress.js` | 重定向数据压缩 |
| `retarget-lod.js` | 重定向 LOD |
| `animation-mesh.js` | 动画网格数据 |
| `loader-convert-cache.js` | 转换结果缓存 |

### 4.7 `world/` 与 `spirit/`

- `world/`：地形、天气、水体、植被、LOD、世界管线；`world-app.js` 是世界应用装配入口。
- `spirit/render/`：渲染队列、视锥裁剪、延迟 GI、头发/布料、粒子、材质扩展。
- `spirit/skin/`：皮肤材质、纹理、物理、妆容、湿度、皮肤应用。
- `spirit/interaction/`：对话引擎、对话记忆、情感、意图响应、交互中枢、Live2D 桥、语音。
- `orb/`：`math.js` 是演示链使用的轻量数学；`orb/split/` 是拆分后的上游模块和扩展，按需加载。

## 5. 数据流

### 5.1 模型加载

```text
URL（相对路径）
  → fetch ArrayBuffer / JSON
  → formats 解析（GLB / VRM / PMX / model3.json）
  → 统一模型描述（节点、网格、材质、骨骼、Humanoid、Morph）
  → renderer 创建 GPU 资源（VBO / IBO / 纹理 / 骨骼纹理）
  → 首帧绘制
```

### 5.2 每帧渲染

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

### 5.3 Live2D

```text
models.yaml → 选中的路径
  → model3.json
  → moc3 + 纹理
  → Cubism Core 创建模型
  → drawable / parameter
  → motion3 / 表情 / 视线
  → 正交投影绘制
```

## 6. 模型路径与资源约定

1. **只使用相对路径**。页面、清单、参数里都不出现盘符或本机绝对路径。
2. **模型资产不进入版本库**。`engine/assets/` 已在 `.gitignore` 中忽略；参与者从自己的资产目录放入。
3. **一个模型清单**。`validate.html` 的模型选择全部由 `models.yaml` 的 `models` 列表生成；动作库也由清单的 `actions` 指定。
4. **新增模型不改渲染代码路径**。在 `models.yaml` 的 `models` 下追加一行相对路径即可，渲染代码里不出现具体模型路径。
5. **模型选择项从清单生成**。清单为空或类型不支持时页面会提示，不静默回退到某个固定文件。
6. **HTML 不内联业务 JS**。页面只引用 `app/*.js`，渲染与解析逻辑留在独立模块里；缓存版本通过 `?v=` 控制。

## 7. 调试与验证

| 手段 | 用途 |
| --- | --- |
| `validate.html` 左侧开关 | 单独关闭贴图、光照、toon、sphere、outline、线框、骨骼、接地 |
| `validate.html?flip=1` | 对照 PMX 贴图 UV 的 Y 方向 |
| 浏览器控制台 | 解析、着色器、纹理和模型加载错误 |

## 8. 贡献约定

- 新增格式解析放在 `formats/`，新增渲染能力放在 `render/` 或 `gl/`，不要把格式分支写进页面。
- 新增模型/动作资产只放本地 `assets/`，不提交。
- 提交前确认工作区没有第三方源码、对照页、下载包和模型文件。
- 页面保持“入口 + 独立 JS”的结构；CSS 可以在页面内，业务逻辑不内联。
- 修改渲染行为时，先保证静止姿态正确，再验证 `idle`、`walk`、`run`、`greet` 四个动作，最后检查 PMX 与 Live2D 入口不受影响。

## 9. 当前实现边界

- PMX 脚踝使用髋部接地补偿，未做逐骨骼足部 IK。
- 动作融合按骨骼分区，未引入接触状态权重。
- VRM 未接 SpringBone、MToon、表情 Morph。
- Live2D 未接 physics3、PartOpacity 与完整 Cubism Framework 控制器。

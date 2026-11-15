# 引擎能力接入清单

这份清单只评估 `D:\Aevum\engine` 里已经存在的模块能不能接进 `apps/community/web` 的 3D 桌面场景。判断标准是：当前场景是“全屏地面 shader + DOM 窗口 + 独立角色 canvas”，不替换现有窗口系统，也不把页面改成完整 3D 游戏。

## 已经接入

| 引擎模块 | 当前用途 |
| --- | --- |
| `engine/math/math.js` | `V3 / M4 / Plane / Ray`，场景矩阵、反投影、角色放置 |
| `engine/world/pipeline/world-pipeline.js` | 只使用 `World3DEngine.CameraController` 的轨道相机状态 |
| `engine/formats/pmx/pmx.js` | PMX 解析 |
| `engine/formats/vrm/vrm.js` | VRM 解析 |
| `engine/formats/texture/tga.js` | PMX 的 TGA 贴图解码 |
| `engine/render/pmx/webgl-renderer.js` | PMX 骨骼、贴图、toon、描边、透明画布 |
| `engine/render/vrm/vrm-renderer.js` | VRM 骨骼、贴图、透明画布；本轮新增方向主光、环境补光、Blinn 高光、fresnel 轮廓光，接收场景相机位置 |
| `engine/render/live2d/live2d-renderer.js` | Live2D 模型、动作、眨眼、视线、口型 |
| `engine/formats/gltf/glb.js` + `gltf-accessor.js` + `gltf-animation.js` | 解析 `all_animations.glb`、采样 `walk` / `run` 片段 |
| `engine/render/retarget/animation-retarget.js` | 把 Mixamo 骨架的 `walk` / `run` 重定向到 VRM Humanoid，带 `footClearance`、`runPose` 和手臂限位 |
| `engine/render/procedural/procedural-animation.js` | PMX 的 `idle` / `walk` / `run` 程序化姿态；也是 VRM 动作库不可用时的回退 |
| `engine/render/look/look-controller.js` | 本次接入：指针驱动的头部/颈部/胸部朝向 |

## VRM 光照现状

`VRMRenderer` 原本只有“方向光 + 固定 0.45 环境项”，模型在浅色地面上容易发灰、发平。本轮在它自己的 shader 里补了四项，没有引入新的渲染管线：

| 项 | 实现 | 参数入口 |
| --- | --- | --- |
| 方向主光 | 顶点输出 `vWorldPos`，片元按 `uLightDir` 做 Lambert，并用 `smoothstep(-0.15, 0.55, ndl)` 做轻 toon 化的明暗过渡 | `override.lighting.direction / color`，默认 `[0.35,0.85,0.42]`、`[0.78,0.74,0.66]` |
| 环境补光 | 片元统一环境色，避免背光面死黑 | `override.lighting.ambient`，默认 `[0.22,0.24,0.3]` |
| 镜面高光 | Blinn-Phong，`pow(dot(N,H), 32)`，强度独立控制 | `override.lighting.specular`，默认 `0.08` |
| fresnel 轮廓光 | `pow(1 - dot(N,V), 3)`，用 `uCameraPos - vWorldPos` 求视线方向 | `override.lighting.rim / rimStrength`，默认 `[0.55,0.78,1]`、`0.2` |

`scene-vrm.js` 每帧把 `scene.camera.position` 传成 `override.cameraPosition`，并传一份 `lighting` 配置。没有外部光照系统、没有阴影贴图、没有 MToon；参数在 `scene-vrm.js` 里集中可调。

## VRM 走路 / 跑步动作

`desktop.html` 在 `gltf-accessor.js` 之后加载 `gltf-animation.js` 和 `animation-retarget.js`。`scene-vrm.js` 载入 VRM 后从 `/engine/assets/all_animations.glb` 建一个 `GLTFAnimation` player，只取 `walk` / `run` 两个片段：

- `walk` 片段末尾补 `1/30 s`，避免循环回绕时左脚跳变；`walk` 从 `0.08 s`、`run` 从 `0.12 s` 开始，跳过接触前的过渡帧。
- 每帧 `player.update(dt)` → `player.getPose()` → `AnimationRetarget.retargetPose(vrm, actionGLB.json, pose, options)`；`walk` 开 `footClearance` 和 `legSmoothState`，`run` 开 `runPose`，两者共用 `armLimitState`。
- 重定向结果直接喂给 `VRMRenderer.render(t, pose.rotation, { translation: pose.translation }, override)`，和现有相机、光照、透明画布共用同一套绘制。
- 近距离点击走 `walk`，目标距离超过 `runDistance`（默认 5）或按住 Shift 走 `run`；VRM 速度分别是 `1.8` / `3.2`，PMX 同样有 `run` 程序化姿态。
- 动作库缺失或重定向异常时自动回退到 `ProceduralAnimation.makeVRMPose`，不会把角色卡死。
- `standing_greeting` 不加载、不参与状态选择；待机仍是程序化 `idle`，所以不会出现之前的挥手效果。

## 引擎里还能继续接的 VRM 相关能力

| 能力 | 现状 | 能补什么 | 限制 |
| --- | --- | --- | --- |
| `engine/render/pmx/webgl-renderer.js` 的 toon ramp / 描边 | PMX 已用，VRM 没接 | 把 VRM 也做成 MMD 式色阶 + 反向外扩描边 | 它的 vertex/skin 和 PMX 材质槽绑定，不能直接套到 VRM；需要把色阶采样和描边 pass 移植到 `VRMRenderer` |
| `engine/character/skin/skin-material.js` | 未接 | 皮肤 SSS、sheen、clearcoat、fresnel | 当前 VRM 渲染器没有材质槽，也不区分皮肤/服装；需要先解析 `VRM/MToon` 或材质名映射 |
| `engine/graphics/core/gl-core/pbr.js` | 未接 | PBR、多光源、高光、Fresnel | 是另一套 WebGL 核心，和现有 `VRMRenderer` 的资源/循环重复；整包接会和场景两套渲染循环冲突 |
| `engine/world/pipeline/world-pipeline.js` 光照/阴影/后处理 | 只用了 `CameraController` | 真实方向光阴影、昼夜、后处理 | 需要完整 render graph 和 shadow map，当前角色是每个角色一个透明 canvas，不是同一 G-Buffer |
| `engine/render/vmd/vmd-pose.js` + `vmd-player.js` | 未接 | VMD 动作 | 仓库没有 `.vmd` 资产；PMX 仍用程序化步态 |
| `engine/render/action/action-state.js` + `pose-blend.js` | 未接 | idle/walk/run 状态机、上下半身叠加 | 当前由 `moving / running` 直接选片段，没有状态机和上下半身混合 |
| `engine/render/retarget/animation-retarget.js` | 已接 | Mixamo/glTF 动作迁移到 VRM Humanoid | 只接 `walk` / `run`；`standing_greeting` 效果不好，不加载 |
| `engine/animation/ik/action-joint-ik.js` | 未接 | 手部/脚部 IK、关节限制 | 需要骨骼链、约束参数和落地检测，改动量大于状态机 |

结论：本轮已经在 `VRMRenderer` 内补光照，并把 `all_animations.glb` 的 `walk` / `run` 接进 VRM；下一步收益最高的是 toon ramp/描边移植与 `action-state + pose-blend`，而不是把 `character/skin` 或 `graphics/core/gl-core` 整包接进来。

## 可以近期接入

| 模块 | 能补什么 | 接入位置 | 主要限制 |
| --- | --- | --- | --- |
| `engine/render/action/action-state.js` | 用 `idle / walk / run / happy` 状态机管理角色动作，替掉现在 `moving ? walk : idle` 的布尔判断 | `scene-vrm.js` / `scene-pmx.js` 的 `frame` | 需要把速度、目标距离和当前状态喂给状态机；不处理碰撞 |
| `engine/render/blend/pose-blend.js` | 下半身走路、上半身叠加挥手/点头/视线 | 角色 `frame` 的姿态合成处 | 需要明确基础层和叠加层，VRM 与 PMX 的骨骼轴不同 |
| `engine/render/morph/pmx-morph.js` | PMX 眨眼、表情 morph | `scene-pmx.js`，加载 `pmx-morph.js` 后调用 `setMorphWeights` | 每帧重算顶点缓冲有一定开销；`まばたき` 等 morph 名称依赖模型 |
| `engine/core/diagnostics/performance-monitor.js` | FPS、帧耗时、绘制调用统计 | 场景右下角状态条或调试面板 | 当前模块是独立 `EngineCoreV6` 命名空间，不是模块化导出，接入前要确认入口 |
| `engine/render/vmd/vmd-pose.js` + `engine/render/vmd/vmd-player.js` | 播放 VMD 动作 | PMX 角色 | 仓库目前没有 `.vmd` 资产；PMX 仍用程序化步态 |
| `engine/animation/ik/action-joint-ik.js` | 手部/脚部 IK、关节限制 | 角色步态和点击目标 | 需要骨骼链和约束参数，改动量比状态机大 |
| `engine/animation/capture/action-capture.js` | 记录/回放动作片段 | 未来做角色动作录制 | 当前场景没有动作编辑器，收益有限 |

## 需要单独管线，暂不直接接

| 模块 | 原因 |
| --- | --- |
| `engine/world/terrain/terrain-atmosphere.js`、`terrain-lod-water.js`、`terrain-vegetation-water.js` | 这些是程序化地形/天空/水体/植被，要求自己的网格、LOD、深度和后处理；当前地面是单平面 shader，硬接会破坏 DOM 分层和现有相机投影 |
| `engine/world/pipeline/world-pipeline.js` 的光照/阴影/昼夜/后处理 | 当前只用了 `CameraController`；VRM 已在自己的轻量 shader 里补主光/环境/高光/轮廓光，PMX 仍用内置简化光照。接真实阴影需要改两个渲染器的材质和 uniform，并引入 shadow map |
| `engine/character/deferred/*`（GI、头发/布料、粒子、延迟队列、材质扩展） | 依赖完整 `SpiritRenderer` 渲染图和 G-Buffer；不是当前每个角色一个透明 canvas 的结构 |
| `engine/character/skin/*`（皮肤材质、湿度、物理妆容、皮肤物理） | 面向 SSS/皮肤材质管线，当前 PMX/VRM 渲染器没有对应的材质插槽 |
| `engine/graphics/core/gl-core/*`、`engine/graphics/post/*` | 另一套 WebGL 核心/PBR/后处理栈，和现有 `WebGLRenderer`/`VRMRenderer` 重复；同时加载会出现两个资源与渲染循环 |
| `engine/legacy/orb/*` | 旧 Orb 命名空间，里面已有 PMX/VMD/数学/相机实现，和现行模块重复；不要当新功能接 |

## 重复入口

- Live2D 有两个入口：`engine/character/live2d/live2d-bridge.js`（`OrbLive2DRenderer`）和 `engine/render/live2d/live2d-renderer.js`（`Live2DRenderer`）。当前场景使用后者，前者是旧命名，不要同时加载。
- 程序化动作有两个入口：`engine/render/procedural/procedural-animation.js`（当前已接入，输出姿态增量）和 `engine/animation/procedural/procedural-animator.js`（更完整的独立 animator）。二选一，当前不要叠加。
- `engine/animation/core`、`chain`、`ik`、`matcher` 有功能重叠，按具体能力单独取用，不要整包加载。

## 建议顺序

1. `action-state` + `pose-blend`：把现在的布尔步态换成状态机，并让走路和挥手可以叠加。
2. `pmx-morph`：先做眨眼，观察 `setMorphWeights` 的开销。
3. `performance-monitor`：把 FPS 和帧耗时挂到状态条，作为后续接入的体积基线。
4. VMD/重定向：等有真实 `.vmd` 资产后再做，不先造播放器 UI。

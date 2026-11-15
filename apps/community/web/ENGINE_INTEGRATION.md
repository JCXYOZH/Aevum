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
| `engine/render/vrm/vrm-renderer.js` | VRM 骨骼、贴图、透明画布 |
| `engine/render/live2d/live2d-renderer.js` | Live2D 模型、动作、眨眼、视线、口型 |
| `engine/render/procedural/procedural-animation.js` | 本次接入：空闲/行走姿态、呼吸、手臂与腿部步态 |
| `engine/render/look/look-controller.js` | 本次接入：指针驱动的头部/颈部/胸部朝向 |

## 可以近期接入

| 模块 | 能补什么 | 接入位置 | 主要限制 |
| --- | --- | --- | --- |
| `engine/render/action/action-state.js` | 用 `idle / walk / run / happy` 状态机管理角色动作，替掉现在 `moving ? walk : idle` 的布尔判断 | `scene-vrm.js` / `scene-pmx.js` 的 `frame` | 需要把速度、目标距离和当前状态喂给状态机；不处理碰撞 |
| `engine/render/blend/pose-blend.js` | 下半身走路、上半身叠加挥手/点头/视线 | 角色 `frame` 的姿态合成处 | 需要明确基础层和叠加层，VRM 与 PMX 的骨骼轴不同 |
| `engine/render/morph/pmx-morph.js` | PMX 眨眼、表情 morph | `scene-pmx.js`，加载 `pmx-morph.js` 后调用 `setMorphWeights` | 每帧重算顶点缓冲有一定开销；`まばたき` 等 morph 名称依赖模型 |
| `engine/core/diagnostics/performance-monitor.js` | FPS、帧耗时、绘制调用统计 | 场景右下角状态条或调试面板 | 当前模块是独立 `EngineCoreV6` 命名空间，不是模块化导出，接入前要确认入口 |
| `engine/render/vmd/vmd-pose.js` + `engine/render/vmd/vmd-player.js` | 播放 VMD 动作 | PMX 角色 | 仓库目前没有 `.vmd` 资产；VRM 需要先做重定向 |
| `engine/render/retarget/animation-retarget.js` | 把 Mixamo/glTF 动作迁移到 VRM Humanoid | VRM 角色 | 需要外部动作资产，且当前 VRM 姿态是程序化生成的，不是动作图 |
| `engine/animation/ik/action-joint-ik.js` | 手部/脚部 IK、关节限制 | 角色步态和点击目标 | 需要骨骼链和约束参数，改动量比状态机大 |
| `engine/animation/capture/action-capture.js` | 记录/回放动作片段 | 未来做角色动作录制 | 当前场景没有动作编辑器，收益有限 |

## 需要单独管线，暂不直接接

| 模块 | 原因 |
| --- | --- |
| `engine/world/terrain/terrain-atmosphere.js`、`terrain-lod-water.js`、`terrain-vegetation-water.js` | 这些是程序化地形/天空/水体/植被，要求自己的网格、LOD、深度和后处理；当前地面是单平面 shader，硬接会破坏 DOM 分层和现有相机投影 |
| `engine/world/pipeline/world-pipeline.js` 的光照/阴影/昼夜/后处理 | 当前只用了 `CameraController`；PMX/VRM 渲染器的光照是内置简化模型，接真实阴影需要改两个渲染器的材质和 uniform |
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

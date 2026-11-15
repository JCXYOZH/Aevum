# 3D 地面网格场景层

`desktop.html` 和 `index.html` 共用的第一版 3D 场景。它不是把 HTML 窗口做成 WebGL 纹理，而是在原有页面下面加一层地面网格：3D 负责空间、相机、节点和角色位，原有 DOM 继续负责窗口、输入、滚动、iframe 和拖拽。

## 跑起来

先启动本地静态服务：

```powershell
$env:LIBERTAS_DATA_DIR='C:\Temp\aevum-auth-test'
python D:\Aevum\apps\console\monitor\desktop_server.py --port 8799
```

| 页面 | 地址 |
| --- | --- |
| 普通桌面 | `http://127.0.0.1:8799/desktop.html` |
| 沉浸桌面 | `http://127.0.0.1:8799/desktop.html?scene=1` |
| 展示页场景段 | `http://127.0.0.1:8799/index.html#world` |

## 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 数学 | `engine/math/math.js` | `V3 / M4 / Plane / Ray`，挂到 `window.AEVUM.math` |
| 相机状态 | `engine/world/pipeline/world-pipeline.js` | `World3DEngine.CameraController` 的轨道参数 |
| 场景核心 | `js/scene/scene-core.js` | WebGL 地面网格、相机矩阵、DOM 锚点投影、射线拾取、角色位、工具条、WebGL fallback |
| 角色 pass | `js/scene/scene-vrm.js` | 透明角色 canvas、VRM 加载与待机动作、角色位放置、与地面共用 `viewProjection` |
| PMX pass | `js/scene/scene-pmx.js` | PMX 解析、贴图、待机动作，默认放在角色位 02 |
| Live2D pass | `js/scene/scene-live2d.js` | 屏幕空间 Live2D 画布，按角色位投影定位，可选替代角色位 02 |
| 桌面布局 | `js/scene/scene-desktop.js` | 桌面页 7 个应用节点 + 2 个角色位，点击走 `MD.bus` |
| 展示页布局 | `js/scene/scene-showcase.js` | 展示页 5 个入口节点 + 2 个角色位，点击滚动或跳转 |
| 场景样式 | `styles/scene3d.css` | 场景层、节点、角色位、工具条、沉浸模式、响应式 |
| 展示页区块 | `styles/showcase/world.css` | `#world` 舞台高度、背景和窄屏适配 |

## 桌面页节点

节点不自己维护应用列表。`scene-desktop.js` 每次从 `MD.listApps()` 取应用，再按 `placements` 分配地面坐标；新增窗口时 `MD.bus` 的 `apps` 事件会触发 `api.refresh()`，新应用自动分到外圈位置。

| 应用 | 节点 ID | `grid` 坐标 | 点击行为 |
| --- | --- | --- | --- |
| 总览 | `overview` | `[-1.5, 0.0]` | 打开总览窗口 |
| 内核实况 | `kernel` | `[-3.4, -2.6]` | 打开内核实况窗口 |
| 训练监控 | `trainer` | `[-0.2, -3.4]` | 打开训练监控窗口 |
| 模型对话 | `model` | `[3.0, -2.6]` | 打开模型对话窗口 |
| 中继交流 | `relay` | `[-3.4, 1.8]` | 打开中继交流窗口 |
| 错误看板 | `errors` | `[3.0, 1.8]` | 打开错误看板窗口 |
| 展示页 | `exhibit` | `[0.0, 3.2]` | 打开展示页窗口 |
| 角色位 01 | `host` | `[-1.2, 2.2]` | 已接入 VRM；点击打开模型对话 |
| 角色位 02 | `guide` | `[1.2, 2.2]` | 默认 PMX，可用 `?guide=live2d` 切换；点击打开模型对话 |

沉浸模式下点节点会先退出 `scene-focus`，再发 `request-open`，否则窗口会被沉浸样式继续隐藏。

## 展示页节点

`#world` 放在 hero 与架构之间，是长页内容的 3D 索引，不改写原有 section。

| 节点 | 节点 ID | 行为 |
| --- | --- | --- |
| 架构 | `modules` | 平滑滚动到 `#modules` |
| 阶段 | `state` | 平滑滚动到 `#state` |
| 控制台 | `console` | 平滑滚动到 `#console` |
| 参与 | `join` | 平滑滚动到 `#join` |
| 进入 3D 桌面 | `desktop` | 跳转 `desktop.html?scene=1` |

## 相机与坐标

- 配置里的 `grid` 坐标乘以 `2.0` 后得到世界坐标；地面固定 `y=0`，节点抬高 `0.05`。
- `CameraController` 只负责轨道状态（`mode="orbit"`，初始 `rotationX=0.52`、`rotationY=0.28`、`distance=14`、`fov=48`、`near=0.1`、`far=2000`）。
- 投影矩阵由 `scene-core.js` 用 `M4.lookAt / M4.perspective / multiply` 自己合成，不直接用 `CameraController.getViewProjectionMatrix()`。后者在当前引擎里给 DOM 锚点投影时会把节点判到裁剪区外，`scene-core` 不改引擎，只绕开这一个出口。
- 屏幕点击用 `M4.invert(viewProjection)` 反投影成射线，再与 `y=0` 平面求交；离射线最近的节点会被选中。

## 交互

- 拖拽：旋转相机。
- 滚轮：拉近拉远，`preventDefault` 只在场景挂载点上生效，不影响页面别处滚动。
- 点击节点：走 `onOpen(id)`；桌面页发 `MD.bus`，展示页滚动 section。
- 点击空白地面：选最近节点，或清除当前状态。
- 工具条：`沉浸 / 返回桌面`、`斜视`、`俯视`、`重置`。
- `?scene=1` 直接进沉浸模式；`Esc` 退出。

## 场景核心接口

```js
var api = AEVUM.scene.create({
  mount: mountElement,
  nodes: [{ id, title, meta, grid: [x, z], tone }],
  slots: [{ id, title, meta, grid: [x, z] }],
  onOpen: function (id) {},
  onSlot: function (slot) {},
  onPick: function (node) {}
});

api.mount();
api.refresh(nodes, slots);
api.setView("focus" | "top" | "angle" | "reset");
api.setStatus("...");
api.screenRay(x, y);
api.project([x, y, z]);
api.onFrame(function (now, dt) {});
api.getViewProjection();
api.getSize();
api.slotWorld("host");
api.setSlotMeta("host", "VRM / fufu酱");
```

`onFrame` 在每帧 `draw()` 之后执行；`getViewProjection()` 返回场景内部矩阵引用，角色 pass 必须直接使用它，不能另算一套相机。

## 角色接入

角色位 01 已经接入真实 VRM：

- 模型：`engine/assets/models/furina/f芙宁娜.vrm`（38 MB）。
- 解析：`engine/formats/vrm/vrm.js` 的 `parseVRM`，底层走 `glb.js` 和 `gltf-accessor.js`。
- 渲染：`engine/render/vrm/vrm-renderer.js` 的 `VRMRenderer`，当前是最小管线，包含 accessor 解码、骨骼蒙皮、贴图、方向光和程序化待机动作。
- 放置：`scene-vrm.js` 按 `renderer.bounds` 把模型缩放到 1.75 世界单位，脚底对齐 `y=0`，再用 `slotWorld("host")` 放到角色位圆环。
- 朝向：`yaw` 由 `scene-desktop.js` 传入，默认 `Math.PI`；也可以临时用 `desktop.html?scene=1&yaw=0` 对比朝向。
- 合成：角色画在独立的透明 WebGL2 canvas（`.scene3d__characters`，`z-index:2`）上，地面在下面，节点和工具条在 `.scene3d__overlay`（`z-index:3`）上面。

`VRMRenderer` 的扩展点：

```js
var renderer = new AEVUM.render.VRMRenderer(canvas, {
  context: { alpha: true, antialias: true },
  clearColor: [0, 0, 0, 0]
});
renderer.render(time, pose, transforms, {
  viewProjection: scene.getViewProjection(),
  modelMatrix: characterMatrix,
  clearColor: [0, 0, 0, 0]
});
```

`render(time, pose, transforms)` 的原调用方式保持不变；`override` 是可选第四参数。

角色位 02 默认接入 PMX：

- 模型：`engine/assets/models/ganyu/甘雨.pmx`，贴图在同目录 `tex/`。
- 解析：`engine/formats/pmx/pmx.js` 的 `parsePMX`。
- 渲染：`engine/render/pmx/webgl-renderer.js` 的 `WebGLRenderer`，支持骨骼、morph、toon、sphere、描边。
- 放置：`scene-pmx.js` 按顶点包围盒把模型缩放到 1.75 世界单位，脚底对齐 `y=0`，再放到 `slotWorld("guide")`。
- 贴图：PMX 的贴图路径逐段 `encodeURIComponent`，中文目录也能加载；TGA 走 `engine/formats/texture/tga.js`，PNG/BMP 由浏览器解码。
- 切换：`desktop.html?scene=1&guide=live2d` 把角色位 02 换成 Live2D。

Live2D 是 2D 渲染器，不能直接塞进 3D 网格，所以用一个屏幕空间画布按角色位投影定位：

- 模型：`engine/assets/models/live2d/xiaoyue/xiaoyue.model3.json`。
- 渲染：`engine/render/live2d/live2d-renderer.js`，依赖 `engine/vendor/live2dcubismcore.min.js`。
- 定位：`scene-live2d.js` 每帧用 `scene.project(slotWorld("guide"))` 把画布底部对到角色位；画布只做缩放，不旋转，保持 2D 正面。
- z 序与 PMX/VRM 相同，仍在 `.scene3d__overlay` 之下。

三种角色 pass 都只读场景的 `viewProjection` 或投影结果，不修改相机；角色位坐标仍由 `scene-core` 统一提供。

## 角色位与后续接入

`scene-core` 只负责把 `grid` 坐标投影成 DOM 锚点，并回调 `onSlot`；模型解析、蒙皮、材质和口型在角色 pass 里完成。

后续接 PMX / Live2D 时，地面网格不需要重写，但角色 pass 仍要遵守同一条规则：复用场景的 `viewProjection`，脚底落在 `y=0`，角色 canvas 放在地面之上、DOM 节点和窗口之下。引擎侧已有可复用的真实入口：

- PMX：`engine/formats/pmx/pmx.js` 解析，`engine/render/pmx/webgl-renderer.js` 负责 WebGL 绘制、骨骼姿态与 morph。
- Live2D：`engine/render/live2d/live2d-renderer.js`，依赖官方 `engine/vendor/live2dcubismcore.min.js`。
- 角色位配置保持 `id / title / meta / grid` 不变，把 `onSlot` 从“打开模型对话”换成“加载 / 切换角色”，不要在页面里另造一套坐标。
- `engine/character/live2d/live2d-bridge.js` 与 `engine/render/live2d/live2d-renderer.js` 内容高度重复，接 Live2D 前先确定唯一入口，避免两套渲染器同时存在。

不要用 `apps/console/ui/world/world-app.js` 的 Three.js 全屏场景替换这套链路。它适合参考资源加载和骨骼动画，但它的运行方式会盖住现有 DOM 桌面，和现在的“3D 导航层 + DOM 内容层”不是同一条链。

## 已知边界

- 3D 只是导航层；窗口仍是普通 DOM，不是 3D 物体。
- 普通桌面下两个默认窗口会大面积遮住场景，完整场景主要看 `?scene=1` 或展示页的 `#world`。
- 展示页的 `#world` 在首屏之下；如果希望首屏就能看到场景，需要再决定是否把舞台提前或做成 hero 背景。
- VRM 角色 pass 还没有阴影、描边、PBR/MToon、SpringBone，待机动作是程序化骨骼摆动。
- PMX 已能加载真实模型和贴图，但没有物理、完整材质排序和 VMD 动作播放；显示尺寸按包围盒缩放。
- Live2D 是屏幕空间画布，不是 3D 网格上的平面；它只随角色位投影移动，不能绕到模型背面。
- 展示页 `#world` 没有加载角色，只保留圆环接口。
- 本次场景层还没有接认证、对话或中继接口，节点只负责打开已有窗口和滚动，不新增数据请求。

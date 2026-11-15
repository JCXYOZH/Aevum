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
| 角色位 01 | `host` | `[-1.2, 2.2]` | 打开模型对话，预留角色接入 |
| 角色位 02 | `guide` | `[1.2, 2.2]` | 打开模型对话，预留角色接入 |

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
```

## 角色位与后续接入

当前角色位只是地面圆环，没有加载模型。`scene-core` 只负责把 `grid` 坐标投影成 DOM 锚点，并回调 `onSlot`；不包含模型解析、蒙皮、材质或口型。

后续接 VRM / PMX / Live2D 时，地面网格不需要重写，但需要新增一个**角色渲染 pass**。现在 `scene-core` 的 canvas 只跑全屏 quad 的地面网格 shader，不能把角色直接塞进同一个 fragment shader。建议按下面顺序做：

1. 在 `#scene3d` 里加一个角色 canvas，或给同一个 canvas 加第二个 program；两种方式都必须复用同一份 `viewProjection`，否则角色和地面会对不上。
2. 角色 canvas 的 z 序放在地面之上、DOM 节点和窗口之下；先保证角色站在 `y=0` 的网格上，再做阴影和描边。
3. 引擎侧已有可复用的真实入口：
   - VRM：`engine/formats/vrm/vrm.js` 解析，`engine/render/vrm/vrm-renderer.js` 负责 accessor、蒙皮、贴图和待机动作；目前是最小管线，不含 PBR、MToon、SpringBone。
   - PMX：`engine/formats/pmx/pmx.js` 解析，`engine/render/pmx/webgl-renderer.js` 负责 WebGL 绘制、骨骼姿态与 morph。
   - Live2D：`engine/render/live2d/live2d-renderer.js`，依赖官方 `live2dcubismcore.min.js`。
4. 角色位配置保持 `id / title / meta / grid` 不变，把 `onSlot` 从“打开模型对话”换成“加载 / 切换角色”，不要在页面里另造一套坐标。
5. `engine/character/live2d/live2d-bridge.js` 与 `engine/render/live2d/live2d-renderer.js` 内容高度重复，接 Live2D 前先确定唯一入口，避免两套渲染器同时存在。

不要用 `apps/console/ui/world/world-app.js` 的 Three.js 全屏场景替换这套链路。它适合参考资源加载和骨骼动画，但它的运行方式会盖住现有 DOM 桌面，和现在的“3D 导航层 + DOM 内容层”不是同一条链。

## 已知边界

- 3D 只是导航层；窗口仍是普通 DOM，不是 3D 物体。
- 普通桌面下两个默认窗口会大面积遮住场景，完整场景主要看 `?scene=1` 或展示页的 `#world`。
- 展示页的 `#world` 在首屏之下；如果希望首屏就能看到场景，需要再决定是否把舞台提前或做成 hero 背景。
- 当前没有模型资源、没有角色动画、没有阴影；角色位只是接口占位。
- 本次场景层还没有接认证、对话或中继接口，节点只负责打开已有窗口和滚动，不新增数据请求。

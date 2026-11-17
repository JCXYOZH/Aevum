# web —— AEVUM 前端

一个纵向滚动的页面，四块内容：首屏（灵体 + 项目一句话）、内核实况（QEMU 串口送出的 VGA 文本帧）、开源进度（仓库数字 + ROADMAP 阶段）、中继交流区（房间在线/浏览、帖子流、发言）。浏览器直接打开 `index.html` 就能看；中继不在线时交流区显示未连接，页面其余部分照常。

## 3D 场景层

`desktop.html` 和 `index.html` 共用一层 WebGL 地面网格：3D 只负责空间、相机、节点选择与角色位，原有窗口、输入、滚动、iframe 和拖拽仍然由 DOM 负责。根地址 `/` 显示 `index.html` 展示页，`desktop.html` 是单独的桌面入口。桌面页当前暴露 `MrHua`、`订阅`、`内核实况`、`展示页` 和 `拍照` 五个常驻启动项：`MrHua` 在 3D 桌面的程序窗口里打开完整 `/mrhua/` 工作台；`订阅` 是桌面里的原生窗口，直接复用 `mrhua/partials/windows/workspace/subscribe.html` 与 `loop-subscribe.js`，没有嵌入页、双层壳或身份认证门；`内核实况` 通过 `serial_bridge.py` 接收 QEMU 里真实内核的 80×25 VGA 差量帧，`展示页` 在窗口里打开原 `index.html`；`拍照` 会把地面网格和角色一起拍成图片，也接受本地图片，图片只保存在当前页面的内存里，刷新即清空，不上传、不写 localStorage；载入或拍下后会自动放进 3D 空间作为背景板，清空时一并移出。拍照窗口同时出现在左侧启动项和启动台里。其它应用窗口代码仍保留在注册表和 panels 里，通过 `MD.visibleApps` 控制是否显示；地面只保留角色位圆环，不渲染节点小标签，避免视觉噪声。展示页用 `#world` 做同一个长页的 3D 索引，5 个入口标签仍负责滚动和跳转。桌面页角色位 01 已接入真实 VRM，角色位 02 默认接入 PMX，也可以用 `?guide=live2d` 换成 Live2D。VRM 已有方向主光、环境补光、高光和 fresnel 轮廓光；角色画布默认显示在窗口后面，不会盖住窗口内容，场景工具栏里的“隐藏角色”可以整层收起角色。点击空白地面，离点击点最近的角色会走向该位置；近距离是 `walk`，远距离或按住 Shift 是 `run`，VRM 的步态来自 `engine/assets/all_animations.glb` 经 `AnimationRetarget` 重定向，PMX 用程序化 `walk` / `run`，待机头部朝向来自指针视线控制器。桌面页的 3D 空间不接节点点击，点地面不会误打开窗口。

- 代码：`js/scene/scene-core.js`、`scene-vrm.js`、`scene-pmx.js`、`scene-live2d.js`、`scene-desktop.js`、`scene-showcase.js`
- 模型：`engine/assets/models/furina/f芙宁娜.vrm`、`engine/assets/models/ganyu/甘雨.pmx`、`engine/assets/models/live2d/xiaoyue/xiaoyue.model3.json`
- 样式：`styles/scene3d.css`、`styles/showcase/world.css`
- 沉浸桌面：`desktop.html?scene=1`
- 贴地仰视：`desktop.html?scene=1&view=low`
- 完整说明见 [SCENE3D.md](SCENE3D.md)，引擎能力见 [ENGINE_INTEGRATION.md](ENGINE_INTEGRATION.md)

## 内核实况窗口

`apps/community/web/data/kernel.c` 是旧项目 `例6_完整内核/kernel.c` 的原文件完整副本（893 行、33,150 字节，SHA256 `2D3CD873BBC76E55A5C6E83DDF27325A3CB167D4B063B576852CE09768FE5C6C`），只作为源文件参考，不在桌面窗口里显示。

真正运行的内核在 `apps/console/kernel/robot/`：以这份 `kernel.c` 为基础，保留原来的三自由度机械臂渲染，追加了 COM1 串口初始化、VGA 差量扫描和 `A5 5A 01 COUNT ... CRC` 帧输出。`apps/console/bridge/serial_bridge.py` 读取 QEMU 串口并把 `{type:"frame",cells}` 广播到 `ws://127.0.0.1:8765`；桌面「内核实况」窗口的 `kernel.js` 只负责画这块 80×25 VGA，不再显示源码。没有连接时画布保持空白。

## 目录与归属

| 路径 | 归属 | 说明 |
| --- | --- | --- |
| `index.html` | 装配 | 页面结构 + 进度文案 + 对下面的引用，不写样式、不写逻辑 |
| `assets/favicon.ico` / `assets/favicon-32.png` | 资源 | 站点图标：透明底花形，ico 内含 16/32/48 三档 |
| `styles/tokens.css` | 全局 | 颜色、间距、字体令牌，**全站唯一色源** |
| `styles/base.css` | 全局 | 盒模型、页面底色、文字基线 |
| `styles/essence.css` | 组件 | 彩色灵体的形态、光晕、脉冲，以及游走/静态两态 |
| `styles/terminal.css` | 组件 | 终端面板：状态栏、画布、脚注 |
| `styles/progress.css` | 组件 | 进度区：四个统计数字 + 阶段清单（纯静态，无同名 js） |
| `styles/relay.css` | 组件 | 交流区：房间条、帖子流、发言框与窄屏布局 |
| `styles/layout.css` | 布局 | 页面骨架、区块间距、断点、减弱动效 |
| `js/core/bus.js` | 基础设施 | 事件总线，组件间唯一的通信通道 |
| `js/core/ws-connection.js` | 基础设施 | **唯一**持有 WebSocket 的地方，负责重连 |
| `js/core/demo-feed.js` | 可选数据源 | 离线时造演示帧，连上后自动停；整段删掉不影响别人 |
| `js/core/wander.js` | 基础设施 | 通用游走引擎：喂一个元素，它在区域里自己移动（详见下节） |
| `js/components/essence.js` | 组件 | 灵体：锚定/静态两态、收到帧就脉冲、连接状态决定在线/离线外观 |
| `js/components/screen.js` | 组件 | VGA 屏：唯一维护 screen 缓冲与 canvas 的地方 |
| `js/components/hud.js` | 组件 | 状态灯、帧数/格数、重连按钮、数据来源提示 |
| `js/components/relay.js` | 组件 | 中继交流区：心跳、轮询、发帖；线上同源 `/v1/`，本地才指 `127.0.0.1:8790` |
| `js/main.js` | 装配 | 只发起连接，别处不重复连 |

进度区的数字和阶段文案直接写在 `index.html` 里（静态内容不单开 js），改文案只改装配文件；要联动 `PROGRESS.md` 的话再另立数据文件，不在这里硬编码两套。

## 事件约定

| 事件 | 载荷 | 谁发 | 谁收 |
| --- | --- | --- | --- |
| `frame` | `{ type, cells: [[row, col, ch, attr], ...], demo? }` | `ws-connection` / `demo-feed` | `screen`、`essence`、`hud` |
| `link:state` | `{ state: "connecting" \| "online" \| "offline" }` | `ws-connection` | `essence`、`hud`、`demo-feed` |
| `demo:state` | `{ on: boolean }` | `demo-feed` | `hud` |

## 灵体为什么会自己动

`js/core/wander.js` 是从 MrHua（`mrhua/interfaces/static/engine-core/engine-extra.js` 第 232–667 行“自主游走系统”）抽出来的通用引擎，去掉了窗口停靠、3D 模型、菜单栏那些家电逻辑，只留“一个元素在一块区域里自己活着”的部分：

- 弹簧插值：`v = v * 0.85 + 距离 * 速度系数 * 0.15`，起步收尾都有惯性，不是匀速直线
- 起点：默认落在区域下缘；传 `start` 则用显式坐标起手，用于“从屏幕底部升上来”这类入场
- 边界：贴住即停，**不做反向回弹**——舞台往往只有一两百像素高，硬反弹会变成连续撞墙，看起来一顿一顿的
- 区域太小时不放弃：比元素还窄的那一轴直接钉在中线，宁可少动，也不把元素挤到区域外（这是“灵体跑到标题上方”的直接原因）
- 避障：按“最小重叠方向”每帧只推开 7px，滑出障碍矩形而不是瞬间瞬移 —— 障碍是首屏文字块，所以灵体不会压住正文
- 三个状态：`idle` 每 2.6–6.8 秒换个目标；`flee` 指针 150px 内且速度 > 0.55 时躲开；`magnet` 指针停驻且速度 < 0.25 时慢慢飘过去
- 30fps 节流、`document.hidden` 暂停，后台不空转

接口：

```js
const handle = AEVUM.wander.attach(el, {
  obstacles: [textBlock],      // 元素，或 () => rect（坐标须与 bounds 同坐标系）
  bounds: () => bandRect(),    // 可选：只在某块区域里活动（函数形式，每帧现算）
  start: { x: 320, y: 610 },   // 可选：起手坐标（与 bounds 同坐标系，元素中心）
  clampViewport: false,        // 元素锚在容器里时关掉视口裁剪
  toLocal: (cx, cy) => ({ x, y }),  // 可选：把视口指针坐标换算进同一坐标系
  pad: 16,
  size: 160,
  onMove(state) {}             // 每帧拿 x / y / vx / vy / mode
});
handle.detach();
```

灵体的形态（`essence.js` 决定，样式在 `essence.css`）：

| 形态 | 触发 | 表现 |
| --- | --- | --- |
| 锚定游走 | 宽屏（≥ 860px） | 挂在文字块下方、“进度口径”那行以下的一条窄带里左右游走；它是页面里的一件东西（`position: absolute`，包含块是 `.hero`），滚动时随内容一起走，滚回来还在原处，全程不做显隐 |
| 静态 | 窄屏 / `prefers-reduced-motion` | 留在文档流里，摆在文字块下方，不做位移 |

锚线取 `.hero__note`（“MPL-2.0 · 进度口径”）的下沿 + 16px，游走带就是锚线往下、高度为灵体尺寸 + 28px 的一条窄带，左右到文字列两端——所以它主要是横着走，纵向只留一点浮沉余量，看起来是“挂着那条线活着”，而不是在整块首屏里乱飘。灵体尺寸按锚线以下剩余空间取（`96–190px`），空间不够先缩它，不让它压回正文。

位置模型是这套代码的关键：**灵体不是视口上的悬浮层**。早先几版把它做成 `position: fixed`，再靠“滚一下淡出、停下再渐显、重新挂载到新落点”去掩盖它和页面的脱节，代价就是瞬移、消失、回来位置对不上。现在坐标全部写成相对 `.hero` 的形式（`getBoundingClientRect` 的差值与滚动无关），落点只在挂载时按锚线算一次，之后既不改位置也不改透明度。

`prefers-reduced-motion` 是浏览器读系统“动画效果”开关。系统关掉动画时，页面默认不做位移；要强制看动效，用 `index.html?motion=on`，这个开关只影响预览。

`prefers-reduced-motion` 是浏览器读系统“动画效果”开关。系统关掉动画时，页面默认不做位移；要强制看动效，用 `index.html?motion=on`，这个开关只影响预览。

## 改动规则

1. 一个组件 = 一个样式文件 + 一个逻辑文件，**同名成对**（`essence.css` ↔ `essence.js`）；纯静态区块（如 `progress.css`）可以只有样式，若将来需要交互再补同名 js。
2. 组件之间不互相 import、不互相取 DOM，只发/收事件。
3. 颜色只出现在 `tokens.css`，新增颜色先加令牌再用；样式加载顺序由 `index.html` 里的 `<link>` 顺序决定（tokens → base → 组件 → layout），不依赖文件名排序。
4. 加一个组件：新建同名 css/js → 在 `index.html` 里引入 CSS 与 script → 在 `js/main.js` 或组件自身向 bus 注册。
5. 删功能先删文件，再删 `index.html` 里的引用；`demo-feed.js` 是唯一可以整段删掉的可选模块。

## 跑起来

- 只看页面：双击 `index.html`（`file://` 也能跑，全部是普通脚本，没有 import / 构建）；中继不在线时交流区显示未连接，其余部分照常。
- 看交流区：

```bash
cd apps/relay && python -m relay
cd apps/community/web && python -m http.server 8080
```

打开 `http://localhost:8080`。内核实况面板在没有桥接时走演示帧；串口桥接与内核不在本仓库。

## 跟着服务器常驻

1. **nginx 托管页面**：指向 `apps/community/web`，`git pull` 即生效。
2. **中继常驻**：`apps/relay` 由 systemd 托管，只监听 `127.0.0.1:8790`。
3. **对外接口**：nginx 把 `/v1/` 反代到中继并注入 `X-Relay-Token`，浏览器拿不到令牌。
4. 一键部署：`sudo bash apps/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn`。

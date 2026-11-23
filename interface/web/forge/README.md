# AEVUM FORGE

机器人专用 3D 建模 / 控制台。第一台身体是 3R 平面机械臂。

## 跑起来

直接打开：

`interface/web/forge/index.html`

或从 `interface/web` 起静态服务：

```bash
cd interface/web
python -m http.server 8080
```

打开 `http://localhost:8080/forge/`。

页面不依赖 React、Three.js、构建工具或外部素材。3D 视口、矩阵、相机、网格、关节标签和绘制顺序都在 `js/render/` 下，由页面自己的 WebGL 代码实现。

## 目录约定

浅层只放入口和接口，深层放实现：

```text
forge/
├─ index.html                  # 只做装配：布局 + CSS/JS 引用
├─ api.js                      # 只做公开 API：window.AEVUM_FORGE
├─ app.js                      # 组合根：state、模块接线、帧循环
├─ styles/
│  ├─ tokens.css               # 颜色/尺寸令牌
│  ├─ base.css                 # reset + 基础控件
│  ├─ shell.css                # header / 三栏骨架 / toast
│  ├─ stage.css                # 3D 视口 / HUD / 关节标签
│  ├─ panels.css               # 左树 / 右 Inspector / bridge 表单
│  └─ telemetry.css            # footer 指标 / 误差曲线
└─ js/
   ├─ core/
   │  ├─ namespace.js          # AEVUM.FORGE 命名空间
   │  ├─ math.js               # 矩阵 / 投影 / 角度 / 数值格式
   │  └─ dom.js                # DOM 查询 / 下载 / 文件读取
   ├─ app/
   │  ├─ bridge-control.js     # WebSocket 生命周期 / 入站 q-target
   │  ├─ api-handlers.js       # api.js 背后的命令实现
   │  └─ frame-loop.js         # 帧循环：绘制 → 控制 → 遥测
   ├─ model/
   │  ├─ body-document.js      # BodyDocument schema + 默认 3R 身体
   │  └─ exporters.js          # JSON / MuJoCo XML / virtual-bus manifest
   ├─ control/
   │  ├─ pd-loop.js            # 100 Hz PD 被控对象
   │  └─ telemetry.js          # RMS / peak / torque 只读指标
   ├─ render/
   │  ├─ gl/
   │  │  ├─ shaders.js         # GLSL
   │  │  ├─ meshes.js          # box / cylinder / grid 顶点数据
   │  │  ├─ context.js         # WebGL context + program
   │  │  └─ buffers.js         # VBO 上传 + draw calls
   │  ├─ scene/
   │  │  ├─ camera.js          # 相机状态 + view-projection
   │  │  ├─ arm-scene.js       # BodyDocument → 3R 世界变换
   │  │  └─ joint-labels.js    # 关节标签投影
   │  └─ viewport/
   │     └─ renderer.js        # 绘制顺序 / 清屏 / 地面 / 工具
   ├─ ui/
   │  ├─ toast.js
   │  ├─ document-tree.js      # 左侧 BODY DOCUMENT
   │  ├─ inspector.js          # 右侧参数编辑
   │  ├─ controls.js           # RUN / SINE / RESET
   │  └─ telemetry-panel.js    # footer 指标 + 曲线
   └─ bridge/
      └─ websocket.js          # WebSocket 接缝，不认识内核
```

规则：

1. `index.html` 不写业务逻辑，只装配。
2. `api.js` 不碰 DOM、不碰渲染，只转发命令和快照。
3. `app.js` 只做组合，不实现矩阵、mesh、PD 公式。
4. 越底层的代码放越深；例如 GLSL 在 `render/gl/`，场景变换在 `render/scene/`。
5. 一个文件一个职责；新增能力先找已有 owner，不复制一份。

## 公开 API

页面加载后暴露：

```js
window.AEVUM_FORGE
```

可用方法：

| 方法 | 作用 |
| --- | --- |
| `getState()` | 当前运行状态、q/target、选中项、bridge、BodyDocument 快照 |
| `getDocument()` | 复制当前 BodyDocument |
| `setDocument(doc)` | 校验并替换 BodyDocument，重置仿真 |
| `setTarget(index, degrees)` | 设置单个关节目标角 |
| `setTargets(degrees[])` | 批量设置目标角 |
| `run()` / `pause()` | 启动 / 暂停 100 Hz 本地 PD |
| `reset()` | 回到目标姿态 |
| `sine(on)` | 开 / 关正弦激励；开时自动启动 |
| `getTelemetry()` | RMS、峰值、力矩、丢包 |
| `exportJson()` / `exportXml()` / `exportManifest()` | 导出文档 / MuJoCo 模型 / 虚拟总线 manifest |
| `connect(url)` / `disconnect()` | 连 / 断 WebSocket 接缝 |
| `subscribe(fn)` | 订阅遥测事件，返回取消函数 |

示例：

```js
AEVUM_FORGE.setTarget(1, 20);
AEVUM_FORGE.run();

const stop = AEVUM_FORGE.subscribe(function (msg) {
  if (msg.type === "telemetry") console.log(msg.rms, msg.peak);
});
```

## 内核边界

内核不在这里被 `import`。它是独立二进制，由 QEMU / Renode / 真实板加载；页面只负责呈现和本地控制可视化。

右上角 `KERNEL OFFLINE` 是真实状态，不是装饰。当前接缝：

```text
kernel ↔ UART / virtual bus ↔ WebSocket bridge ↔ interface/web/forge
```

页面默认连接 `ws://127.0.0.1:8765`。现有 P6 内核 UART 还只发 VGA 单元差分帧、输入只认 `F` 全量刷新，没有关节控制命令通道；下一阶段需要给内核补最小的 `J` 命令 / `S` 状态帧，再用 QEMU 串口接 TCP，由 bridge 转成 WebSocket。此时 `KERNEL LINK` 才是真的。

## 目录边界

`interface/web/forge/` 只做呈现与本地控制可视化，不直接读数据库、不直接碰串口，也不承载身份业务。真正的串口桥和内核分别在 `src/kernel/host/bridge/` 与 `src/kernel/host/console/robot/`。

Forge 不放在 `build/`：`build/` 是构建产物和本地缓存，`.gitignore` 会忽略它；源码和产品页面放在 `interface/web/forge/`。

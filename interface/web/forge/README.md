# AEVUM FORGE

机器人专用 3D 建模 / 控制台。第一台身体是 3R 平面机械臂；同时支持导入 glTF / GLB，把任意节点树变成可编辑 link/joint 树。内核接入后可按关节手动控制，并显示完整运动学状态。

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

## 建模与导入

- 左侧 `BODY DOCUMENT` 显示当前 link/joint 树。每个节点可选中，右侧 Inspector 编辑关节轴、原点、目标角、限位、力矩、惯量和 PD 参数。
- 右侧 `IMPORT glTF / GLB` 接受 `.glb`，或同时选择 `.gltf` 与它引用的 `.bin`。导入后自动生成 `aevum.body/1`：每个 glTF node 变成一个 link，父子节点自动生成 joint；轴优先读 `node.extras.jointAxis`，否则按节点平移主轴启发式推断。仓库自带 `samples/arm3.glb`，3 links / 36 triangles，可直接导入验证。
- 导入模型只在本地建模 / 仿真；只有与内核几何一致的 3R 链（3 个 link、Z 轴、0.30/0.30/0.20 m、parent -1/0/1）才显示 `KERNEL COMPATIBLE` 并接收内核状态。其他模型显示 `KERNEL LOCAL ONLY`，不会被内核状态覆盖。
- `SAVE JSON` / `LOAD JSON` 保存完整 `aevum.body/1`，包含三角网格；导入模型暂不导出 MuJoCo XML。

## 接真实内核（手动关节 + 完整状态）

链路是双向的：

```text
QEMU COM1 (TCP 5555)
  ├─ A5 5A 03 13 + 19×i32 LE + CRC     # q/dq/q_target/末端/运动学/模式
  │    └─ serial_bridge.py → ws://127.0.0.1:8765 {type:"status", ...}
  │         └─ Forge  KERNEL / MANUAL HOLD | AUTO
  └─ 'J' + 3×int16 LE (0.001 rad)      # ← Forge {type:"joint", q}
```

启动顺序：

1. 构建内核（WSL）：

```bash
wsl -d kali-linux -- bash -lc "cd /mnt/d/Aevum/src/kernel/host/console/robot && make clean && make all"
```

2. 启动 QEMU；`build/local-test/run-qemu.bat` 已把串口改成：

```text
-serial tcp:127.0.0.1:5555,server,nowait
```

3. 启动桥接：

```powershell
D:\venv\Scripts\python.exe D:\Aevum\src\kernel\host\bridge\serial_bridge.py
```

4. 打开 `interface/web/forge/index.html`，点 `CONNECT` 或调用：

```js
AEVUM_FORGE.connect();
```

进入内核模式的标志：

- 顶部变成 `KERNEL LINK`，模式 pill 显示 `KERNEL / MANUAL HOLD` 或 `KERNEL / AUTO`；
- `RUN` 按钮变成 `MANUAL` / `MANUAL ON`；`SINE TEST` 和 `RESET` 禁用，本地 100 Hz PD 暂停；
- Inspector 的 `KERNEL STATUS / 0x03` 显示 MODE、末端误差、可操作度、sigma min/max、null-space share、limit margin、max |dq|、target X/Y；
- 底部曲线切换成内核 q 轨迹；拖动 target 或调用 `setTargets()` 会下发 `J` 并进入手动保持；
- 手动保持靠页面每帧重发 `joint`（桥接 100 ms 节流）；停止下发后内核 5 秒无命令自动回 AUTO。

边界：

- 内核臂几何是 `0.30 + 0.30 + 0.20 m`（约 0.80 m），Forge 原生页面臂约 1.38 m；q 可以共享，**末端笛卡尔目标不能直接共享**。
- 只有 3R 兼容链接内核；导入的其他模型保持本地，状态帧被兼容性守卫丢弃。
- 手动模式是关节空间 PD，不替代内核原有自动正弦/雅可比控制；超时回 AUTO 由内核 PIT tick 判定。


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
   │  ├─ bridge-control.js     # WebSocket 生命周期 / 0x03 状态 / joint 命令
   │  ├─ api-handlers.js       # api.js 背后的命令实现
   │  └─ frame-loop.js         # 帧循环：绘制 → 控制 → 遥测
   ├─ model/
   │  ├─ body-document.js      # BodyDocument schema / 3R 默认身体 / 导入校验
   │  ├─ gltf-loader.js        # GLB / glTF 2.0 → aevum.body/1
   │  └─ exporters.js          # JSON / MuJoCo XML / virtual-bus manifest
   ├─ control/
   │  ├─ pd-loop.js            # 100 Hz PD 被控对象
   │  └─ telemetry.js          # RMS / peak / torque 只读指标
   ├─ render/
   │  ├─ gl/
   │  │  ├─ shaders.js         # GLSL
   │  │  ├─ meshes.js          # box / cylinder / grid 顶点数据
   │  │  ├─ context.js         # WebGL context + program
   │  │  └─ buffers.js         # VBO 上传 / 任意三角网格 / draw calls
   │  ├─ scene/
   │  │  ├─ camera.js          # 相机状态 + view-projection + 导入自动取景
   │  │  ├─ arm-scene.js       # 原生 3R → 世界变换
   │  │  ├─ body-scene.js      # 任意 link/joint 树 → 世界变换
   │  │  └─ joint-labels.js    # 关节标签投影
   │  └─ viewport/
   │     └─ renderer.js        # 绘制顺序 / 清屏 / 地面 / 工具
   ├─ ui/
   │  ├─ toast.js
   │  ├─ document-tree.js      # 左侧 BODY DOCUMENT
   │  ├─ inspector.js          # 右侧参数编辑 / KERNEL STATUS
   │  ├─ controls.js           # RUN / MANUAL / SINE / RESET
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
| `getState()` | 当前运行状态、q/target、选中项、bridge、`kernel` / `manual` / `kernelStatus`、BodyDocument 快照 |
| `getDocument()` | 复制当前 BodyDocument |
| `setDocument(doc)` | 校验并替换 BodyDocument，重置仿真 |
| `importModel(name, buffer)` | 解析 `.glb` 或 `.gltf` ArrayBuffer，替换为 `aevum.body/1`，返回 segments / triangles / kernel 兼容性 |
| `setTarget(index, degrees)` | 设置单个关节目标角；kernel 下自动进入手动并下发 |
| `setTargets(degrees[])` | 批量设置目标角；kernel 下自动进入手动并下发 |
| `setManual(on)` | kernel 下开 / 关手动保持；关闭后 5 秒无命令内核回 AUTO |
| `run()` / `pause()` | 本地启动 / 暂停 100 Hz PD；kernel 下等价于开 / 关手动保持 |
| `reset()` | 回到目标姿态（仅本地；kernel 抛错） |
| `sine(on)` | 开 / 关正弦激励；开时自动启动（仅本地；kernel 抛错） |
| `getTelemetry()` | 本地 RMS / 峰值 / 力矩 / 丢包；kernel 下返回 q/dq/qTarget/末端误差/可操作度/sigma/null share/limit margin/mode |
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

右上角 `KERNEL OFFLINE` 是真实状态，不是装饰。当前已接通的接缝：

```text
kernel ↔ UART / virtual bus ↔ WebSocket bridge ↔ interface/web/forge
```

P6 内核 UART 现在发三种帧，并接受两种输入：

- `A5 5A 01 COUNT [row col ch attr] * COUNT CRC`：VGA 单元差分；
- `A5 5A 02 03 q0 q1 q2 CRC`：旧只读 q 帧，保留兼容；
- `A5 5A 03 13 + 19×i32 LE + CRC`：完整状态，字段顺序是 q3 / dq3 / q_target3 / target.x,y / err_mm / w_manip / sigma_min / sigma_max / null_share / limit_margin / mode / null_on；
- `J` + 3×int16 LE（0.001 rad）：页面下发关节目标；
- `F`：请求内核全量 VGA 刷新。

桥接把 `0x03` 转成 `{type:"status", ...}` 广播，新客户端会收到最近一帧；页面消息 `{type:"joint", q}` 转成 `J` 写回内核。内核手动模式用 PIT tick 计时，`MANUAL_TIMEOUT_TICKS=500`（100 Hz，5 秒）无新命令回 AUTO。

页面默认连接 `ws://127.0.0.1:8765`。导入的非 3R 模型会被 `kernelCompatibility()` 拦下，只做本地建模，不会污染 q。

## 目录边界

`interface/web/forge/` 只做呈现与本地控制可视化，不直接读数据库、不直接碰串口，也不承载身份业务。真正的串口桥和内核分别在 `src/kernel/host/bridge/` 与 `src/kernel/host/console/robot/`。

Forge 不放在 `build/`：`build/` 是构建产物和本地缓存，`.gitignore` 会忽略它；源码和产品页面放在 `interface/web/forge/`。

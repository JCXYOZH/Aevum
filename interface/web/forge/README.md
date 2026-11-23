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

## 接真实内核（只读 q）

当前接的是 P6 内核的**只读关节状态**，不是双向控制。链路是：

```text
QEMU COM1 (TCP 5555)
  └─ A5 5A 02 03 q0 q1 q2 CRC   # i32 LE, Q16.16 rad
       └─ src/kernel/host/bridge/serial_bridge.py
            └─ ws://127.0.0.1:8765  {type:"state", q:[...]}
                 └─ Forge  KERNEL q / READ ONLY
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

进入只读模式的标志：

- 顶部变成 `KERNEL LINK` + `KERNEL q / READ ONLY`；
- `RUN / SINE TEST / RESET` 被禁用，本地 100 Hz PD 暂停；
- 底部不再显示本地 RMS/PEAK/TORQUE 数值，改为 `N/A`，曲线切换成三条内核 q（角度）轨迹；
- 页面只接收 q，不向内核发送目标；bridge 的 WebSocket 入站消息仍被丢弃，只在下发 `F` 时请求内核全量刷新 VGA。

边界：

- 内核臂几何是 `0.30 + 0.30 + 0.20 m`（约 0.80 m），Forge 页面臂约 1.38 m；q 可以共享，**末端笛卡尔目标不能直接共享**。
- 当前没有 `J` 关节目标命令、没有内核手动模式、没有状态超时保护；这些属于下一阶段双向控制。
- 只读 q 不改变内核控制律；内核仍按自己的正弦末端目标运行。


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
   │  ├─ bridge-control.js     # WebSocket 生命周期 / 入站 q（只读）
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
| `getState()` | 当前运行状态、q/target、选中项、bridge、`kernel` 只读标志、BodyDocument 快照 |
| `getDocument()` | 复制当前 BodyDocument |
| `setDocument(doc)` | 校验并替换 BodyDocument，重置仿真 |
| `setTarget(index, degrees)` | 设置单个关节目标角（仅本地；kernel 只读模式抛错） |
| `setTargets(degrees[])` | 批量设置目标角（仅本地；kernel 只读模式抛错） |
| `run()` / `pause()` | 启动 / 暂停 100 Hz 本地 PD；kernel 只读模式不能 `run()` |
| `reset()` | 回到目标姿态（仅本地；kernel 只读模式抛错） |
| `sine(on)` | 开 / 关正弦激励；开时自动启动；kernel 只读模式抛错 |
| `getTelemetry()` | RMS、峰值、力矩、丢包；kernel 只读模式下 RMS/峰值/力矩为 `null` |
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

P6 内核 UART 现在发两种帧：

- `A5 5A 01 COUNT [row col ch attr] * COUNT CRC`：VGA 单元差分；
- `A5 5A 02 03 q0 q1 q2 CRC`：3 个 Q16.16 弧度关节角，只读观测。

桥接只把 `0x02` 转成 `{type:"state", q:[...]}` 并广播；页面收到 q 后进入只读跟随，不发送目标。内核输入目前仍只认 `F` 全量刷新，没有 `J` 关节控制命令通道，也没有状态超时/看门狗；因此 `KERNEL LINK` 表示“已收到真实内核 q”，不表示“页面能驱动内核”。

页面默认连接 `ws://127.0.0.1:8765`。下一阶段才是双向控制：给内核补 `J` 命令、手动关节目标模式和超时回退，再决定几何映射；在这些完成前，保持只读。

## 目录边界

`interface/web/forge/` 只做呈现与本地控制可视化，不直接读数据库、不直接碰串口，也不承载身份业务。真正的串口桥和内核分别在 `src/kernel/host/bridge/` 与 `src/kernel/host/console/robot/`。

Forge 不放在 `build/`：`build/` 是构建产物和本地缓存，`.gitignore` 会忽略它；源码和产品页面放在 `interface/web/forge/`。

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

页面是单文件，不依赖 React、Three.js、构建工具或外部素材。3D 视口、矩阵、相机、网格、关节标签和点击拾取都在 `index.html` 自己的 WebGL 代码里。

## 页面结构

- 左：`BODY DOCUMENT`，base + `J1 SHOULDER` / `J2 ELBOW` / `J3 WRIST`
- 中：3D 机械臂、轨道相机、关节标签和拾取
- 右：`INSPECTOR`，目标角、限位、力矩、惯量、阻尼、`Kp/Kd`、连杆长宽深
- 下：控制频率、RMS/峰值误差、力矩、丢包、仿真时间、误差曲线

顶部按钮：

- `RUN` / `PAUSE`：暂停/继续 100 Hz PD 控制
- `SINE TEST`：给 J2/J3 加正弦目标，用于看控制效果
- `RESET`：回到默认姿态

文档输出：

- `SAVE JSON` / `LOAD JSON`：保存和恢复 BodyDocument
- `MUJOCO XML`：导出 MuJoCo 模型；已用 MuJoCo 4.0.1 验证 `5 bodies / 3 joints / 3 actuators`
- `BUS MANIFEST`：导出 `aevum.virtual_bus/0` 虚拟总线描述

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

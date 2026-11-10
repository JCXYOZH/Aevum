# 开发入口

## 仓库结构

```text
apps/
  community/web      展示页与看板（静态 HTML/CSS/JS）
  console/monitor    监控 API + 模型子进程
  console/bridge     串口 -> WebSocket
  console/kernel     引导、状态机、错误码
  desktop            Electron 壳与安装包配置
  relay              纯内存中继
src/
  memoria            C++ 训练/生成内核；另有早期 Python 接口空目录
  fortuna / libertas / common / integrations   其他方向占位
include/memoria       C++ 头文件
scripts               构建、训练、生成、桌面栈、Linux、打包
data                  公开语料；权重不进仓库
docs                  设计、架构、使用、排障
```

## 起完整本地栈

```powershell
scripts\desktop.ps1
```

`-NoKernel` 跳过 QEMU；`-Electron` 起桌面壳；`-Stop` 停掉本脚本起的进程。

## 编译 Memoria

```powershell
scripts\build.ps1
```

需要 VS2022 Build Tools、Windows SDK 与 LibTorch。路径全部可用 `MEMORIA_*` 环境变量覆盖。Linux 用：

```bash
bash scripts/build-linux.sh
```

## 训练与生成

```powershell
scripts\train.ps1 -Epochs 2 -Dim 48 -Batch 16 -Device cuda
scripts\generate.ps1 -Checkpoint "build\checkpoint_demo" -Prompt "What " -Device cpu
```

看板读 `build\training_metrics.jsonl` 与检查点；没有指标文件就不画曲线。

## 改页面

展示页在 `apps/community/web/index.html`，看板在 `desktop.html`；样式按 `styles/showcase` 与 `styles/desktop` 分开，灵体只有 `styles/presence.css` 一份。不要把一个组件的样式拆回 HTML 内联。

## 打包

开源目录默认不含 `node_modules`。如果本机没有 `apps\desktop\node_modules\electron\dist`，用外部 Electron 运行时，不往仓库里拷依赖：

```powershell
$env:MEMORIA_ELECTRON_DIST = "<path-to-electron-dist>"
$env:MEMORIA_MONITOR_EXE = "<path-to-monitor-exe>"   # 可选；monitor 已在本仓库构建时可省略
cd apps\desktop
npm run dist:installer
```

`dist-app\win-unpacked` 是免安装目录；`Memoria-Control-Desk-Setup-*.exe` 是 Inno Setup 安装包。两者都不含 `node_modules` 与训练权重。低内存机器用 `dist:installer`；它绕开 electron-builder 解压 Electron 的内存峰值，用 `apps\desktop\installer.iss` 调 ISCC 编译，形式和 mrhua 的 Windows 安装包一致。

## 训练指标与路径

`training_metrics.jsonl`、检查点 exe 和语料不是写死的绝对路径，默认由运行位置推出来：

- 源码运行监控：`desktop_server.py` 的 `ROOT` 是仓库根，`BUILD_ROOT` 默认是 `<repo>\build`，因此指标默认落在 `<repo>\build\training_metrics.jsonl`，模型默认是 `<repo>\build\memoria_gen_cpu.exe`。在开源目录里跑就是 `D:\Aevum\build\...`；只有从旧工作目录跑旧源码，才会落到旧目录。
- 打包运行：`main.js` 注入 `MEMORIA_ROOT=resources`，`BUILD_ROOT` 默认是 `resources\build`，并在启动 monitor 前创建该目录；安装器也给 `{app}\resources\build` 授予用户写权限。因此安装后的默认指标路径是 `<安装目录>\resources\build\training_metrics.jsonl`，不会去读开发机的旧工作目录。要读外部权重，显式设置 `MEMORIA_BUILD_ROOT`，或在安装目录 `resources` / exe 旁放 `model-root.txt`。
- 模型生成器 `memoria_gen_cpu.exe` 依赖 `torch_cpu.dll` 等 CPU 运行时，不是单文件程序。把运行时 DLL 放到 `<build-root>\runtime`，或显式设置 `MEMORIA_TORCH_LIB`；monitor 会把该目录加到生成子进程的 `PATH`。不要把 `D:\venv` 这类开发机路径写进代码。
- 训练脚本 `scripts/train.ps1` 默认把指标写到同一个 `build\training_metrics.jsonl`，所以源码模式下看板与训练自动对齐。

其他覆盖项：`MEMORIA_DATA_ROOT` 换语料目录，`MEMORIA_WEB_ROOT` 换页面目录，`MEMORIA_ERROR_TABLE` 换错误码表。

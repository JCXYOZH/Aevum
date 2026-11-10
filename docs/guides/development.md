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

```powershell
cd apps\desktop
npm install
npm run dist
```

`dist-app\win-unpacked` 是免安装目录；`Memoria-Control-Desk-Setup-*.exe` 是安装包。两者都不含 `node_modules` 与训练权重。

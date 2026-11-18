# Memoria Control Desk

Electron 桌面壳。页面本体仍是 `interface/web/desktop.html`；壳只负责开无菜单窗口，并在需要时拉起本地监控服务。

## 先起服务

在仓库根目录：

```powershell
ops\scripts\desktop.ps1
```

端口：

- `8781` 看板与监控 API（`archive/backend-python/monitor/desktop_server.py`）
- `8790` 中继 API（`command/relay`）
- `8765` 内核串口桥接 WebSocket
- `5555` QEMU 串口

只起页面、中继与监控：

```powershell
ops\scripts\desktop.ps1 -NoKernel
```

停止：

```powershell
ops\scripts\desktop.ps1 -Stop
```

## 再开桌面壳

```powershell
cd interface\desktop
npm install
npm start
```

`main.js` 会先检查 `8781`；没有服务时用 `MEMORIA_PYTHON` 指定的解释器拉起 `archive/backend-python/monitor/desktop_server.py`。也可以：

```powershell
ops\scripts\desktop.ps1 -NoKernel -Electron
```

## 打包

两套目标并存：

```powershell
$env:MEMORIA_ELECTRON_DIST = "<path-to-electron-dist>"
$env:MEMORIA_MONITOR_EXE = "<path-to-monitor-exe>"   # 可选
npm run dist:installer  # Windows Inno Setup 安装包，低内存路径
npm run dist:dir        # 免安装目录：dist-app\win-unpacked
```

`npm run dist` 仍是 electron-builder 的常规 NSIS 路径；这台机器上它在解压 Electron 时会 OOM，因此实际验收走 `dist:installer`：用 `node_modules\electron\dist` 拼出完整 app 目录，再由 `installer.iss` 调 Inno Setup 7 的 `ISCC.exe` 编译，产物在 `interface\desktop\dist-app\Memoria-Control-Desk-Setup-0.1.0.exe`（约 96 MB）。开源目录没有 `node_modules` 时，用 `MEMORIA_ELECTRON_DIST` 指向外部运行时，不要把依赖拷进仓库。

安装包带 Electron 运行时、监控 exe、前端页面、错误码表和 3000 行语料，**不带训练权重**。安装器会创建 `{app}\resources\build` 并授予用户写权限；安装后默认指标路径是 `<安装目录>\resources\build\training_metrics.jsonl`，不是旧工作目录。要读外部权重，设置 `MEMORIA_BUILD_ROOT`，或在 `resources` / exe 旁放 `model-root.txt`。模型生成器 `memoria_gen_cpu.exe` 依赖 `torch_cpu.dll` 等 CPU 运行时，把 DLL 放到 `<安装目录>\resources\build\runtime`，或设置 `MEMORIA_TORCH_LIB`；安装包本身不夹这组运行时。安装器提供中文/英文向导、程序图标、可选桌面快捷方式和开始菜单项；窗口图标由 `main.js` 的 `icon.ico` 设置。

## 窗口

- 左栏是启动项；中间可以同时开多个窗口。
- 「展示页」窗口加载 `index.html`，原页面没有被删除。
- 「新增窗口」把名字和地址存进本机 `localStorage`，出现在启动台和总览插槽里。
- 模型窗口有「本地检查点」和「云端模型 / 后端代理」；云端模式由监控服务代理，页面只显示状态，不保存地址或密钥。
- 内核窗口只在打开时连 `ws://127.0.0.1:8765`，避免没有 QEMU 时反复重连。

# Memoria Control Desk

Electron 桌面壳。页面本体仍是 `apps/community/web/desktop.html`；壳只负责开无菜单窗口，并在需要时拉起本地监控服务。

## 先起服务

在仓库根目录：

```powershell
scripts\desktop.ps1
```

端口：

- `8781` 看板与监控 API（`apps/console/monitor/desktop_server.py`）
- `8790` 中继 API（`apps/relay`）
- `8765` 内核串口桥接 WebSocket
- `5555` QEMU 串口

只起页面、中继与监控：

```powershell
scripts\desktop.ps1 -NoKernel
```

停止：

```powershell
scripts\desktop.ps1 -Stop
```

## 再开桌面壳

```powershell
cd apps\desktop
npm install
npm start
```

`main.js` 会先检查 `8781`；没有服务时用 `MEMORIA_PYTHON` 指定的解释器拉起 `apps/console/monitor/desktop_server.py`。也可以：

```powershell
scripts\desktop.ps1 -NoKernel -Electron
```

## 打包

两套目标并存：

```powershell
npm run dist:installer  # Windows NSIS 安装包，低内存路径
npm run dist:dir        # 免安装目录：dist-app\win-unpacked
```

`npm run dist` 仍是 electron-builder 的常规 NSIS 路径；这台机器上它在解压 Electron 时会 OOM，因此实际验收走 `dist:installer`：用 `node_modules\electron\dist` 拼出完整 app 目录，再直接调 NSIS 编译器，`SetCompress off`，产物在 `apps\desktop\dist-app\Memoria-Control-Desk-Setup-0.1.0.exe`（约 281 MB）。

安装包带 Electron 运行时、监控 exe、前端页面、错误码表和 3000 行语料，**不带训练权重**。安装目录的 `resources/build` 可放检查点，或设置 `MEMORIA_BUILD_ROOT`。

## 窗口

- 左栏是启动项；中间可以同时开多个窗口。
- 「展示页」窗口加载 `index.html`，原页面没有被删除。
- 「新增窗口」把名字和地址存进本机 `localStorage`，出现在启动台和总览插槽里。
- 模型窗口有「本地检查点」和「云端加载 / 预留位」；云端只存地址，不假装接通。
- 内核窗口只在打开时连 `ws://127.0.0.1:8765`，避免没有 QEMU 时反复重连。

# Aevum QML 外壳

这是 QML 原生外壳的第一版原型。它只做外壳，不重写 3D 渲染：

- QML 负责窗口、顶部状态栏、左侧启动项、黄纸底色、灵体和底部状态。
- 一个 `WebEngineView` 只加载现有 `desktop.html?scene=1&qml=1`，继续使用仓库里已有的 AEVUM JS 3D 渲染器。
- 页面加载完成后注入一段很小的宿主样式：隐藏 HTML 的窗口层、启动台、旧顶栏/侧栏，只留 3D 场景。
- 不使用每个应用一个嵌入窗口，也不新增第二套 Web/3D 渲染器。

## 运行

先启动现有桌面服务：

```powershell
$env:LIBERTAS_DATA_DIR='D:\LibertasData\AevumData'
$env:PYTHONPATH='D:\Aevum\src;D:\Aevum'
D:\venv\Scripts\python.exe D:\Aevum\archive\backend-python\monitor\desktop_server.py --port 8799
```

再启动 QML 外壳：

```powershell
$env:LIBERTAS_DATA_DIR='D:\LibertasData\AevumData'
$env:PYTHONPATH='D:\Aevum\src;D:\Aevum'
D:\venv\Scripts\python.exe D:\Aevum\interface\desktop\qml\qml_shell.py
```

`8799` 是场景页和健康检查的来源；QML 外壳本身只监听本机，不另外开端口。

## C 内核串口

`qml_shell.py` 里的 `KernelBridge` 已经预留了 QEMU 串口桥：

- 连接 `127.0.0.1:5555`；
- 按 `A5 5A` 帧格式解析，统计帧数和单元数；
- 连接后发送 `F`，请求内核补一帧完整 VGA；
- 侧栏「串口」打开的是原生 QML 抽屉，不是 HTML 内核窗口。

下一步接 C 内核时，直接把串口帧喂给这个 bridge，或把帧数据转成原生 QML 面板即可；不需要再引入一套渲染层。

## 文件

- `Main.qml`：窗口、WebEngine、宿主样式注入、串口抽屉、拍照保存提示。
- `AevumTopBar.qml`：原生顶部栏和健康状态。
- `AevumDock.qml`：原生左侧启动项、灵体和场景视角按钮。
- `AevumFoot.qml`：原生底部状态。
- `Theme.qml`：沿用现有黄纸/琥珀/青/珊瑚 token。
- `SpiritOrb.qml`：QML Canvas 灵体。
- `qml_shell.py`：QML 入口、健康探针、串口桥、照片保存。

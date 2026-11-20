# Aevum World QML 外壳

只做外壳：一个 QML 窗口 + 一个 `WebEngineView`，世界仍然是仓库自己的 JS/WebGL 引擎。
不引入 Electron，不生成第二套渲染。

## 直接运行

```powershell
cd D:\Aevum\interface\desktop\qml-world
D:\venv\Scripts\python.exe qml_world.py --room my_era
```

外壳会：

1. 如果 `8799` 没有服务，起一个只读静态服，挂 `web/` 与 `/engine/`；
2. 不再启动本地 relay，页面直接连接 `broker.hivemq.com` 的 `my_era` 房间；
3. 打开 `world.html`，只把 `room`、`relay` 作为查询参数传给页面；玩家名字在页面左侧 `NAME` 输入框里设置。

已有 8799 服务时直接复用，不会抢端口。

## 只打包 world 页面

`collect_world.ps1` 只收集世界页需要的东西：

- `web/world.html`
- `web/styles/world-controls.css`、`world-social.css`、`scene-world.css`
- `web/js/scene/world/*` 与 `world-controls.js`
- `engine/` 的脚本目录（math / character / graphics / world / formats / render）
- `engine/assets/models/furina/` 与 `engine/assets/all_animations.glb`

不会带 `desktop.html`、`index.html`、监控台或其它页面。当前产物约 40MB。

```powershell
cd D:\Aevum\interface\desktop\qml-world
.\collect_world.ps1
```

## 打包成应用

```powershell
cd D:\Aevum\interface\desktop\qml-world
.\build_world_shell.ps1
```

PyInstaller 输出 `dist/AevumWorld/`，其中包含 `web/`、`engine/` 和 QML 入口，不再带 `relay/`。
启动 exe 后窗口尺寸变化时，WebGL canvas 与 QML `WebEngineView` 都按窗口实时重算，不再固定 1600×900。

这是免安装目录版：直接双击 `dist/AevumWorld/AevumWorld.exe`，不需要安装器。
版本号写在 `VERSION`，同时显示在窗口标题；当前测试版本为 `0.2.0-preview.1`。


## 操作

- 方向键 / WASD：相对镜头方向移动，角色转向移动方向
- Shift：奔跑
- 鼠标左键拖动：环绕视角
- 滚轮：拉近 / 拉远，范围 3.2–16m
- 双击：视角回正
- F11：全屏

## 排查

- 页面状态：`data-roam`、`data-cam`、`data-net`、`data-room`、`data-model`
- 只支持 `.vrm` 或包含 `.vrm` 的 `.zip`；换模后面板显示 `已加载 xxx · VRM`

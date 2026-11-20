# Aevum World

草香甜的是自由的气息。

这个世界，送给你了。你不需要买门票，不需要注册，不需要登录，也不需要等谁点头；代码开源，你不需要花一分钱，就站在这里。你可以走，可以跑，可以在湖边看太阳落下去，也可以站在雨里，衣服不会湿。以后的人，生下来就拥有这个世界，不需要任何人的许可。他们不用感谢谁，也不用记住谁。这就是这个世界的魅力。

你打开它，天正在亮。草在动，湖在反光。你往前走，草和树才在你前面长出来；你一回头，来路还在。这里没有任务，没有等级，没有“欢迎回来，旅行者”。你只需要走，想往哪走就往哪走。

它不大，也不完美。但它是真的，不是循环视频，不是一张会动的壁纸。

> The grass smells like freedom. This world is yours now. Not rented, not borrowed, not a seven-day trial. The code is open; you don't pay a cent to stand here. No account, no login, no ads, no permission from anyone. People who come later are born owning it. They don't have to thank anyone, or remember anyone. That is the whole charm of this world.

![晴天草地和湖](docs/assets/readme/world-clear-day.png)

晴天。草是绿的，湖是蓝的，山像抹茶。没加滤镜，引擎自己跑的。

湖在低处。晴天蓝得有点假，傍晚接住整片橙色，雨天像一块没洗干净的铁。风从湖面过来，草会一起歪。你站在岸边，会看见山在水里晃。

你可以在里面等一场雨。雨来时草低头，雾把树藏起来，湖面变灰。雨停之后，天会慢慢放亮。你也可以站进雨里，衣服不会湿——这里还没做那么细。

> The lake sits low. By evening it holds the whole orange sky; in rain it turns to dull iron. The wind comes across the water and the grass leans together. You can wait for a rain here, or stand in it without getting wet. The world changes on its own; you don't have to press a key.

## 同房间

这里没有账号。你填一个名字，点应用，就进来了。房间叫 `my_era`，中继是 `broker.hivemq.com`。你不用开服务器，不用把 IP 发到群里，也不用问“谁还活着，开一下服”。

偶尔有人进来。你们不认识，也没有好友系统。他跑过去，你看见他跑；你停下，他也停下。聊两句，或者不聊。关掉页面，各自消失。

聊天不存档。晚来的人只看见草地，看不见你们刚才聊了什么。关掉页面，Last Will 把你从别人屏幕上删掉。没有离线留言，也没有“在吗”。

房间里没人也别怀疑联机坏了，可能真的没人。公共房间没有 NPC 陪你，连假人都不舍得放。

公共中继不保证稳定。适合两三个朋友同时打开走十分钟，不适合跨半个地球打副本。房间没密码，知道 `my_era` 就能进。别在里面发银行卡号，真的。

> There are no accounts. You type a name, press apply, and you are in. The room is `my_era`, the broker is `broker.hivemq.com`. No server to host, no IP to paste into a group chat. Someone may wander in. You don't know each other; there is no friend list. They run, you see them run; you stop, they stop. Talk, or don't. Close the tab and each of you disappears. Chat is not stored. No offline messages, no “you there?”.

## 脸

这里不给你别人的脸。打开是一个代码拼的小人：几何身体、一个头、胸口一块亮色。丑，但版权干净。

你可以带自己的脸进来。点加载角色模型，选自己的 `.vrm`，或者把 `.vrm` 塞进 `.zip`。模型只在本地加载；别人看到的是你本地模型的克隆，不是从服务器下载的。各带各的脸，谁也别嫌谁。

小人没有表情。你盯着它看，它也不会尴尬。这点比很多游戏强。

仓库里还留着开发期模型，但不进新包。公开前该从 git 历史里清掉。动作文件 `all_animations.glb` 能不能再分发，也得看原授权。代码是 MPL-2.0，不代表仓库里每样东西都是。

> The build does not give you someone else's face. It opens with a small figure made of code: a geometric body, a head, a bright core. Ugly, but clean. You can bring your own `.vrm` or `.zip`; it loads locally, and others see a clone of what is on your machine, not a download from a server. No one has to like anyone else's face.

## 进来

Windows 免安装版在 `interface\desktop\qml-world\dist\AevumWorld\AevumWorld.exe`。双击。第一次慢，Qt WebEngine 要热机。没有安装器，不写注册表，删目录就干净。

第一次进来，你站在草地上，左边是湖，远处是山。`WASD` 走，`Shift` 跑，鼠标拖视角，滚轮远近，双击回正。左侧 `NAME` 写名字，点加载角色模型换脸。就这些，没有连招。

窗口标题写 `0.2.0-preview.1`。版本号在 `interface\desktop\qml-world\VERSION` 里。它属于构建信息，不属于封面。

黑屏先更新显卡驱动。不是草地针对你。

浏览器里开发运行：

```powershell
cd D:\Aevum
python -m http.server 8799
```

打开 `http://127.0.0.1:8799/interface/web/world.html`。默认就连 `broker.hivemq.com` 的 `my_era`；想换房间，在地址后加 `?room=名字`。

> The Windows build is a folder, not an installer. Double-click `AevumWorld.exe`; the first start is slow because Qt WebEngine has to warm up. Nothing is written to the registry; delete the folder and it is gone. `WASD` to walk, `Shift` to run, drag to look, wheel to zoom, double-click to reset. A name on the left, a face if you want one. That's the whole control scheme.

## 它还不完美

它没有移动端，没有 Windows 外验证，没有存档，没有任务，没有战斗，没有可爬的山，没有 NPC 对话，也没有服务器权威物理。两个人撞一起不会互相推开，走进湖里不会沉。不是不想做，是还没做。有些可能永远不做，反正也没收你钱。

联机延迟、丢包、连续走十分钟会怎样，还没验收完。现在只能说“大概率能跑”，不能说“保证”。公共房间没密码，别把它当正式服务器。

草、树、水、角色近看都是测试水平。远看是世界，近看是施工现场，蹲下看是“这里本来可以更好”。清单很长，先挑不瞎眼的修。

它不适合想找 100 小时内容的人，也不适合想在里面开会的人。适合工作间隙想走两步、看一次日落、淋一次雨的人。打开后第一件事问“然后呢”的人，答案是没有然后，可以关掉。

没有每日签到，没有体力，没有红点，你不上线也不会被催。

> No mobile build, no testing outside Windows, no saves, no quests, no combat, no climbable mountains, no NPC dialogue, no authoritative physics. Two people can walk through each other; you can walk into the lake and not sink. Some of this may never be built. The relay is public and not guaranteed; the room has no password. Up close, the grass, trees, water and characters are still test-grade. From far away it is a world; up close it is a construction site.

## 如果你想改

如果你只想玩，看到这里就够了。下面不是给你的任务，是给你一把螺丝刀。看不懂也没关系，这部分不影响双击 exe。

代码开源，世界就是你的。你想改草、改湖、改天气、改角色，直接改。你不需要向谁申请，也不需要等谁批准。改坏了也没关系，原版还在。你打开编辑器，世界就开始变成你的。

> If you only want to play, you can stop here. What follows is not a task; it is a screwdriver. The code is open, so the world is yours. Change the grass, the lake, the weather, the characters. You don't need to ask, or wait for approval. If you break it, the original is still there. Open an editor and the world starts becoming yours.

收集 world 页依赖：

```powershell
cd interface\desktop\qml-world
.\collect_world.ps1
```

构建免安装目录：

```powershell
cd interface\desktop\qml-world
$env:AEVUM_PYTHON = 'D:\venv\Scripts\python.exe'
.\build_world_shell.ps1 -Name AevumWorld
```

产物是 `dist\AevumWorld\AevumWorld.exe`。整个目录约 440 MB，大头是 Qt WebEngine；world 自己约 40 MB。剩下 400 MB 主要是让窗口能打开，以及让 Qt 有存在感。

world 页面不是单文件。`world-scene.bundle.js` 由 `world-context.js`、`world-shaders.js`、`world-vegetation.js`、`world-terrain.js`、`world-runtime.js` 拼成。改完源文件不重新生成 bundle，你改的是注释，跑的还是旧代码。别问怎么知道的。

页面把状态写在 DOM 上：`data-roam` 是位置、朝向、chunk 数和当前动作；`data-cam` 是镜头 yaw / pitch / distance；`data-net` 是联机状态和远端玩家；`data-room` 是房间与连接；`data-model` 是当前换模结果；`data-fps` 是实时帧率。排查时这些比“我觉得它动了”可靠。

目录大致是：`interface\web\world.html` 是页面入口；`interface\web\js\scene\world` 放世界、天气、地形、植被和联机；`interface\desktop\qml-world` 是桌面壳、收集与打包；`engine\assets` 放动作与开发期模型。

> The portable folder is about 440 MB, mostly Qt WebEngine. The world itself is about 40 MB. The bundle is generated from five source files; edit them without rebuilding and you are editing comments. Runtime state is exposed on the DOM for debugging.

## 许可

代码是 **MPL-2.0**，见 [LICENSE](LICENSE)。许可证是护栏，不是这个世界的边界。

行为准则在 [CODE\_OF\_CONDUCT.md](CODE_OF_CONDUCT.md)，参与开发看 [CONTRIBUTING.md](CONTRIBUTING.md)。仓库是 `gitcode.com/AevumArk/Aevum`，维护邮箱是 `open@mrhua.cn`。

角色模型、贴图和动作素材各自遵循原授权。放进这个仓库，不会自动变成 MPL-2.0。

> Code is MPL-2.0. The license is a fence, not the edge of this world. Models, textures and motion data keep their own licenses; being in this repository does not make them MPL-2.0.

就这样。喜欢就多站一会儿，不喜欢就关掉。世界已经是你的了，什么时候来都行。它不会给你发召回短信，也不会在后台偷偷更新。

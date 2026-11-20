# Aevum World

> 一个双击就能走进去的 3D 草地。  
> 不用装环境，不用注册，甚至不用先看完这篇文档。

测试版本：**`0.2.0-preview.1`**

<p align="center">
  <img src="docs/assets/readme/world-clear-day.png" width="49%" alt="晴天草地和湖">
  <img src="docs/assets/readme/world-sunset.png" width="49%" alt="傍晚草地">
</p>

<p align="center">
  <sub>晴天和傍晚。都是引擎实时跑的，不是渲染视频——所以草会动，云会飘，帧率也很诚实。</sub>
</p>

截图里我把界面和角色关了，免得像产品发布会。你自己打开时，左边有聊天框，右边有时钟和天气，画面中间还有个角色。

---

## 先说结论

这不是 3A 大作。

它是一个**真的能走、能跑、能联机、会下雨、会长草**的 3D 世界。远山有点像抹茶蛋糕，湖像没化开的牛奶，草偶尔会穿模。但它不是贴图假 3D，也不是一段剪好的演示视频。

更重要的是：**它不占你时间。**

- 没有安装器。
- 不写注册表。
- 不弹“请先注册账号”。
- 不要求你先装 Unity、UE 或者 20GB 素材包。
- 不好玩的话，关掉窗口就行，它不会赖着不走。

---

## 30 秒试一下

找到这个目录：

```text
interface\desktop\qml-world\dist\AevumWorld\
```

双击：

```text
AevumWorld.exe
```

然后：

1. 看到草地。
2. 按 `W` 往前走。
3. 按 `Shift` 跑起来。
4. 鼠标拖一下，看看湖和山。

如果窗口开了但画面黑着，多半是显卡驱动在闹脾气；先更新驱动，再来一次。世界不会因此记仇。

---

## 它现在能干什么

- **走路**：`WASD` / 方向键，相对镜头移动；按上就是朝你看的方向走，不是朝世界北边一路撞墙。
- **跑**：按住 `Shift`，角色会迈开腿。
- **转镜头**：鼠标左键拖动环绕，滚轮拉近拉远，双击回正。
- **看天气**：黎明、正午、黄昏、夜晚，晴、多云、雨、暴风雨、雪、雾。太阳和月亮真的会跟着时间走。
- **联机**：默认连德国公共中继，进 `my_era` 房间，有世界聊天和在线人数。
- **看别人**：现在对方显示的是**同一个 VRM 角色**，不是方块人。两个人贴脸时也不会突然消失。
- **换角色**：支持 `.vrm`，也支持把 `.vrm` 塞进 `.zip` 直接选。换完还是同一个世界角色，只是换了张皮。
- **名字自己填**：打开游戏后，在左侧 `NAME` 输入框里写名字，点“应用”就行。不用命令行，不用改配置。

---

## 联机小抄

两个人各开一个窗口，直接双击：

```powershell
cd interface\desktop\qml-world\dist\AevumWorld
.\AevumWorld.exe
.\AevumWorld.exe
```

打开后都在 `my_era` 房间，中继是 `broker.hivemq.com`。在左侧 `NAME` 输入框里各写一个名字，点“应用”，然后互相走近一点。

以前走近会看到一根方块；现在能看到对方也顶着同一个 VRM，站在草地上。跑、走、站着发呆都有自己的动作，不会复制你的姿势——至少看起来像两个人在同一个世界里。

联机走的是 HiveMQ 的 MQTT over WebSocket，状态大约 8Hz 发一次。公共中继不保证速度和稳定性，所以它更适合“朋友同时打开试一下”，还不适合“跨半个地球打副本”。聊天只转发给当前在线的人，不存档，晚进来的人看不到前面的消息。

---

## 它不擅长什么

- 每个远端玩家会按自己发来的 `run` / `walk` / `idle` 播动作，不再跟着本地角色一起摆；但大家暂时共用同一个 VRM 和同一套骨骼，换模不会跨客户端同步。
- 联机走公共 MQTT 中继，没有私有房间密码；谁都知道 `my_era` 就能进来，聊天也不存档。
- 公共中继的延迟、丢包和连续走十分钟，这些都还没完整验收。
- 草、树、水、角色都还是测试版水平。远看是世界，近看是“正在施工”。
- 当前测试包默认角色是第三方 Furina，详见下面的素材说明。公开发布前建议换掉。

---

## 自己构建

不想看代码可以跳过。下面这一整段都不会影响你双击 exe。

只收集 world 页依赖：

```powershell
cd interface\desktop\qml-world
.\collect_world.ps1
```

构建免安装目录版：

```powershell
cd interface\desktop\qml-world
$env:AEVUM_PYTHON = 'D:\venv\Scripts\python.exe'
.\build_world_shell.ps1 -Name AevumWorld
```

产物：

```text
dist\AevumWorld\AevumWorld.exe
```

整个目录大约 440 MB，大头是 Qt WebEngine；真正属于 world 的网页和引擎载荷约 40 MB。

版本号写在 `interface\desktop\qml-world\VERSION`，也会显示在窗口标题：

```text
Aevum World 0.2.0-preview.1
```

`world.html?v=...` 和 `vrm-renderer.js?v=...` 只是资源缓存版本，不是产品版本。别拿它当版本号发出去，不然很难解释为什么 0.2.0 后面还跟着 g9y。

---

## 开发运行

只起网页和世界：

```powershell
cd D:\Aevum
python -m http.server 8799
```

打开：

```text
http://127.0.0.1:8799/interface/web/world.html
```

不需要另起中继：页面默认就连 `broker.hivemq.com` 的 `my_era` 房间。想换房间就在地址后加 `?room=随便一个名字`。

页面状态可以直接看 DOM：

- `data-roam`：位置、朝向、chunk 数、当前动作
- `data-cam`：镜头 yaw / pitch / distance
- `data-net`：联机状态和远端玩家
- `data-room`：房间与连接状态
- `data-model`：当前换模结果
- `data-fps`：实时帧率

调试的时候，这些属性比“我觉得它动了”可靠。

---

## 默认角色与第三方素材

> **当前测试包默认加载的 `f芙宁娜.vrm` 是第三方《原神》角色模型，不是 Aevum 自制的小积木人，也不属于本项目的 MPL-2.0 授权范围。**

它目前只用于本地联调和换模验收。公开发布前，最好做下面三件事之一：

1. 删除 `engine/assets/models/furina/` 里的第三方模型；
2. 把 `world-runtime.js` 的默认 VRM URL 换成自制或明确授权的 VRM；
3. 或直接给空场景 + “加载角色模型”入口，让用户自己选。

代码是 **MPL-2.0**；角色模型、贴图和动作素材各自遵循原授权。放进这个仓库，不会自动变成 MPL-2.0。

---

## 许可与联系

- 代码：**MPL-2.0**，见 [LICENSE](LICENSE)
- 行为准则：[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- 参与开发：[CONTRIBUTING.md](CONTRIBUTING.md)
- 仓库：`gitcode.com/AevumArk/Aevum`
- 维护邮箱：`open@mrhua.cn`

> Aevum 还很不成熟。  
> 但它已经有一片会长草的草地、一个会反光的湖、一个能走进去的第三人称世界，和一群可以一起上线的人。
>
> 你可以先试三十秒。不好玩就关掉，真的。

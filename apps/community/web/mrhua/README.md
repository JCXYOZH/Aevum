# MrHua 页面结构

这是从旧 `mrhua/interfaces/templates/index.html` 直接拆出来的模块化版本。页面标题、开门文案、窗口内容和视觉样式保持 MrHua 原样，只把组织方式改成“壳 + partials + 独立样式/脚本”。

## 目录

```text
mrhua/
├─ index.html                      页面壳，只负责 meta、样式入口、启动脚本和 #mrhua-root
├─ partials/
│  ├─ manifest.json                按顺序加载的 partial 清单
│  ├─ shell/                       页面壳层
│  │  ├─ boot.html                 初始加载指示器
│  │  ├─ gateway.html              开门画面
│  │  ├─ orb.html                  灵体、环形菜单、命令面板
│  │  ├─ dock.html                 主状态栏、任务栏
│  │  ├─ launcher.html             启动器窗口
│  │  ├─ overlays.html             实验创建弹窗、全局思考指示器
│  │  ├─ dialogs.html              自定义 confirm/alert 弹窗
│  │  └─ exit-dialog.html          退出确认弹窗
│  └─ windows/                     功能窗口，按领域分组
│     ├─ dialogue/                 对话
│     ├─ network/                  网络中心、镜像舱、局域网/广域网共享、节点同步
│     ├─ security/                 作战、扫描、快扫、规则、告警、沙箱、脱敏、图谱
│     ├─ ai/                       AI 中心、知识、记忆、实验、治理、云
│     ├─ tools/                    浏览器、HTTP、代码、开发者工具、插件、工作流、报告、版本、快照
│     ├─ workspace/                任务、贡献、联系人、监控、便签、通知、委派、白板、搜索、状态、反馈、终端
│     └─ system/                   设置、认证、身份
├─ styles/
│  ├─ base.css                     防闪屏黑底
│  ├─ theme.css                    主主题、灵体、窗口、任务栏
│  ├─ loading.css                  初始加载动画
│  ├─ launcher.css                 启动器分类与按钮
│  └─ modal.css                    自定义弹窗
└─ js/
   ├─ importmap.js                 三方库 importmap 开关（默认关闭；Aevum 暂无 /cdn-proxy）
   ├─ runtime-guard.js             QtWebEngine 兼容、错误监控、全局错误处理
   ├─ engine-loader.js             调用 OrbLoader 装载 legacy orb 模块
   ├─ boot.js                      partials 装载器；DOM 就绪后再按顺序装载 UI 脚本
   ├─ dialog.js                    自定义 alert/confirmAsync
   └─ scripts.json                 页面级脚本清单
```

## 加载顺序

`boot.js` 先读取 `partials/manifest.json`，把壳层和全部窗口拼进 `#mrhua-root`，然后读取 `js/scripts.json` 依次装载：

1. `dialog.js`
2. `/engine/legacy/orb/core/orb-index.js`
3. `/apps/console/ui/shell/app-shell.js`
4. `/apps/console/ui/orb/orb-ui.js`
5. `/apps/console/ui/skin/skin-app.js`
6. `/apps/console/ui/world/world-app.js`
7. `/apps/console/ui/dialogue/voice.js`

这样 `app-shell.js` 执行时，所有窗口 DOM 已经存在。

## 本次拆分处理

- 原页面 51 个顶层窗口块，拆分后保留 50 个：启动器放入 `shell/`，其余 49 个进入 `windows/`。
- 原页面第 2865 行和第 5013 行是同一份“漏洞知识图谱”窗口，`id` 和内容完全重复；只保留第一份，删掉第二份重复块。
- 原页面 5 个 `<style>` 块、5 个内联 `<script>` 块分别落入 `styles/` 和 `js/`。
- 没有改写任何窗口内的文案、按钮、id 或 `onclick`。

## 已接的功能

- 身份认证：`/api/auth/*` 由 `apps/console/monitor/auth_api.py` 接到
  `libertas.identity.user.UserManager`（账号、密码、会话）与
  `libertas.identity.auth_manager.AuthManager`（验证码、许可证、激活、账号找回/重置、子用户）。
  `win-identity` 的注册、登录、验证码、激活、账号找回、重置账户和身份档案均使用这套真实后端。
- 对话：`/api/chat/stream_token`、`/api/chat/with_file`、`/api/chat/new_session`、
  `/api/chat/cancel` 由 `apps/console/monitor/chat_api.py` 接到 `desktop_server.py` 已有的
  本地生成器（`POST /api/model/generate` 同一套检查点、数据文件和设备参数）。前端收到的是
  SSE `chunk/done/error` 事件，附件消息收到普通 JSON `{success, reply}`。
- 页面静态资源：`desktop_server.py` 现在可以直接提供
  `/apps/console/ui/*`、`/engine/*` 和 `/apps/community/web/*`，不需要再单独复制脚本。

## 广域网嵌入模式

当前 3D 桌面用 `mrhua-wan` 应用打开广域网通信窗口：

```text
http://127.0.0.1:8799/mrhua/?embed=wanshare
```

嵌入模式只把 `#win-wanshare` 留在页面上，隐藏开门动画、灵体、任务栏、启动器和其它窗口；`boot.js` 会跳过开门动画并自动打开广域网窗口，`app-shell.js` 在 `window.MR_EMBED_WANSHARE` 为真时不做身份认证拦截。窗口内部的文案、控件、id 和样式保持原样。

这个模式目前只负责“把广域网页面接进来”。`/api/wan/status`、`/api/wan/connect`、`/api/wan/send` 等接口在 `desktop_server.py` 还没有路由，点击连接会按原前端逻辑请求并失败；下一步要补的是真实的 WAN HTTP 适配层，不是在前端猜接口。

## 本地运行

身份认证和对话依赖 `desktop_server.py` 的真实后端，不能用纯静态服务验收。启动：

```powershell
$env:LIBERTAS_DATA_DIR = "C:\Temp\aevum-auth-test"
python D:\Aevum\apps\console\monitor\desktop_server.py --port 8799
```

打开：

```text
http://127.0.0.1:8799/mrhua/
```

`LIBERTAS_DATA_DIR` 只用于隔离测试账户；正式运行不要设置它，默认数据仍在
`D:\LibertasData`。页面也可以从
`http://127.0.0.1:8799/apps/community/web/mrhua/index.html` 打开。

`python -m http.server` 只适合看静态布局：它没有 `/api/auth/*` 和 `/api/chat/*`，
注册、登录、对话都会失败。

## 还没接的部分

- 旧 `/static/*`、`/qwebchannel.js`、`/cdn-proxy/*` 路径没有复制进 Aevum，拆分时不再引用这些旧路径。
- 当前只装载 Aevum 实际存在的 `engine/legacy/orb` 与 `apps/console/ui` 文件；旧页面里的 `spirit-render-extra`、`humanoid-action`、`world3d-main`、`spirit-interaction` 在 Aevum 没有同名文件，暂不猜测路径。
- 页面仍会调用旧 `/api/orb/commands`、扫描、网络共享、知识库等接口；这些不在本次身份认证/对话接线范围内，仍需按真实后端逐项接。
- 对话的回复质量取决于 `build/` 下当前检查点。仓库内只有 `checkpoint_aevum_shakespeare`（小词汇量 Shakespeare 模型），它不是通用聊天模型；配置云端模型并注入 `LIBERTAS_CLOUD_API_KEY` 后，才适合作为通用对话。

## 已做验证

2026-11-15 在 `--port 8799` 的 `desktop_server.py`、临时数据目录
`C:\Temp\aevum-auth-test` 下用真实 HTTP 和无头 Edge 点击验证：

- `GET /api/auth/status`、`GET /api/current_user`：未登录返回未登录，登录后返回
  `username`、`identity_id`、`activated`。
- `send_code` → `register` → `login` → `activate`：注册返回用户名、许可证、激活码；
  激活后 `status.activated=true`。
- 子用户创建、列出；`reset` 后同一邮箱/手机号可重新注册；`recover` 能返回账户信息。
- `POST /api/chat/stream_token` 返回 `tool_status`、`chunk`、`done`；未登录返回 401。
- 无头 Edge 实际打开 `win-identity`、填写登录表单、点击登录：
  `loginDisplay=block`、`isLoggedIn=true`、徽标显示“已激活”。
- 无头 Edge 实际打开 `win-chat`、点击发送：消息进入 `chat-messages`，SSE 回复渲染完成。

对话内容本身受当前本地检查点限制，验证时输出为小词汇量 Shakespeare 文本，不是通用助手回复。

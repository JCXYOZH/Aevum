# 变更记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

> 历史记录中的路径按当时结构保留，不代表当前目录。当前结构见 [STRUCTURE.md](STRUCTURE.md)。

## [Unreleased]

### Added

- `apps/console/monitor/api/visitor.py`：访客入口、公开社区概览与隔离数据作用域；访客 Cookie 由服务端签发，前端传入的 `user_id` 不再作为身份依据。
- `/api/visitor/bootstrap` 与 `/api/community/overview`：返回访客角色、权限说明、每日额度、社区注册/在线/房间统计和角色文化；不返回任何服务器路径。
- 访客 AI 对话：`/api/chat/stream_token` 未登录也可用，按访客作用域落盘；每日 30 条，额度用尽提示登录；文件分析仍要求登录。
- 注册用户/访客各自使用 `user_data/users/<user_id>` 与 `user_data/guests/<guest_id>` 隔离目录，聊天历史从内存字典改为按作用域持久化。
- 广域网 presence 只传播 `data_scope`（`user:<id>` / `guest:<id>`），不传播绝对路径；各节点在本机解析目录。
- `/api/model` 对非本机 Host 只返回模型元信息，`/api/model/generate` 只在本机开放，避免公网拿到服务器路径和模型子进程入口。
- `src/memoria/`：Memoria C++ 内核（17 个 `.cpp`：门控、链单元、三层平衡、分层记忆、训练、生成、检查点）。
- `include/memoria/`：与源码对应的 15 个公共头文件。
- `apps/console/monitor/`：桌面监控 API、模型生成子进程与检查点发现。
- `apps/desktop/`：Electron 壳；`npm run dist:installer` 为 Inno Setup 安装包，`npm run dist:dir` 为免安装目录；窗口图标、任务栏 AppUserModelId 与安装器快捷方式图标已配置。
- `apps/desktop/installer.iss`：Inno Setup 7 脚本；中文/英文向导、程序图标、可选桌面快捷方式、开始菜单与卸载项，与 mrhua 的安装形式一致。
- `scripts/build-installer.ps1`：用已下载的 Electron dist 拼完整 app 目录后调 ISCC，绕开 electron-builder 解压 Electron 与 7z 的内存峰值。
- `apps/community/web/desktop.html`：多窗口看板；`index.html` 保留为展示页并可作看板窗口。
- `apps/community/web/styles/presence.css`：展示页与看板共用的灵体组件。
- `data/tinyshakespeare_3000.txt`：3000 行公开语料。
- `scripts/build-linux.sh`：Linux 云端编译入口（train / gen / gen_cpu）。
- `docs/memoria/`、`docs/architecture/memoria.md`、`docs/guides/development.md`：Memoria 与开发入口文档。

### Changed

- 治理窗口改为只读：`/api/governance/status|proposals|forks|requirements` 和 `/api/community/stats` 返回角色与统计；投票、提案、分叉写操作统一 403。角色文化卡片不再放在治理窗口，改到 3D 桌面「总览」的纯文字介绍里。
- 3D 桌面取消了独立的「操作手册」启动项和按钮式卡片；桌面操作与十级社区角色文化并进「总览」页，只保留文字，不再新增第二个入口。
- MrHua 首页主舞台去掉写死的 `opacity:0`，并让 `boot.js` 先直接装载 `app-shell`，避免页面只剩灵体、启动项和窗口不出现。
- FastAPI 侧接入治理只读路由；`Request` 显式注解，避免 `from __future__ import annotations` 下被当成查询参数返回 422。
- 3D 桌面的 MrHua 启动项改为 `/mrhua/?public=1`，访客先看到工作台，再按需登录；访客 AI 对话不再被 401 挡住。
- 前端聊天对 429 额度耗尽返回可读提示，不再只显示 `HTTP 429`。
- `README.md` 代码位置表改为当前真实结构；本地开发命令改到 `scripts/desktop.ps1`。
- `PROGRESS.md` 状态与新目录对齐；安装包与 Linux 产物单独标为未验收。
- `apps/desktop/README.md` 改掉 portable-only 与“必须本机 Python”的旧说法。
- 展示页与看板配色统一回纸黄系；看板保留深色终端块。
- `scripts/build.ps1`、`scripts/build-linux.sh` 的源码路径改到 `src/memoria/`。

### Fixed

- `hello_torch.obj` 从仓库根目录移除。
- `.gitignore` 增加 `node_modules/`、`dist-app/`、`build/`、`*.exe`、权重与日志，避免构建产物进入开源仓库。

### Notes

- 模型权重、检查点和 `node_modules` 不入库；模型发布走 Release 附件或服务器目录。
- 安装包渠道从 NSIS 改为 Inno Setup 7：`dist:installer` 已产出 `Memoria-Control-Desk-Setup-0.1.0.exe`（约 95 MB），产物不进 Git。常规 `npm run dist` 仍留作内存充足构建机使用。

## [0.1.0] - 2026-11-08

### Added

- `apps/community/web/`：社区静态站首版。单文件 HTML，零依赖，零构建步骤。
- 入口文档：`README.md`、`PROGRESS.md`、`ROADMAP.md`、`start_here.md`、`CONTRIBUTING.md`、`CHANGELOG.md`。
- `CODE_OF_CONDUCT.md`：行为准则独立成文件。
- `apps/community/README.md`：平台本体的目录说明、本地预览与上线方式。

### Changed

- `README.md` 由行为准则改写为项目说明，补代码位置表与入口索引。
- `docs/index.md` 从空文件改为文档索引。

### Notes

- 站点里的社区二维码是占位，图片待放入 `apps/community/web/assets/qrcode.png`。
- `src/` 下仍无源代码；`configs/`、`deployment/`、`docs/` 其余文件为 0 字节占位。
- 服务端 API 架构未定，见 ROADMAP P2。

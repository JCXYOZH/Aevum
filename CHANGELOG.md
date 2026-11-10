# 变更记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [Unreleased]

### Added

- `src/memoria/`：Memoria C++ 内核（17 个 `.cpp`：门控、链单元、三层平衡、分层记忆、训练、生成、检查点）。
- `include/memoria/`：与源码对应的 15 个公共头文件。
- `apps/console/monitor/`：桌面监控 API、模型生成子进程与检查点发现。
- `apps/desktop/`：Electron 壳；`npm run dist:installer` 为低内存 NSIS 安装包，`npm run dist:dir` 为免安装目录。
- `scripts/build-installer.ps1`：用已下载的 Electron dist 拼完整 app 目录后直接调 NSIS，绕开 electron-builder 解压 Electron 的内存峰值。
- `apps/community/web/desktop.html`：多窗口看板；`index.html` 保留为展示页并可作看板窗口。
- `apps/community/web/styles/presence.css`：展示页与看板共用的灵体组件。
- `data/tinyshakespeare_3000.txt`：3000 行公开语料。
- `scripts/build-linux.sh`：Linux 云端编译入口（train / gen / gen_cpu）。
- `docs/memoria/`、`docs/architecture/memoria.md`、`docs/guides/development.md`：Memoria 与开发入口文档。

### Changed

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
- NSIS 安装包在本机受 electron-builder 解压 Electron 的内存峰值限制；`dist:installer` 已产出 `Memoria-Control-Desk-Setup-0.1.0.exe`（约 281 MB），产物不进 Git。常规 `npm run dist` 仍留作内存充足构建机使用。

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

# 变更记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

## [Unreleased]

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

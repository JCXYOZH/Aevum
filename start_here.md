# 从这里开始

三条路，选一条。每条不超过五分钟。

## 我只是想看看这是什么

1. [README.md](README.md) —— 项目是干什么的，代码在哪
2. [STRUCTURE.md](STRUCTURE.md) —— 目录怎么分层，为什么这样分
3. [docs/glossary.md](docs/glossary.md) —— 专有名称和通用术语
4. [PROGRESS.md](PROGRESS.md) —— 真实进度，含“未完成”清单
5. [ROADMAP.md](ROADMAP.md) —— 接下来打算做什么
6. `interface/web/index.html` —— 页面本身，双击就能打开

## 我想提代码

1. [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) —— 先知道边界在哪
2. [CONTRIBUTING.md](CONTRIBUTING.md) —— 命名约定、一次更新一次提交、提交信息格式
3. [docs/glossary.md](docs/glossary.md) —— 先统一术语，再写代码和文档
4. [PROGRESS.md](PROGRESS.md) 的“缺口”一节 —— 那里写着现在缺什么
5. 从 [ROADMAP.md](ROADMAP.md) 的 P1 或 P2 挑一件，别自己发明需求

## 我要把它挂到服务器

1. [interface/web/README.md](interface/web/README.md) —— 静态站怎么起、怎么更新
2. [ops/deploy/systemd/README.md](ops/deploy/systemd/README.md) —— Linux 服务、nginx、证书
3. [docs/guides/deployment.md](docs/guides/deployment.md) —— 部署流程与检查清单

## 第一次来容易踩的坑

- `fortuna`、`libertas`、`memoria` 是同一个仓库里的模块名，不是三个仓库；职责见 [docs/glossary.md](docs/glossary.md)。
- `src/kernel`、`src/architecture`、`engine` 是三个核心运行时；`control/` 是控制平面，不是第四个核心。
- `archive/backend-python/monitor` 是已放弃的 Python 业务后端，只读保留，不参与新功能。
- `build/`、`checkpoints/`、`data/`、`logs/`、`models/`、`vendor/` 是运行状态和缓存，不提交。
- 站点没有构建步骤，也没有依赖；改完 HTML 刷新即生效。

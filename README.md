# Aevum

社区共建的社区平台。工具、文档、成员之间的协作，收在同一块地方。代码以 [MPL-2.0](LICENSE) 开源。

- 仓库：`gitcode.com/AevumArk/Aevum`
- 许可：Mozilla Public License 2.0
- 当前状态：骨架 + 静态站（**没有可运行的服务端**）
- 维护邮箱：`open@mrhua.cn`

---

## 这是什么

Aevum 是社区自己的平台，不是某个产品的官网。它的目标是：一份 Web 前端，既能挂在自己的服务器上访问，也能被桌面端打包带走，多窗口，并且带真实的工作能力（社区的工具按需调度、本地安装、内置更新）。

目前只走到第一层——一个静态站点。服务端 API 的架构还没定，前端也没有账号、发帖和检索。

## 代码在哪里

| 路径 | 是什么 | 状态 |
| --- | --- | --- |
| `apps/community/` | **社区平台本体**（前端 Web，后续加桌面壳） | 静态站已上线 |
| `apps/community/web/` | 静态站点；nginx 可直接指向这个目录 | 运行中 |
| `src/fortuna/` | 内核方向：引导、内核、内存、调度、文件系统、网络、沙箱 | 空骨架 |
| `src/libertas/` | 安全方向：扫描、蜜罐、取证、SIEM、逆向、响应 | 空骨架 |
| `src/memoria/` | 记忆方向：记忆层、知识库、检索、训练、量化 | 空骨架 |
| `src/common/` | 三个模块共用的基础件（缓存、队列、日志、校验等） | 空骨架 |
| `src/integrations/` | 外部系统对接（redis / postgres / kafka / openai / huggingface 等） | 空骨架 |
| `docs/` | 设计、架构、ADR、运维文档 | 占位 |
| `deployment/` | docker-compose、镜像、k8s、helm、ansible、terraform | 占位 |
| `configs/` | 各模块配置样例 | 占位 |
| `tests/` | 分层测试（unit / integration / performance / security） | 占位 |
| `benchmarks/`、`experiments/`、`models/` | 基准、实验记录、模型产物 | 占位 |
| `tools/`、`bin/`、`build/`、`sandbox/`、`scripts/` | 开发与构建辅助、临时实验区 | 占位 |

**"占位"的意思是 0 字节**。仓库里除 `LICENSE`、`README.md`、`CODE_OF_CONDUCT.md` 和 `apps/` 下的站点文件外，全部是空文件——它们标记了结构，不是能用的实现。`sandbox/` 是留给未验证实验的地方，稳定之前不进 `src/`。

## 现在做到哪一步

见 [PROGRESS.md](PROGRESS.md)。一句话：816 个文件里 806 个是空占位，`src/` 下 533 个文件没有一行代码，能打开的只有 1 个页面——就是 `apps/community/web/index.html`。

## 接下来做什么

见 [ROADMAP.md](ROADMAP.md)。下一步是把这个页面挂上服务器，然后是服务端 API 的三个选型决定。

## 怎么开始

| 你想做的事 | 先读 |
| --- | --- |
| 三分钟内弄清这是什么 | [start_here.md](start_here.md) |
| 提代码 | [CONTRIBUTING.md](CONTRIBUTING.md)（一次更新一次提交） |
| 把站点跑起来 | [apps/community/README.md](apps/community/README.md) |
| 了解行为边界与举报流程 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 看文档索引 | [docs/index.md](docs/index.md) |

## 许可与行为准则

代码以 MPL-2.0 授权，见 [LICENSE](LICENSE)。参与社区与仓库的行为受 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 约束，举报渠道 `open@mrhua.cn`，48 小时内确认收到。该准则由 Contributor Covenant v2.1 改编，并按本项目"命名—呈现—指认"的三条心法做了调整。

---

In English: Aevum is a community-built platform for its own community — tools, documents and collaboration in one place. Right now the repository is a skeleton plus a single static page; there is no working server yet. Code is licensed under MPL 2.0, and participation is governed by `CODE_OF_CONDUCT.md` (report to `open@mrhua.cn`).

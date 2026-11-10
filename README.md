# Aevum

社区共建的社区平台。工具、文档、成员之间的协作，收在同一块地方。代码以 [MPL-2.0](LICENSE) 开源。

- 仓库：`gitcode.com/AevumArk/Aevum`
- 许可：Mozilla Public License 2.0
- 当前状态：展示页 + 多窗口看板 + 纯内存中继 + Memoria C++ 训练/生成内核 + Electron 桌面壳；安装包构建脚本已接入，权重与语料默认不打包
- 维护邮箱：`open@mrhua.cn`

---

## 这是什么

Aevum 是社区自己的平台，不是某个产品的官网。它的目标是：一份 Web 前端，既能挂在自己的服务器上访问，也能被桌面端打包带走，多窗口，并且带真实的工作能力（社区的工具按需调度、本地安装、内置更新）。

目前有三部分：一个静态站点，一个只活在内存里的中继服务，一套内核与串口后端。中继负责会话、上下文与分片传输，不写盘、不建账号、不做检索；内核只产生状态、错误码与 80×25 单元格，不参与显示；页面完全由前端呈现。

## 代码在哪里

| 路径 | 是什么 | 状态 |
| --- | --- | --- |
| `apps/community/web/` | 展示页 `index.html` + 多窗口看板 `desktop.html`，可直接挂 nginx | 已实现 |
| `apps/relay/` | **纯内存中继**：会话、上下文、分片传输、在线计数；无数据库、无落盘 | 已实现 |
| `apps/relay/contracts/` | 唯一契约源：`errors.json`（`0xRRFFTT` 码表）、`api.json`（HTTP 面） | 定稿 |
| `apps/relay/deploy/` | 一键部署：systemd 单元、nginx vhost、`install.sh` | 可用 |
| `apps/console/monitor/` | `desktop_server.py`：桌面监控 API，读检查点、训练指标、错误码，起模型子进程 | 已实现 |
| `apps/console/bridge/` | 串口帧转 WebSocket，页面不直接碰内核 | 已实现 |
| `apps/console/kernel/` | 引导、状态机、错误码、80×25 单元格；只做逻辑，不含页面 | 维护中 |
| `apps/desktop/` | Electron 壳；`npm run dist:installer` 出 Inno Setup 安装包，`dist:dir` 出免安装目录 | 安装包已出 |
| `src/memoria/` | Memoria C++ 内核：门控、链单元、三层平衡、分层记忆、训练、生成、检查点 | 可编译 |
| `include/memoria/` | C++ 公共头文件；与 `src/memoria` 一一对应 | 可编译 |
| `data/tinyshakespeare_3000.txt` | 3000 行公开语料，用于小模型冒烟训练；不是权重 | 已入库 |
| `scripts/` | 构建、训练、生成、桌面栈、Linux 编译、桌面打包 | 可用 |
| `src/fortuna/` | 内核方向：引导、内核、内存、调度、文件系统、网络、沙箱 | 空骨架 |
| `src/libertas/` | 安全方向：扫描、蜜罐、取证、SIEM、逆向、响应 | 空骨架 |
| `src/common/` | 三个模块共用的基础件（缓存、队列、日志、校验等） | 空骨架 |
| `src/integrations/` | 外部系统对接（redis / postgres / kafka / openai / huggingface 等） | 空骨架 |
| `docs/` | 设计、架构、ADR、运维文档 | 入口已补 |
| `deployment/` | docker-compose、镜像、k8s、helm、ansible、terraform | 占位 |
| `configs/` | 各模块配置样例 | 占位 |
| `tests/` | 分层测试（unit / integration / performance / security） | 占位 |
| `benchmarks/`、`experiments/`、`models/` | 基准、实验记录、模型产物 | 占位 |

**边界**：`src/memoria` 里是代码和空接口占位，不是训练权重。`*.pt`、`*.safetensors`、`checkpoint*/`、`build/`、`apps/desktop/node_modules/`、`dist-app/` 都在 `.gitignore` 里；要发布模型，走 Release 附件、对象存储或服务器下载，不把大文件塞进 Git。

## 本地开发

Windows 上在仓库根目录执行：

```powershell
scripts\desktop.ps1
```

它起中继 `127.0.0.1:8790`、监控与看板 `127.0.0.1:8781`、QEMU 串口 `127.0.0.1:5555`、串口桥接 `ws://127.0.0.1:8765`，并打开看板。只起页面、中继与监控：

```powershell
scripts\desktop.ps1 -NoKernel
```

带 Electron 壳：

```powershell
scripts\desktop.ps1 -NoKernel -Electron
```

停止：

```powershell
scripts\desktop.ps1 -Stop
```

脚本从 `PATH` 找 `python`；没有激活虚拟环境时用 `-Python` 指定解释器。QEMU 从 `PATH`、`QEMU_BIN` 或默认安装位置找，也可以用 `-Qemu`。日志与 pid 状态在 `build\desktop-logs`。

内核是独立进程，不是网页的一部分：QEMU 只提供串口，桥接把串口帧转成 WebSocket；页面只连中继与桥接，不直接碰内核。任何一段挂掉，其余仍能启动。

## Memoria C++ 内核

`src/memoria/` 是 C++（LibTorch）实现，`include/memoria/` 是对应头文件。当前默认单周期链路：

```text
embedding -> gated valve -> chain × 3 -> tri-balancer × 3
-> strata memory -> weighted fusion -> V regularization -> output
```

构建（Windows，需要 VS2022 Build Tools、Windows SDK、LibTorch 头与库）：

```powershell
scripts\build.ps1
```

产物是 `build\memoria_train.exe`、`build\memoria_gen.exe`、`build\memoria_gen_cpu.exe`。Linux 云端：

```bash
bash scripts/build-linux.sh
```

输出在 `build/linux/`。小语料训练：

```powershell
scripts\train.ps1 -Epochs 2 -Batch 16 -Dim 48 -Device cuda
```

生成：

```powershell
scripts\generate.ps1 -Checkpoint "build\checkpoint_shakespeare_words_full" -Prompt "What " -MaxNewTokens 8 -Device cpu
```

模型权重默认写到 `build/checkpoint_*`，不进 Git。看板通过 `MEMORIA_BUILD_ROOT` 或 exe 旁的 `model-root.txt` 找检查点；语料目录可用 `MEMORIA_DATA_ROOT` 指定。

## 桌面壳与安装包

```powershell
cd apps\desktop
$env:MEMORIA_ELECTRON_DIST = "<path-to-electron-dist>"
$env:MEMORIA_MONITOR_EXE = "<path-to-monitor-exe>"   # 可选
npm run dist:installer  # Windows 安装包（Inno Setup，和 mrhua 同一形式）
npm run dist:dir        # 免安装目录
```

安装包会带 Electron 运行时、`resources/monitor/memoria-monitor.exe`、前端页面、错误码表和 3000 行语料；**不带训练权重**。安装器会创建 `{app}\resources\build` 并授予用户写权限，安装后默认指标路径是 `<安装目录>\resources\build\training_metrics.jsonl`；要加载自己的检查点，设置 `MEMORIA_BUILD_ROOT`，或在该目录放权重。安装包产物约 96 MB，放在 `dist-app`，不进 Git。安装器提供中文/英文向导、程序图标、可选桌面快捷方式和开始菜单项。

## 纯内存中继是什么

它解决的是"对话不该留下数据"这件事。会话、消息、文件都只在内存里活一段固定时间，时间一到或进程一停，什么都不剩：

| 能力 | 边界 |
| --- | --- |
| 一次性会话 | 空会话有 TTL，读写会续期；条数与字数是硬上限，满了就拒 |
| 上下文读写 | 建立 → 写消息 → 取上下文 → 焚毁；取完即散，没有历史回放 |
| 分片传输 | 按块转发，单块、单次传输、全局缓冲各有上限；接收方边收边取，取完即毁 |
| 在线计数 | 只记客户端 id 与最后心跳时间，不记内容；窗口一过就掉线 |
| 交流房间 | 房间本身就是一个普通会话，空了会到期消失，下一次心跳重新开一间 |

三条硬规则贯穿整套代码：错误码只有一个出处（`contracts/errors.json`，`0xRRFFTT`），跨语言只靠契约不靠导入，模块之间只允许依赖更低层。任何一条被破坏，启动自检直接失败，而不是跑到一半才出问题。

明确不做：跨会话记忆、用户偏好、审计日志、离线重放。这些都需要存储，与"纯内存"是相反的命题。

## 现在做到哪一步

**展示页**：`apps/community/web/index.html` 已改成工作台结构，左侧 rail 常驻灵体与状态，右侧是连续内容，不再是独立展台。

**看板**：`apps/community/web/desktop.html` 是多窗口桌面，总览、内核、训练、模型、中继、错误码、展示页都是可开的窗口；展示页保留为其中一个窗口，不删除。

**中继**：会话与上下文、分片传输、在线/浏览计数、交流房间可用；HTTP 面 15 个端点，契约 `MRR1/1`，码表 `0xRRFFTT`。

**监控服务**：`apps/console/monitor/desktop_server.py` 读检查点、训练日志和错误码，起模型生成子进程；`/api/model` 能看到本地检查点，`POST /api/model/generate` 能返回生成文本。

**桌面壳**：`apps/desktop` 已能起 Electron 窗口，并拉起监控服务；Windows Inno Setup 安装包与免安装目录两套构建入口已配置。

**还没做**：账号与登录、帖子检索与回复层级、云端模型/训练接口的真实接通、Linux 安装包、签名与自动更新。

## 接下来做什么

见 [ROADMAP.md](ROADMAP.md)。短期三件事：在干净 Windows 用户目录把安装器实装/卸载跑一遍；补云端模型加载与训练接口；再谈账号与检索。

## 部署

一台 Alibaba Cloud Linux 3 主机，克隆仓库后一条命令：

```bash
sudo bash apps/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
```

脚本做四件事：装 nginx 与 Python、起 `aevum-relay`（只监听 `127.0.0.1:8790`）、写 nginx vhost（静态站 + `/v1/` 反代，关闭缓冲）、用 certbot 申请证书并跳转 HTTPS。令牌由 nginx 注入，浏览器拿不到；中继进程 `MemoryMax=256M`，因为它本来就不需要磁盘。细节与排障见 [apps/relay/deploy/README.md](apps/relay/deploy/README.md)。

## 怎么开始

| 你想做的事 | 先读 |
| --- | --- |
| 三分钟内弄清这是什么 | [start_here.md](start_here.md) |
| 提代码 | [CONTRIBUTING.md](CONTRIBUTING.md)（一次更新一次提交），或下面的合并规则 |
| 把站点跑起来 | [apps/community/README.md](apps/community/README.md) |
| 部署整站与中继 | [apps/relay/deploy/README.md](apps/relay/deploy/README.md) |
| 了解行为边界与举报流程 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 看文档索引 | [docs/index.md](docs/index.md) |

## 怎么提交合并

维护者直接推 `main`；其他贡献者一律走分支 + Pull Request，不直接推主干。

1. **先说清楚要改什么**。超过一个文件的改动，先开 issue 或 Discussion，写清目标、影响面、是否动契约。没讨论过的重构不合并。
2. **从最新 `main` 切分支**。命名用 `feat/<范围>-<短描述>`、`fix/<范围>-<短描述>`，例如 `feat/relay-presence-window`。
3. **一次更新一次提交**。一个提交只做一件事，不把格式化、重命名和功能混在一起；提交信息写 `relay: 说明改了什么以及为什么`。
4. **动契约要成对改**。改 `errors.json` 或 `api.json` 时，同一次提交里更新 `relay/codes.py` 的加载路径、`contracts/errors.h` 生成物与端点数量说明；只改一半会被自检挡住。
5. **提交前自己跑一遍**（不产生任何要提交的文件）：
   ```bash
   python -m relay.architecture   # 层级与导入检查
   python -m relay.bootstrap      # 契约与自检
   ```
6. **PR 里只放该放的东西**。源码、契约、部署文件、文档。截图、日志、探针页、临时脚本、本机路径、测试目录都不进 PR；需要证明行为时，在 PR 描述里写清命令与输出摘要，而不是把文件塞进仓库。
7. **评审看三件事**：有没有跨层导入或循环依赖；跨语言是不是只通过契约通信；失败时有没有落到 `0xRRFFTT` 的码，而不是黑盒异常。
8. **合并**。评审通过后由维护者合并，默认 squash 成一个提交；合并后删掉分支。合并即视为同意以 MPL-2.0 授权。

不接受的 PR：改目录结构但不动锚点映射、在代码里 `sys.path.append`、把测试数据或本机绝对路径写进仓库、顺手重排无关文件。

## 许可与行为准则

代码以 MPL-2.0 授权，见 [LICENSE](LICENSE)。参与社区与仓库的行为受 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 约束，举报渠道 `open@mrhua.cn`，48 小时内确认收到。该准则由 Contributor Covenant v2.1 改编，并按本项目"命名—呈现—指认"的三条心法做了调整。

---

In English: Aevum is a community-built platform for its own community — a static site plus a memory-only relay that keeps sessions, context and transfers in RAM and writes nothing to disk. The relay lives in `apps/relay/` and is being merged; it has no accounts, no database and no history. Code is licensed under MPL 2.0, and participation is governed by `CODE_OF_CONDUCT.md` (report to `open@mrhua.cn`).

# Aevum

社区共建的社区平台。工具、文档、成员之间的协作，收在同一块地方。代码以 [MPL-2.0](LICENSE) 开源。

- 仓库：`gitcode.com/AevumArk/Aevum`
- 许可：Mozilla Public License 2.0
- 当前状态：展示页 + 多窗口看板 + 纯内存中继 + Memoria C++ 训练/生成内核 + Libertas 安全模块 + Electron 桌面壳；安装包构建脚本已接入，权重与语料默认不打包
- 维护邮箱：`open@mrhua.cn`

---

## 这是什么

Aevum 由三个核心运行时组成：**内核（Kernel）、AI 运行时（AI Runtime）、渲染引擎（Render Engine）**。界面是独立的呈现层，`control/` 是控制平面（Control Plane），负责启动、停止和状态汇总。Python 业务后端已归档，不再参与主线。

目录规则、模块边界和迁移对照统一写在 [STRUCTURE.md](STRUCTURE.md)，专有名称与通用架构术语写在 [docs/glossary.md](docs/glossary.md)。先读这两份，再读各目录的 README。

## 代码在哪里

| 路径 | 是什么 | 状态 |
| --- | --- | --- |
| `src/kernel/fortuna/` | 内核：引导、内存、调度、文件系统、网络、沙箱 | 维护中 |
| `src/kernel/host/` | 内核宿主适配：串口桥、引导盘、机器人例程 | 维护中 |
| `src/architecture/libertas/` | AI 运行时：身份、工具、通知、治理、安全 | 已迁入 |
| `src/architecture/memoria/` | AI 运行时：训练、生成、检查点 | 可编译 |
| `src/shared/common/` | 跨核心共用代码 | 可用 |
| `src/shared/integrations/` | 外部系统适配 | 骨架 |
| `engine/` | 渲染引擎：数学、PMX/VMD、VRM、Live2D、WebGL2 | 可用 |
| `control/` | 控制平面：核心登记、状态契约、多进程管理、中继 | 骨架 + 中继可用 |
| `interface/web/` | 展示页、3D 桌面、MrHua 页面 | 已实现 |
| `interface/desktop/` | Electron 壳与安装包 | 已出包 |
| `interface/console/` | 旧 QML / Web UI | 归档界面 |
| `archive/backend-python/monitor/` | 已放弃的 Python 业务后端 | 只读归档 |
| `ops/` | 部署、构建、脚本、工具 | 可用 |
| `docs/` | 架构、审计、ADR、运维 | 已补 |
| `labs/` | 基准、实验、示例、沙箱 | 实验 |
| `configs/`、`tests/` | 配置样例与测试 | 骨架 |

**边界**：`build/` 是构建产物，`var/` 是本地运行状态（检查点、日志、模型缓存、vendor）；`data/` 是源码语料。三者都不参与源码分层，模型权重不进 Git。

## Python 路径

新结构把 `src` 拆成三个包根，包名保持不变：

```powershell
$env:PYTHONPATH = "$env:AEVUM_ROOT\src\kernel;$env:AEVUM_ROOT\src\architecture;$env:AEVUM_ROOT\src\shared"
```

Linux：

```bash
export PYTHONPATH="$AEVUM_ROOT/src/kernel:$AEVUM_ROOT/src/architecture:$AEVUM_ROOT/src/shared"
```

这样 `import fortuna`、`import libertas`、`import memoria`、`import common` 都不需要改导入名。

## 本地开发

只起静态页面：

```powershell
cd interface\web
python -m http.server 8080
```

起纯内存中继：

```powershell
cd control\relay
python -m relay --port 8790
```

旧的 `ops\scripts\desktop.ps1` 仍然拉起监控与串口链路；那属于归档后的后端方向，不再作为新主线。新的主线只围绕内核、AI 运行时、渲染引擎三个核心运行时。

内核是独立进程，不是网页的一部分：QEMU 只提供串口，桥接把串口帧转成 WebSocket；页面只连中继与桥接，不直接碰内核。任何一段挂掉，其余仍能启动。

## Libertas 安全模块

`src/architecture/libertas/core` 只保留兼容入口，具体实现按职责分布在 `foundation`、`observability`、`security`、`identity`、`release`、`data`、`workflow`、`ai`、`tools`、`models`、`media`、`code`、`network` 等目录。

- `src/architecture/libertas/foundation/`：异常、终端、事件总线、缓存、限流、重试、指标、健康检查、计时、配置。
- `src/architecture/libertas/models/legacy_models/`：从 `mrhua/models` 迁入，36 个 `.py`，33 个不超过 500 行，3 个因单个方法体过大仍超过 500 行；`ModelEngine` 的 107 个方法全部保留。
- `src/architecture/libertas/tools/legacy_tools/`：旧工具层迁入；外部扫描工具从 `PATH` 或环境变量解析，不在仓库里写死本机路径。
- `src/architecture/libertas/security/legacy_security/`：旧安全模块迁入，121 个 `.py`，按资产发现、攻击链、扫描器、指纹库等职责分包。
- `src/architecture/libertas/security/`：隐私、合规、守护、沙箱、规则、漏洞情报等能力。

旧 Web UI 的 `get_MrHua`、`queue_orb_command` 目前是 `_compat_web.py` 的兼容占位，接入 Aevum Web 层前不是完整实现。

外部工具路径约定：`xray`、`nuclei`、`masscan` 通过 `PATH`、`XRAY_PATH`、`NUCLEI_PATH`、`MSF_PATH` 或本地配置解析；仓库不保存本机安全工具目录的绝对路径。`config.yaml` 是按 `configs/` 样例生成的本地运行配置，不提交。

验证：

```powershell
python -m compileall -q src\architecture\libertas
```

当前结果：编译 0 错误；`legacy_models` 6 个子包导入通过，9 个单例工厂返回正确实例，函数全局名检查无实际未定义项。

## Memoria C++ 内核

`src/architecture/memoria/` 是 C++（LibTorch）实现，`src/architecture/memoria/include/` 是公共头文件目录。统一入口是 `src/architecture/memoria/include/aevum_core.h`：模块内外都写 `#include <include/aevum_core.h>`，构建统一提供 `-I src/architecture/memoria`；同目录内部依赖用 `"..."`，公共路径不散落到每个源文件。当前默认单周期链路：

```text
embedding -> gated valve -> chain × 3 -> tri-balancer × 3
-> strata memory -> weighted fusion -> V regularization -> output
```

构建（Windows，需要 VS2022 Build Tools、Windows SDK、LibTorch 头与库）：

```powershell
ops\scripts\build.ps1
```

产物是 `build\memoria_train.exe`、`build\memoria_gen.exe`、`build\memoria_gen_cpu.exe`。Linux 云端：

```bash
bash ops/scripts/build-linux.sh
```

输出在 `build/linux/`。小语料训练：

```powershell
ops\scripts\train.ps1 -Epochs 2 -Batch 16 -Dim 48 -Device cuda
```

生成：

```powershell
ops\scripts\generate.ps1 -Checkpoint "build\checkpoint_shakespeare_words_full" -Prompt "What " -MaxNewTokens 8 -Device cpu
```

模型权重默认写到 `build/checkpoint_*`，不进 Git。看板通过 `MEMORIA_BUILD_ROOT` 或 exe 旁的 `model-root.txt` 找检查点；语料目录可用 `MEMORIA_DATA_ROOT` 指定。

## 桌面壳与安装包

```powershell
cd interface\desktop
$env:MEMORIA_ELECTRON_DIST = "<path-to-electron-dist>"
$env:MEMORIA_MONITOR_EXE = "<path-to-monitor-exe>"   # 可选
npm run dist:installer  # Windows 安装包（Inno Setup，和 mrhua 同一形式）
npm run dist:dir        # 免安装目录
```

安装包会带 Electron 运行时、`resources/monitor/memoria-monitor.exe`、前端页面、错误码表和 3000 行语料；**不带训练权重**。安装器会创建 `{app}\resources\build` 并授予用户写权限，安装后默认指标路径是 `<安装目录>\resources\build\training_metrics.jsonl`；要加载自己的检查点，设置 `MEMORIA_BUILD_ROOT`，或在该目录放权重。模型生成器 `memoria_gen_cpu.exe` 还依赖 `torch_cpu.dll` 等 CPU 运行时，把 DLL 放到 `<安装目录>\resources\build\runtime`，或设置 `MEMORIA_TORCH_LIB`；安装包本身不夹这组运行时。安装包产物约 96 MB，放在 `dist-app`，不进 Git。安装器提供中文/英文向导、程序图标、可选桌面快捷方式和开始菜单项。

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

**展示页**：`interface/web/index.html` 已改成工作台结构，左侧 rail 常驻灵体与状态，右侧是连续内容，不再是独立展台。

**看板**：`interface/web/desktop.html` 是多窗口桌面，总览、内核、训练、模型、中继、错误码、展示页都是可开的窗口；展示页保留为其中一个窗口，不删除。

**中继**：会话与上下文、分片传输、在线/浏览计数、交流房间可用；HTTP 面 15 个端点，契约 `MRR1/1`，码表 `0xRRFFTT`。

**监控服务**：`archive/backend-python/monitor/desktop_server.py` 读检查点、训练日志和错误码，起模型生成子进程；`/api/model` 能看到本地检查点，`POST /api/model/generate` 能返回生成文本。

**桌面壳**：`interface/desktop` 已能起 Electron 窗口，并拉起监控服务；Windows Inno Setup 安装包与免安装目录两套构建入口已配置。

**还没做**：账号与登录、帖子检索与回复层级、云端模型/训练接口的真实接通、Linux 安装包、签名与自动更新。

## 接下来做什么

见 [ROADMAP.md](ROADMAP.md)。短期三件事：在干净 Windows 用户目录把安装器实装/卸载跑一遍；补云端模型加载与训练接口；再谈账号与检索。

## 部署

一台 Alibaba Cloud Linux 3 主机，克隆仓库后一条命令：

```bash
sudo bash control/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
```

脚本做四件事：装 nginx 与 Python、起 `aevum-relay`（只监听 `127.0.0.1:8790`）、写 nginx vhost（静态站 + `/v1/` 反代，关闭缓冲）、用 certbot 申请证书并跳转 HTTPS。令牌由 nginx 注入，浏览器拿不到；中继进程 `MemoryMax=256M`，因为它本来就不需要磁盘。细节与排障见 [control/relay/deploy/README.md](control/relay/deploy/README.md)。

## 怎么开始

| 你想做的事 | 先读 |
| --- | --- |
| 三分钟内弄清这是什么 | [start_here.md](start_here.md) |
| 提代码 | [CONTRIBUTING.md](CONTRIBUTING.md)（一次更新一次提交），或下面的合并规则 |
| 把站点跑起来 | [interface/web/README.md](interface/web/README.md) |
| 部署整站与中继 | [control/relay/deploy/README.md](control/relay/deploy/README.md) |
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

In English: Aevum is a community-built platform for its own community — a static site plus a memory-only relay that keeps sessions, context and transfers in RAM and writes nothing to disk. The relay lives in `control/relay/` and is being merged; it has no accounts, no database and no history. Code is licensed under MPL 2.0, and participation is governed by `CODE_OF_CONDUCT.md` (report to `open@mrhua.cn`).

# Aevum 目录结构

这份文档只回答一个问题：**什么代码放在哪一层，为什么放在那里**。目录按职责和运行边界划分，不按历史项目名划分。术语定义见 [docs/glossary.md](docs/glossary.md)。

## 目录总览

```text
Aevum/
├─ src/
│  ├─ kernel/                  # 内核（Kernel）
│  │  ├─ fortuna/              # 内核主包，原 src/fortuna
│  │  └─ host/                 # 内核宿主适配：串口桥、引导盘、机器人例程
│  ├─ architecture/            # AI 运行时（AI Runtime）
│  │  ├─ libertas/             # 身份、工具、通知、治理、安全，原 src/libertas
│  │  └─ memoria/              # 训练、生成、检查点，原 src/memoria
│  └─ shared/                  # 跨核心共用代码
│     ├─ common/               # 原 src/common
│     └─ integrations/         # 原 src/integrations
├─ engine/                     # 渲染引擎（Render Engine），保持独立
├─ control/                    # 控制平面（Control Plane）
│  ├─ contract.py              # 核心运行时登记与状态契约
│  ├─ registry.py              # 三个核心运行时登记
│  ├─ supervisor.py            # 多进程启动、停止、状态轮询
│  └─ relay/                   # 纯内存中继，原 apps/relay
├─ interface/                  # 呈现层，只显示，不承载业务
│  ├─ web/                     # 展示页、3D 桌面、MrHua
│  ├─ desktop/                 # Electron 壳
│  └─ console/                 # 旧 QML / Web UI
├─ archive/
│  └─ backend-python/          # 已放弃的 Python 业务后端
│     └─ monitor/              # 原 apps/console/monitor
├─ ops/                        # 运维与构建
│  ├─ deploy/
│  │  ├─ systemd/              # 原 apps/console/deploy
│  │  └─ platform/             # 原 deployment
│  ├─ scripts/                 # 原 scripts
│  ├─ tools/                   # 原 tools
│  └─ bin/                     # 原 bin
├─ labs/                       # 实验、样例与外部参考
│  ├─ benchmarks/
│  ├─ experiments/
│  ├─ examples/
│  ├─ reference/               # 外部参考实现与源码包，仅本地
│  └─ sandbox/
├─ docs/ tests/ configs/
├─ data/                       # 源码语料与固定数据
├─ build/                      # 构建产物与本地工具缓存
└─ var/                        # 本地运行状态
   ├─ checkpoints/
   ├─ logs/
   ├─ models/
   └─ vendor/
```

## 三个核心运行时

| 核心运行时 | 代码位置 | 包入口 | 职责 |
| --- | --- | --- | --- |
| 内核（Kernel） | `src/kernel/fortuna` | `fortuna` | 引导、内存、调度、文件系统、网络、沙箱 |
| AI 运行时（AI Runtime） | `src/architecture/libertas`、`src/architecture/memoria` | `libertas` / `memoria` | 身份、工具、通知、治理、训练、生成 |
| 渲染引擎（Render Engine） | `engine/` | `engine/README.md` | 数学、PMX/VMD、VRM、Live2D、WebGL2 渲染 |

`control/` 是控制平面（Control Plane），不是第四个核心。它只负责登记核心运行时、启动和停止进程、汇总状态、转发消息；业务逻辑不进入这里。

## 目录边界规则

1. **底层模块放在更深的目录**。例如 `src/architecture/libertas/identity/user/`、`src/kernel/fortuna/mm/`、`engine/render/pipeline/`。底层能力不单独开平级快捷文件。
2. **同一层的一个文件只承担一个职责**。职责变多，就拆成子目录，不在同一层堆杂项。
3. **每个模块有 README**。目录 `README.md` 说明内容；`__init__.py` 只做导出，不写业务。
4. **兼容代码只保留一处**。旧路径需要保留时，放在 `archive/` 或明确的兼容入口，不在新目录里复制一份实现。
5. **运行状态不混进源码**。`build/` 只放构建产物，`var/` 只放本地运行状态（检查点、日志、模型缓存、vendor），两者都不参与源码分层。

## Python 路径

`src` 拆成三个包根，包名保持不变：

```powershell
$env:PYTHONPATH = "$env:AEVUM_ROOT\src\kernel;$env:AEVUM_ROOT\src\architecture;$env:AEVUM_ROOT\src\shared"
```

Linux：

```bash
export PYTHONPATH="$AEVUM_ROOT/src/kernel:$AEVUM_ROOT/src/architecture:$AEVUM_ROOT/src/shared"
```

这样 `import fortuna`、`import libertas`、`import memoria`、`import common` 都保持原名，不需要批量改导入。

## 启动入口

```powershell
# 展示页：interface/web/index.html，静态打开或由 nginx 托管
# 3D 桌面：interface/web/desktop.html
# 中继
cd control\relay
python -m relay --port 8790
```

归档后端 `archive/backend-python/monitor` 不在当前运行路径里；需要查旧行为时只读，不再扩展。

## 迁移对照

| 旧路径 | 新路径 |
| --- | --- |
| `src/fortuna` | `src/kernel/fortuna` |
| `src/libertas` | `src/architecture/libertas` |
| `src/memoria` | `src/architecture/memoria` |
| `src/common` | `src/shared/common` |
| `src/integrations` | `src/shared/integrations` |
| `apps/community/web` | `interface/web` |
| `apps/desktop` | `interface/desktop` |
| `apps/console/ui` | `interface/console` |
| `apps/console/monitor` | `archive/backend-python/monitor` |
| `apps/console/bridge` | `src/kernel/host/bridge` |
| `apps/console/kernel` | `src/kernel/host/console/robot` |
| `apps/relay` | `control/relay` |
| `apps/console/deploy` | `ops/deploy/systemd` |
| `deployment` | `ops/deploy/platform` |
| `scripts` | `ops/scripts` |
| `tools` | `ops/tools` |
| `bin` | `ops/bin` |
| `benchmarks`、`experiments`、`examples`、`sandbox` | `labs/` |

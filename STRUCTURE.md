# Aevum 目录结构

这份结构只回答一件事：**什么放在哪一层，为什么放在那里**。不按历史项目名分，不按“前端/后端”分，按职责和运行边界分。

## 三层总图

```text
Aevum/
├─ src/
│  ├─ kernel/                  # 核心 1：内核
│  │  ├─ fortuna/              # 原 src/fortuna，包名不变
│  │  └─ host/                 # 内核宿主：串口桥、引导盘、机器人例程
│  ├─ architecture/            # 核心 2：AI 架构
│  │  ├─ libertas/             # 原 src/libertas，包名不变
│  │  └─ memoria/              # 原 src/memoria，包名不变
│  └─ shared/                  # 非核心：跨核心基础件
│     ├─ common/               # 原 src/common
│     └─ integrations/         # 原 src/integrations
├─ engine/                     # 核心 3：3D 引擎，保持独立
├─ command/                    # 统一指挥态
│  ├─ contract.py              # 核心注册与状态契约
│  ├─ registry.py              # 三核心登记
│  ├─ supervisor.py            # 多进程守护骨架
│  └─ relay/                   # 纯内存中继，原 command/relay
├─ interface/                  # 呈现层，只显示，不承载业务
│  ├─ web/                     # 原 interface/web
│  ├─ desktop/                 # 原 interface/desktop
│  └─ console/                 # 原 interface/console
├─ archive/
│  └─ backend-python/          # 已放弃的 Python 业务后端
│     └─ monitor/              # 原 archive/backend-python/monitor
├─ ops/                        # 运维与构建
│  ├─ deploy/
│  │  ├─ systemd/              # 原 ops/deploy/systemd
│  │  └─ platform/             # 原 deployment
│  ├─ ops/scripts/                 # 原 scripts
│  ├─ tools/                   # 原 tools
│  └─ bin/                     # 原 bin
├─ labs/                       # 实验与样例
│  ├─ benchmarks/
│  ├─ experiments/
│  ├─ examples/
│  └─ sandbox/
├─ docs/ tests/ configs/
├─ build/ checkpoints/ data/ logs/ models/ vendor/   # 运行状态与缓存
```

## 三个指挥态核心

| 核心 | 落点 | 入口 | 职责 |
| --- | --- | --- | --- |
| 内核 | `src/kernel/fortuna` | `fortuna` 包 | 引导、内存、调度、文件系统、网络、沙箱 |
| AI 架构 | `src/architecture/libertas`、`src/architecture/memoria` | `libertas` / `memoria` 包 | 身份、工具、通知、治理、训练、生成 |
| 引擎 | `engine/` | `engine/README.md` | 数学、PMX/VMD、VRM、Live2D、WebGL2 渲染 |

`command/` 不是第四个核心。它只负责登记、拉起、收状态、转消息；任何业务逻辑都不进 `command/`。

## 柜子规则

1. **底层功能放深层目录**。例如 `src/architecture/libertas/identity/user/`、`src/kernel/fortuna/mm/`、`engine/render/pipeline/`。底层能力不单独开平级快捷文件。
2. **同层一个文件只装一个柜子**。一个文件职责变多，就下沉成子目录，不在同一层堆杂项。
3. **每个柜子有柜门**。目录 `README.md` 说明内容；`__init__.py` 只做导出，不写业务。
4. **兼容只留一处**。旧路径需要保留时，放在 `archive/` 或明确的兼容入口，不在新目录里复制一份实现。
5. **运行状态不混进源码**。`build/`、`checkpoints/`、`data/`、`logs/`、`models/`、`vendor/` 原地保留，不参与结构迁移。

## Python 路径

新结构不再把整个 `src` 当作唯一根，而是三个根：

```powershell
$env:PYTHONPATH = "$env:AEVUM_ROOT\src\kernel;$env:AEVUM_ROOT\src\architecture;$env:AEVUM_ROOT\src\shared"
```

Linux：

```bash
export PYTHONPATH="$AEVUM_ROOT/src/kernel:$AEVUM_ROOT/src/architecture:$AEVUM_ROOT/src/shared"
```

这样 `import fortuna`、`import libertas`、`import memoria`、`import common` 都保持原名，不需要批量改 1000 多个导入。

## 启动入口

```powershell
# 展示页：interface/web/index.html，静态打开或由 nginx 托管
# 3D 桌面：interface/web/desktop.html
# 中继
cd command\relay
python -m relay --port 8790
```

后端业务 `archive/backend-python/monitor` 不在新运行路径里；需要查旧行为时只读，不再扩展。

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
| `apps/console/kernel` | `src/kernel/host/console` |
| `apps/relay` | `command/relay` |
| `apps/console/deploy` | `ops/deploy/systemd` |
| `deployment` | `ops/deploy/platform` |
| `scripts` | `ops/scripts` |
| `tools` | `ops/tools` |
| `bin` | `ops/bin` |
| `benchmarks`、`experiments`、`examples`、`sandbox` | `labs/` |

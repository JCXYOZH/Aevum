# 贡献指南

## 开始之前

1. 读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。仓库、讨论区、群聊、线下活动都适用同一套边界。
2. 读 [PROGRESS.md](PROGRESS.md) 的“缺口”一节，从那里挑活，不要自己发明需求。
3. 读 [ROADMAP.md](ROADMAP.md)，确认你要做的东西在计划里，或者先在 issue 里说清楚为什么它应该在计划里。
4. 读 [docs/glossary.md](docs/glossary.md)，先统一术语，再动代码。

## 命名与语言

这是开源仓库，代码和文档首先要让第一次来的人看懂。

- 用通用术语，不新造内部词。比如用“控制平面（Control Plane）”“核心运行时（Core Runtime）”，不使用只有项目内部才懂的自造词。
- 项目专有名称（Fortuna、Libertas、Memoria、MrHua）第一次出现时，必须同时写清职责和代码位置；之后再用简称。
- 目录、包、命令和路径保持英文原样，解释用中文；同一篇文档里一个概念只用一个主词。
- 新增目录必须有 `README.md`，写清负责什么、不负责什么、入口在哪。
- 代码注释解释“为什么”，不写只有作者自己知道的缩写和代号。

## 提交规范：一次更新一次提交

一个提交只做一件事。功能、修复、文档整理、格式化，各自一个提交；不要把一个功能的改动和一次全仓格式化混在一起。

提交信息默认用中文写清楚，路径、命令、标识符和类型前缀保留英文。格式：

```
type(scope): 中文摘要，说清这次做了什么

Why:
为什么现在要做这件事；不写“优化一下”“修一下”这种空话。

What:
具体改了什么：入口、模块、协议、数据流、关键文件。
如果改了行为，要写清旧行为和新行为的差别。

Verify:
跑过什么命令、看到什么输出、在什么环境验证。
没有验证的提交不要写成已验证。

Bounds:
这次不做什么、已知限制、没有推送/没有重建/没有改某个模块。
```

示例：

```
feat(forge): 把单页拆成 API、启动、样式和 JS 模块

Why:
index.html 已经到 799 行，渲染、控制、DOM 和导出混在一起，
后面接内核时无法判断改一处会影响哪里。

What:
- 根目录只留 index.html、api.js、app.js。
- 渲染拆到 js/render/{gl,scene,viewport}，控制拆到 js/control。
- api.js 只暴露 window.AEVUM_FORGE，不碰 DOM 和渲染。
- 删除旧的单文件实现，不保留重复版本。

Verify:
- 26 个 JS 文件 node --check 全部通过。
- 页面在 Edge 完整渲染，API 驱动正弦控制通过。
- MuJoCo XML 解析为 5 bodies / 3 joints / 3 actuators。

Bounds:
- 只做拆分，没有新增 3D 鼠标轨道/拾取。
- 本地提交，未推送。
```

type 前缀：

| type | 用于 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复 |
| `docs` | 只改文档 |
| `refactor` | 不改行为的重写 |
| `test` | 测试 |
| `chore` | 配置、依赖、杂项 |
| `deploy` | 部署脚本与编排 |

其它约定：

- 摘要不写 `update`、`fix`、`misc`、`wip`；正文不能空着。
- 小改动可以合并 `Verify` 和 `Bounds`，但不能只写一句“已测试”。
- 不 `--amend` 已推送的提交，不 force push `main`。
- 不在提交里夹带 `.env`、密钥、证书私钥、扫描目标清单。
- 大改动先开分支，用 PR 合入。

## 代码质量

这个项目不收“看起来能跑”的代码。

- 新增实现要说明验证方式：跑过什么命令、看到什么输出、在什么环境。没有验证说明的 PR 会被要求补。
- 稳定性不确定的实验放 `labs/sandbox/`，验证过再进 `src/`。
- 不要把 0 字节占位文件当成实现提交上去；`configs/` 和 `labs/` 里的空文件尤其容易被误当成可用配置。
- 引用了别人的代码，在文件头写明来源与许可。

## 目录约定

| 改动内容 | 放哪 |
| --- | --- |
| 展示页、3D 桌面、桌面壳 | `interface/web/`、`interface/desktop/` |
| 内核 | `src/kernel/fortuna/` |
| 内核宿主适配 | `src/kernel/host/` |
| AI 运行时：身份、工具、通知、治理、安全 | `src/architecture/libertas/` |
| AI 运行时：训练、生成、检查点 | `src/architecture/memoria/` |
| 控制平面：核心登记、启动停止、状态轮询 | `control/` |
| 跨核心共用代码 | `src/shared/common/`、`src/shared/integrations/` |
| 渲染引擎 | `engine/` |
| 架构决策记录 | `docs/adr/`（编号递增，一篇一个决定） |
| 未验证的试验 | `labs/sandbox/` |

## 评审

评审只指认具体位置：哪个文件、哪一行、哪一段逻辑，以及你期望它是什么。不写“这段很烂”，也不做不指向具体代码的鼓励。这不是风格问题，是行为准则第 3 条。

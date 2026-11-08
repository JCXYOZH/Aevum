# 进度

> 更新于 2026-11-08。这份文件只写能核对的状态；计划写在 [ROADMAP.md](ROADMAP.md)。

## 一句话

骨架与入口文档就位，静态站能打开；服务端一行未写。

## 状态表

| 部分 | 位置 | 状态 | 依据 |
| --- | --- | --- | --- |
| 仓库骨架 | 全仓 | 完成 | 816 个文件（其中 806 个为空占位） |
| 顶层文档 | 根目录 | 完成 | README / PROGRESS / ROADMAP / start_here / CONTRIBUTING / CHANGELOG / CODE_OF_CONDUCT |
| 静态站 | `apps/community/web/` | 可打开 | `index.html` 单文件，零依赖，零构建 |
| 后端 API | 未选型 | 未开始 | ROADMAP P2 的三个决定都还没做 |
| 桌面端 | `apps/community/desktop/` | 未开始 | 目录尚不存在 |
| fortuna | `src/fortuna/` | 空骨架 | 目录齐全，0 行代码 |
| libertas | `src/libertas/` | 空骨架 | 同上 |
| memoria | `src/memoria/` | 空骨架 | 同上 |
| 部署编排 | `deployment/` | 空骨架 | docker-compose、Dockerfile、k8s、helm、ansible、terraform 全为空文件 |
| 配置样例 | `configs/` | 空骨架 | 全为空文件 |
| CI | `.github/workflows/` | 空骨架 | 11 个 workflow 全为空 |

## 数字口径

统计于 2026-11-08 的当前克隆，**排除 `.git` 目录**：

- 文件总数 **816**
- 空文件 **806**
- `src/` 下 **533** 个文件，非空 **0**
- 非空文件 **11** 个：`LICENSE`、`README.md`、`CODE_OF_CONDUCT.md`、`PROGRESS.md`、`ROADMAP.md`、`start_here.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`docs/index.md`、`apps/community/README.md`、`apps/community/web/index.html`

复核命令（PowerShell，在仓库根目录执行）：

```powershell
$all = Get-ChildItem -Recurse -File -Force | Where-Object { $_.FullName -notlike '*\.git\*' }
"$($all.Count) 个文件 / $(($all | Where-Object { $_.Length -gt 0 }).Count) 个非空"
```

## 已完成

- 三模块目录结构：fortuna（内核）、libertas（安全）、memoria（记忆），外加 `src/common` 与 `src/integrations`
- 许可：Mozilla Public License 2.0
- 行为准则：从 `README.md` 迁出到 `CODE_OF_CONDUCT.md`，内容未改
- 入口文档六份，README 带代码位置表
- 静态站首版：单文件 HTML，移动端优先，带二维码占位与复制邮箱

## 缺口（按优先级）

1. **二维码图未入库**。页面显示虚线占位框，把图片放到 `apps/community/web/assets/qrcode.png` 即替换。
2. **站点未部署**。没有域名解析、没有证书、没有 nginx 配置。现在只能在本地看。
3. **服务端 API 未选型**。形态、存储、准入三个决定没做，任何后端代码都还不该开始写。
4. **`src/` 无代码**。533 个文件全部为空；仓库里没有能编译、能运行的东西。
5. **`docs/` 除 `index.md` 全空**，包括 `docs/adr/0001-initial-architecture.md` 与 `0002-memory-model.md`。
6. **`deployment/` 与 `configs/` 全空**。里面任何文件都不能当成可用配置直接照做。
7. **没有 CI**。`.github/workflows/` 下 11 个 workflow 全为空，提交不会触发任何检查。
8. **进度数字写死两处**。`PROGRESS.md` 与 `apps/community/web/index.html` 各有一份，状态变化时要同时改。

## 更新规则

- 模块状态变化时：改上面状态表的对应行，改顶部日期，必要时重算数字口径。
- 站点「现状」区块里的四个数字是写死的，同步改 `index.html`。
- 新增功能先更新 CHANGELOG，再改 PROGRESS。

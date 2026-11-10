# 进度

> 更新于 2026-11-10。这份文件只写能核对的状态；计划写在 [ROADMAP.md](ROADMAP.md)。

## 一句话

展示页、看板、中继、监控服务和 Memoria C++ 内核已经进入同一个仓库；Windows 桌面壳和两套打包入口已接入，安装包还需要在构建机上完整验收。

## 状态表

| 部分 | 位置 | 状态 | 依据 |
| --- | --- | --- | --- |
| 顶层文档 | 根目录 | 已更新 | README / PROGRESS / start_here / CONTRIBUTING / CHANGELOG |
| 展示页 | `apps/community/web/index.html` | 可打开 | 左侧 rail 灵体 + 连续内容，保留 P0–P4 进度 |
| 看板 | `apps/community/web/desktop.html` | 可打开 | 多窗口、启动台、展示页窗口保留 |
| 纯内存中继 | `apps/relay/` | 已实现 | 会话、上下文、分片、在线计数；无落盘 |
| 监控服务 | `apps/console/monitor/desktop_server.py` | 已实现 | 读检查点、训练指标、错误码；起模型子进程 |
| 串口桥接 | `apps/console/bridge/serial_bridge.py` | 已实现 | 串口帧转 WebSocket |
| 内核 | `apps/console/kernel/` | 维护中 | 引导、状态机、错误码、80×25 单元格 |
| Memoria C++ | `src/memoria/` + `include/memoria/` | 可编译 | 17 个 `.cpp`、15 个头文件；训练/生成/检查点 |
| 桌面壳 | `apps/desktop/` | 已接入 | Electron 窗口、拉起监控、NSIS/目录两套目标 |
| 训练语料 | `data/tinyshakespeare_3000.txt` | 已入库 | 3000 行公开文本，不包含权重 |
| 模型权重 | 不入库 | 明确边界 | `.gitignore` 挡 `*.pt`、`*.safetensors`、`checkpoint*/`、`build/` |
| fortuna | `src/fortuna/` | 空骨架 | 目录齐全，0 行代码 |
| libertas | `src/libertas/` | 空骨架 | 同上 |
| 部署编排 | `deployment/` | 空骨架 | 占位文件，不可直接照做 |
| 配置样例 | `configs/` | 空骨架 | 占位文件 |
| CI | `.github/workflows/` | 空骨架 | 占位文件 |

## 数字口径

统计时排除 `.git`、`node_modules`、`build`、`dist*`：

```powershell
$all = Get-ChildItem -Recurse -File -Force | Where-Object {
  $_.FullName -notlike '*\.git\*' -and
  $_.FullName -notlike '*node_modules*' -and
  $_.FullName -notlike '*\build\*' -and
  $_.FullName -notlike '*\dist*'
}
"$($all.Count) 个文件 / $(($all | Where-Object { $_.Length -gt 0 }).Count) 个非空"
```

## 已完成

- 展示页改成连续工作台结构：左侧 rail 常驻灵体、状态与锚点，右侧用 `.chain` 和行式清单代替卡片展台。
- 看板与展示页共用 `styles/presence.css`，灵体在 rail 和 dock 各有位置。
- 配色回到纸黄系（展示页与看板 token 已替换），保留深色终端块作为局部面板。
- 中继、监控、串口桥接、内核入口都收在 `apps/` 下。
- Memoria C++ 内核迁入 `src/memoria/`，头文件在 `include/memoria/`；构建脚本已改到新路径。
- Electron 桌面壳接入 `apps/desktop/`；`npm run dist` 目标为 NSIS 安装包，`npm run dist:dir` 为免安装目录。
- 3000 行公开语料入库；模型权重、构建产物、`node_modules` 明确忽略。

## 缺口（按优先级）

1. **安装包未最终验收**。本机 `7za` 压缩 282 MiB 载荷时内存不足；目录包已验证，NSIS 安装包需要在内存更充足的机器上完成。
2. **Linux 安装包未做**。Linux C++ 编译脚本已补，但未在真实 Linux 主机跑过；PyInstaller 监控的 Linux 产物也未生成。
3. **云端模型/训练接口未接通**。看板里有「云端加载 / 预留位」，只保存地址，不假装已连。
4. **训练参数未调低**。当前仍是 `dim=64 / seq=16 / batch=32 / vocab=3000`，约 1,352,744 参数；下一轮按目标值调整。
5. **`docs/` 多数文件仍为空**。本轮只补 Memoria 与开发入口，其余按需填写。
6. **账号与登录、帖子检索、回复层级、签名与自动更新** 未开始。

## 更新规则

- 模块状态变化时：改状态表对应行，改顶部日期，必要时重算数字口径。
- 新增功能先更新 CHANGELOG，再改 PROGRESS。
- 不写没有实际跑过的“已完成”；构建失败就写失败原因。

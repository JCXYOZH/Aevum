# 进度

> 更新于 2026-11-17。仓库第一个提交是 2026-11-05，首版展示页进度口径是 2026-11-08；这份文件只写能核对的状态，计划写在 [ROADMAP.md](ROADMAP.md)。

## 一句话

展示页、3D 桌面、MrHua、中继、监控服务、FastAPI 身份接口和 Memoria C++ 内核已经进入同一个仓库；Windows 桌面壳已接入，`dist:installer` 已产出约 95 MB 的 Inno Setup 安装包，免安装目录同样可产出。

## 状态表

| 部分 | 位置 | 状态 | 依据 |
| --- | --- | --- | --- |
| 顶层文档 | 根目录 | 已更新 | README / PROGRESS / start_here / CONTRIBUTING / CHANGELOG |
| 展示页 | `apps/community/web/index.html` | 可打开 | 左侧 rail 灵体 + 连续内容；P0–P8 为原节点，P2 / P3 / P6–P8 已按当前状态补充，另加 11-17 账号与桌面节点 |
| 看板 | `apps/community/web/desktop.html` | 可打开 | 多窗口、启动台、展示页窗口保留 |
| 纯内存中继 | `apps/relay/` | 已实现 | 会话、上下文、分片、在线计数；无落盘 |
| 监控服务 | `apps/console/monitor/desktop_server.py` | 已实现 | 读检查点、训练指标、错误码；起模型子进程 |
| 串口桥接 | `apps/console/bridge/serial_bridge.py` | 已实现 | 串口帧转 WebSocket |
| 内核 | `apps/console/kernel/` | 维护中 | 引导、状态机、错误码、80×25 单元格 |
| Memoria C++ | `src/memoria/` + `src/memoria/include/` | 可编译 | 17 个 `.cpp`、17 个头文件；训练/生成/检查点 |
| 桌面壳 | `apps/desktop/` | 可打包 | Electron 窗口、拉起监控；`dist:installer` 出 Inno Setup，`dist:dir` 出目录 |
| 训练语料 | `data/tinyshakespeare_3000.txt` | 已入库 | 3000 行公开文本，不包含权重 |
| 模型权重 | 不入库 | 明确边界 | `.gitignore` 挡 `*.pt`、`*.safetensors`、`checkpoint*/`、`build/` |
| fortuna | `src/fortuna/` | 有代码 | 内核与引导相关实现、文档；仍与 `apps/console/kernel` 并行维护 |
| libertas | `src/libertas/` | 有代码 | 身份、安全、工具、回路等模块；不再是空骨架 |
| 3D 桌面 | `apps/community/web/desktop.html` | 可打开 | 窗口、启动项先渲染；VRM / PMX 角色随后载入 |
| MrHua 与订阅 | `apps/community/web/mrhua/`、`apps/console/ui/shell/` | 已接入 | MrHua 是 3D 桌面启动项；订阅走 3D 原生窗口，不用 iframe |
| 账号 | `apps/console/monitor/auth_api.py`、`src/libertas/identity/` | 已接入 | 主账号 / 子用户账号、会话、身份档案隔离；本机验证码登录 |
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
- Memoria C++ 内核迁入 `src/memoria/`，公共头文件在 `src/memoria/include/`；统一入口为 `src/memoria/include/aevum_core.h`，源码用 `#include <include/aevum_core.h>`，构建提供 `-I src/memoria`。
- Electron 桌面壳接入 `apps/desktop/`；`npm run dist:installer` 出 Inno Setup 安装包，`npm run dist:dir` 为免安装目录；安装包约 95 MB，产物不进 Git。
- 3000 行公开语料入库；模型权重、构建产物、`node_modules` 明确忽略。
- 3D 桌面接入 VRM / PMX，窗口与程序先渲染、角色后载入；MrHua 作为启动项，订阅走原生窗口。
- FastAPI + Uvicorn 身份接口、主账号 / 子用户隔离、本机验证码登录接入；历史内容目录尚未按用户彻底分区。

## 缺口（按优先级）

1. **安装包只在本机验收**。`dist:installer` 用 Inno Setup 的 ISCC 编译成功，形式与 mrhua 一致；安装器尚未做静默安装/卸载实跑，建议在干净 Windows 用户目录再验一次。
2. **Linux 安装包未做**。Linux C++ 编译脚本已补，但未在真实 Linux 主机跑过；PyInstaller 监控的 Linux 产物也未生成。
3. **云端模型/训练接口未接通**。看板里有「云端加载 / 预留位」，只保存地址，不假装已连。
4. **训练参数未调低**。当前仍是 `dim=64 / seq=16 / batch=32 / vocab=3000`，约 1,352,744 参数；下一轮按目标值调整。
5. **`docs/` 多数文件仍为空**。本轮只补 Memoria 与开发入口，其余按需填写。
6. **账号与登录只完成基础闭环**。主账号、子用户账号、会话和身份档案已隔离；邀请/邮件准入、帖子检索、回复层级、签名与自动更新仍未完成。聊天、上传、记忆等历史目录也还没有按 `user_id` 彻底分区。
7. **AI 动作桥还没有接运行时**。`tools/ai-bridge` 只完成“模型文本 -> 33 维标签向量 -> 带时区 JSON”，参数化树、YAML 注册表、JSON 记录提取、成功判定和动画驱动都未落地；现状与约束见 [docs/architecture/ai-action.md](docs/architecture/ai-action.md)。
8. **代码结构还没有整理好**。公共头文件刚改为 `src/memoria/include/` 直属、源码统一 `<include/aevum_core.h>`，后续仍要整理 AI 动作桥的正式落点、模块边界和导入路径。

## 更新规则

- 模块状态变化时：改状态表对应行，改顶部日期，必要时重算数字口径。
- 新增功能先更新 CHANGELOG，再改 PROGRESS。
- 不写没有实际跑过的“已完成”；构建失败就写失败原因。

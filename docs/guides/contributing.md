# 贡献流程

1. 从最新 `main` 拉分支，先跑 `python ops/tools/analyze.py` 看基线。
2. 改动前先确认属于哪个核心运行时、控制平面还是呈现层，不要让模块边界互相穿透。
3. 拆分文件时保持公开签名不变，先加 re-export，再迁移实现。
4. 运行 `python -m compileall -q control src\architecture\libertas src\kernel\host\bridge src\kernel\host\console`。
5. 提交时写清楚影响面；视觉改动附页面路径，接口改动附路由。
6. 不提交本机绝对路径、口令、模型权重和构建产物。
7. 新增公共名称先更新 `docs/glossary.md`，不要在代码里另造一套说法。

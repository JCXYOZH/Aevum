# 贡献流程

1. 从最新 `main` 拉分支，先跑 `python ops/tools/analyze.py` 看基线。
2. 改动前确认所属层；入口、适配、领域、内核不要互相穿透。
3. 拆分文件时保持公开签名不变，先加 re-export，再迁移实现。
4. 运行 `python -m compileall -q src\architecture\libertas archive\backend-python\monitor`。
5. 提交时写清楚影响面；视觉改动附页面路径，接口改动附路由。
6. 不提交本机绝对路径、口令、模型权重和构建产物。

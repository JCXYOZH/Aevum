"""按领域拆分 MrHua API 的包。

新增接口时先归入对应领域模块，不要继续往 auth_api.py 里堆：
- capabilities.py  能力清单（前端启动项的唯一后端依据）
- loop.py          回路订阅 / 确认 / 退订 / 一屏一人
- system.py        服务健康状态
- visitor.py       访客入口、公开社区概览与隔离数据作用域
- governance.py    社区治理只读接口（角色、统计、提案、分叉）

账号认证的 /api/auth/* 仍由 desktop_server 的 AuthAPI 适配，后续再按同样方式拆。
"""

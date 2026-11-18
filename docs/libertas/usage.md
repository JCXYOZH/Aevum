# Libertas 使用

从应用入口引用时，优先使用稳定包：

```python
from libertas.identity.user import UserManager
from libertas.observability.notifications import get_notification_center
```

不要从 `libertas.core` 反向导入旧实现；`core` 只保留兼容入口。需要新能力时，先确认它在 `docs/architecture/code-map.md` 中属于哪一层，再补模块 docstring 和最小回归。

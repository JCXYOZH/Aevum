# Libertas 示例

```python
from libertas.identity.user import UserManager

users = UserManager()
result = users.loop_subscribe("reader@example.com", scope="release", consent_page="/subscribe")
print(result)
```

真实订阅会写入 `loop.db`，并在配置了 SMTP 口令时给站长发内部提醒。测试完删除测试记录，不要把测试邮箱留在名单里。

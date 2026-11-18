# 运行手册

## 服务检查

```bash
systemctl status aevum-relay aevum-monitor aevum-bridge aevum-kernel
ss -lntp | grep -E '5555|8765|8781|8790'
curl -fsS http://127.0.0.1:8781/api/health
```

## 常见故障

- 根页 404 或错误页：检查 nginx 是否指向 `interface/web`，以及监控服务的根路由。
- 部署检查根页失败：确认展示页含 `data-page="showcase"`，旧 `masthead` 判断已废弃。
- 订阅无提醒：检查服务用户数据目录下的 `config/mail.json`，以及 `loop.db` 是否已有 pending 记录。
- 中继异常：重启会清空内存会话，这是设计行为，不是数据丢失。

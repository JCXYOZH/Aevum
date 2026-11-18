# 部署

Linux 服务器推荐 `systemd + nginx`。静态站点由 nginx 提供，监控 API 只监听 `127.0.0.1:8781`，中继监听 `127.0.0.1:8790`。

```bash
sudo bash apps/console/deploy/install.sh
sudo systemctl status aevum-monitor
curl -fsS http://127.0.0.1:8781/api/health
```

部署检查会验证根页 `data-page="showcase"`、桌面页、MrHua 页、验证页和模型资源。服务器必须同步最新代码后重跑，旧脚本的 `masthead` 判断已废弃。

`mail.json` 不自动生成；需要订阅提醒时，在服务用户的数据目录 `config/mail.json` 填入口令。不要把 8781 直接暴露到公网。

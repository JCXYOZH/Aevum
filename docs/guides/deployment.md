# 部署

Linux 服务器推荐 `systemd + nginx`。静态站点由 nginx 提供，中继监听 `127.0.0.1:8790`，串口桥接监听 `127.0.0.1:8765`，内核串口监听 `127.0.0.1:5555`。

```bash
sudo bash ops/deploy/systemd/install.sh
sudo systemctl status aevum-kernel aevum-bridge aevum-relay
curl -fsS http://127.0.0.1:8790/v1/health
```

部署检查会验证根页 `data-page="showcase"`、桌面页、MrHua 页、验证页和模型资源。服务器必须同步最新代码后重跑。

监控与模型后端已归档到 `archive/backend-python/monitor`，当前部署不再启动 8781，也不再代理 `/api/`。需要恢复那部分能力时，应把它重写进三个核心运行时之一，不要直接把归档后端挂回公网。

`config/mail.json` 属于归档后端的旧配置，不再由当前部署生成。不要把 5555、8765、8790 暴露到公网；安全组只需要放行 80/443。

# 常见问题

## 根路径为什么是展示页？

`desktop_server.py` 明确把 `/`、`/apps/community/web` 和带斜杠目录都指向 `index.html`；3D 桌面只保留 `/desktop` 和 `desktop.html` 两个显式入口。

## 部署检查为什么报“根页是展示页”失败？

旧脚本用 `class="masthead"` 判断，展示页已改为 `hero` 结构。现在统一检查 `data-page="showcase"`。服务器同步代码后重跑即可。

## 订阅提醒为什么没有邮件？

先看 `mail.json` 是否有口令；再看 `loop.db` 是否已有 pending 记录；最后看服务日志是否出现 `datetime` 之类异常。订阅提醒只发给站长，不发给订阅者。

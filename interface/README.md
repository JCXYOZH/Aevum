# interface：呈现层

```text
interface/
├─ web/        # 展示页、3D 桌面、MrHua 页面，原 interface/web
├─ desktop/    # Electron 壳，原 interface/desktop
└─ console/    # 旧 QML / Web UI，原 interface/console
```

这里只做呈现和交互，不直接读数据库、不直接碰串口、不承载身份业务。

后端业务已经放弃，归档在 `archive/backend-python/`；页面需要数据时通过明确的
API 或静态数据，不在页面里补业务逻辑。

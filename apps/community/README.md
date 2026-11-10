# 社区平台 · apps/community

社区自己的平台本体。一份前端同时服务两件事：浏览器里打开的展示页，和 Electron 壳里的多窗口看板。

## 目录

```text
apps/community/
├── README.md
└── web/
    ├── index.html            展示页（左侧 rail 灵体 + 连续内容）
    ├── desktop.html          多窗口看板（总览 / 内核 / 训练 / 模型 / 中继 / 错误 / 展示页）
    ├── README.md             页面组件与事件约定
    ├── DESKTOP_STRUCTURE.md  看板窗口与面板结构
    ├── assets/               图标、二维码；favicon-256.ico 供安装包用
    ├── styles/
    │   ├── tokens.css        展示页纸黄 token
    │   ├── presence.css      展示页与看板共用的灵体
    │   ├── showcase/         展示页 rail / 段落 / 页面
    │   └── desktop/          壳、窗口、启动台、面板、响应式
    └── js/
        ├── main.js           展示页入口
        ├── components/       HUD、中继、屏幕（旧灵体组件不再挂载）
        ├── core/             事件总线、连接、演示数据
        └── desktop/          看板入口、窗口系统、面板
```

展示页是桌面壳里的一个窗口，不是另起一份；页面不直接读权重，只调 `apps/console/monitor` 的 API。

## 本地预览

```powershell
python -m http.server 8080 --directory apps/community/web
```

看板：`http://localhost:8080/desktop.html`；展示页：`http://localhost:8080/index.html`。

只起监控和页面：

```powershell
scripts\desktop.ps1 -NoKernel
```

## 放到服务器

页面没有构建步骤，`web/` 目录本身就是发布产物。整站与中继一起部署：

```bash
sudo bash apps/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
```

桌面壳通过 `apps/desktop` 打包；安装包和 nginx 静态站是两条分发通道，不是二选一。

## 二维码

`web/assets/qrcode.png` 是 QQ 群码，页面按原图比例显示。换群只换图，文件名保持不变。

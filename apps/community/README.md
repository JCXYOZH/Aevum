# 社区平台 · apps/community

社区自己的平台本体。目标形态是一份可自托管的页面，既能挂在自己的服务器上访问，也能被桌面端打包带走；服务端只做逻辑与状态，不参与显示。

## 目录

```text
apps/community/
├── README.md
└── web/                    前端页面，仓库里唯一的页面入口
    ├── index.html          页面结构
    ├── README.md           页面组件与事件约定
    ├── assets/             图标与二维码
    ├── styles/             令牌、布局与各组件样式
    └── js/
        ├── core/           事件总线、游走引擎、连接与演示数据
        └── components/     灵体、屏幕、HUD、中继交流区
```

中继在 `apps/relay/`，单独部署，不在这个目录里；页面通过 `/v1/` 调它。

## 本地预览

两个进程：

```powershell
# 1. 中继，监听 127.0.0.1:8790（在仓库根目录执行）
cd apps/relay
python -m relay

# 2. 页面，另开一个终端
cd apps/community/web
python -m http.server 8080
```

打开 `http://localhost:8080`。页面里的交流区会连本机 `8790`；线上则走同源 `/v1/`，由 nginx 注入令牌。

## 放到服务器

页面没有构建步骤，`web/` 目录本身就是发布产物。整站与中继一起部署：

```bash
sudo bash apps/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
```

## 二维码

`web/assets/qrcode.png` 是 QQ 群码，页面按原图比例显示。换群只换图，文件名保持不变。

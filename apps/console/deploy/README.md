# Aevum console 部署

## 首次部署

从仓库根目录、以 root 运行：

```bash
sudo env DOMAIN=www.mrhua.cn bash apps/console/deploy/install.sh
```

需要 HTTPS 时（建议同时给证书通知邮箱）：

```bash
sudo env DOMAIN=www.mrhua.cn EMAIL=admin@mrhua.cn bash apps/console/deploy/install.sh --tls
```

安装脚本会做这些事：

- 安装 nginx、QEMU、Python 3.10+ 和 `curl`；
- 如果服务器上还没有可用 venv，就在仓库根目录创建 `.venv`，安装 `websockets`，并尝试安装可选的 `pyyaml`；
- 写入四个 systemd 服务：`aevum-kernel`（QEMU 串口内核）、`aevum-bridge`（串口转 WebSocket）、`aevum-relay`（内存中继）、`aevum-monitor`（桌面、身份认证和对话 API）；
- 写入 nginx 配置：静态首页、`desktop.html`、`/mrhua/`、`/engine/`、`/api/`、`/ws`、`/v1/`；
- 默认使用 `apps/console/kernel/robot/disk.img`，也就是已经接好串口上报的真实内核镜像；
- 模型生成器是可选项：没有 `build/linux/memoria_gen_cpu` 时，网站、MrHua、内核实况照常启动，只让模型对话窗口显示不可用。

当前根地址 `/` 显示 `apps/community/web/index.html` 展示页；`desktop.html` 是单独的桌面入口。桌面默认显示四个常驻启动项：MrHua 广域网、内核实况、展示页、拍照；启动台同样包含拍照。部署前请确认 `apps/community/web/mrhua/index.html`、`apps/community/web/desktop.html` 和 `apps/community/web/index.html` 都在仓库里。

## 角色模型路径

前端从 `apps/community/web/js/scene/models.config.js` 读取模型位置，默认是：

- `engine/assets/models/furina/f芙宁娜.vrm`
- `engine/assets/models/ganyu/甘雨.pmx`，贴图在同目录的 `tex/`
- `engine/assets/models/live2d/xiaoyue/xiaoyue.model3.json`、`xiaoyue.moc3` 等
- 动作库：`engine/assets/all_animations.glb`

浏览器访问时由 nginx 的 `/engine/` 路由映射到服务器上的 `$APP_ROOT/engine/...`。这些文件被 `.gitignore` 排除，`git pull` 不会带下来，必须在服务器上单独同步：

```bash
rsync -av engine/assets/models/ root@<服务器>:/opt/Aevum/engine/assets/models/
rsync -av engine/assets/all_animations.glb root@<服务器>:/opt/Aevum/engine/assets/
```

`install.sh` 会在部署前检查这些文件；缺失时默认失败，不会出现“部署成功但角色位空白”。只部署站点、不需要角色时可以用 `REQUIRE_MODELS=no`。如果改了 `models.config.js` 的路径，`install.sh` 里的 `VRM_MODEL`、`PMX_MODEL`、`LIVE2D_MODEL` 也要同步改。

## 已经部署过，只修 nginx

服务器上已经有仓库、服务也在运行时，不要重跑完整安装，直接：

```bash
cd /opt/Aevum
git pull
sudo bash apps/console/deploy/fix-nginx.sh --domain=www.mrhua.cn
```

有证书时脚本会自动启用 443；没有证书时保持 HTTP。需要现在申请证书：

```bash
sudo bash apps/console/deploy/fix-nginx.sh --domain=www.mrhua.cn --tls --email=admin@mrhua.cn
```

## 验证页地址

```text
https://www.mrhua.cn/engine/validate.html?catalog=assets/models.local.yaml
```

`/engine/` 由 `nginx-common.conf` 单独指向仓库的 `engine/`，不会再被首页的 `try_files` fallback 吃掉。`models.local.yaml` 和真实模型仍需单独上传到服务器，`git pull` 不会带下来。

## 自检

```bash
nginx -t
ss -lntp | grep -E ':80|:443'
curl -I https://www.mrhua.cn/engine/validate.html
curl -fsS https://www.mrhua.cn/engine/validate.html | grep '渲染引擎验证'
curl -fsS https://www.mrhua.cn/ | grep -q 'class="masthead"'
curl -fsS https://www.mrhua.cn/api/health
curl -fsS https://www.mrhua.cn/desktop.html -o /dev/null
curl -fsS https://www.mrhua.cn/mrhua/index.html -o /dev/null
```

如果返回的是首页内容，说明 `/engine/` 路由没有生效，检查：

```bash
grep -n 'engine' /etc/nginx/aevum-console-common.conf
grep -n 'include' /etc/nginx/conf.d/aevum-console.conf
```

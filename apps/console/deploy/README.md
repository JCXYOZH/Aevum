# Aevum console 部署

## 首次部署

从仓库根目录、以 root 运行：

```bash
sudo DOMAIN=www.mrhua.cn bash apps/console/deploy/install.sh
```

需要 HTTPS 时：

```bash
sudo DOMAIN=www.mrhua.cn bash apps/console/deploy/install.sh --tls
```

安装脚本会写入四个 systemd 服务、nginx 配置和 `/engine/` 静态验证页路由。

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
```

如果返回的是首页内容，说明 `/engine/` 路由没有生效，检查：

```bash
grep -n 'engine' /etc/nginx/aevum-console-common.conf
grep -n 'include' /etc/nginx/conf.d/aevum-console.conf
```

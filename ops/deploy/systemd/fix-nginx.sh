#!/usr/bin/env bash
# =====================================================================
# Aevum console —— 只修 nginx（不装依赖、不重建 venv、不重启四个服务）
#
#   用法（在仓库根目录、以 root 运行）：
#     sudo bash ops/deploy/systemd/fix-nginx.sh
#     sudo bash ops/deploy/systemd/fix-nginx.sh --domain=www.mrhua.cn
#     sudo bash ops/deploy/systemd/fix-nginx.sh --domain=www.mrhua.cn --tls
#     sudo bash ops/deploy/systemd/fix-nginx.sh --no-tls
#
# 修复内容：
#   1. 把 /engine/ 指到仓库的真实 engine 目录，不再 fallback 到首页；
#   2. 有证书时自动生成 443 入口；没有证书时保持 HTTP；
#   3. nginx -t 通过后 reload，并校验验证页确实返回 render lab。
# =====================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
TLS_MODE="auto"

for arg in "$@"; do
    case "$arg" in
        --domain=*) DOMAIN="${arg#--domain=}" ;;
        --email=*)  EMAIL="${arg#--email=}" ;;
        --tls)      TLS_MODE="request" ;;
        --no-tls)   TLS_MODE="off" ;;
        -h|--help)
            sed -n '2,16p' "$0"
            exit 0
            ;;
        *) echo "未知参数：$arg" >&2; exit 2 ;;
    esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash ops/deploy/systemd/fix-nginx.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_ROOT="$APP_ROOT/interface/web"
ENGINE_ROOT="$APP_ROOT/engine"
MODEL_ROOT="$ENGINE_ROOT/assets/models"
NGINX_COMMON="/etc/nginx/aevum-console-common.conf"
NGINX_HTTP="/etc/nginx/conf.d/aevum-console.conf"
NGINX_TLS="/etc/nginx/conf.d/aevum-console-tls.conf"

command -v nginx >/dev/null 2>&1 || die "没有 nginx，先装 nginx"

if [ -z "$DOMAIN" ] && [ -f "$NGINX_HTTP" ]; then
    DOMAIN="$(awk '/server_name/ { gsub(";", "", $2); print $2; exit }' "$NGINX_HTTP" 2>/dev/null || true)"
fi
DOMAIN="${DOMAIN:-www.mrhua.cn}"
EMAIL="${EMAIL:-admin@${DOMAIN#*.}}"
TLS_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
TLS_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
TLS_ACTIVE="no"

[ -f "$ENGINE_ROOT/validate.html" ] || die "找不到验证页：$ENGINE_ROOT/validate.html"
[ -f "$WEB_ROOT/index.html" ] || die "找不到首页：$WEB_ROOT/index.html"
[ -f "$WEB_ROOT/desktop.html" ] || die "找不到桌面页：$WEB_ROOT/desktop.html"
[ -f "$WEB_ROOT/mrhua/index.html" ] || die "找不到 MrHua 页面：$WEB_ROOT/mrhua/index.html"
[ -f "$APP_ROOT/interface/console/shell/app-shell.js" ] || die "找不到 MrHua 前端脚本：$APP_ROOT/interface/console/shell/app-shell.js"

if [ ! -r "$MODEL_ROOT/furina/f芙宁娜.vrm" ] || [ ! -r "$MODEL_ROOT/ganyu/甘雨.pmx" ] || [ ! -r "$MODEL_ROOT/live2d/xiaoyue/xiaoyue.model3.json" ]; then
    log "警告：角色模型不完整，桌面角色位会空白；模型被 .gitignore 排除，需要单独上传 engine/assets/models"
fi

log "仓库根目录：$APP_ROOT"
log "域名：$DOMAIN"

# ---------------------------------------------------------------- 1 配置
log "写入 nginx 公共配置"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
    "$SCRIPT_DIR/nginx-common.conf" > "$NGINX_COMMON"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
    "$SCRIPT_DIR/nginx.conf" > "$NGINX_HTTP"
rm -f "$NGINX_TLS"

# ---------------------------------------------------------------- 2 权限
log "修正 engine 与静态目录权限"
for dir in "$APP_ROOT" "$APP_ROOT/src/kernel" "$APP_ROOT/interface/web" "$APP_ROOT/interface/console" "$APP_ROOT/engine"; do
    [ -d "$dir" ] && chmod o+x "$dir" 2>/dev/null || true
done
chmod -R o+rX "$WEB_ROOT" 2>/dev/null || true
chmod -R o+rX "$ENGINE_ROOT" 2>/dev/null || true
chmod -R o+rX "$APP_ROOT/interface/console" 2>/dev/null || true

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
    setsebool -P httpd_can_network_connect 1 || true
    chcon -R -t httpd_sys_content_t "$WEB_ROOT" 2>/dev/null || true
    chcon -R -t httpd_sys_content_t "$ENGINE_ROOT" 2>/dev/null || true
fi

nginx -t || die "nginx 配置校验失败，先看 $NGINX_HTTP 和 $NGINX_COMMON"

# ---------------------------------------------------------------- 3 TLS
if [ "$TLS_MODE" = "request" ] && [ ! -f "$TLS_CERT" ]; then
    log "申请证书"
    command -v certbot >/dev/null 2>&1 \
        || die "没有 certbot，先在服务器装 certbot 和 nginx 插件，或去掉 --tls"
    certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --keep-until-expiring -m "$EMAIL"
fi

if [ "$TLS_MODE" != "off" ] && [ -f "$TLS_CERT" ] && [ -f "$TLS_KEY" ]; then
    log "启用 443 TLS"
    sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
        "$SCRIPT_DIR/nginx-tls.conf" > "$NGINX_TLS"
    if nginx -t; then
        TLS_ACTIVE="yes"
    else
        rm -f "$NGINX_TLS"
        die "443 配置校验失败，已恢复为仅 HTTP；检查证书：$TLS_CERT"
    fi
else
    log "未启用 HTTPS（缺少证书或指定了 --no-tls）"
fi

# ---------------------------------------------------------------- 4 reload
log "reload nginx"
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
    systemctl reload nginx
else
    nginx -s reload
fi
sleep 1

# ---------------------------------------------------------------- 5 校验
log "校验"
fail=0
check() {
    if eval "$2"; then printf '    [ok]   %s\n' "$1"; else printf '    [FAIL] %s\n' "$1"; fail=1; fi
}
check "验证页 200"       "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/engine/validate.html -H 'Host: $DOMAIN'"
check "验证页不是首页"   "curl -fsS --max-time 5 http://127.0.0.1/engine/validate.html -H 'Host: $DOMAIN' | grep -q '渲染引擎验证'"
check "根页是展示页"     "curl -fsS --max-time 5 http://127.0.0.1/ -H 'Host: $DOMAIN' | grep -q 'data-page=\"showcase\"'"
check "桌面页 200"       "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/desktop.html -H 'Host: $DOMAIN'"
check "中继健康"         "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/v1/health -H 'Host: $DOMAIN'"
if [ "$TLS_ACTIVE" = "yes" ]; then
    check "443 在监听"   "ss -lnt | grep -q ':443'"
    check "HTTPS 验证页"  "curl -fsS --max-time 5 --resolve '$DOMAIN:443:127.0.0.1' 'https://$DOMAIN/engine/validate.html' | grep -q '渲染引擎验证'"
fi

if [ "$fail" -ne 0 ]; then
    echo >&2
    echo "没通过。看：" >&2
    echo "  nginx -t" >&2
    echo "  tail -40 /var/log/nginx/aevum-console.error.log" >&2
    echo "  ss -lntp | grep -E ':80|:443'" >&2
    exit 1
fi

if [ "$TLS_ACTIVE" = "yes" ]; then
    SCHEME="https"
else
    SCHEME="http"
fi
log "完成"
echo "    验证页：$SCHEME://$DOMAIN/engine/validate.html?catalog=assets/models.local.yaml"
echo "    如果 models.local.yaml 还没上传，先把清单和模型放到 $ENGINE_ROOT/assets/。"

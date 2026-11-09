#!/usr/bin/env bash
# =====================================================================
# Aevum console —— 一台 Linux 服务器上从零到可访问
#
#   用法（在仓库根目录、以 root 运行）：
#     sudo bash apps/console/deploy/install.sh
#     sudo DOMAIN=console.mrhua.cn bash apps/console/deploy/install.sh
#     sudo bash apps/console/deploy/install.sh --tls     # 顺带申请证书
#
# 做的事：装依赖 → 建 venv → 起内核(QEMU 无头) → 起桥接 → 配 nginx →
#         校验两个端口与页面。可以重复执行，不会重复建东西。
# =====================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-www.mrhua.cn}"
WITH_TLS="no"
for arg in "$@"; do
    case "$arg" in
        --tls) WITH_TLS="yes" ;;
        --domain=*) DOMAIN="${arg#--domain=}" ;;
        *) echo "未知参数：$arg" >&2; exit 2 ;;
    esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash apps/console/deploy/install.sh"

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$(cd "$CONSOLE_DIR/../.." && pwd)"
IMAGE="$CONSOLE_DIR/kernel/disk.img"

log "仓库根目录：$APP_ROOT"
log "域名：$DOMAIN"

# ---------------------------------------------------------------- 1 依赖
# 两套发行版的包名不同，必须分开写：
#   Debian/Ubuntu : qemu-system-x86 / iproute2 / python3-venv
#   RHEL 系       : qemu-kvm        / iproute  / python3-pip（Alibaba Cloud Linux 3、
#                   AlmaLinux、Rocky、CentOS Stream 都走这支）
log "安装系统依赖"
PKG_FAMILY=""
if command -v apt-get >/dev/null 2>&1; then
    PKG_FAMILY="deb"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y >/dev/null
    apt-get install -y nginx qemu-system-x86 python3 python3-venv iproute2 curl >/dev/null
elif command -v dnf >/dev/null 2>&1; then
    PKG_FAMILY="rpm"
    dnf install -y nginx qemu-kvm python3 python3-pip iproute curl >/dev/null
elif command -v yum >/dev/null 2>&1; then
    PKG_FAMILY="rpm"
    yum install -y nginx qemu-kvm python3 python3-pip iproute curl >/dev/null
else
    die "只支持 apt / dnf / yum 的系统，请手动装 nginx、qemu、python3 后重跑"
fi

# QEMU 的可执行文件名各家不一样，不能只认 qemu-system-i386：
#   Debian 系 → qemu-system-i386
#   RHEL 系   → qemu-kvm 包只提供 qemu-kvm（就是 qemu-system-x86_64），没有 i386 别名
# 三个都是同一套 CLI，引导 32 位镜像没有区别，取先找到的那个。
# RHEL 9 / Alibaba Cloud Linux 3 上 qemu-kvm 可能只装在 /usr/libexec/ 下、没有
# /usr/bin 符号链接，所以最后再兜一次绝对路径。
QEMU_BIN=""
for cand in qemu-system-i386 qemu-system-x86_64 qemu-kvm /usr/libexec/qemu-kvm; do
    if QEMU_BIN="$(command -v "$cand" 2>/dev/null)"; then
        break
    fi
done
[ -n "$QEMU_BIN" ] || die "找不到 QEMU，试过 qemu-system-i386 / qemu-system-x86_64 / qemu-kvm / /usr/libexec/qemu-kvm。
    Debian 系：apt install -y qemu-system-x86
    RHEL 系：  dnf install -y qemu-kvm"
log "QEMU：$QEMU_BIN"

# ---------------------------------------------------------------- 2 Python
log "准备 Python 环境（$APP_ROOT/.venv）"
if [ ! -x "$APP_ROOT/.venv/bin/python" ]; then
    python3 -m venv "$APP_ROOT/.venv" \
        || die "python3 -m venv 失败：Debian 系装 python3-venv，RHEL 系装 python3-pip"
fi
if [ ! -x "$APP_ROOT/.venv/bin/pip" ]; then
    "$APP_ROOT/.venv/bin/python" -m ensurepip --upgrade >/dev/null 2>&1 \
        || die "venv 里没有 pip：RHEL 系先 dnf install -y python3-pip 再重跑"
fi
"$APP_ROOT/.venv/bin/pip" install --quiet --upgrade pip
"$APP_ROOT/.venv/bin/pip" install --quiet websockets

# ---------------------------------------------------------------- 3 内核镜像
log "检查内核镜像"
[ -f "$IMAGE" ] || die "缺少 $IMAGE：请在开发机上 make disk.img 后提交到仓库"
printf '    %s（%s 字节）\n' "$IMAGE" "$(stat -c%s "$IMAGE")"
[ "$(stat -c%s "$IMAGE")" -eq 16384 ] || die "disk.img 大小不是 16384 字节，镜像不对劲"

# ---------------------------------------------------------------- 4 systemd
log "写入 systemd 单元并启动"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@QEMU_BIN@|$QEMU_BIN|g" \
    "$CONSOLE_DIR/deploy/aevum-kernel.service" > /etc/systemd/system/aevum-kernel.service
sed -e "s|@APP_ROOT@|$APP_ROOT|g" \
    "$CONSOLE_DIR/deploy/aevum-bridge.service" > /etc/systemd/system/aevum-bridge.service

systemctl daemon-reload
systemctl enable aevum-kernel aevum-bridge >/dev/null 2>&1
systemctl restart aevum-kernel
sleep 1
systemctl restart aevum-bridge
sleep 1

# ---------------------------------------------------------------- 5 nginx
log "写 nginx 配置"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
    "$CONSOLE_DIR/deploy/nginx.conf" > /etc/nginx/conf.d/aevum-console.conf

# RHEL 系默认 SELinux 会拦 nginx 的 127.0.0.1 反代
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
    log "SELinux 处于 Enforcing，允许 nginx 连接本机回环"
    setsebool -P httpd_can_network_connect 1 || true
fi

nginx -t || die "nginx 配置校验失败，先看 /etc/nginx/conf.d/aevum-console.conf"
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx
sleep 1

# ---------------------------------------------------------------- 6 TLS
if [ "$WITH_TLS" = "yes" ]; then
    log "申请证书"
    if ! command -v certbot >/dev/null 2>&1; then
        if [ "$PKG_FAMILY" = "deb" ]; then
            apt-get install -y certbot python3-certbot-nginx >/dev/null
        else
            # RHEL 系的 certbot 在 EPEL 里，基础源没有
            dnf install -y certbot python3-certbot-nginx >/dev/null \
                || die "certbot 装不上：先 dnf install -y epel-release 再重跑，或先去掉 --tls"
        fi
    fi
    command -v certbot >/dev/null 2>&1 || die "certbot 不可用，先装 epel-release 再重跑"
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        -m "admin@${DOMAIN#*.}" --redirect
fi

# ---------------------------------------------------------------- 7 校验
log "校验"
fail=0
check() {
    if eval "$2"; then printf '    [ok]   %s\n' "$1"; else printf '    [FAIL] %s\n' "$1"; fail=1; fi
}
check "内核服务在跑"      "systemctl is-active --quiet aevum-kernel"
check "桥接服务在跑"      "systemctl is-active --quiet aevum-bridge"
check "5555 只绑回环"     "ss -lnt | grep -q '127.0.0.1:5555'"
check "8765 只绑回环"     "ss -lnt | grep -q '127.0.0.1:8765'"
check "页面能取到 200"    "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/ -H 'Host: $DOMAIN'"

if [ "$fail" -ne 0 ]; then
    cat >&2 <<'EOF'

有项目没通过。常用排查：
  journalctl -u aevum-kernel -n 40      # 内核是否起来、是否报错
  journalctl -u aevum-bridge -n 40      # 桥接是否连上 5555
  ss -lntp | grep 5555                  # 端口被谁占了
EOF
    exit 1
fi

log "完成"
cat <<EOF
    访问：http${WITH_TLS:+s}://$DOMAIN/
    页面上的灯变青绿、帧/格在涨，就说明 内核 → 桥接 → 前端 全通了。
    安全组只需要放行 80/443；5555 与 8765 不要对外开放。
EOF

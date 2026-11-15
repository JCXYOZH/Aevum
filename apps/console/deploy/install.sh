#!/usr/bin/env bash
# =====================================================================
# Aevum console —— 一台 Linux 服务器上从零到可访问
#
#   用法（在仓库根目录、以 root 运行）：
#     sudo bash apps/console/deploy/install.sh
#     sudo DOMAIN=console.mrhua.cn bash apps/console/deploy/install.sh
#     sudo bash apps/console/deploy/install.sh --tls     # 顺带申请证书
#
# 做的事：装依赖 → 建 venv → 起内核(QEMU 无头) → 起桥接 → 起中继 →
#         起监控与模型 → 配 nginx → 校验四个服务端口与页面。
# =====================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-www.mrhua.cn}"
EMAIL="${EMAIL:-}"
WITH_TLS="no"
for arg in "$@"; do
    case "$arg" in
        --tls) WITH_TLS="yes" ;;
        --domain=*) DOMAIN="${arg#--domain=}" ;;
        --email=*) EMAIL="${arg#--email=}" ;;
        *) echo "未知参数：$arg" >&2; exit 2 ;;
    esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash apps/console/deploy/install.sh"

CONSOLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="$(cd "$CONSOLE_DIR/../.." && pwd)"
IMAGE="$CONSOLE_DIR/kernel/robot/disk.img"
[ -f "$IMAGE" ] || IMAGE="$CONSOLE_DIR/kernel/disk.img"
BUILD_DIR="$APP_ROOT/build/linux"
MODEL_EXE="$BUILD_DIR/memoria_gen_cpu"
MODEL_DATA="$APP_ROOT/data/tinyshakespeare_3000.txt"
WEB_ROOT="$APP_ROOT/apps/community/web"
ENGINE_ROOT="$APP_ROOT/engine"
PYTHON="$APP_ROOT/.venv/bin/python"
NGINX_COMMON="/etc/nginx/aevum-console-common.conf"
NGINX_HTTP="/etc/nginx/conf.d/aevum-console.conf"
NGINX_TLS="/etc/nginx/conf.d/aevum-console-tls.conf"
TLS_CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
TLS_KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
TLS_ACTIVE="no"

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
# 优先使用显式指定的解释器或已有 venv；新机器上如果都没有，就在仓库根目录
# 建一个只装 websockets 的 .venv（不装 torch，模型生成器是可选的）。
log "选择 Python 环境"

PYTHON=""
if [ -n "${MEMORIA_PYTHON:-}" ]; then
    PYTHON="$(command -v "$MEMORIA_PYTHON" 2>/dev/null || true)"
    [ -n "$PYTHON" ] || PYTHON="$MEMORIA_PYTHON"
    [ -x "$PYTHON" ] || die "MEMORIA_PYTHON 指向的 Python 不可执行：$PYTHON"
    log "Python（MEMORIA_PYTHON）：$PYTHON"
elif [ -n "${VIRTUAL_ENV:-}" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
    PYTHON="$VIRTUAL_ENV/bin/python"
    log "Python（VIRTUAL_ENV）：$PYTHON"
else
    log "环境变量里没有 venv，开始查找 pyvenv.cfg"
    SUDO_HOME=""
    if [ -n "${SUDO_USER:-}" ]; then
        SUDO_HOME="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
    fi
    CANDIDATES=()
    for root in "$APP_ROOT" "$(cd "$APP_ROOT/.." && pwd)" "${SUDO_HOME:-}" /opt /home; do
        [ -n "$root" ] && [ -d "$root" ] || continue
        while IFS= read -r cfg; do
            py="$(dirname "$cfg")/bin/python"
            [ -x "$py" ] && CANDIDATES+=("$py")
        done < <(find "$root" -maxdepth 4 -type f -name pyvenv.cfg -print 2>/dev/null)
    done
    for py in "${CANDIDATES[@]}"; do
        [ -n "$py" ] || continue
        log "  发现：$py"
        if "$py" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
            PYTHON="$py"
            break
        fi
    done
fi

if [ -z "$PYTHON" ]; then
    PYTHON=""
    for cand in python3.13 python3.12 python3.11 python3.10 python3; do
        if command -v "$cand" >/dev/null 2>&1 \
            && "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
            PYTHON="$(command -v "$cand")"
            break
        fi
    done
    [ -n "$PYTHON" ] || die "服务器上找不到 Python >= 3.10；请先安装 python3.10 或更高版本"
    log "新建仓库 venv：$APP_ROOT/.venv"
    "$PYTHON" -m venv "$APP_ROOT/.venv" \
        || die "创建 venv 失败：RHEL 系先 dnf install -y python3-pip，Debian 系先 apt install -y python3-venv"
    PYTHON="$APP_ROOT/.venv/bin/python"
fi

"$PYTHON" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' \
    || die "选中的 Python 版本低于 3.10：$PYTHON"
if ! "$PYTHON" -m pip --version >/dev/null 2>&1; then
    "$PYTHON" -m ensurepip --upgrade >/dev/null 2>&1 \
        || die "Python 里没有 pip：RHEL 系先 dnf install -y python3-pip；Debian 系先 apt install -y python3-venv"
fi
if ! "$PYTHON" -c 'import websockets' >/dev/null 2>&1; then
    "$PYTHON" -m pip install --quiet websockets \
        || die "装不上 websockets：检查网络或换 MEMORIA_PYTHON 指向已有 venv"
fi
log "Python：$PYTHON"

# ---------------------------------------------------------------- 2.1 torch 运行库
# 生成器是 C++ 二进制，运行时需要 libtorch；从选中的 Python 里取 torch/lib。
log "探测 torch 运行库"
TORCH_LIB=""
for py in "$PYTHON"; do
    [ -x "$py" ] || continue
    TORCH_LIB="$("$py" -c 'import pathlib, torch; print(pathlib.Path(torch.__file__).resolve().parent / "lib")' 2>/dev/null || true)"
    [ -n "$TORCH_LIB" ] && break
done
if [ -n "$TORCH_LIB" ]; then
    log "torch：$TORCH_LIB"
else
    log "未探测到 torch 运行库，生成器将依赖自身的 rpath"
fi

# ---------------------------------------------------------------- 3 内核镜像
log "检查内核镜像"
[ -f "$IMAGE" ] || die "缺少 $IMAGE：请在开发机上构建 apps/console/kernel/robot/disk.img 后提交到仓库"
IMAGE_SIZE="$(stat -c%s "$IMAGE")"
printf '    %s（%s 字节）\n' "$IMAGE" "$IMAGE_SIZE"
# boot.asm 从第 2 扇区读 16 个扇区；镜像至少要能容下这 8KB 内核。
[ "$IMAGE_SIZE" -ge 16384 ] || die "disk.img 太小（$IMAGE_SIZE 字节），至少需要 16384 字节"
if [ "$IMAGE_SIZE" -ne 16384 ] && [ "$IMAGE_SIZE" -ne 1474560 ]; then
    log "警告：disk.img 不是 16KB 或 1.44MB，确认 QEMU 的 BIOS 能按这个几何读到第 2~17 扇区"
fi

# ---------------------------------------------------------------- 3.1 模型
# 模型生成器不是页面启动的必要条件：没有编译产物时，看板与 MrHua/内核照常，
# 只是「模型对话」窗口取不到可执行文件。这样云端可以先把网站部署起来。
log "检查模型生成器与检查点"
if [ -f "$MODEL_EXE" ] && [ ! -x "$MODEL_EXE" ]; then
    chmod +x "$MODEL_EXE" 2>/dev/null || true
fi
if [ -x "$MODEL_EXE" ]; then
    printf '    %s（%s 字节）\n' "$MODEL_EXE" "$(stat -c%s "$MODEL_EXE")"
else
    log "未发现 $MODEL_EXE；模型窗口保持不可用，页面和其它服务继续部署"
fi
if [ -f "$MODEL_DATA" ]; then
    printf '    语料：%s（%s 字节）\n' "$MODEL_DATA" "$(stat -c%s "$MODEL_DATA")"
else
    log "未发现模型语料 $MODEL_DATA；模型加载入口会提示缺文件"
fi
CHECKPOINT="$(find "$APP_ROOT/build" -maxdepth 4 -type f \( -name memoria_model.pt -o -name pytorch_model.bin \) -print -quit 2>/dev/null || true)"
if [ -n "$CHECKPOINT" ]; then
    CHECKPOINT_DIR="$(dirname "$CHECKPOINT")"
    if [ -f "$CHECKPOINT_DIR/memoria_config.txt" ] || [ -f "$CHECKPOINT_DIR/config.json" ]; then
        log "检查点：$CHECKPOINT_DIR"
    else
        log "警告：$CHECKPOINT_DIR 有权重，但没有 memoria_config.txt 或 config.json"
    fi
else
    log "提示：$APP_ROOT/build 下没有 memoria_model.pt 或 pytorch_model.bin；只影响模型窗口"
fi

# ---------------------------------------------------------------- 4 systemd
log "写入 systemd 单元并启动"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@QEMU_BIN@|$QEMU_BIN|g" -e "s|@KERNEL_IMAGE@|$IMAGE|g" \
    "$CONSOLE_DIR/deploy/aevum-kernel.service" > /etc/systemd/system/aevum-kernel.service
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@PYTHON@|$PYTHON|g" \
    "$CONSOLE_DIR/deploy/aevum-bridge.service" > /etc/systemd/system/aevum-bridge.service
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@PYTHON@|$PYTHON|g" \
    "$CONSOLE_DIR/deploy/aevum-relay.service" > /etc/systemd/system/aevum-relay.service
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@PYTHON@|$PYTHON|g" -e "s|@TORCH_LIB@|$TORCH_LIB|g" -e "s|@WEB_ROOT@|$WEB_ROOT|g" \
    "$CONSOLE_DIR/deploy/aevum-monitor.service" > /etc/systemd/system/aevum-monitor.service

systemctl daemon-reload
systemctl enable aevum-kernel aevum-bridge aevum-relay aevum-monitor >/dev/null 2>&1
systemctl restart aevum-relay
sleep 1
systemctl restart aevum-kernel
sleep 1
systemctl restart aevum-bridge
sleep 1
systemctl restart aevum-monitor
sleep 1

# ---------------------------------------------------------------- 5 nginx
log "写 nginx 配置"
[ -d "$WEB_ROOT" ] || die "缺少静态目录：$WEB_ROOT"
[ -f "$WEB_ROOT/index.html" ] || die "缺少首页：$WEB_ROOT/index.html"
[ -f "$WEB_ROOT/desktop.html" ] || die "缺少桌面页：$WEB_ROOT/desktop.html"
[ -f "$WEB_ROOT/mrhua/index.html" ] || die "缺少 MrHua 页面：$WEB_ROOT/mrhua/index.html"
[ -f "$APP_ROOT/apps/console/ui/shell/app-shell.js" ] || die "缺少 MrHua 前端脚本：$APP_ROOT/apps/console/ui/shell/app-shell.js"
[ -f "$ENGINE_ROOT/validate.html" ] || die "缺少验证页：$ENGINE_ROOT/validate.html"

sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
    "$CONSOLE_DIR/deploy/nginx-common.conf" > "$NGINX_COMMON"
sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
    "$CONSOLE_DIR/deploy/nginx.conf" > "$NGINX_HTTP"
# 旧证书块先移除；证书存在时再写，避免 nginx -t 因证书缺失失败。
rm -f "$NGINX_TLS"

# nginx worker 通常不是 root。仓库目录若是 700，worker 连 index.html 都 stat 不到，
# 就会返回 500，而 nginx -t 仍然是成功的。这里只补“可穿过 + 静态文件可读”，
# 不递归打开整个仓库。
log "修正静态目录权限"
for dir in "$APP_ROOT" "$APP_ROOT/apps" "$APP_ROOT/apps/community" "$APP_ROOT/apps/console" "$APP_ROOT/apps/console/ui" "$WEB_ROOT" "$ENGINE_ROOT"; do
    [ -d "$dir" ] && chmod o+x "$dir" 2>/dev/null || true
done
chmod -R o+rX "$WEB_ROOT" 2>/dev/null || true
chmod -R o+rX "$ENGINE_ROOT" 2>/dev/null || true
chmod -R o+rX "$APP_ROOT/apps/console/ui" 2>/dev/null || true

# RHEL 系默认 SELinux 会拦 nginx 的 127.0.0.1 反代
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
    log "SELinux 处于 Enforcing，允许 nginx 连接本机回环"
    setsebool -P httpd_can_network_connect 1 || true
    chcon -R -t httpd_sys_content_t "$WEB_ROOT" 2>/dev/null || true
    chcon -R -t httpd_sys_content_t "$ENGINE_ROOT" 2>/dev/null || true
fi

nginx -t || die "nginx 配置校验失败，先看 $NGINX_HTTP 和 $NGINX_COMMON"
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx
sleep 1

# 云主机常见组合：RHEL 系 firewalld、Ubuntu ufw。安全组仍需要在云控制台放行 80/443。
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
    log "放行 firewalld 的 80/443"
    firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "放行 ufw 的 80/443"
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
fi

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
    EMAIL="${EMAIL:-admin@${DOMAIN#*.}}"
    certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
        --keep-until-expiring -m "$EMAIL"
fi

# 已有证书时自动启用 443，不再依赖 certbot 去改站点配置。
if [ -f "$TLS_CERT" ] && [ -f "$TLS_KEY" ]; then
    log "启用 443 TLS"
    sed -e "s|@APP_ROOT@|$APP_ROOT|g" -e "s|@DOMAIN@|$DOMAIN|g" \
        "$CONSOLE_DIR/deploy/nginx-tls.conf" > "$NGINX_TLS"
    if nginx -t; then
        TLS_ACTIVE="yes"
        systemctl reload nginx
        sleep 1
    else
        rm -f "$NGINX_TLS"
        die "443 配置校验失败，已恢复为仅 HTTP；先检查证书路径：$TLS_CERT"
    fi
else
    log "未发现证书，保持 HTTP；需要 HTTPS 时用 --tls 重跑"
fi

# ---------------------------------------------------------------- 7 校验
log "校验"
fail=0
check() {
    if eval "$2"; then printf '    [ok]   %s\n' "$1"; else printf '    [FAIL] %s\n' "$1"; fail=1; fi
}
check "内核服务在跑"      "systemctl is-active --quiet aevum-kernel"
check "桥接服务在跑"      "systemctl is-active --quiet aevum-bridge"
check "中继服务在跑"      "systemctl is-active --quiet aevum-relay"
check "监控服务在跑"      "systemctl is-active --quiet aevum-monitor"
check "5555 只绑回环"     "ss -lnt | grep -q '127.0.0.1:5555'"
check "8765 只绑回环"     "ss -lnt | grep -q '127.0.0.1:8765'"
check "8781 只绑回环"     "ss -lnt | grep -q '127.0.0.1:8781'"
check "8790 只绑回环"     "ss -lnt | grep -q '127.0.0.1:8790'"
check "看板健康接口"      "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8781/api/health"
check "中继健康接口"      "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8790/v1/health"
check "页面能取到 200"    "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/ -H 'Host: $DOMAIN'"
check "桌面页能取到 200"  "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/desktop.html -H 'Host: $DOMAIN'"
check "MrHua 页面能取到 200" "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/mrhua/index.html -H 'Host: $DOMAIN'"
check "验证页能取到 200"  "curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/engine/validate.html -H 'Host: $DOMAIN'"
check "验证页不是首页回退" "curl -fsS --max-time 5 http://127.0.0.1/engine/validate.html -H 'Host: $DOMAIN' | grep -q '渲染引擎验证'"
if [ "$TLS_ACTIVE" = "yes" ]; then
    check "443 在监听" "ss -lnt | grep -q ':443'"
fi

if [ "$fail" -ne 0 ]; then
    cat >&2 <<'EOF'

有项目没通过。常用排查：
  journalctl -u aevum-kernel -n 40      # 内核是否起来、是否报错
  journalctl -u aevum-bridge -n 40      # 桥接是否连上 5555
  journalctl -u aevum-relay -n 40       # 中继是否监听 8790
  journalctl -u aevum-monitor -n 40     # 监控与模型是否起来
  ss -lntp | grep -E '5555|8765|8781|8790'
EOF
    systemctl --no-pager -l status aevum-relay aevum-monitor aevum-bridge 2>&1 | tail -80
    echo "--- nginx error ---"
    tail -20 /var/log/nginx/aevum-console.error.log 2>/dev/null || true
    exit 1
fi

log "完成"
if [ "$TLS_ACTIVE" = "yes" ]; then
    SCHEME="https"
else
    SCHEME="http"
fi
cat <<EOF
    访问：$SCHEME://$DOMAIN/
    看板：$SCHEME://$DOMAIN/desktop
    验证页：$SCHEME://$DOMAIN/engine/validate.html?catalog=assets/models.local.yaml
    中继：$SCHEME://$DOMAIN/v1/health
    页面上的灯变青绿、帧/格在涨，就说明 内核 → 桥接 → 前端 全通了。
    安全组只需要放行 80/443；5555、8765、8781、8790 不要对外开放。
EOF

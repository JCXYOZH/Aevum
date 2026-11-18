#!/usr/bin/env bash
# ============================================================
# install.sh — one-shot deployment for the Aevum static site + in-memory relay
#
# Target: Alibaba Cloud Linux 3 / RHEL 8-9 compatible, nginx, systemd.
# Run from the repository root after cloning:
#
#   sudo bash command/relay/deploy/install.sh --domain www.mrhua.cn --email open@mrhua.cn
#
# In a standalone checkout (relay/ at the top level) the same script also works.
#
# What it does:
#   1. installs nginx / a Python >= 3.10 interpreter / (optional) qemu-kvm + iproute
#   2. creates a system user and a venv, without touching the repo itself
#   3. writes /etc/aevum/relay.env (loopback bind + generated token)
#   4. installs and starts aevum-relay.service
#   5. installs an nginx vhost: static site + /v1/ reverse proxy with buffering off
#   6. optionally obtains a Let's Encrypt certificate through certbot --nginx
#
# Idempotent: safe to re-run after `git pull`.
# ============================================================
set -euo pipefail

DOMAIN="www.mrhua.cn"
EMAIL=""
WITH_QEMU=0
NO_CERT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --email) EMAIL="${2:?--email needs a value}"; shift 2 ;;
    --with-qemu) WITH_QEMU=1; shift ;;
    --no-cert) NO_CERT=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash command/relay/deploy/install.sh ..." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=""

# The script may live at <repo>/command/relay/deploy/install.sh (monorepo) or
# <repo>/deploy/install.sh (standalone). Try three levels up (monorepo root),
# then two and one (standalone root), then the script directory itself, and
# take the first directory that actually holds a relay package.
for cand in "$SCRIPT_DIR/../../.." "$SCRIPT_DIR/../.." "$SCRIPT_DIR/.." "$SCRIPT_DIR"; do
  if [ -d "$cand/command/relay/relay" ] || [ -d "$cand/relay" ]; then
    REPO_ROOT="$(cd "$cand" && pwd)"
    break
  fi
done

if [ -z "$REPO_ROOT" ]; then
  echo "cannot locate the repository root from $SCRIPT_DIR" >&2
  exit 1
fi

# The relay lives at command/relay/ in the monorepo; standalone checkouts keep it at the root.
if [ -d "$REPO_ROOT/command/relay/relay" ]; then
  APP_DIR="$REPO_ROOT/command/relay"
else
  APP_DIR="$REPO_ROOT"
fi

# Static site: the community site in the monorepo, the preview copy in a standalone checkout.
if [ -d "$REPO_ROOT/interface/web" ]; then
  WEBROOT="$REPO_ROOT/interface/web"
elif [ -d "$REPO_ROOT/preview/web" ]; then
  WEBROOT="$REPO_ROOT/preview/web"
else
  echo "no static site found under interface/web or preview/web" >&2
  exit 1
fi

if [ ! -d "$APP_DIR/relay" ]; then
  echo "relay package not found under $APP_DIR" >&2
  exit 1
fi

echo "repo:    $REPO_ROOT"
echo "relay:   $APP_DIR"
echo "webroot: $WEBROOT"
echo "domain:  $DOMAIN"

# ---------- 1. packages ----------
PKGS="nginx tar curl"
if [ "$WITH_QEMU" -eq 1 ]; then
  # RHEL-family names: qemu-kvm (not qemu-system-x86), iproute (not iproute2)
  PKGS="$PKGS qemu-kvm iproute"
fi

if command -v dnf >/dev/null 2>&1; then
  dnf install -y $PKGS
else
  echo "dnf not found; this script targets Alibaba Cloud Linux 3 / RHEL" >&2
  exit 1
fi

# ---------- 2. Python >= 3.10 ----------
PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if ! command -v "$candidate" >/dev/null 2>&1; then
    continue
  fi
  if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
    PY="$(command -v "$candidate")"
    break
  fi
done

if [ -z "$PY" ]; then
  if dnf install -y python3.11 >/dev/null 2>&1 && command -v python3.11 >/dev/null 2>&1; then
    PY="$(command -v python3.11)"
  else
    echo "no Python >= 3.10 available; install python3.11 and re-run" >&2
    exit 1
  fi
fi
echo "python:  $PY ($("$PY" -c 'import sys; print(sys.version.split()[0])'))"

# ---------- 3. user, dirs, venv ----------
if ! id -u aevum >/dev/null 2>&1; then
  useradd --system --home-dir /opt/aevum --shell /sbin/nologin aevum
fi
install -d -m 0755 -o root -g root /opt/aevum
install -d -m 0755 -o root -g root /etc/aevum

VENV=/opt/aevum/venv
if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || true

# ---------- 4. relay env + token ----------
TOKEN="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cat > /etc/aevum/relay.env <<EOF
RELAY_HOST=127.0.0.1
RELAY_PORT=8790
RELAY_TOKEN=$TOKEN
RELAY_LOG_LEVEL=INFO
EOF
chmod 0640 /etc/aevum/relay.env
chown root:aevum /etc/aevum/relay.env

# ---------- 5. systemd unit ----------
install -d -m 0755 /etc/systemd/system
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__PYTHON__|$VENV/bin/python|g" \
    "$SCRIPT_DIR/relay.service" > /etc/systemd/system/aevum-relay.service

systemctl daemon-reload
systemctl enable aevum-relay.service >/dev/null 2>&1 || true
systemctl restart aevum-relay.service

# ---------- 6. nginx vhost ----------
install -d -m 0755 /etc/nginx/conf.d
sed -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__WEBROOT__|$WEBROOT|g" \
    -e "s|__RELAY_TOKEN__|$TOKEN|g" \
    "$SCRIPT_DIR/nginx-aevum.conf" > /etc/nginx/conf.d/aevum.conf

# nginx (running as nginx) must be able to read the static tree
chmod -R a+rX "$WEBROOT" 2>/dev/null || true

nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx

if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

# ---------- 7. certificate ----------
if [ "$NO_CERT" -eq 0 ] && [ -n "$EMAIL" ]; then
  if ! command -v certbot >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    "$VENV/bin/python" -m pip install --quiet certbot certbot-nginx
    CERTBOT="$VENV/bin/certbot"
  else
    CERTBOT="$(command -v certbot)"
  fi

  if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo "certificate already present for $DOMAIN; skipping issuance"
  else
    "$CERTBOT" --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
      echo "certbot failed; the HTTP vhost is still up. Re-run with --email or fix DNS first." >&2
    }
  fi
fi

# ---------- 8. health check ----------
for i in $(seq 1 20); do
  if curl -fsS -m 2 -H "X-Relay-Token: $TOKEN" http://127.0.0.1:8790/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if curl -fsS -m 2 -H "X-Relay-Token: $TOKEN" http://127.0.0.1:8790/v1/health >/dev/null 2>&1; then
  echo "relay health: ok"
else
  echo "relay health: FAILED — journalctl -u aevum-relay -n 50" >&2
fi

cat <<EOF

deployed.
  site:   http://$DOMAIN/
  relay:  http://$DOMAIN/v1/health  (nginx injects the token; 127.0.0.1:8790 is not public)
  status: systemctl status aevum-relay --no-pager
  logs:   journalctl -u aevum-relay -f
  update: git -C "$REPO_ROOT" pull && systemctl restart aevum-relay && systemctl reload nginx

EOF

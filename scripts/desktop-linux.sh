#!/usr/bin/env bash
# Memoria desktop launcher for Linux: relay + monitor + QEMU kernel + serial bridge.
#
# Usage:
#   bash scripts/desktop-linux.sh                 # start everything
#   bash scripts/desktop-linux.sh --no-kernel     # relay + monitor only
#   bash scripts/desktop-linux.sh --stop          # stop started services
#   bash scripts/desktop-linux.sh --status        # show ports and pids
#
# Ports: relay 8790, monitor 8781, QEMU serial 5555, bridge websocket 8765.
# Logs and pid state stay under build/desktop-logs, never in apps or src.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${MEMORIA_LINUX_BUILD:-$ROOT/build/linux}"
STATE_DIR="$ROOT/build/desktop-logs"
LOG_DIR="$STATE_DIR/logs"
PID_FILE="$STATE_DIR/pids.txt"

RELAY_PORT="${RELAY_PORT:-8790}"
MONITOR_PORT="${MONITOR_PORT:-8781}"
SERIAL_PORT="${SERIAL_PORT:-5555}"
WS_PORT="${WS_PORT:-8765}"

PYTHON="${MEMORIA_PYTHON:-}"
QEMU="${MEMORIA_QEMU:-${QEMU_BIN:-}}"
NO_KERNEL=0
ACTION=start

for arg in "$@"; do
  case "$arg" in
    --stop) ACTION=stop ;;
    --status) ACTION=status ;;
    --no-kernel) NO_KERNEL=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PYTHON" ]]; then
  for candidate in "$ROOT/venv/bin/python" "$ROOT/.venv/bin/python" python3 python; do
    if [[ -x "$candidate" ]] || command -v "$candidate" >/dev/null 2>&1; then
      PYTHON="$candidate"
      break
    fi
  done
fi
if [[ -z "$PYTHON" ]]; then
  echo "python not found. Activate the venv or set MEMORIA_PYTHON." >&2
  exit 3
fi
PYTHON_BIN="$(command -v "$PYTHON" || echo "$PYTHON")"

if [[ -z "$QEMU" ]]; then
  for candidate in qemu-system-i386 qemu-system-x86_64; do
    if command -v "$candidate" >/dev/null 2>&1; then
      QEMU="$(command -v "$candidate")"
      break
    fi
  done
fi

port_in_use() {
  "$PYTHON_BIN" - "$1" <<'PY'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(0)
else:
    sys.exit(1)
finally:
    s.close()
PY
}

wait_port() {
  local port="$1" seconds="${2:-20}" i
  for ((i = 0; i < seconds * 4; i++)); do
    if ! port_in_use "$port"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

stop_pid() {
  local pid="$1" child
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_pid "$child"
  done
  kill "$pid" 2>/dev/null || true
}

stop_services() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r name pid rest; do
      [[ -z "${name:-}" ]] && continue
      if kill -0 "$pid" 2>/dev/null; then
        echo "  stop $name (pid $pid)"
        stop_pid "$pid"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "Memoria Linux services stopped."
}

show_status() {
  echo "ports:"
  for item in "relay:$RELAY_PORT" "monitor:$MONITOR_PORT" "serial:$SERIAL_PORT" "bridge:$WS_PORT"; do
    name="${item%%:*}"
    port="${item##*:}"
    if port_in_use "$port"; then
      echo "  $name $port  listening"
    else
      echo "  $name $port  free"
    fi
  done
  if [[ -f "$PID_FILE" ]]; then
    echo "pids:"
    sed 's/^/  /' "$PID_FILE"
  else
    echo "pids: none"
  fi
}

start_service() {
  local name="$1" workdir="$2"
  shift 2
  local out="$LOG_DIR/$name.out.log" err="$LOG_DIR/$name.err.log"
  ( cd "$workdir" && exec nohup "$@" ) >"$out" 2>"$err" &
  local pid=$!
  printf '%s %s\n' "$name" "$pid" >> "$PID_FILE"
  echo "  start $name (pid $pid)"
}

if [[ "$ACTION" == "stop" ]]; then
  stop_services
  exit 0
fi

if [[ "$ACTION" == "status" ]]; then
  show_status
  exit 0
fi

mkdir -p "$LOG_DIR"
: > "$PID_FILE"

if port_in_use "$RELAY_PORT"; then
  echo "port $RELAY_PORT already in use; run scripts/desktop-linux.sh --stop" >&2
  exit 4
fi
if port_in_use "$MONITOR_PORT"; then
  echo "port $MONITOR_PORT already in use; run scripts/desktop-linux.sh --stop" >&2
  exit 4
fi
if [[ "$NO_KERNEL" != "1" ]]; then
  if port_in_use "$SERIAL_PORT"; then
    echo "port $SERIAL_PORT already in use; run scripts/desktop-linux.sh --stop" >&2
    exit 4
  fi
  if port_in_use "$WS_PORT"; then
    echo "port $WS_PORT already in use; run scripts/desktop-linux.sh --stop" >&2
    exit 4
  fi
fi

if [[ ! -f "$BUILD_DIR/memoria_gen_cpu" ]]; then
  echo "model generator not found: $BUILD_DIR/memoria_gen_cpu" >&2
  echo "Build it first: MEMORIA_PYTHON=python bash scripts/build-linux.sh --cpu-only" >&2
  exit 5
fi
if [[ ! -x "$BUILD_DIR/memoria_gen_cpu" ]]; then
  chmod +x "$BUILD_DIR/memoria_gen_cpu"
fi
if [[ "$NO_KERNEL" != "1" ]]; then
  if [[ -z "$QEMU" ]]; then
    echo "qemu-system-i386 not found; use --no-kernel or set MEMORIA_QEMU." >&2
    exit 6
  fi
  if [[ ! -f "$ROOT/apps/console/kernel/disk.img" ]]; then
    echo "kernel image not found: apps/console/kernel/disk.img" >&2
    exit 6
  fi
  if ! "$PYTHON_BIN" -c 'import websockets' >/dev/null 2>&1; then
    echo "python package websockets is missing; install it or use --no-kernel." >&2
    exit 6
  fi
fi

TORCH_LIB="$("$PYTHON_BIN" -c 'import pathlib, torch; print(pathlib.Path(torch.__file__).resolve().parent / "lib")' 2>/dev/null || true)"
if [[ -n "$TORCH_LIB" && -d "$TORCH_LIB" ]]; then
  export MEMORIA_TORCH_LIB="$TORCH_LIB"
  export LD_LIBRARY_PATH="$TORCH_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
export MEMORIA_BUILD_ROOT="$BUILD_DIR"

echo "Memoria Linux desktop:"
echo "  root    $ROOT"
echo "  build   $BUILD_DIR"
echo "  python  $PYTHON_BIN"
echo "  logs    $LOG_DIR"

start_service relay "$ROOT/apps/relay" \
  "$PYTHON_BIN" -X utf8 -m relay --port "$RELAY_PORT"
if ! wait_port "$RELAY_PORT"; then
  echo "relay did not start; see $LOG_DIR/relay.err.log" >&2
  stop_services
  exit 7
fi

start_service monitor "$ROOT/apps/console/monitor" \
  "$PYTHON_BIN" -X utf8 desktop_server.py \
  --host 127.0.0.1 --port "$MONITOR_PORT" \
  --relay-port "$RELAY_PORT" --bridge-port "$WS_PORT" --serial-port "$SERIAL_PORT" \
  --metrics "$BUILD_DIR/training_metrics.jsonl" \
  --model-exe "$BUILD_DIR/memoria_gen_cpu" \
  --model-exe-cuda "$BUILD_DIR/memoria_gen" \
  --model-data "$ROOT/data/tinyshakespeare_3000.txt"
if ! wait_port "$MONITOR_PORT"; then
  echo "monitor did not start; see $LOG_DIR/monitor.err.log" >&2
  stop_services
  exit 7
fi

if [[ "$NO_KERNEL" != "1" ]]; then
  start_service qemu "$ROOT/apps/console/kernel" \
    "$QEMU" -drive format=raw,file=disk.img -display none -monitor none -no-reboot \
    -serial "tcp:127.0.0.1:$SERIAL_PORT,server=on,wait=off"
  if ! wait_port "$SERIAL_PORT"; then
    echo "qemu serial did not start; see $LOG_DIR/qemu.err.log" >&2
    stop_services
    exit 7
  fi

  start_service bridge "$ROOT/apps/console/bridge" \
    "$PYTHON_BIN" -X utf8 serial_bridge.py
  if ! wait_port "$WS_PORT"; then
    echo "serial bridge did not start; see $LOG_DIR/bridge.err.log" >&2
    stop_services
    exit 7
  fi
fi

echo ""
echo "Memoria Linux desktop is up:"
echo "  desktop  http://127.0.0.1:$MONITOR_PORT/"
echo "  relay    http://127.0.0.1:$RELAY_PORT/v1/health"
if [[ "$NO_KERNEL" != "1" ]]; then
  echo "  kernel   tcp://127.0.0.1:$SERIAL_PORT  ->  ws://127.0.0.1:$WS_PORT"
fi
echo "  logs     $LOG_DIR"
echo "  stop     bash scripts/desktop-linux.sh --stop"
echo ""

#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bridge="$root/src/kernel/host/bridge/serial_bridge.py"
python="${AEVUM_PYTHON:-python3}"
serial_port="${AEVUM_SERIAL_PORT:-5555}"
ws_port="${AEVUM_WS_PORT:-8765}"

if [[ ! -f "$bridge" ]]; then
  echo "bridge not found: $bridge" >&2
  exit 1
fi
if ! command -v "$python" >/dev/null 2>&1; then
  echo "$python not found. Put Python 3 on PATH or set AEVUM_PYTHON." >&2
  exit 1
fi
if ! "$python" -c 'import websockets' >/dev/null 2>&1; then
  echo "Python at $python cannot import websockets. Run: $python -m pip install websockets" >&2
  exit 1
fi

export QEMU_SERIAL_PORT="$serial_port"
export BRIDGE_WS_PORT="$ws_port"
exec "$python" "$bridge"

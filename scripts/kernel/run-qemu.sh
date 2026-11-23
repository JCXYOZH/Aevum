#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
robot="$root/src/kernel/host/console/robot"
disk="$robot/disk.img"
qemu="${AEVUM_QEMU:-qemu-system-i386}"
port="${AEVUM_SERIAL_PORT:-5555}"

if [[ ! -f "$disk" ]]; then
  echo "disk.img not found: $disk. Build first: ./scripts/kernel/build-kernel.sh" >&2
  exit 1
fi
if ! command -v "$qemu" >/dev/null 2>&1; then
  echo "$qemu not found. Put it on PATH or set AEVUM_QEMU." >&2
  exit 1
fi

exec "$qemu" \
  -m 32M \
  -drive "format=raw,file=$disk" \
  -display gtk,zoom-to-fit=on \
  -vga std \
  -serial "tcp:127.0.0.1:$port,server,nowait" \
  -no-reboot

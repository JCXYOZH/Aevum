#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
robot="$root/src/kernel/host/console/robot"

for tool in make gcc nasm ld objcopy; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing build tool: $tool" >&2; exit 1; }
done

cd "$robot"
make clean
make all

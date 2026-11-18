#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "usage: cloud_build.sh <repo_dir>" >&2
    exit 2
fi

REPO_DIR="$1"
cd "$REPO_DIR"
MEMORIA_PYTHON="${MEMORIA_PYTHON:-python}" bash ops/scripts/build-linux.sh

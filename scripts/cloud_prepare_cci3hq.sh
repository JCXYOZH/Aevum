#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "usage: cloud_prepare_cci3hq.sh <data_dir> [output_list]" >&2
    exit 2
fi

DATA_DIR="$1"
LIST="${2:-$DATA_DIR/train_files.txt}"

if [ ! -d "$DATA_DIR" ]; then
    echo "data dir not found: $DATA_DIR" >&2
    exit 1
fi

find "$DATA_DIR" -maxdepth 1 -type f -name 'part_*.jsonl' | sort > "$LIST"
COUNT="$(wc -l < "$LIST" | tr -d ' ')"
BYTES="$(find "$DATA_DIR" -maxdepth 1 -type f -name 'part_*.jsonl' -printf '%s\n' | awk '{s+=$1} END {print s+0}')"

echo "list: $LIST"
echo "shards: $COUNT"
echo "bytes: $BYTES"
if [ "$COUNT" -eq 0 ]; then
    echo "no part_*.jsonl found under $DATA_DIR" >&2
    exit 1
fi

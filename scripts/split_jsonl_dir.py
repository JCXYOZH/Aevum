import argparse
import json
import os
from pathlib import Path


def split_one(src: Path, dst_dir: Path, max_bytes: int, overwrite: bool):
    outputs = []
    out = None
    out_path = None
    out_size = 0
    out_lines = 0
    total_lines = 0
    part = 0
    stem = src.stem

    def open_part():
        nonlocal out, out_path, out_size, out_lines, part
        out_path = dst_dir / f"{stem}.split{part:03d}.jsonl"
        part += 1
        if out_path.exists() and not overwrite:
            raise FileExistsError(f"exists (use --overwrite): {out_path}")
        out = open(out_path, "wb")
        out_size = 0
        out_lines = 0
        outputs.append(out_path)

    try:
        with open(src, "rb") as f:
            for line in f:
                if out is None or (out_size > 0 and out_size + len(line) > max_bytes):
                    if out is not None:
                        out.close()
                    open_part()
                out.write(line)
                out_size += len(line)
                out_lines += 1
                total_lines += 1
    finally:
        if out is not None:
            out.close()

    return outputs, total_lines


def main():
    parser = argparse.ArgumentParser(
        description="Split JSONL shards by line boundaries, never inside a JSON object.")
    parser.add_argument("src_dir", help="source directory, or one source .jsonl file")
    parser.add_argument("dst_dir", help="output directory for split shards")
    parser.add_argument("--max-mb", type=float, default=450.0,
                        help="target maximum size per output file in MiB (default 450)")
    parser.add_argument("--pattern", default="part_*.jsonl",
                        help="source glob pattern (default part_*.jsonl)")
    parser.add_argument("--overwrite", action="store_true",
                        help="overwrite existing split outputs")
    args = parser.parse_args()

    src_arg = Path(args.src_dir).resolve()
    dst_dir = Path(args.dst_dir).resolve()
    if src_arg.is_file():
        sources = [src_arg]
    elif src_arg.is_dir():
        sources = sorted(p for p in src_arg.glob(args.pattern)
                         if p.is_file() and ".split" not in p.name)
    else:
        raise SystemExit(f"source not found: {src_arg}")
    if not sources:
        raise SystemExit(f"no files matched {args.pattern} in {src_arg}")

    dst_dir.mkdir(parents=True, exist_ok=True)
    max_bytes = int(args.max_mb * 1024 * 1024)

    manifest = {"src_dir": str(src_arg), "dst_dir": str(dst_dir),
                "max_mb": args.max_mb, "files": []}
    total_out = 0
    for src in sources:
        outputs, lines = split_one(src, dst_dir, max_bytes, args.overwrite)
        total_out += len(outputs)
        item = {"source": src.name, "lines": lines,
                "outputs": [{"name": p.name, "bytes": p.stat().st_size}
                            for p in outputs]}
        manifest["files"].append(item)
        print(f"{src.name}: {lines} lines -> {len(outputs)} files")
        for p in outputs:
            print(f"  {p.name}  {p.stat().st_size} B")

    manifest["total_outputs"] = total_out
    manifest_path = dst_dir / "split_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                             encoding="utf-8")
    print(f"manifest: {manifest_path}")


if __name__ == "__main__":
    main()

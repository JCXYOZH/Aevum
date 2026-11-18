# ============================================================
# relay/contract_export.py — 从契约生成其它语言的代码（DAG 第 2 层）
#
# 方法论三：跨语言不导入，只认同一份契约。
#   契约（contracts/errors.json，与语言无关）
#     → Python：relay/codes.py 运行时加载
#     → C     ：contracts/errors.h 由本模块生成
#     → JS    ：同理可在此扩展一个生成器
#
# 只写文件、不读业务状态；不属于运行时路径，只在构建时手工执行：
#   python -m relay.contract_export --out contracts/errors.h
# ============================================================
from __future__ import annotations

import argparse
import unicodedata
from pathlib import Path

from relay.codes import CONTRACT_SHA256, MAGIC, VERSION, all_codes, error_hex


def _ascii_comment(text: str) -> str:
    """C 头文件里保留中文说明，但把换行和 */ 清掉，避免破坏注释块。"""
    cleaned = unicodedata.normalize("NFC", text).replace("\n", " ").replace("*/", "* /")
    return cleaned


def render_c_header() -> str:
    lines = [
        "/* 由 contracts/errors.json 生成；不要手改。",
        f" * contract {MAGIC}/{VERSION}  sha256={CONTRACT_SHA256}",
        " * 生成命令：python -m relay.contract_export --out contracts/errors.h",
        " */",
        "#ifndef MRR_ERRORS_H",
        "#define MRR_ERRORS_H",
        "",
        f'#define MRR_CONTRACT_MAGIC "{MAGIC}"',
        f"#define MRR_CONTRACT_VERSION {VERSION}u",
        "",
    ]
    for code, name, message, http in all_codes():
        lines.append(
            f"#define MRR_ERR_{name} {error_hex(code)}u"
            f"  /* HTTP {http} {_ascii_comment(message)} */"
        )
    lines += [
        "",
        "#endif /* MRR_ERRORS_H */",
        "",
    ]
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m relay.contract_export")
    parser.add_argument("--out", default="contracts/errors.h")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写文件")
    args = parser.parse_args(argv)

    header = render_c_header()
    if args.dry_run:
        print(header)
        return 0
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(header + "", encoding="utf-8", newline="\n")
    print(f"wrote {target} ({len(header)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Aevum 静态代码审计。

本脚本只做可复算的静态统计，不做运行时覆盖率：

- 代码利用率：从 ``src/architecture/libertas/main.py`` 出发，沿 ``libertas``
  导入图计算可达模块数与可达代码行数。
- 文档完善性：统计 ``docs/`` 非空/实质文档、Libertas 模块 docstring、
  函数/类 docstring。
- 拆分规范性：统计 Python 文件行数、超 500/800/1000 行文件与入口文件大小。

用法：
    python ops/tools/analyze.py
    python ops/tools/analyze.py --json
"""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
ARCH_ROOT = ROOT / "src" / "architecture"
LIBERTAS_ROOT = ARCH_ROOT / "libertas"


def _iter_py(base: Path) -> Iterable[Path]:
    for path in base.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        if "node_modules" in path.parts or "vendor" in path.parts:
            continue
        yield path


def _line_count(path: Path) -> int:
    try:
        with path.open("rb") as handle:
            return sum(1 for _ in handle)
    except OSError:
        return 0


def _module_map() -> dict[str, Path]:
    modules: dict[str, Path] = {}
    for path in _iter_py(LIBERTAS_ROOT):
        rel = path.relative_to(ARCH_ROOT).with_suffix("")
        name = ".".join(rel.parts)
        if name.endswith(".__init__"):
            name = name[: -len(".__init__")]
        modules[name] = path
    return modules


def _package_of(module: str, path: Path) -> str:
    if path.name == "__init__.py":
        return module
    return module.rsplit(".", 1)[0] if "." in module else ""


def _imported_names(path: Path, module: str) -> list[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, SyntaxError):
        return []
    names: list[str] = []
    package = _package_of(module, path)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                parts = package.split(".") if package else []
                keep = len(parts) - (node.level - 1)
                prefix = parts[: max(0, keep)]
                base = ".".join(prefix + ([base] if base else []))
            if base:
                names.append(base)
                names.extend(f"{base}.{alias.name}" for alias in node.names if alias.name != "*")
    return names


def _resolve(name: str, modules: dict[str, Path]) -> str | None:
    """把导入名收敛到实际存在的 Libertas 模块。"""
    if not name.startswith("libertas"):
        return None
    parts = name.split(".")
    for end in range(len(parts), 0, -1):
        candidate = ".".join(parts[:end])
        if candidate in modules:
            return candidate
    return None


def code_reachability(modules: dict[str, Path]) -> dict:
    queue: list[str] = []
    for path in _iter_py(LIBERTAS_ROOT):
        if path.name == "main.py":
            module = ".".join(path.relative_to(ARCH_ROOT).with_suffix("").parts)
            for imported in _imported_names(path, module):
                resolved = _resolve(imported, modules)
                if resolved:
                    queue.append(resolved)

    reached: set[str] = set()
    while queue:
        module = queue.pop()
        if module in reached or module not in modules:
            continue
        reached.add(module)
        path = modules[module]
        for imported in _imported_names(path, module):
            resolved = _resolve(imported, modules)
            if resolved:
                queue.append(resolved)

    total_loc = sum(_line_count(path) for path in modules.values())
    reached_loc = sum(_line_count(modules[name]) for name in reached)
    return {
        "scope": "src/architecture/libertas",
        "modules": len(modules),
        "reachable_modules": len(reached),
        "module_rate": round(len(reached) / len(modules), 4) if modules else 0.0,
        "loc": total_loc,
        "reachable_loc": reached_loc,
        "loc_rate": round(reached_loc / total_loc, 4) if total_loc else 0.0,
        "unreachable_modules": len(modules) - len(reached),
    }


def docs_metrics() -> dict:
    docs = sorted((ROOT / "docs").rglob("*.md"))
    docs = [path for path in docs if path.is_file()]
    zero = [path for path in docs if path.stat().st_size == 0]
    substantive = []
    for path in docs:
        try:
            body = path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            body = ""
        if len(body) >= 200:
            substantive.append(path)

    module_total = module_doc = 0
    symbol_total = symbol_doc = 0
    for path in _iter_py(LIBERTAS_ROOT):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, SyntaxError):
            continue
        module_total += 1
        if ast.get_docstring(tree):
            module_doc += 1
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                symbol_total += 1
                if ast.get_docstring(node):
                    symbol_doc += 1

    return {
        "docs_total": len(docs),
        "docs_empty": len(zero),
        "docs_substantive": len(substantive),
        "docs_rate": round(len(substantive) / len(docs), 4) if docs else 0.0,
        "module_docstrings": module_doc,
        "module_total": module_total,
        "module_doc_rate": round(module_doc / module_total, 4) if module_total else 0.0,
        "symbol_docstrings": symbol_doc,
        "symbol_total": symbol_total,
        "symbol_doc_rate": round(symbol_doc / symbol_total, 4) if symbol_total else 0.0,
        "composite_rate": round(
            (
                (len(substantive) / len(docs) if docs else 0.0)
                + (module_doc / module_total if module_total else 0.0)
                + (symbol_doc / symbol_total if symbol_total else 0.0)
            )
            / 3,
            4,
        ),
    }


def split_metrics() -> dict:
    paths = list(_iter_py(LIBERTAS_ROOT))
    paths += list(_iter_py(ROOT / "src" / "kernel"))
    paths += list(_iter_py(ROOT / "src" / "shared"))
    paths += list(_iter_py(ROOT / "control"))
    paths += list(_iter_py(ROOT / "interface"))
    paths += list(_iter_py(ROOT / "ops"))
    paths += list(_iter_py(ROOT / "labs"))
    sizes = [(path, _line_count(path)) for path in paths]
    sizes.sort(key=lambda item: item[1], reverse=True)
    over_500 = [item for item in sizes if item[1] > 500]
    over_800 = [item for item in sizes if item[1] > 800]
    over_1000 = [item for item in sizes if item[1] > 1000]
    return {
        "python_files": len(sizes),
        "files_over_500": len(over_500),
        "files_over_800": len(over_800),
        "files_over_1000": len(over_1000),
        "compliance_rate": round(1 - len(over_500) / len(sizes), 4) if sizes else 0.0,
        "max_lines": sizes[0][1] if sizes else 0,
        "top_files": [
            {"path": str(path.relative_to(ROOT)), "lines": lines}
            for path, lines in sizes[:12]
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()

    modules = _module_map()
    result = {
        "code": code_reachability(modules),
        "docs": docs_metrics(),
        "split": split_metrics(),
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    code = result["code"]
    docs = result["docs"]
    split = result["split"]
    print("Aevum code audit")
    print(f"code modules: {code['reachable_modules']}/{code['modules']} = {code['module_rate']:.1%}")
    print(f"code lines:   {code['reachable_loc']}/{code['loc']} = {code['loc_rate']:.1%}")
    print(f"docs:         {docs['docs_substantive']}/{docs['docs_total']} substantive = {docs['docs_rate']:.1%}")
    print(f"docstrings:   module {docs['module_doc_rate']:.1%}, symbol {docs['symbol_doc_rate']:.1%}")
    print(f"docs composite: {docs['composite_rate']:.1%} (页面/模块/符号等权)")
    print(f"split:        {split['files_over_500']}/{split['python_files']} over 500 lines = {split['compliance_rate']:.1%} under threshold")
    print("\nLargest files:")
    for item in split["top_files"]:
        print(f"  {item['lines']:5d} {item['path']}")


if __name__ == "__main__":
    main()

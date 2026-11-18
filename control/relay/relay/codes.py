# ============================================================
# relay/codes.py — 契约加载层（DAG 第 0 层，最低层）
#
# 唯一出处是 contracts/errors.json，不是本文件。
# 本文件只做三件事：读契约、建表、暴露常量与查询函数。
# 任何语言需要 0xRRFFTT，都读同一份 JSON；Python 只是其中一个消费者。
#
# 本模块不导入包内任何其它模块：它是所有模块的根。
# ============================================================
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Dict, List, Tuple

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "errors.json"


class ContractFault(RuntimeError):
    """契约缺失或损坏。由 bootstrap 映射成 0x07 开头的码。"""


def _load(path: Path) -> dict:
    if not path.is_file():
        raise ContractFault(f"契约文件不存在: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractFault(f"契约文件无法解析: {path} ({exc})") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("codes"), list):
        raise ContractFault(f"契约结构不合法: {path}")
    return raw


_RAW = _load(CONTRACT_PATH)

MAGIC: str = str(_RAW.get("magic", ""))
VERSION: int = int(_RAW.get("version", 0))
CONTRACT_SHA256: str = hashlib.sha256(CONTRACT_PATH.read_bytes()).hexdigest()

_BY_NAME: Dict[str, int] = {}
_TABLE: Dict[int, Tuple[str, str, int]] = {}

for _entry in _RAW["codes"]:
    try:
        code = int(str(_entry["code"]), 16)
        name = str(_entry["name"])
        message = str(_entry["message"])
        http = int(_entry["http"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ContractFault(f"契约条目字段缺失: {_entry!r} ({exc})") from exc
    if code in _TABLE:
        raise ContractFault(f"契约里出现重复码: 0x{code:06X}")
    _BY_NAME[name] = code
    _TABLE[code] = (name, message, http)
    globals()[f"ERR_{name}"] = code

CONTRACT_VERSION = f"{MAGIC}/{VERSION}"

# 成功码也从契约取，但在模块加载时显式绑定一次：as_dict 直接用这个名字，
# 静态检查器能看到定义，不必依赖循环里的 globals() 动态写入。
try:
    ERR_OK: int = _BY_NAME["OK"]
except KeyError as exc:
    raise ContractFault("契约缺少成功码 OK") from exc


def error_hex(code: int) -> str:
    return f"0x{code:06X}"


def error_name(code: int) -> str:
    return _TABLE.get(code, ("R_UNKNOWN", "未知错误", 500))[0]


def error_message(code: int) -> str:
    return _TABLE.get(code, ("R_UNKNOWN", "未知错误", 500))[1]


def http_status(code: int) -> int:
    return _TABLE.get(code, ("R_UNKNOWN", "未知错误", 500))[2]


def code_of(name: str) -> int:
    """按符号名取码；名字写错属于契约缺口，直接抛出。"""
    try:
        return _BY_NAME[name]
    except KeyError as exc:
        raise ContractFault(f"契约里没有这个码: {name}") from exc


def as_dict(code: int) -> Dict[str, object]:
    return {
        "ok": code == ERR_OK,
        "code": error_hex(code),
        "name": error_name(code),
        "message": error_message(code),
    }


def all_codes() -> List[Tuple[int, str, str, int]]:
    """(码, 名, 说明, HTTP)。生成其它语言的头文件时用这一份，保证同源。"""
    return [(code, *_TABLE[code]) for code in sorted(_TABLE)]


__all__ = sorted(["MAGIC", "VERSION", "CONTRACT_VERSION", "CONTRACT_SHA256", "CONTRACT_PATH",
                  "ContractFault", "error_hex", "error_name", "error_message", "http_status",
                  "code_of", "as_dict", "all_codes"] + [f"ERR_{name}" for name in _BY_NAME])

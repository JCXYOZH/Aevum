"""
高级搜索语法（Google dork）解析器。
支持: site: inurl: intitle: intext: filetype: ext: link: related:
      双引号精确匹配  -排除  OR  括号分组
"""
from __future__ import annotations
import re
from typing import Dict, List, Any

DORK_OPERATORS = {
    "site", "inurl", "intitle", "intext", "filetype", "ext",
    "link", "related", "cache", "define", "info", "anchor",
}

_OPERATOR_RE = re.compile(
    r'\b(site|inurl|intitle|intext|filetype|ext|link|related|cache|define|info|anchor)'
    r'\s*:\s*("([^"]*)"|([^\s)]+))',
    re.IGNORECASE,
)
_PHRASE_RE = re.compile(r'"([^"]+)"')
_EXCLUDE_RE = re.compile(r'(?:^|\s)-([^\s]+)')
_OR_RE = re.compile(r'\bOR\b')


def parse_dork(query: str) -> Dict[str, Any]:
    """解析高级搜索语法。

    Returns:
        {
            "is_dork": bool,
            "raw": str,                    # 原始查询
            "cleaned": str,                # 去掉运算符后的关键词
            "operators": {op: [values]},   # 运算符
            "phrases": [str],              # 双引号精确匹配
            "exclude": [str],              # 排除词
            "has_or": bool,                # 是否含OR
        }
    """
    q = query.strip()
    operators: Dict[str, List[str]] = {}
    phrases: List[str] = []
    exclude: List[str] = []

    # 先解析运算符（支持带引号的值，如 intitle:"index of"）
    for m in _OPERATOR_RE.finditer(q):
        op = m.group(1).lower()
        val = (m.group(3) if m.group(3) is not None else m.group(4) or "").strip("'\"")
        val = val.rstrip('()')
        if val:
            operators.setdefault(op, []).append(val)
    q_no_ops = _OPERATOR_RE.sub(" ", q)

    # 再解析独立的双引号短语
    for m in _PHRASE_RE.finditer(q_no_ops):
        phrases.append(m.group(1))
    q_no_phrases = _PHRASE_RE.sub(" ", q_no_ops)

    # 排除词
    for m in _EXCLUDE_RE.finditer(q_no_phrases):
        ex = m.group(1).strip("'\"()")
        if ex:
            exclude.append(ex)
    q_clean = _EXCLUDE_RE.sub(" ", q_no_phrases)

    has_or = bool(_OR_RE.search(q_clean))
    q_clean = _OR_RE.sub(" ", q_clean)
    q_clean = re.sub(r'[()]+', ' ', q_clean)
    q_clean = re.sub(r'\s+', ' ', q_clean).strip()

    is_dork = bool(operators) or bool(phrases)

    return {
        "is_dork": is_dork,
        "raw": query.strip(),
        "cleaned": q_clean,
        "operators": operators,
        "phrases": phrases,
        "exclude": exclude,
        "has_or": has_or,
    }


def build_engine_query(dork: Dict[str, Any], engine: str = "bing") -> str:
    """根据搜索引擎构建查询字符串（不同引擎语法略有差异）。"""
    parts = []
    ops = dork.get("operators", {})

    for op, values in ops.items():
        for v in values:
            if engine == "baidu" and op in ("intext", "anchor", "cache", "define", "info"):
                continue
            if op == "ext":
                parts.append(f"filetype:{v}")
            elif " " in v:
                parts.append(f'{op}:"{v}"')
            else:
                parts.append(f"{op}:{v}")

    for phrase in dork.get("phrases", []):
        parts.append(f'"{phrase}"')

    for ex in dork.get("exclude", []):
        parts.append(f"-{ex}")

    cleaned = dork.get("cleaned", "")
    if cleaned:
        parts.append(cleaned)

    return " ".join(parts)


def is_dork_query(query: str) -> bool:
    """快速判断是否包含高级搜索语法。"""
    q = query.strip()
    if _OPERATOR_RE.search(q):
        return True
    if _PHRASE_RE.search(q):
        return True
    if re.search(r'\bOR\b', q):
        return True
    return False

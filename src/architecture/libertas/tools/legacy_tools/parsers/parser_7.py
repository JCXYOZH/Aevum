# tools/parsers.py
"""
工具输出解析器集合
每个解析器函数接收 raw_output 和 params，返回结构化数据
"""
import json
import re
import sys
from typing import Dict, Any
from libertas.utils.text_decode import read_text_auto, read_lines_auto, describe_exception


def nuclei_jsonl_parser(raw_output: str, params: dict) -> dict:
    """解析 nuclei -jsonl 输出"""
    findings = []
    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            findings.append({
                "template": data.get("template-id", ""),
                "template_name": data.get("info", {}).get("name", ""),
                "severity": data.get("info", {}).get("severity", ""),
                "url": data.get("matched-at", ""),
                "cve": [t for t in data.get("info", {}).get("classification", {}).get("cve-id", []) if t],
                "tags": data.get("info", {}).get("tags", ""),
            })
        except json.JSONDecodeError:
            if "[" in line and "]" in line:
                sev_match = re.search(r'\[(critical|high|medium|low|info)\]', line, re.IGNORECASE)
                findings.append({
                    "template": "",
                    "template_name": line[:100],
                    "severity": sev_match.group(1).lower() if sev_match else "info",
                    "url": "",
                    "cve": re.findall(r'CVE-\d{4}-\d{4,7}', line),
                    "tags": "",
                })
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda x: severity_order.get(x.get("severity", "info"), 5))
    return {
        "target": params.get("target", ""),
        "findings": findings,
        "count": len(findings),
        "summary": f"{len(findings)} 个发现 ({sum(1 for f in findings if f.get('severity') in ('critical','high'))} 高危)",
    }

def parse_tool_result(tool_name: str, raw_output: str, params: dict = None) -> dict:
    """统一解析入口。根据工具名分发到对应解析器，无匹配时返回None。"""
    if params is None:
        params = {}
    params["target"] = params.get("target", "")
    from .registry import PARSER_MAP
    parser_fn = PARSER_MAP.get(tool_name)
    if parser_fn:
        try:
            result = parser_fn(raw_output, params)
            result["_parsed"] = True
            result["_tool"] = tool_name
            return result
        except Exception as e:
            return {"_parsed": False, "_tool": tool_name, "error": str(e)[:200]}
    return {"_parsed": False, "_tool": tool_name}

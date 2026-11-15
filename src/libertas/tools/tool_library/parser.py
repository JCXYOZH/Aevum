"""职责模块：parser。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import xml.etree.ElementTree as ET
from collections import deque, Counter, defaultdict
import json
from libertas.foundation.terminal import terminal
import threading
import uuid

class ToolResultParser:
    """工具结果结构化解析器 - 统一解析各种工具输出"""

    def __init__(self):
        self.parser_id = f"parser_{uuid.uuid4().hex[:8]}"
        self.parsers: Dict[str, Callable] = {
            "json": self._parse_json,
            "xml": self._parse_xml,
            "nmap_xml": self._parse_nmap_xml,
            "csv": self._parse_csv,
            "key_value": self._parse_key_value,
            "table": self._parse_table,
            "text": self._parse_text,
        }
        self._lock = threading.RLock()

    def parse(self, raw_output: str, parser_type: str = "text",
              tool_name: str = "") -> Tuple[Any, bool]:
        """解析工具输出"""
        parser = self.parsers.get(parser_type, self._parse_text)
        try:
            result = parser(raw_output, tool_name)
            return result, True
        except Exception as e:
            terminal.warn(f"结果解析失败 ({parser_type}): {e}", "tool_parser")
            return {"raw": raw_output, "parse_error": str(e)}, False

    def register_parser(self, name: str, parser_fn: Callable):
        with self._lock:
            self.parsers[name] = parser_fn

    def _parse_json(self, raw: str, tool_name: str = "") -> Any:
        return json.loads(raw)

    def _parse_xml(self, raw: str, tool_name: str = "") -> Dict:
        root = ET.fromstring(raw)
        return self._xml_to_dict(root)

    def _xml_to_dict(self, element: ET.Element) -> Dict:
        result = {}
        if element.attrib:
            result["@attributes"] = dict(element.attrib)
        children = list(element)
        if children:
            child_dict = defaultdict(list)
            for child in children:
                child_dict[child.tag].append(self._xml_to_dict(child))
            for tag, items in child_dict.items():
                result[tag] = items[0] if len(items) == 1 else items
        if element.text and element.text.strip():
            result["#text"] = element.text.strip()
        return result

    def _parse_nmap_xml(self, raw: str, tool_name: str = "") -> Dict:
        """解析Nmap XML输出"""
        root = ET.fromstring(raw)
        result = {
            "scanner": root.get("scanner", ""),
            "version": root.get("version", ""),
            "args": root.get("args", ""),
            "start_time": root.get("start", ""),
            "hosts": [],
        }
        for host in root.findall(".//host"):
            host_data = {
                "status": host.findtext("status/@state", "unknown"),
                "addresses": [],
                "ports": [],
                "os": [],
            }
            for addr in host.findall("address"):
                host_data["addresses"].append({
                    "addr": addr.get("addr", ""),
                    "type": addr.get("addrtype", ""),
                })
            for port in host.findall(".//port"):
                port_data = {
                    "protocol": port.get("protocol", ""),
                    "portid": port.get("portid", ""),
                    "state": port.findtext("state/@state", "unknown"),
                    "service": port.findtext("service/@name", ""),
                    "service_version": port.findtext("service/@version", ""),
                    "product": port.findtext("service/@product", ""),
                    "scripts": [],
                }
                for script in port.findall("script"):
                    port_data["scripts"].append({
                        "id": script.get("id", ""),
                        "output": script.get("output", "")[:500],
                    })
                host_data["ports"].append(port_data)
            for osmatch in host.findall(".//osmatch"):
                host_data["os"].append({
                    "name": osmatch.get("name", ""),
                    "accuracy": osmatch.get("accuracy", ""),
                })
            result["hosts"].append(host_data)
        return result

    def _parse_csv(self, raw: str, tool_name: str = "") -> List[Dict]:
        lines = raw.strip().split("\n")
        if not lines:
            return []
        headers = [h.strip().strip('"') for h in lines[0].split(",")]
        result = []
        for line in lines[1:]:
            values = [v.strip().strip('"') for v in line.split(",")]
            if len(values) == len(headers):
                result.append(dict(zip(headers, values)))
        return result

    def _parse_key_value(self, raw: str, tool_name: str = "") -> Dict:
        result = {}
        for line in raw.split("\n"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" in line:
                key, value = line.split(":", 1)
                result[key.strip()] = value.strip()
            elif "=" in line:
                key, value = line.split("=", 1)
                result[key.strip()] = value.strip()
        return result

    def _parse_table(self, raw: str, tool_name: str = "") -> List[Dict]:
        lines = [l for l in raw.split("\n") if l.strip()]
        if len(lines) < 2:
            return []
        # 检测分隔符
        if "|" in lines[0]:
            sep = "|"
        elif "\t" in lines[0]:
            sep = "\t"
        else:
            sep = None
        if sep:
            headers = [h.strip() for h in lines[0].split(sep) if h.strip()]
            result = []
            for line in lines[2:]:  # 跳过分隔线
                values = [v.strip() for v in line.split(sep) if v.strip()]
                if len(values) == len(headers):
                    result.append(dict(zip(headers, values)))
            return result
        return []

    def _parse_text(self, raw: str, tool_name: str = "") -> Dict:
        return {
            "raw": raw,
            "lines": len(raw.split("\n")),
            "chars": len(raw),
            "words": len(raw.split()),
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "parser_id": self.parser_id,
            "supported_parsers": list(self.parsers.keys()),
        }

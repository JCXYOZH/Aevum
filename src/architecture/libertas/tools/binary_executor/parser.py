"""职责模块：parser。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple, Union
import re

from .constants import logger

class OutputParser:
    """常见工具输出解析器"""

    @staticmethod
    def parse(tool_name: str, output: str) -> Any:
        """解析工具输出"""
        parsers = {
            "nmap": OutputParser._parse_nmap,
            "ping": OutputParser._parse_ping,
            "netstat": OutputParser._parse_netstat,
            "curl": OutputParser._parse_curl,
            "dig": OutputParser._parse_dig,
            "whois": OutputParser._parse_whois,
        }
        parser = parsers.get(tool_name.lower())
        if parser:
            try:
                return parser(output)
            except Exception as e:
                logger.debug(f"解析{tool_name}输出失败: {e}")
        return None

    @staticmethod
    def _parse_nmap(output: str) -> Dict:
        """解析Nmap输出"""
        result = {"hosts": [], "open_ports": [], "summary": ""}
        # 简化解析
        host_matches = re.findall(r"Nmap scan report for ([\w.\-]+(?: \(([\d.]+)\))?)", output)
        for match in host_matches:
            host = match[0]
            ip = match[1] if len(match) > 1 and match[1] else ""
            result["hosts"].append({"host": host, "ip": ip})

        port_matches = re.findall(r"(\d+)/(\w+)\s+(\w+)\s+([^\n]*)", output)
        for port, proto, state, service in port_matches:
            if state.lower() == "open":
                result["open_ports"].append({
                    "port": int(port), "protocol": proto,
                    "state": state, "service": service.strip()
                })

        summary_match = re.search(r"# Nmap done at[^\n]*", output)
        if summary_match:
            result["summary"] = summary_match.group(0)

        return result

    @staticmethod
    def _parse_ping(output: str) -> Dict:
        """解析Ping输出"""
        result = {"sent": 0, "received": 0, "loss": 0.0, "min_ms": 0.0, "avg_ms": 0.0, "max_ms": 0.0}

        loss_match = re.search(r"(\d+(?:\.\d+)?)%\s*(?:packet loss|丢失)", output)
        if loss_match:
            result["loss"] = float(loss_match.group(1))

        sent_match = re.search(r"(\d+)\s*(?:packets transmitted|已发送)", output)
        if sent_match:
            result["sent"] = int(sent_match.group(1))

        recv_match = re.search(r"(\d+)\s*(?:received|已接收)", output)
        if recv_match:
            result["received"] = int(recv_match.group(1))

        time_match = re.search(r"min/avg/max[^=]*=\s*([\d.]+)/([\d.]+)/([\d.]+)", output)
        if time_match:
            result["min_ms"] = float(time_match.group(1))
            result["avg_ms"] = float(time_match.group(2))
            result["max_ms"] = float(time_match.group(3))

        return result

    @staticmethod
    def _parse_netstat(output: str) -> Dict:
        """解析netstat输出"""
        result = {"connections": [], "listening_ports": []}
        lines = output.strip().split("\n")
        for line in lines:
            parts = line.split()
            if len(parts) >= 4 and ":" in line:
                proto = parts[0] if parts[0] in ("tcp", "udp", "TCP", "UDP") else ""
                if proto:
                    result["connections"].append({"raw": line.strip()})
        return result

    @staticmethod
    def _parse_curl(output: str) -> Dict:
        """解析curl输出"""
        return {"body_length": len(output), "preview": output[:500]}

    @staticmethod
    def _parse_dig(output: str) -> Dict:
        """解析dig输出"""
        result = {"answers": [], "status": ""}
        status_match = re.search(r"status:\s*(\w+)", output)
        if status_match:
            result["status"] = status_match.group(1)

        # 简化解析ANSWER SECTION
        in_answer = False
        for line in output.split("\n"):
            if "ANSWER SECTION" in line:
                in_answer = True
                continue
            if in_answer and line.strip() and not line.startswith(";;"):
                parts = line.split()
                if len(parts) >= 5:
                    result["answers"].append({
                        "name": parts[0], "ttl": parts[1],
                        "class": parts[2], "type": parts[3],
                        "value": " ".join(parts[4:])
                    })
            elif in_answer and line.startswith(";;"):
                break
        return result

    @staticmethod
    def _parse_whois(output: str) -> Dict:
        """解析whois输出"""
        result = {}
        for line in output.split("\n"):
            if ":" in line and not line.startswith("%"):
                key, _, value = line.partition(":")
                key = key.strip().lower().replace(" ", "_")
                value = value.strip()
                if key and value and key not in result:
                    result[key] = value
        return result

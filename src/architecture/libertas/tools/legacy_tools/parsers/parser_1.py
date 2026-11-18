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


def subfinder_parser(raw_output: str, params: dict) -> dict:
    """解析 subfinder 输出（每行一个域名）"""
    domains = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "domains": domains,
        "count": len(domains)
    }

def masscan_parser(raw_output: str, params: dict) -> dict:
    """解析 masscan JSON 输出"""
    try:
        data = json.loads(raw_output)
        ports = []
        for item in data:
            ports.append({
                "ip": item.get("ip"),
                "port": item.get("port"),
                "protocol": item.get("proto"),
                "service": item.get("service", {}).get("name", "unknown")
            })
        return {"open_ports": ports, "count": len(ports)}
    except json.JSONDecodeError:
        # 回退到逐行解析
        ports = []
        for line in raw_output.splitlines():
            match = re.search(r'(\d+\.\d+\.\d+\.\d+):(\d+)', line)
            if match:
                ports.append({"ip": match.group(1), "port": int(match.group(2))})
        return {"open_ports": ports, "count": len(ports)}

def ffuf_parser(raw_output: str, params: dict) -> dict:
    """解析 ffuf JSON 输出"""
    try:
        data = json.loads(raw_output)
        results = data.get("results", [])
        return {
            "total": len(results),
            "results": [
                {
                    "url": r.get("url"),
                    "status": r.get("status"),
                    "length": r.get("length"),
                    "words": r.get("words"),
                    "lines": r.get("lines")
                }
                for r in results
            ]
        }
    except json.JSONDecodeError:
        # 回退到 CSV 解析（如果输出为CSV）
        lines = raw_output.strip().splitlines()
        if not lines:
            return {"results": []}
        results = []
        for line in lines[1:]:
            parts = line.split(',')
            if len(parts) >= 3:
                results.append({
                    "url": parts[0].strip(),
                    "status": parts[1].strip(),
                    "length": parts[2].strip()
                })
        return {"results": results}

def hydra_parser(raw_output: str, params: dict) -> dict:
    """解析 hydra 输出，提取成功登录尝试"""
    success_lines = []
    for line in raw_output.splitlines():
        if "[SUCCESS]" in line:
            success_lines.append(line.strip())
    return {
        "success_attempts": success_lines,
        "count": len(success_lines)
    }

def nikto_parser(raw_output: str, params: dict) -> dict:
    """解析 nikto JSON 输出（需将输出格式设为json）"""
    try:
        data = json.loads(raw_output)
        vulnerabilities = []
        for item in data.get("vulnerabilities", []):
            vulnerabilities.append({
                "id": item.get("id"),
                "name": item.get("name"),
                "method": item.get("method"),
                "url": item.get("url"),
                "severity": item.get("severity")
            })
        return {
            "vulnerabilities": vulnerabilities,
            "count": len(vulnerabilities)
        }
    except json.JSONDecodeError:
        # 回退到纯文本解析
        vulns = []
        for line in raw_output.splitlines():
            if "+" in line and ":" in line:
                vulns.append(line.strip())
        return {"vulnerabilities": vulns, "count": len(vulns)}

def amass_parser(raw_output: str, params: dict) -> dict:
    """解析 amass 输出（每行一个域名）"""
    domains = [line.strip() for line in raw_output.splitlines() if line.strip() and not line.startswith("#")]
    return {
        "domains": domains,
        "count": len(domains)
    }

def gobuster_parser(raw_output: str, params: dict) -> dict:
    """解析 gobuster JSON 输出"""
    try:
        data = json.loads(raw_output)
        entries = data.get("results", [])
        return {
            "total": len(entries),
            "results": [
                {
                    "url": e.get("url"),
                    "status": e.get("status"),
                    "size": e.get("size")
                }
                for e in entries
            ]
        }
    except json.JSONDecodeError:
        # 回退到纯文本
        results = []
        for line in raw_output.splitlines():
            parts = line.strip().split()
            if len(parts) >= 3:
                # 格式: /path (Status: 200) [Size: 123]
                url = parts[0]
                status = parts[1].replace('(Status:', '').replace(')', '')
                size = parts[2].replace('[Size:', '').replace(']', '')
                results.append({"url": url, "status": status, "size": size})
        return {"results": results}

def rustscan_parser(raw_output: str, params: dict) -> dict:
    """解析 rustscan JSON 输出"""
    try:
        data = json.loads(raw_output)
        ports = []
        for host in data.get("hosts", []):
            for port in host.get("ports", []):
                ports.append({
                    "ip": host.get("ip"),
                    "port": port.get("port"),
                    "protocol": port.get("protocol"),
                    "service": port.get("service", {}).get("name", "unknown")
                })
        return {"open_ports": ports, "count": len(ports)}
    except json.JSONDecodeError:
        # 回退到逐行解析
        ports = []
        for line in raw_output.splitlines():
            # 格式: 192.168.1.1:22
            if ':' in line and len(line.split(':')) == 2:
                ip, port = line.strip().split(':')
                ports.append({"ip": ip, "port": int(port)})
        return {"open_ports": ports, "count": len(ports)}

def naabu_parser(raw_output: str, params: dict) -> dict:
    """解析 naabu 输出（每行 ip:port）"""
    ports = []
    for line in raw_output.splitlines():
        line = line.strip()
        if ':' in line:
            parts = line.split(':')
            if len(parts) == 2:
                ports.append({
                    "ip": parts[0],
                    "port": int(parts[1])
                })
    return {"open_ports": ports, "count": len(ports)}

def sqlmap_parser(raw_output: str, params: dict) -> dict:
    """解析 sqlmap 输出，提取漏洞信息"""
    vulnerabilities = []
    for line in raw_output.splitlines():
        if "vulnerable" in line.lower() or "identified" in line.lower():
            # 简单提取包含 "vulnerable" 的行
            clean_line = line.strip()
            if clean_line:
                vulnerabilities.append(clean_line)
    return {
        "is_vulnerable": len(vulnerabilities) > 0,
        "findings": vulnerabilities,
        "count": len(vulnerabilities)
    }

def trivy_parser(raw_output: str, params: dict) -> dict:
    """解析 trivy JSON 输出"""
    try:
        data = json.loads(raw_output)
        total_vulns = len(data.get("Results", []))
        findings = []
        for result in data.get("Results", []):
            for vuln in result.get("Vulnerabilities", []):
                findings.append({
                    "id": vuln.get("VulnerabilityID"),
                    "severity": vuln.get("Severity"),
                    "title": vuln.get("Title"),
                    "package": vuln.get("PkgName")
                })
        return {
            "total_vulnerabilities": len(findings),
            "findings": findings
        }
    except json.JSONDecodeError:
        # 回退到纯文本
        vulns = []
        for line in raw_output.splitlines():
            if "VulnerabilityID" in line:
                vulns.append(line.strip())
        return {"findings": vulns, "count": len(vulns)}

def whatweb_parser(raw_output: str, params: dict) -> dict:
    """解析 whatweb JSON 输出"""
    try:
        data = json.loads(raw_output)
        if isinstance(data, list) and len(data) > 0:
            results = []
            for item in data:
                results.append({
                    "url": item.get("url"),
                    "status": item.get("status"),
                    "fingerprints": [
                        {"name": k, "value": v} 
                        for k, v in item.items() 
                        if k not in ("url", "status")
                    ]
                })
            return {"results": results, "count": len(results)}
        else:
            return {"results": [], "count": 0}
    except json.JSONDecodeError:
        # 回退到纯文本
        lines = raw_output.strip().splitlines()
        return {"raw_lines": lines[:20], "count": len(lines)}

def wpscan_parser(raw_output: str, params: dict) -> dict:
    """解析 wpscan JSON 输出"""
    try:
        data = json.loads(raw_output)
        vulnerabilities = []
        for vuln in data.get("vulnerabilities", []):
            vulnerabilities.append({
                "id": vuln.get("id"),
                "title": vuln.get("title"),
                "risk": vuln.get("risk"),
                "description": vuln.get("description", "")[:200]
            })
        return {
            "vulnerabilities": vulnerabilities,
            "count": len(vulnerabilities),
            "summary": data.get("summary", {})
        }
    except json.JSONDecodeError:
        vulns = []
        for line in raw_output.splitlines():
            if "Vulnerability" in line or "vuln" in line.lower():
                vulns.append(line.strip())
        return {"vulnerabilities": vulns, "count": len(vulns)}

def medusa_parser(raw_output: str, params: dict) -> dict:
    """解析 medusa 输出，提取成功登录"""
    success_lines = []
    for line in raw_output.splitlines():
        if "SUCCESS" in line.upper():
            success_lines.append(line.strip())
    return {
        "success_attempts": success_lines,
        "count": len(success_lines)
    }

def ncrack_parser(raw_output: str, params: dict) -> dict:
    """解析 ncrack 输出，提取成功登录"""
    success_lines = []
    for line in raw_output.splitlines():
        if "correct" in line.lower() or "password" in line.lower() and ":" in line:
            success_lines.append(line.strip())
    return {
        "success_attempts": success_lines,
        "count": len(success_lines)
    }

def dnsrecon_parser(raw_output: str, params: dict) -> dict:
    """解析 dnsrecon 输出，提取域名记录"""
    records = []
    for line in raw_output.splitlines():
        line = line.strip()
        if line and not line.startswith("["):
            # 尝试识别常见的 DNS 记录格式
            if "A " in line or "CNAME" in line or "NS " in line:
                records.append(line)
    return {
        "dns_records": records,
        "count": len(records),
        "summary": {
            "total_records": len(records)
        }
    }

def fierce_parser(raw_output: str, params: dict) -> dict:
    """解析 fierce 输出，提取域名"""
    domains = []
    for line in raw_output.splitlines():
        line = line.strip()
        if line and "." in line and not line.startswith("#"):
            # 过滤出域名
            if "Zone Transfer" not in line and "Scanning" not in line:
                domains.append(line)
    return {
        "domains": domains,
        "count": len(domains)
    }

def bettercap_parser(raw_output: str, params: dict) -> dict:
    """解析 bettercap 输出，提取流量摘要"""
    # bettercap 输出主要是实时日志，提取关键信息
    connections = []
    for line in raw_output.splitlines():
        if "http" in line.lower() and ("request" in line.lower() or "response" in line.lower()):
            # 提取HTTP请求/响应行
            connections.append(line.strip())
        elif "dns" in line.lower():
            connections.append(line.strip())
    return {
        "summary": f"捕获到 {len(connections)} 条连接记录",
        "connections": connections[:50],  # 只返回前50条
        "count": len(connections)
    }

def wafw00f_parser(raw_output: str, params: dict) -> dict:
    """解析 wafw00f 输出"""
    waf_detected = None
    wafs = []
    for line in raw_output.splitlines():
        if "WAF" in line and "detected" in line:
            waf_detected = line.strip()
            # 尝试提取具体WAF名称
            import re
            match = re.search(r'has ([\w\s]+) WAF', line)
            if match:
                wafs.append(match.group(1).strip())
        elif "is behind" in line:
            waf_detected = line.strip()
    return {
        "waf_detected": waf_detected,
        "waf_list": wafs if wafs else ["未知"],
        "raw_output": raw_output[:500]
    }

def cve_bin_tool_parser(raw_output: str, params: dict) -> dict:
    """解析 cve-bin-tool JSON 输出"""
    try:
        data = json.loads(raw_output)
        vulnerabilities = []
        for item in data.get("results", []):
            vulnerabilities.append({
                "cve_id": item.get("cve_id"),
                "severity": item.get("severity"),
                "package": item.get("package"),
                "version": item.get("version"),
                "description": item.get("description", "")[:100]
            })
        return {
            "vulnerabilities": vulnerabilities,
            "count": len(vulnerabilities),
            "summary": data.get("summary", {})
        }
    except json.JSONDecodeError:
        # 回退到文本解析
        vulns = []
        for line in raw_output.splitlines():
            if "CVE-" in line:
                vulns.append(line.strip())
        return {"vulnerabilities": vulns, "count": len(vulns)}

def clamav_parser(raw_output: str, params: dict) -> dict:
    """解析 clamscan JSON 输出"""
    try:
        data = json.loads(raw_output)
        return {
            "infected_files": data.get("infected_files", 0),
            "scanned_files": data.get("scanned_files", 0),
            "virus": data.get("virus", {}),
            "summary": f"扫描 {data.get('scanned_files', 0)} 个文件，发现 {data.get('infected_files', 0)} 个感染"
        }
    except json.JSONDecodeError:
        infected = []
        for line in raw_output.splitlines():
            if "FOUND" in line:
                infected.append(line.strip())
        return {
            "infected_files": len(infected),
            "infected_details": infected,
            "summary": f"发现 {len(infected)} 个感染文件"
        }

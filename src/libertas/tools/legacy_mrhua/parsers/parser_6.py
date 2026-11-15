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


def docker_bench_parser(raw_output: str, params: dict) -> dict:
    """解析 Docker Bench 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        checks = data.get("checks", [])
        return {
            "total_checks": len(checks),
            "pass": len([c for c in checks if c.get("status") == "PASS"]),
            "fail": len([c for c in checks if c.get("status") == "FAIL"]),
            "warn": len([c for c in checks if c.get("status") == "WARN"]),
            "summary": f"通过: {len([c for c in checks if c.get('status') == 'PASS'])}"
        }
    except Exception as e:
        lines = raw_output.splitlines()
        return {"lines": lines[:30],
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def find_rshell_parser(raw_output: str, params: dict) -> dict:
    """解析 find 命令输出"""
    files = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "detected_files": files[:50],
        "count": len(files),
        "summary": f"发现 {len(files)} 个可疑文件"
    }

def vuln_update_parser(raw_output: str, params: dict) -> dict:
    """解析漏洞模板更新输出"""
    return {
        "status": "completed" if "Updated" in raw_output else "failed",
        "summary": raw_output[:200]
    }

def nmap_parser(raw_output: str, params: dict) -> dict:
    """解析nmap grepable输出 (-oG -)"""
    open_ports = []
    for line in raw_output.splitlines():
        if "Ports:" in line:
            ports_part = line.split("Ports:")[1].split("\t")[0]
            for item in ports_part.split(","):
                parts = item.strip().split("/")
                if len(parts) >= 5 and parts[1] == "open":
                    open_ports.append({
                        "port": int(parts[0]),
                        "protocol": parts[2],
                        "state": parts[1],
                        "service": parts[4] if len(parts) > 4 else "unknown",
                    })
    return {
        "open_ports": open_ports,
        "port_count": len(open_ports),
        "summary": f"发现 {len(open_ports)} 个开放端口"
    }

def nuclei_parser(raw_output: str, params: dict) -> dict:
    """解析nuclei JSONL输出"""
    findings = []
    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            info = obj.get("info", {})
            findings.append({
                "name": info.get("name", obj.get("template-id", "")),
                "severity": info.get("severity", "info"),
                "type": obj.get("type", ""),
                "matched": obj.get("matched-at", obj.get("host", "")),
                "description": info.get("description", ""),
                "tags": info.get("tags", ""),
                "reference": info.get("reference", []),
            })
        except (json.JSONDecodeError, ValueError):
            continue
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda x: severity_order.get(x["severity"].lower(), 5))
    counts = {}
    for f in findings:
        s = f["severity"].lower()
        counts[s] = counts.get(s, 0) + 1
    return {
        "findings": findings,
        "vulnerabilities": findings,
        "counts": counts,
        "total": len(findings),
        "summary": f"发现 {len(findings)} 个问题 ({', '.join(f'{k}:{v}' for k,v in counts.items())})"
    }

def xray_parser(raw_output: str, params: dict) -> dict:
    """解析xray JSON输出"""
    findings = []
    try:
        data = json.loads(raw_output)
        if isinstance(data, list):
            for item in data:
                detail = item.get("detail", {})
                findings.append({
                    "name": item.get("plugin", ""),
                    "severity": "high" if "高危" in item.get("plugin", "") else "medium",
                    "type": detail.get("type", ""),
                    "matched": detail.get("host", ""),
                    "payload": detail.get("payload", ""),
                    "description": item.get("plugin", ""),
                })
    except (json.JSONDecodeError, ValueError):
        for line in raw_output.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    obj = json.loads(line)
                    findings.append({
                        "name": obj.get("plugin", ""),
                        "severity": "medium",
                        "matched": obj.get("target", {}).get("url", ""),
                    })
                except (json.JSONDecodeError, ValueError):
                    continue
    return {
        "findings": findings,
        "vulnerabilities": findings,
        "total": len(findings),
        "summary": f"xray发现 {len(findings)} 个问题"
    }

def shodan_parser(raw_output: str, params: dict) -> dict:
    """解析shodan输出"""
    entries = []
    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t") if "\t" in line else line.split()
        if parts:
            entry = {"raw": line}
            if len(parts) >= 1:
                entry["ip"] = parts[0]
            if len(parts) >= 2:
                try:
                    entry["port"] = int(parts[1])
                except ValueError:
                    entry["port"] = parts[1]
            entries.append(entry)
    return {
        "entries": entries,
        "total": len(entries),
        "summary": f"Shodan返回 {len(entries)} 条结果"
    }

def mitmproxy_parser(raw_output: str, params: dict) -> dict:
    """解析mitmproxy/mitmdump输出"""
    flows = []
    for line in raw_output.splitlines():
        line = line.strip()
        m = re.match(r"(\d+\.\d+\.\d+\.\d+:\d+)\s+->\s+(\S+)\s+(\d+)", line)
        if m:
            flows.append({"src": m.group(1), "dst": m.group(2), "port": m.group(3)})
        elif re.search(r"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+", line):
            flows.append({"request": line[:200]})
    return {
        "flows": flows,
        "total": len(flows),
        "summary": f"捕获 {len(flows)} 个流量事件"
    }

def pwn_parser(raw_output: str, params: dict) -> dict:
    """解析pwntools输出"""
    lines = [l for l in raw_output.splitlines() if l.strip()]
    flags = re.findall(r"flag\{[^}]+\}", raw_output, re.IGNORECASE)
    addresses = re.findall(r"0x[0-9a-fA-F]+", raw_output)
    return {
        "lines": lines[:50],
        "flags": flags,
        "addresses": list(set(addresses))[:20],
        "summary": f"找到 {len(flags)} 个flag, {len(set(addresses))} 个地址" if flags else f"输出 {len(lines)} 行"
    }

def ropgadget_parser(raw_output: str, params: dict) -> dict:
    """解析ROPgadget输出"""
    gadgets = []
    for line in raw_output.splitlines():
        line = line.strip()
        if line.startswith("0x") and ":" in line:
            parts = line.split(":", 1)
            gadgets.append({
                "address": parts[0].strip(),
                "gadget": parts[1].strip() if len(parts) > 1 else ""
            })
    return {
        "gadgets": gadgets,
        "total": len(gadgets),
        "summary": f"找到 {len(gadgets)} 个ROP gadget"
    }

def scapy_parser(raw_output: str, params: dict) -> dict:
    """解析scapy输出"""
    packets = []
    for line in raw_output.splitlines():
        line = line.strip()
        if line:
            packets.append(line[:300])
    return {
        "packets": packets[:100],
        "total": len(packets),
        "summary": f"Scapy处理 {len(packets)} 个数据包"
    }

def ldapdomaindump_parser(raw_output: str, params: dict) -> dict:
    """解析ldapdomaindump输出"""
    users = []
    computers = []
    groups = []
    for line in raw_output.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if "user" in line.lower() or "cn=" in line.lower():
            users.append(line[:200])
        elif "computer" in line.lower():
            computers.append(line[:200])
        elif "group" in line.lower():
            groups.append(line[:200])
    return {
        "users": users[:50],
        "computers": computers[:50],
        "groups": groups[:50],
        "summary": f"用户:{len(users)} 计算机:{len(computers)} 组:{len(groups)}"
    }

def secretsdump_parser(raw_output: str, params: dict) -> dict:
    """解析impacket-secretsdump输出"""
    hashes = []
    for line in raw_output.splitlines():
        line = line.strip()
        if ":" in line and not line.startswith("#") and not line.startswith("Impacket"):
            parts = line.split(":")
            if len(parts) >= 4:
                hashes.append({
                    "username": parts[0],
                    "rid": parts[1],
                    "lmhash": parts[2],
                    "nthash": parts[3],
                    "raw": line[:200]
                })
    return {
        "hashes": hashes,
        "total": len(hashes),
        "summary": f"导出 {len(hashes)} 个凭证哈希"
    }

def native_dns_parser(raw_output: str, params: dict) -> dict:
    """解析原生 dns_lookup 工具输出"""
    records = {"a": [], "mx": [], "ns": [], "cname": [], "txt": [], "other": []}
    current_type = None
    for line in raw_output.splitlines():
        line = line.strip()
        if not line:
            continue
        type_match = re.match(r'^(A|AAAA|MX|NS|CNAME|TXT|PTR|SOA)\s+记录', line, re.IGNORECASE)
        if type_match:
            current_type = type_match.group(1).lower()
            continue
        if current_type and re.match(r'^[\w\.\-]+', line):
            t = current_type if current_type in records else "other"
            records[t].append(line.split()[0] if " " in line else line)
    if not any(records.values()):
        for line in raw_output.splitlines():
            line = line.strip()
            ip_match = re.findall(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', line)
            if ip_match:
                records["a"].extend(ip_match)
    return {
        "target": params.get("target", ""),
        "records": records,
        "summary": f"A:{len(records['a'])} MX:{len(records['mx'])} NS:{len(records['ns'])}",
    }

def native_http_fingerprint_parser(raw_output: str, params: dict) -> dict:
    """解析原生 http_fingerprint 工具输出"""
    tech = []
    status = 0
    title = ""
    server = ""
    for line in raw_output.splitlines():
        line = line.strip()
        if line.startswith("HTTP状态") or "状态码" in line:
            m = re.search(r'(\d{3})', line)
            if m:
                status = int(m.group(1))
        elif "标题" in line or "Title" in line:
            title = line.split(":", 1)[-1].strip() if ":" in line else line
        elif line.lower().startswith("server:") or "服务器" in line:
            server = line.split(":", 1)[-1].strip() if ":" in line else ""
        elif "技术栈" in line or "tech" in line.lower():
            parts = re.split(r'[,，、\s]+', line.split(":", 1)[-1] if ":" in line else line)
            tech = [p.strip() for p in parts if p.strip() and p.strip() not in ("技术栈", "tech", "")]
    if not tech:
        for line in raw_output.splitlines():
            for known in ("nginx", "apache", "iis", "php", "python", "node", "react",
                          "vue", "angular", "jquery", "bootstrap", "wordpress", "joomla",
                          "drupal", "express", "django", "flask", "spring", "tomcat",
                          "openresty", "cloudflare", "aspnet", "laravel"):
                if known in line.lower():
                    tech.append(known)
    return {
        "target": params.get("target", ""),
        "status": status,
        "title": title,
        "server": server,
        "technologies": list(set(tech)),
        "summary": f"{status} {title} [{', '.join(list(set(tech))[:5])}]",
    }

def native_ssl_parser(raw_output: str, params: dict) -> dict:
    """解析原生 ssl_info 工具输出"""
    info = {"issuer": "", "subject": "", "san": [], "not_before": "", "not_after": "", "protocol": ""}
    for line in raw_output.splitlines():
        line = line.strip()
        if "issuer" in line.lower() or "颁发者" in line:
            info["issuer"] = line.split(":", 1)[-1].strip() if ":" in line else line
        elif "subject" in line.lower() or "主题" in line:
            info["subject"] = line.split(":", 1)[-1].strip() if ":" in line else line
        elif "notBefore" in line or "生效" in line:
            info["not_before"] = line.split(":", 1)[-1].strip() if ":" in line else line
        elif "notAfter" in line or "到期" in line or "过期" in line:
            info["not_after"] = line.split(":", 1)[-1].strip() if ":" in line else line
        elif "SAN" in line or "备用名" in line:
            sans = re.findall(r'[\w\.\-]+\.[a-zA-Z]{2,}', line)
            info["san"] = sans
        elif "TLS" in line or "SSL" in line:
            m = re.search(r'(TLSv?\d\.\d|SSLv?\d)', line)
            if m:
                info["protocol"] = m.group(1)
    return {
        "target": params.get("target", ""),
        **info,
        "summary": f"{info['subject'] or '未知'} 到期:{info['not_after'] or '未知'}",
    }

def native_port_scan_parser(raw_output: str, params: dict) -> dict:
    """解析原生 port_scan 工具输出"""
    ports = []
    for line in raw_output.splitlines():
        line = line.strip()
        m = re.match(r'(\d+)/(tcp|udp)\s+(\w+)\s*(.*)', line)
        if m:
            ports.append({
                "port": int(m.group(1)),
                "protocol": m.group(2),
                "state": m.group(3),
                "service": m.group(4).strip(),
            })
        else:
            m2 = re.search(r'\b(\d{1,5})\b.*?(open|closed|filtered)', line, re.IGNORECASE)
            if m2:
                ports.append({
                    "port": int(m2.group(1)),
                    "protocol": "tcp",
                    "state": m2.group(2).lower(),
                    "service": "",
                })
    return {
        "target": params.get("target", ""),
        "ports": ports,
        "open_count": sum(1 for p in ports if p["state"] == "open"),
        "summary": f"{sum(1 for p in ports if p['state'] == 'open')} 个开放端口",
    }

def native_whois_parser(raw_output: str, params: dict) -> dict:
    """解析原生 whois 工具输出"""
    from .parser_3 import whois_parser as _whois_parser
    return _whois_parser(raw_output, params)

def nmap_text_parser(raw_output: str, params: dict) -> dict:
    """解析 nmap 文本输出（非XML）"""
    ports = []
    host = params.get("target", "")
    for line in raw_output.splitlines():
        line = line.strip()
        m = re.match(r'(\d+)/(tcp|udp)\s+(\w+)\s+(\S+)\s*(.*)', line)
        if m:
            ports.append({
                "port": int(m.group(1)),
                "protocol": m.group(2),
                "state": m.group(3),
                "service": m.group(4),
                "version": m.group(5).strip(),
            })
        host_m = re.search(r'Nmap scan report for (\S+)', line)
        if host_m:
            host = host_m.group(1)
    return {
        "host": host,
        "ports": ports,
        "open_count": sum(1 for p in ports if p["state"] == "open"),
        "summary": f"{host}: {sum(1 for p in ports if p['state'] == 'open')} 个开放端口",
    }

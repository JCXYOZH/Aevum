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


def subzy_parser(raw_output: str, params: dict) -> dict:
    """解析 subzy JSON 输出"""
    try:
        data = json.loads(raw_output)
        vulnerable = []
        for item in data.get("results", []):
            if item.get("vulnerable"):
                vulnerable.append({
                    "domain": item.get("domain"),
                    "service": item.get("service"),
                    "status": "VULNERABLE"
                })
        return {
            "vulnerable_domains": vulnerable,
            "count": len(vulnerable),
            "summary": f"发现 {len(vulnerable)} 个可接管子域名"
        }
    except json.JSONDecodeError:
        vulnerable = []
        for line in raw_output.splitlines():
            if "VULNERABLE" in line:
                vulnerable.append(line.strip())
        return {"vulnerable_domains": vulnerable, "count": len(vulnerable)}

def subjack_parser(raw_output: str, params: dict) -> dict:
    """解析 subjack 输出"""
    vulnerable = []
    for line in raw_output.splitlines():
        if "VULNERABLE" in line:
            vulnerable.append(line.strip())
        elif "NOT VULNERABLE" not in line and ".com" in line:
            vulnerable.append(line.strip())
    return {
        "vulnerable_domains": vulnerable[:30],
        "count": len(vulnerable),
        "summary": f"发现 {len(vulnerable)} 个潜在可接管子域名"
    }

def cloudfox_parser(raw_output: str, params: dict) -> dict:
    """解析 cloudfox 输出"""
    findings = []
    for line in raw_output.splitlines():
        if line.strip():
            findings.append(line.strip())
    return {
        "findings": findings[:50],
        "count": len(findings),
        "summary": f"发现 {len(findings)} 条云资源信息"
    }

def prowler_parser(raw_output: str, params: dict) -> dict:
    """解析 prowler 输出"""
    try:
        data = json.loads(raw_output)
        findings = []
        for item in data.get("findings", []):
            findings.append({
                "id": item.get("id"),
                "severity": item.get("severity"),
                "description": item.get("description", "")[:100]
            })
        return {
            "findings": findings,
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个 AWS 安全发现"
        }
    except json.JSONDecodeError:
        findings = []
        for line in raw_output.splitlines():
            if "FAIL" in line:
                findings.append(line.strip())
        return {"findings": findings, "count": len(findings)}

def trivy_k8s_parser(raw_output: str, params: dict) -> dict:
    """解析 trivy k8s 输出"""
    try:
        data = json.loads(raw_output)
        vulnerabilities = []
        for result in data.get("Results", []):
            for vuln in result.get("Vulnerabilities", []):
                vulnerabilities.append({
                    "id": vuln.get("VulnerabilityID"),
                    "severity": vuln.get("Severity"),
                    "title": vuln.get("Title"),
                    "resource": vuln.get("Resource")
                })
        return {
            "vulnerabilities": vulnerabilities,
            "count": len(vulnerabilities),
            "summary": f"发现 {len(vulnerabilities)} 个 K8s 漏洞"
        }
    except json.JSONDecodeError:
        vulnerabilities = []
        for line in raw_output.splitlines():
            if "CVE-" in line:
                vulnerabilities.append(line.strip())
        return {"vulnerabilities": vulnerabilities, "count": len(vulnerabilities)}

def kube_score_parser(raw_output: str, params: dict) -> dict:
    """解析 kube-score 输出"""
    try:
        data = json.loads(raw_output)
        issues = []
        for item in data:
            issues.append({
                "id": item.get("id"),
                "severity": item.get("severity"),
                "description": item.get("description", "")[:100]
            })
        return {
            "issues": issues,
            "count": len(issues),
            "summary": f"发现 {len(issues)} 个 K8s 配置问题"
        }
    except json.JSONDecodeError:
        issues = []
        for line in raw_output.splitlines():
            if "FAIL" in line:
                issues.append(line.strip())
        return {"issues": issues, "count": len(issues)}

def katana_parser(raw_output: str, params: dict) -> dict:
    """解析 katana JSON 输出"""
    urls = []
    try:
        for line in raw_output.strip().splitlines():
            if line:
                try:
                    data = json.loads(line)
                    if data.get("url"):
                        urls.append({
                            "url": data.get("url"),
                            "method": data.get("method", "GET"),
                            "status": data.get("status")
                        })
                except:
                    urls.append(line.strip())
    except:
        urls = raw_output.strip().splitlines()
    return {
        "urls": urls[:100],
        "count": len(urls),
        "summary": f"爬取到 {len(urls)} 个 URL"
    }

def hakrawler_parser(raw_output: str, params: dict) -> dict:
    """解析 hakrawler 输出"""
    urls = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "urls": urls[:100],
        "count": len(urls),
        "summary": f"爬取到 {len(urls)} 个 URL"
    }

def dalfox_parser(raw_output: str, params: dict) -> dict:
    """解析 dalfox 输出"""
    findings = []
    for line in raw_output.splitlines():
        if "XSS" in line or "found" in line or "payload" in line:
            findings.append(line.strip())
    return {
        "findings": findings[:30],
        "count": len(findings),
        "summary": f"发现 {len(findings)} 个 XSS 可能点"
    }

def nuclei_js_parser(raw_output: str, params: dict) -> dict:
    """解析 nuclei JavaScript 扫描输出"""
    try:
        findings = []
        for line in raw_output.strip().splitlines():
            if line:
                try:
                    data = json.loads(line)
                    if data.get("matched-at"):
                        findings.append({
                            "url": data.get("matched-at"),
                            "template": data.get("template-id"),
                            "severity": data.get("info", {}).get("severity")
                        })
                except:
                    pass
        return {
            "findings": findings[:50],
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个匹配"
        }
    except:
        return {"findings": raw_output.splitlines()[:50], "count": 50}

def chaos_parser(raw_output: str, params: dict) -> dict:
    """解析 chaos 输出"""
    domains = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "domains": domains[:100],
        "count": len(domains),
        "summary": f"发现 {len(domains)} 个子域名"
    }

def ping_parser(raw_output: str, params: dict) -> dict:
    """解析 ping 输出"""
    packets_sent = 0
    packets_received = 0
    loss = 0
    rtt_min = rtt_avg = rtt_max = 0
    
    for line in raw_output.splitlines():
        if "packets transmitted" in line:
            # 提取丢包率
            import re
            match = re.search(r'(\d+) packets transmitted, (\d+) received', line)
            if match:
                packets_sent = int(match.group(1))
                packets_received = int(match.group(2))
                loss = ((packets_sent - packets_received) / packets_sent * 100) if packets_sent > 0 else 0
        if "rtt min/avg/max" in line or "round-trip" in line:
            match = re.search(r'(\d+\.?\d*)/(\d+\.?\d*)/(\d+\.?\d*)', line)
            if match:
                rtt_min = float(match.group(1))
                rtt_avg = float(match.group(2))
                rtt_max = float(match.group(3))
    
    return {
        "host": params.get("target", "unknown"),
        "packets_sent": packets_sent,
        "packets_received": packets_received,
        "loss_percent": round(loss, 2),
        "rtt_min_ms": rtt_min,
        "rtt_avg_ms": rtt_avg,
        "rtt_max_ms": rtt_max,
        "reachable": packets_received > 0,
        "summary": f"丢包率: {round(loss, 2)}%, RTT: {rtt_avg}ms"
    }

def traceroute_parser(raw_output: str, params: dict) -> dict:
    """解析 traceroute 输出"""
    hops = []
    for line in raw_output.splitlines():
        parts = line.strip().split()
        if parts and parts[0].isdigit():
            hop_num = int(parts[0])
            hop_ip = parts[1] if len(parts) > 1 else "*"
            hop_time = parts[2] if len(parts) > 2 else "*"
            hops.append({
                "hop": hop_num,
                "ip": hop_ip,
                "time": hop_time
            })
    return {
        "target": params.get("target", "unknown"),
        "hops": hops,
        "total_hops": len(hops),
        "summary": f"经过 {len(hops)} 跳"
    }

def mtr_parser(raw_output: str, params: dict) -> dict:
    """解析 mtr JSON 输出"""
    try:
        data = json.loads(raw_output)
        hops = []
        for hop in data.get("report", {}).get("hops", []):
            hops.append({
                "hop": hop.get("hop"),
                "ip": hop.get("host"),
                "loss_percent": hop.get("lossPercent", 0),
                "avg_ms": hop.get("avg", 0),
                "last_ms": hop.get("last", 0)
            })
        return {
            "target": data.get("report", {}).get("host"),
            "hops": hops,
            "total_hops": len(hops),
            "summary": f"经过 {len(hops)} 跳"
        }
    except:
        return {"raw": raw_output[:500], "summary": "解析失败，返回原始输出"}

def dig_parser(raw_output: str, params: dict) -> dict:
    """解析 dig 输出"""
    records = []
    answer_section = False
    for line in raw_output.splitlines():
        if ";; ANSWER SECTION:" in line:
            answer_section = True
            continue
        if answer_section and line.startswith(";;"):
            answer_section = False
            continue
        if answer_section and line.strip():
            parts = line.strip().split()
            if len(parts) >= 5:
                records.append({
                    "name": parts[0],
                    "ttl": parts[1],
                    "class": parts[2],
                    "type": parts[3],
                    "value": " ".join(parts[4:])
                })
    return {
        "target": params.get("target", "unknown"),
        "record_type": params.get("record_type", "ANY"),
        "records": records,
        "count": len(records),
        "summary": f"找到 {len(records)} 条 DNS 记录"
    }

def nslookup_parser(raw_output: str, params: dict) -> dict:
    """解析 nslookup 输出"""
    records = []
    for line in raw_output.splitlines():
        if "Address" in line and ":" in line:
            records.append(line.strip())
        elif "Name:" in line:
            records.append(line.strip())
    return {
        "target": params.get("target", "unknown"),
        "records": records[:20],
        "count": len(records),
        "summary": f"找到 {len(records)} 条 DNS 信息"
    }

def whois_parser(raw_output: str, params: dict) -> dict:
    """解析 whois 输出"""
    info = {}
    for line in raw_output.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            info[key.strip()] = value.strip()
    return {
        "target": params.get("target", "unknown"),
        "registrar": info.get("Registrar", info.get("Sponsoring Registrar", "unknown")),
        "creation_date": info.get("Creation Date", info.get("Registry Registration Date", "unknown")),
        "expiry_date": info.get("Registry Expiry Date", info.get("Expiration Date", "unknown")),
        "name_servers": [v for k, v in info.items() if "Name Server" in k],
        "summary": f"注册商: {info.get('Registrar', 'unknown')}"
    }

def openssl_parser(raw_output: str, params: dict) -> dict:
    """解析 openssl s_client 输出"""
    certificate_info = {}
    for line in raw_output.splitlines():
        if "subject=" in line:
            certificate_info["subject"] = line.strip()
        elif "issuer=" in line:
            certificate_info["issuer"] = line.strip()
        elif "notBefore" in line:
            certificate_info["not_before"] = line.strip()
        elif "notAfter" in line:
            certificate_info["not_after"] = line.strip()
        elif "Verify return code" in line:
            certificate_info["verify_code"] = line.strip()
    
    return {
        "target": params.get("target", "unknown"),
        "port": params.get("port", "443"),
        "certificate": certificate_info,
        "summary": f"证书信息: {certificate_info.get('subject', 'unknown')}"
    }

def testssl_parser(raw_output: str, params: dict) -> dict:
    """解析 testssl 输出"""
    try:
        # 按字节读取再级联解码（避免默认编码 cp936 解 UTF-8 失败后静默变 0 条）
        data = json.loads(read_text_auto(params.get("output_file", "")))
        findings = []
        for scan_result in data.get("scanResult", []):
            for finding in scan_result.get("findings", []):
                findings.append({
                    "id": finding.get("id"),
                    "severity": finding.get("severity"),
                    "finding": finding.get("finding"),
                    "cve": finding.get("cve")
                })
        return {
            "target": params.get("target", "unknown"),
            "findings": findings,
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个 SSL/TLS 问题"
        }
    except Exception as e:
        return {"raw": raw_output[:500], "summary": "解析失败，返回原始输出",
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def nc_parser(raw_output: str, params: dict) -> dict:
    """解析 nc 输出"""
    open_ports = []
    for line in raw_output.splitlines():
        if "succeeded" in line.lower() or "Connected" in line:
            open_ports.append(params.get("port", "unknown"))
    return {
        "target": params.get("target", "unknown"),
        "port": params.get("port", "unknown"),
        "open": len(open_ports) > 0,
        "summary": f"端口 {params.get('port', 'unknown')} {'开放' if open_ports else '关闭'}"
    }

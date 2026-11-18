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


def john_rules_parser(raw_output: str, params: dict) -> dict:
    """解析 john 规则破解输出"""
    results = []
    for line in raw_output.splitlines():
        if ":" in line:
            parts = line.strip().split(":", 1)
            if len(parts) == 2:
                results.append({
                    "username": parts[0],
                    "password": parts[1]
                })
    return {
        "cracked": results,
        "count": len(results),
        "summary": f"破解 {len(results)} 个密码"
    }

def yara_parser(raw_output: str, params: dict) -> dict:
    """解析 yara 输出"""
    matches = []
    for line in raw_output.splitlines():
        if "found" in line or "matches" in line or "rule" in line:
            matches.append(line.strip())
    return {
        "matches": matches[:50],
        "count": len(matches),
        "summary": f"发现 {len(matches)} 个匹配"
    }

def zap_cli_parser(raw_output: str, params: dict) -> dict:
    """解析 zap-cli 输出"""
    alerts = []
    for line in raw_output.splitlines():
        if "Alert" in line or "Risk" in line or "URL" in line:
            alerts.append(line.strip())
    return {
        "alerts": alerts[:50],
        "count": len(alerts),
        "summary": f"发现 {len(alerts)} 个告警"
    }

def sslyze_parser(raw_output: str, params: dict) -> dict:
    """解析 sslyze JSON 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        findings = []
        for target in data:
            for result in target.get("results", []):
                if result.get("is_vulnerable"):
                    findings.append({
                        "name": result.get("name"),
                        "description": result.get("description", "")[:100]
                    })
        return {
            "findings": findings[:30],
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个 SSL/TLS 问题"
        }
    except Exception as e:
        issues = []
        for line in raw_output.splitlines():
            if "vulnerable" in line.lower() or "weak" in line.lower():
                issues.append(line.strip())
        return {"issues": issues[:30], "count": len(issues),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def enum4linux_parser(raw_output: str, params: dict) -> dict:
    """解析 enum4linux 输出"""
    shares = []
    users = []
    os_info = []
    for line in raw_output.splitlines():
        if "Sharename" in line or "Shares" in line:
            shares.append(line.strip())
        elif "User" in line and "Group" in line:
            users.append(line.strip())
        elif "OS:" in line:
            os_info.append(line.strip())
    return {
        "shares": shares[:20],
        "users": users[:20],
        "os_info": os_info,
        "summary": f"找到 {len(shares)} 个共享，{len(users)} 个用户"
    }

def smbmap_parser(raw_output: str, params: dict) -> dict:
    """解析 smbmap JSON 输出"""
    try:
        data = json.loads(raw_output)
        shares = []
        for item in data.get("shares", []):
            shares.append({
                "name": item.get("name"),
                "read": item.get("readable"),
                "write": item.get("writable")
            })
        return {
            "shares": shares[:30],
            "count": len(shares),
            "summary": f"发现 {len(shares)} 个共享"
        }
    except:
        shares = []
        for line in raw_output.splitlines():
            if "Share" in line or "readable" in line:
                shares.append(line.strip())
        return {"shares": shares[:30], "count": len(shares)}

def gitleaks_parser(raw_output: str, params: dict) -> dict:
    """解析 gitleaks JSON 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        findings = []
        for finding in data:
            findings.append({
                "rule": finding.get("rule"),
                "file": finding.get("file"),
                "line": finding.get("line"),
                "match": finding.get("match", "")[:50]
            })
        return {
            "findings": findings[:50],
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个密钥泄露"
        }
    except Exception as e:
        findings = []
        for line in raw_output.splitlines():
            if "leak" in line.lower() or "secret" in line.lower():
                findings.append(line.strip())
        return {"findings": findings[:30], "count": len(findings),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def trufflehog_parser(raw_output: str, params: dict) -> dict:
    """解析 trufflehog JSON 输出"""
    try:
        data = json.loads(raw_output)
        findings = []
        for item in data:
            findings.append({
                "source": item.get("Source"),
                "commit": item.get("Commit"),
                "match": item.get("Match", "")[:50]
            })
        return {
            "findings": findings[:50],
            "count": len(findings),
            "summary": f"发现 {len(findings)} 个密钥泄露"
        }
    except:
        findings = []
        for line in raw_output.splitlines():
            if "found" in line.lower():
                findings.append(line.strip())
        return {"findings": findings[:30], "count": len(findings)}

def jwt_tool_parser(raw_output: str, params: dict) -> dict:
    """解析 jwt_tool 输出"""
    results = []
    for line in raw_output.splitlines():
        if "Vulnerable" in line or "weak" in line:
            results.append(line.strip())
    return {
        "findings": results[:30],
        "count": len(results),
        "summary": f"发现 {len(results)} 个 JWT 问题"
    }

def dnsx_parser(raw_output: str, params: dict) -> dict:
    """解析 dnsx JSON 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        results = []
        for item in data:
            results.append({
                "domain": item.get("host"),
                "a": item.get("a", [])[:5],
                "aaaa": item.get("aaaa", [])[:5],
                "cname": item.get("cname", [""])[0] if item.get("cname") else ""
            })
        return {
            "results": results[:50],
            "count": len(results),
            "summary": f"查询到 {len(results)} 个域名记录"
        }
    except Exception as e:
        lines = raw_output.splitlines()
        return {"lines": lines[:50], "count": len(lines),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def shuffledns_parser(raw_output: str, params: dict) -> dict:
    """解析 shuffledns 输出"""
    domains = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "domains": domains[:100],
        "count": len(domains),
        "summary": f"发现 {len(domains)} 个子域名"
    }

def massdns_parser(raw_output: str, params: dict) -> dict:
    """解析 massdns JSON 输出"""
    try:
        data = json.loads(raw_output)
        records = []
        for item in data:
            records.append({
                "domain": item.get("name"),
                "type": item.get("type"),
                "value": item.get("data") if item.get("data") else ""
            })
        return {
            "records": records[:100],
            "count": len(records),
            "summary": f"解析到 {len(records)} 条记录"
        }
    except:
        lines = raw_output.splitlines()
        return {"lines": lines[:50], "count": len(lines)}

def sublist3r_parser(raw_output: str, params: dict) -> dict:
    """解析 sublist3r 输出"""
    domains = []
    for line in raw_output.splitlines():
        if "." in line and not line.startswith("[-]"):
            domains.append(line.strip())
    return {
        "domains": domains[:100],
        "count": len(domains),
        "summary": f"发现 {len(domains)} 个子域名"
    }

def dnsenum_parser(raw_output: str, params: dict) -> dict:
    """解析 dnsenum 输出"""
    records = []
    for line in raw_output.splitlines():
        if "->" in line:
            records.append(line.strip())
    return {
        "records": records[:50],
        "count": len(records),
        "summary": f"找到 {len(records)} 条记录"
    }

def dnsmap_parser(raw_output: str, params: dict) -> dict:
    """解析 dnsmap 输出"""
    domains = []
    for line in raw_output.splitlines():
        if ":" in line and "IP" not in line:
            parts = line.split(":")
            if len(parts) == 2:
                domains.append({"domain": parts[0].strip(), "ip": parts[1].strip()})
    return {
        "results": domains[:100],
        "count": len(domains),
        "summary": f"找到 {len(domains)} 个域名-IP映射"
    }

def tcpdump_parser(raw_output: str, params: dict) -> dict:
    """解析 tcpdump 输出"""
    packets = []
    for line in raw_output.splitlines():
        if "IP" in line or "ARP" in line:
            packets.append(line.strip())
    return {
        "packets": packets[:100],
        "count": len(packets),
        "summary": f"捕获 {len(packets)} 个数据包"
    }

def ngrep_parser(raw_output: str, params: dict) -> dict:
    """解析 ngrep 输出"""
    matches = []
    for line in raw_output.splitlines():
        if "T" in line or "U" in line:
            matches.append(line.strip())
    return {
        "matches": matches[:50],
        "count": len(matches),
        "summary": f"发现 {len(matches)} 个匹配"
    }

def socat_parser(raw_output: str, params: dict) -> dict:
    """解析 socat 输出"""
    return {
        "output": raw_output[:500],
        "summary": "socat 连接输出"
    }

def joomscan_parser(raw_output: str, params: dict) -> dict:
    """解析 joomscan 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        vulnerabilities = data.get("vulnerabilities", [])
        return {
            "vulnerabilities": [{"id": v.get("id"), "title": v.get("title", "")[:50]} for v in vulnerabilities[:50]],
            "count": len(vulnerabilities),
            "summary": f"发现 {len(vulnerabilities)} 个 Joomla 漏洞"
        }
    except Exception as e:
        findings = []
        for line in raw_output.splitlines():
            if "Vulnerability" in line or "vuln" in line.lower():
                findings.append(line.strip())
        return {"findings": findings[:30], "count": len(findings),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def droopescan_parser(raw_output: str, params: dict) -> dict:
    """解析 droopescan 输出"""
    findings = []
    for line in raw_output.splitlines():
        if "Vulnerable" in line or "Drupal" in line:
            findings.append(line.strip())
    return {
        "findings": findings[:30],
        "count": len(findings),
        "summary": f"发现 {len(findings)} 个 Drupal 问题"
    }

def postman_parser(raw_output: str, params: dict) -> dict:
    """解析 Postman 输出"""
    try:
        data = json.loads(raw_output)
        stats = data.get("run", {}).get("stats", {})
        return {
            "total_requests": stats.get("totalRequests", 0),
            "failed_requests": stats.get("failedRequests", 0),
            "passed_requests": stats.get("passedRequests", 0),
            "summary": f"总请求: {stats.get('totalRequests', 0)}, 失败: {stats.get('failedRequests', 0)}"
        }
    except:
        return {"raw": raw_output[:500]}

def newman_parser(raw_output: str, params: dict) -> dict:
    """解析 Newman 输出"""
    try:
        data = json.loads(raw_output)
        stats = data.get("run", {}).get("stats", {})
        return {
            "total_requests": stats.get("totalRequests", 0),
            "failed_requests": stats.get("failedRequests", 0),
            "passed_requests": stats.get("passedRequests", 0),
            "summary": f"总请求: {stats.get('totalRequests', 0)}, 失败: {stats.get('failedRequests', 0)}"
        }
    except:
        return {"raw": raw_output[:500]}

def burp_parser(raw_output: str, params: dict) -> dict:
    """解析 Burp Suite 输出"""
    try:
        data = json.loads(raw_output)
        return {
            "scan_status": data.get("status", "unknown"),
            "findings": data.get("issues", [])[:50],
            "summary": f"扫描状态: {data.get('status', 'unknown')}"
        }
    except:
        return {"raw": raw_output[:500]}

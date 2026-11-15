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


def lynis_parser(raw_output: str, params: dict) -> dict:
    """解析 lynis 输出，提取安全警告"""
    warnings = []
    suggestions = []
    for line in raw_output.splitlines():
        if "WARNING" in line:
            warnings.append(line.strip())
        elif "SUGGESTION" in line:
            suggestions.append(line.strip())
    return {
        "warnings": warnings,
        "suggestions": suggestions[:20],
        "warning_count": len(warnings),
        "suggestion_count": len(suggestions),
        "summary": f"发现 {len(warnings)} 个警告，{len(suggestions)} 个建议"
    }

def kube_bench_parser(raw_output: str, params: dict) -> dict:
    """解析 kube-bench JSON 输出"""
    try:
        data = json.loads(raw_output)
        total_fail = 0
        total_pass = 0
        findings = []
        for control in data.get("Controls", []):
            for check in control.get("Checks", []):
                if check.get("Status") == "FAIL":
                    total_fail += 1
                    findings.append({
                        "id": check.get("Id"),
                        "description": check.get("Description", "")[:100],
                        "status": "FAIL"
                    })
                elif check.get("Status") == "PASS":
                    total_pass += 1
        return {
            "total_fail": total_fail,
            "total_pass": total_pass,
            "findings": findings[:30],
            "summary": f"通过 {total_pass} 项，失败 {total_fail} 项"
        }
    except json.JSONDecodeError:
        # 回退到文本解析
        fails = []
        for line in raw_output.splitlines():
            if "[FAIL]" in line:
                fails.append(line.strip())
        return {
            "total_fail": len(fails),
            "findings": fails[:30],
            "summary": f"失败 {len(fails)} 项"
        }

def wapiti3_parser(raw_output: str, params: dict) -> dict:
    """解析 wapiti3 JSON 输出"""
    # wapiti3 输出目录中会有多个JSON文件
    output_dir = params.get('output_dir', '/tmp/wapiti_output')
    import os
    vulnerabilities = []
    parse_error = None
    
    # 尝试读取 wapiti 生成的 JSON 报告文件
    report_file = os.path.join(output_dir, 'report.json')
    if os.path.exists(report_file):
        try:
            # 按字节读取再级联解码：不再用默认编码（Windows 中文环境=cp936）
            data = json.loads(read_text_auto(report_file))
            for vuln in data.get('vulnerabilities', []):
                vulnerabilities.append({
                    'name': vuln.get('name'),
                    'level': vuln.get('level'),
                    'url': vuln.get('url'),
                    'parameter': vuln.get('parameter'),
                    'description': vuln.get('description', '')[:100]
                })
        except Exception as e:
            # 不再静默吞掉：报告读取失败时如实回传原因（此前 bare except 表现为"0 条结果"）
            parse_error = f"解析失败：{describe_exception(e)[0]}"
    
    # 如果无法读取JSON，回退到解析raw_output
    if not vulnerabilities:
        for line in raw_output.splitlines():
            if 'vulnerable' in line.lower() or 'found' in line.lower():
                vulnerabilities.append(line.strip())
    
    return {
        'vulnerabilities': vulnerabilities,
        'count': len(vulnerabilities),
        'summary': f'发现 {len(vulnerabilities)} 个漏洞',
        **({'parse_error': parse_error} if parse_error else {})
    }

def kube_hunter_parser(raw_output: str, params: dict) -> dict:
    """解析 kube-hunter 输出"""
    try:
        data = json.loads(raw_output)
        vulnerabilities = []
        for vuln in data.get('vulnerabilities', []):
            vulnerabilities.append({
                'name': vuln.get('name'),
                'severity': vuln.get('severity'),
                'description': vuln.get('description', '')[:100],
                'location': vuln.get('location')
            })
        return {
            'vulnerabilities': vulnerabilities,
            'count': len(vulnerabilities),
            'summary': f'发现 {len(vulnerabilities)} 个K8s安全风险'
        }
    except json.JSONDecodeError:
        vulnerabilities = []
        for line in raw_output.splitlines():
            if 'vulnerability' in line.lower() or 'risk' in line.lower():
                vulnerabilities.append(line.strip())
        return {
            'vulnerabilities': vulnerabilities,
            'count': len(vulnerabilities)
        }

def impacket_parser(raw_output: str, params: dict) -> dict:
    """解析 impacket 工具输出"""
    results = []
    for line in raw_output.splitlines():
        line = line.strip()
        if line and not line.startswith('[') and not line.startswith('[*]'):
            if ':' in line or 'share' in line.lower() or 'user' in line.lower():
                results.append(line)
    return {
        'results': results[:50],
        'count': len(results),
        'summary': f'获取 {len(results)} 条信息'
    }

def ettercap_parser(raw_output: str, params: dict) -> dict:
    """解析 ettercap 输出"""
    connections = []
    for line in raw_output.splitlines():
        if 'http' in line.lower() or 'dns' in line.lower():
            connections.append(line.strip())
        elif 'TARGET' in line or 'HOST' in line:
            connections.append(line.strip())
    return {
        'connections': connections[:50],
        'count': len(connections),
        'summary': f'捕获 {len(connections)} 条连接'
    }

def tshark_parser(raw_output: str, params: dict) -> dict:
    """解析 tshark JSON 输出"""
    try:
        data = json.loads(raw_output)
        packets = []
        for pkt in data:
            packets.append({
                "src": pkt.get("ip.src", {}).get("value", ""),
                "dst": pkt.get("ip.dst", {}).get("value", ""),
                "port": pkt.get("tcp.port", {}).get("value") or pkt.get("udp.port", {}).get("value", "")
            })
        return {"packets": packets[:100], "count": len(packets)}
    except json.JSONDecodeError:
        packets = []
        for line in raw_output.splitlines():
            if " " in line:
                packets.append(line.strip())
        return {"packets": packets[:100], "count": len(packets)}

def zeek_parser(raw_output: str, params: dict) -> dict:
    """解析 Zeek 日志输出"""
    conn_logs = []
    for line in raw_output.splitlines():
        if "conn" in line and "originator" in line:
            conn_logs.append(line.strip())
    return {
        "connections": conn_logs[:50],
        "count": len(conn_logs),
        "summary": f"捕获 {len(conn_logs)} 条连接记录"
    }

def snort_parser(raw_output: str, params: dict) -> dict:
    """解析 Snort 告警输出"""
    alerts = []
    for line in raw_output.splitlines():
        if "[**]" in line or "Priority" in line:
            alerts.append(line.strip())
    return {
        "alerts": alerts[:50],
        "count": len(alerts),
        "summary": f"发现 {len(alerts)} 条告警"
    }

def simple_text_parser(raw_output: str, params: dict) -> dict:
    """通用文本解析器（兜底）"""
    lines = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "lines": lines[:50],
        "count": len(lines),
        "summary": f"共 {len(lines)} 行输出"
    }

def radare2_parser(raw_output: str, params: dict) -> dict:
    """解析 radare2 输出"""
    functions = []
    for line in raw_output.splitlines():
        if "sym." in line or "main" in line or "fcn." in line:
            functions.append(line.strip())
    return {
        "functions": functions[:30],
        "count": len(functions),
        "summary": f"发现 {len(functions)} 个函数"
    }

def rizin_parser(raw_output: str, params: dict) -> dict:
    """解析 rizin 输出"""
    functions = []
    for line in raw_output.splitlines():
        if "sym." in line or "main" in line or "fcn." in line:
            functions.append(line.strip())
    return {
        "functions": functions[:30],
        "count": len(functions),
        "summary": f"发现 {len(functions)} 个函数"
    }

def binwalk_parser(raw_output: str, params: dict) -> dict:
    """解析 binwalk 输出"""
    findings = []
    for line in raw_output.splitlines():
        if any(k in line for k in ["Zlib", "ELF", "Zip", "ZIP", "gzip", "JPEG", "PNG", "extracted"]):
            findings.append(line.strip())
    return {
        "findings": findings[:30],
        "count": len(findings),
        "summary": f"发现 {len(findings)} 个可提取文件/数据"
    }

def volatility3_parser(raw_output: str, params: dict) -> dict:
    """解析 volatility3 输出"""
    try:
        data = json.loads(raw_output)
        info = data.get("info", {})
        return {
            "os": info.get("OS"),
            "kernel": info.get("Kernel"),
            "processes": info.get("processes", [])[:30],
            "summary": f"系统: {info.get('OS', '未知')}"
        }
    except json.JSONDecodeError:
        lines = raw_output.strip().splitlines()
        return {
            "raw_lines": lines[:30],
            "summary": f"共 {len(lines)} 行输出"
        }

def sleuthkit_parser(raw_output: str, params: dict) -> dict:
    """解析 Sleuthkit fls 输出"""
    files = []
    for line in raw_output.splitlines():
        if line.strip():
            parts = line.split()
            if len(parts) >= 5:
                files.append({
                    "name": " ".join(parts[4:]),
                    "type": parts[2],
                    "inode": parts[0]
                })
    return {
        "files": files[:50],
        "count": len(files),
        "summary": f"发现 {len(files)} 个文件/目录"
    }

def aircrack_parser(raw_output: str, params: dict) -> dict:
    """解析 aircrack-ng 输出"""
    key_found = None
    for line in raw_output.splitlines():
        if "KEY FOUND" in line:
            key_found = line.strip()
        elif "Current plaintext" in line:
            key_found = line.strip()
    return {
        "key_found": key_found,
        "success": key_found is not None,
        "summary": f"破解状态: {'成功' if key_found else '失败'}"
    }

def reaver_parser(raw_output: str, params: dict) -> dict:
    """解析 reaver 输出"""
    progress = None
    pin = None
    for line in raw_output.splitlines():
        if "WPS PIN" in line and "found" in line:
            pin = line.strip()
        elif "progress" in line.lower():
            progress = line.strip()
    return {
        "pin_found": pin,
        "progress": progress,
        "success": pin is not None,
        "summary": f"进度: {progress or '未知'}"
    }

def metasploit_parser(raw_output: str, params: dict) -> dict:
    """解析 Metasploit 输出"""
    results = []
    sessions = []
    for line in raw_output.splitlines():
        if "[*]" in line:
            results.append(line.strip())
        elif "Meterpreter session" in line:
            sessions.append(line.strip())
        elif "Exploit completed" in line:
            results.append(line.strip())
    return {
        "results": results[:50],
        "sessions": sessions,
        "session_count": len(sessions),
        "summary": f"获取 {len(results)} 条结果，{len(sessions)} 个会话"
    }

def searchsploit_parser(raw_output: str, params: dict) -> dict:
    """解析 searchsploit JSON 输出"""
    try:
        data = json.loads(raw_output)
        exploits = []
        for item in data.get("RESULTS", []):
            exploits.append({
                "id": item.get("EDB-ID"),
                "title": item.get("Title"),
                "date": item.get("Date"),
                "author": item.get("Author"),
                "type": item.get("Type"),
                "platform": item.get("Platform")
            })
        return {
            "exploits": exploits,
            "count": len(exploits),
            "summary": f"找到 {len(exploits)} 个漏洞利用"
        }
    except json.JSONDecodeError:
        exploits = []
        for line in raw_output.splitlines():
            if "EDB-ID" in line or "Exploit" in line:
                exploits.append(line.strip())
        return {"exploits": exploits, "count": len(exploits)}

def exploitdb_parser(raw_output: str, params: dict) -> dict:
    """解析 exploitdb 输出"""
    exploits = []
    for line in raw_output.splitlines():
        if line.strip():
            exploits.append(line.strip())
    return {
        "exploits": exploits[:50],
        "count": len(exploits),
        "summary": f"找到 {len(exploits)} 条结果"
    }

def hashcat_parser(raw_output: str, params: dict) -> dict:
    """解析 hashcat 输出"""
    results = []
    for line in raw_output.splitlines():
        if ":" in line and len(line.split(":")) == 2:
            hash_val, password = line.strip().split(":", 1)
            results.append({
                "hash": hash_val[:16] + "...",
                "password": password
            })
    return {
        "cracked": results,
        "count": len(results),
        "summary": f"破解 {len(results)} 个密码"
    }

def john_parser(raw_output: str, params: dict) -> dict:
    """解析 john 输出"""
    results = []
    for line in raw_output.splitlines():
        if ":" in line:
            parts = line.strip().split(":", 1)
            if len(parts) == 2:
                results.append({
                    "username": parts[0] if len(parts[0]) < 20 else parts[0][:20] + "...",
                    "password": parts[1] if len(parts[1]) < 20 else parts[1][:20] + "..."
                })
    return {
        "cracked": results,
        "count": len(results),
        "summary": f"破解 {len(results)} 个密码"
    }

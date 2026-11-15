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


def telnet_parser(raw_output: str, params: dict) -> dict:
    """解析 telnet 输出"""
    open_ports = []
    for line in raw_output.splitlines():
        if "Connected" in line or "Escape character" in line:
            open_ports.append(params.get("port", "unknown"))
    return {
        "target": params.get("target", "unknown"),
        "port": params.get("port", "unknown"),
        "open": len(open_ports) > 0,
        "summary": f"端口 {params.get('port', 'unknown')} {'开放' if open_ports else '关闭'}"
    }

def ssh_audit_parser(raw_output: str, params: dict) -> dict:
    """解析 ssh-audit 输出"""
    try:
        # 按字节读取再级联解码（避免默认编码 cp936 解 UTF-8 失败后静默变 0 条）
        data = json.loads(read_text_auto(params.get("output_file", "")))
        issues = []
        for key, value in data.get("audit", {}).get("issues", {}).items():
            issues.append({
                "issue": key,
                "severity": value.get("severity"),
                "description": value.get("description", "")[:100]
            })
        return {
            "target": params.get("target", "unknown"),
            "issues": issues,
            "count": len(issues),
            "summary": f"发现 {len(issues)} 个 SSH 配置问题"
        }
    except Exception as e:
        issues = []
        for line in raw_output.splitlines():
            if "VULN" in line or "WARN" in line:
                issues.append(line.strip())
        return {"issues": issues, "count": len(issues),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def waybackurls_parser(raw_output: str, params: dict) -> dict:
    """解析 waybackurls 输出"""
    urls = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "urls": urls[:200],
        "count": len(urls),
        "summary": f"从 Wayback 找到 {len(urls)} 个 URL"
    }

def gau_parser(raw_output: str, params: dict) -> dict:
    """解析 gau 输出"""
    if params.get("output_file"):
        try:
            # 按字节读取再级联解码（不再用默认编码）
            urls = [line.strip() for line in read_lines_auto(params["output_file"]) if line.strip()]
        except Exception:
            urls = [line.strip() for line in raw_output.splitlines() if line.strip()]
    else:
        urls = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "urls": urls[:200],
        "count": len(urls),
        "summary": f"从多个源找到 {len(urls)} 个 URL"
    }

def assetfinder_parser(raw_output: str, params: dict) -> dict:
    """解析 assetfinder 输出"""
    domains = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "domains": domains[:100],
        "count": len(domains),
        "summary": f"发现 {len(domains)} 个子域名"
    }

def httpx_parser(raw_output: str, params: dict) -> dict:
    """解析 httpx JSON 输出"""
    results = []
    parse_error = None
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码：UTF-8 输出里混入个别非法字节时不再整段丢弃
            for line in read_lines_auto(params["output_file"]):
                if line.strip():
                    try:
                        data = json.loads(line)
                        results.append({
                            "url": data.get("url"),
                            "status_code": data.get("status_code"),
                            "content_length": data.get("content_length"),
                            "title": data.get("title", ""),
                            "tech": data.get("tech", [])
                        })
                    except Exception:
                        pass
        else:
            for line in raw_output.splitlines():
                if line.strip():
                    try:
                        data = json.loads(line)
                        results.append({
                            "url": data.get("url"),
                            "status_code": data.get("status_code"),
                            "content_length": data.get("content_length")
                        })
                    except:
                        pass
    except Exception as e:
        # 不再静默吞掉：读取/解析失败如实回传原因
        parse_error = f"解析失败：{describe_exception(e)[0]}"
    
    if not results:
        # 回退到文本解析
        for line in raw_output.splitlines():
            if " " in line:
                parts = line.split()
                results.append({
                    "url": parts[0] if parts else "",
                    "status_code": parts[1] if len(parts) > 1 else ""
                })
    
    return {
        "results": results[:100],
        "count": len(results),
        "summary": f"探测到 {len(results)} 个活跃服务",
        **({"parse_error": parse_error} if parse_error else {})
    }

def httprobe_parser(raw_output: str, params: dict) -> dict:
    """解析 httprobe 输出"""
    urls = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "urls": urls[:100],
        "count": len(urls),
        "summary": f"发现 {len(urls)} 个可访问的 URL"
    }

def dirsearch_parser(raw_output: str, params: dict) -> dict:
    """解析 dirsearch 输出"""
    results = []
    parse_error = None
    for line in raw_output.splitlines():
        if "STATUS" in line or "Status" in line:
            # 尝试提取状态码和路径
            parts = line.split()
            if len(parts) >= 4:
                results.append({
                    "path": parts[0] if parts else "",
                    "status": parts[1] if len(parts) > 1 else "",
                    "size": parts[2] if len(parts) > 2 else ""
                })
    
    # 如果解析失败，尝试从JSON报告读取
    if not results and params.get("output_file"):
        try:
            import json
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
            for item in data.get("results", []):
                results.append({
                    "path": item.get("path"),
                    "status": item.get("status"),
                    "size": item.get("size")
                })
        except Exception as e:
            # 不再静默吞掉：读取/解析失败如实回传原因
            parse_error = f"解析失败：{describe_exception(e)[0]}"
    
    return {
        "results": results[:100],
        "count": len(results),
        "summary": f"发现 {len(results)} 个目录/文件",
        **({"parse_error": parse_error} if parse_error else {})
    }

def feroxbuster_parser(raw_output: str, params: dict) -> dict:
    """解析 feroxbuster 输出"""
    results = []
    for line in raw_output.splitlines():
        if "Status" in line or "GET" in line:
            parts = line.split()
            if len(parts) >= 3:
                results.append({
                    "status": parts[0] if parts else "",
                    "size": parts[1] if len(parts) > 1 else "",
                    "path": " ".join(parts[2:]) if len(parts) > 2 else ""
                })
    return {
        "results": results[:100],
        "count": len(results),
        "summary": f"发现 {len(results)} 个目录/文件"
    }

def arjun_parser(raw_output: str, params: dict) -> dict:
    """解析 arjun 输出"""
    params_found = []
    for line in raw_output.splitlines():
        if "Found" in line and "parameter" in line:
            params_found.append(line.strip())
        elif "Total" in line and "parameters" in line:
            params_found.append(line.strip())
    return {
        "parameters": params_found[:50],
        "count": len(params_found),
        "summary": f"发现 {len(params_found)} 个参数"
    }

def wappalyzer_parser(raw_output: str, params: dict) -> dict:
    """解析 wappalyzer 输出"""
    techs = []
    for line in raw_output.splitlines():
        if "[" in line and "]" in line:
            # 尝试提取技术名称
            import re
            match = re.search(r'\[([^\]]+)\]', line)
            if match:
                techs.append(match.group(1))
        elif ":" in line and "using" in line:
            parts = line.split(":")
            if len(parts) >= 2:
                techs.append(parts[0].strip())
    return {
        "technologies": list(set(techs))[:30],
        "count": len(set(techs)),
        "summary": f"识别到 {len(set(techs))} 种技术"
    }

def bandit_parser(raw_output: str, params: dict) -> dict:
    """解析 bandit JSON 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        issues = []
        for result in data.get("results", []):
            issues.append({
                "severity": result.get("issue_severity"),
                "confidence": result.get("issue_confidence"),
                "cwe": result.get("issue_cwe", {}).get("id"),
                "description": result.get("issue_text", "")[:100],
                "filename": result.get("filename"),
                "line": result.get("line_num")
            })
        return {
            "issues": issues[:50],
            "count": len(issues),
            "summary": f"发现 {len(issues)} 个代码安全问题"
        }
    except Exception as e:
        issues = []
        for line in raw_output.splitlines():
            if "MEDIUM" in line or "HIGH" in line or "LOW" in line:
                issues.append(line.strip())
        return {"issues": issues[:30], "count": len(issues),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def semgrep_parser(raw_output: str, params: dict) -> dict:
    """解析 semgrep JSON 输出"""
    try:
        if params.get("output_file"):
            # 按字节读取再级联解码（不再按 Windows 区域编码 cp936 解 UTF-8）
            data = json.loads(read_text_auto(params["output_file"]))
        else:
            data = json.loads(raw_output)
        
        results = []
        for result in data.get("results", []):
            results.append({
                "severity": result.get("extra", {}).get("severity"),
                "rule": result.get("check_id"),
                "message": result.get("extra", {}).get("message", "")[:100],
                "path": result.get("path"),
                "line": result.get("start", {}).get("line")
            })
        return {
            "results": results[:50],
            "count": len(results),
            "summary": f"发现 {len(results)} 个代码问题"
        }
    except Exception as e:
        results = []
        for line in raw_output.splitlines():
            if "finding" in line.lower():
                results.append(line.strip())
        return {"results": results[:30], "count": len(results),
                "parse_error": f"解析失败：{describe_exception(e)[0]}"}

def goaccess_parser(raw_output: str, params: dict) -> dict:
    """解析 goaccess JSON 输出"""
    try:
        data = json.loads(raw_output)
        return {
            "total_requests": data.get("summary", {}).get("requests"),
            "unique_visitors": data.get("summary", {}).get("visitors"),
            "top_paths": data.get("paths", [])[:10],
            "top_ips": data.get("visitors", [])[:10],
            "summary": f"总请求: {data.get('summary', {}).get('requests', 0)}"
        }
    except:
        lines = raw_output.splitlines()
        return {"raw": lines[:50], "summary": f"共 {len(lines)} 行日志"}

def lnav_parser(raw_output: str, params: dict) -> dict:
    """解析 lnav 输出"""
    logs = [line.strip() for line in raw_output.splitlines() if line.strip()]
    return {
        "logs": logs[:100],
        "count": len(logs),
        "summary": f"获取 {len(logs)} 条日志记录"
    }

def cve_search_parser(raw_output: str, params: dict) -> dict:
    """解析 cve-search 输出"""
    try:
        data = json.loads(raw_output)
        cves = []
        for item in data:
            cves.append({
                "id": item.get("id"),
                "score": item.get("cvss3", {}).get("baseScore"),
                "summary": item.get("summary", "")[:100],
                "published": item.get("Published")
            })
        return {
            "cves": cves[:50],
            "count": len(cves),
            "summary": f"找到 {len(cves)} 个 CVE"
        }
    except:
        cves = []
        for line in raw_output.splitlines():
            if "CVE-" in line:
                cves.append(line.strip())
        return {"cves": cves, "count": len(cves)}

def vulners_parser(raw_output: str, params: dict) -> dict:
    """解析 vulners 输出"""
    vulnerabilities = []
    for line in raw_output.splitlines():
        if "CVE-" in line or "MS" in line:
            vulnerabilities.append(line.strip())
    return {
        "vulnerabilities": vulnerabilities[:50],
        "count": len(vulnerabilities),
        "summary": f"找到 {len(vulnerabilities)} 个漏洞"
    }

def lynis_system_parser(raw_output: str, params: dict) -> dict:
    """解析 lynis 系统审计输出"""
    warnings = []
    suggestions = []
    for line in raw_output.splitlines():
        if "WARNING" in line:
            warnings.append(line.strip())
        elif "SUGGESTION" in line:
            suggestions.append(line.strip())
    return {
        "warnings": warnings[:30],
        "suggestions": suggestions[:30],
        "warning_count": len(warnings),
        "suggestion_count": len(suggestions),
        "summary": f"发现 {len(warnings)} 个警告，{len(suggestions)} 个建议"
    }

def osquery_parser(raw_output: str, params: dict) -> dict:
    """解析 osquery JSON 输出"""
    try:
        data = json.loads(raw_output)
        return {
            "results": data[:100],
            "count": len(data),
            "summary": f"返回 {len(data)} 行查询结果"
        }
    except:
        lines = raw_output.splitlines()
        return {"results": lines[:50], "count": len(lines)}

def hashcat_rules_parser(raw_output: str, params: dict) -> dict:
    """解析 hashcat 规则破解输出"""
    results = []
    for line in raw_output.splitlines():
        if ":" in line:
            parts = line.strip().split(":", 1)
            if len(parts) == 2:
                results.append({
                    "hash": parts[0][:16] + "...",
                    "password": parts[1]
                })
    return {
        "cracked": results,
        "count": len(results),
        "summary": f"破解 {len(results)} 个密码"
    }

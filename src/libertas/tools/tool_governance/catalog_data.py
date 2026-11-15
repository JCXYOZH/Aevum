"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .models import RiskLevel


NATIVE_TOOL_REGISTRY: Dict[str, Dict] = {
    # 漏洞情报 - 安全（只读本地漏洞库；sync 只走用户已配置的源，不涉及攻击动作）
    "vuln_intel":         {"risk": RiskLevel.SAFE,   "category": "漏洞情报", "desc": "按编号查漏洞完整情报，或按关键词/产品/时间检索（CVE/CVSS）"},
    # 信息收集 - 安全
    "dns_lookup":         {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "DNS记录查询"},
    "whois":              {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "WHOIS域名信息"},
    "ssl_info":           {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "SSL证书信息"},
    "http_headers":       {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "HTTP响应头检查"},
    "http_methods":       {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "HTTP允许方法检测"},
    "http_fingerprint":   {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "HTTP指纹识别"},
    "robots_scanner":     {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "robots.txt扫描"},
    "ip_info":            {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "IP地址信息查询"},
    "reverse_dns":        {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "反向DNS解析"},
    "subnet_calculator":  {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "子网计算"},
    "cert_transparency":  {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "证书透明度日志查询"},
    "jwt_decoder":        {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "JWT令牌解码"},
    "hash_calculator":    {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "哈希计算"},
    "encode_decode":      {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "编码/解码"},
    "password_strength":  {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "密码强度检测"},
    # 信息收集 - 低风险
    "ping":               {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "ICMP Ping存活检测"},
    "tcp_ping":           {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "TCP Ping存活检测"},
    "port_scan":          {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "TCP端口扫描"},
    "banner_grab":        {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "Banner抓取"},
    "subdomain_enum":     {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "子域名枚举"},
    "traceroute":         {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "路由追踪"},
    "link_extractor":     {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "页面链接提取"},
    "email_harvester":    {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "邮箱收集"},
    "cookie_analyzer":    {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "Cookie安全分析"},
    "cors_checker":       {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "CORS配置检测"},
    "open_redirect":      {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "开放重定向检测"},
    "directory_listing":  {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "目录列表检测"},
    "host_discovery":     {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "主机发现"},
    # 扫描/爆破 - 中风险
    "dir_bruteforce":     {"risk": RiskLevel.MEDIUM, "category": "扫描爆破", "desc": "目录暴力扫描"},
    "backup_finder":      {"risk": RiskLevel.MEDIUM, "category": "扫描爆破", "desc": "备份文件发现"},
    # 网络工具（非安全工具但模型可用）
    "web_search":         {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "互联网搜索"},
    "web_fetch":          {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "抓取网页内容"},
    "web_deep_search":    {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "深度搜索+抓取"},
    "media_analyze":      {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "分析页面视频/媒体"},
    "link_check":         {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "检查链接有效性"},
    "link_repair":        {"risk": RiskLevel.SAFE,   "category": "网络工具", "desc": "修复失效链接"},
}


PLUGIN_REGISTRY: Dict[str, Dict] = {
    "port_scan":        {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "插件-端口扫描"},
    "dns_lookup":       {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-DNS查询"},
    "whois_lookup":     {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-WHOIS查询"},
    "ssl_cert_check":   {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-SSL证书检查"},
    "http_headers_check": {"risk": RiskLevel.SAFE, "category": "信息收集", "desc": "插件-HTTP头检查"},
    "http_methods":     {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-HTTP方法检测"},
    "robots_check":     {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-robots.txt检查"},
    "subdomain_enum":   {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "插件-子域名枚举"},
    "ping_test":        {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "插件-Ping测试"},
    "ip_info":          {"risk": RiskLevel.SAFE,   "category": "信息收集", "desc": "插件-IP信息查询"},
    "cors_check":       {"risk": RiskLevel.LOW,    "category": "信息收集", "desc": "插件-CORS检测"},
    "dir_scan":         {"risk": RiskLevel.MEDIUM, "category": "扫描爆破", "desc": "插件-目录扫描"},
    "email_validate":   {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-邮箱验证"},
    "encode_decode":    {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-编码解码"},
    "hash_calc":        {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-哈希计算"},
    "json_tool":        {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-JSON格式化"},
    "regex_test":       {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-正则测试"},
    "time_convert":     {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-时间转换"},
    "url_parser":       {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-URL解析"},
    "password_gen":     {"risk": RiskLevel.SAFE,   "category": "编码解码", "desc": "插件-密码生成"},
}


CATEGORY_DEFAULT_RISK: Dict[str, RiskLevel] = {
    "信息收集": RiskLevel.LOW,
    "扫描爆破": RiskLevel.MEDIUM,
    "编码解码": RiskLevel.SAFE,
    "网络工具": RiskLevel.SAFE,
    "外部工具": RiskLevel.MEDIUM,
    "插件工具": RiskLevel.LOW,
    "字典资源": RiskLevel.SAFE,
    "工具管理": RiskLevel.MEDIUM,
    "Web安全": RiskLevel.MEDIUM,
    "漏洞检测": RiskLevel.MEDIUM,
    "密码破解": RiskLevel.HIGH,
    "流量分析": RiskLevel.MEDIUM,
    "网络诊断": RiskLevel.LOW,
    "DNS工具": RiskLevel.SAFE,
    "逆向分析": RiskLevel.MEDIUM,
    "容器安全": RiskLevel.MEDIUM,
    "取证分析": RiskLevel.LOW,
    "系统审计": RiskLevel.LOW,
    "SSL/TLS": RiskLevel.SAFE,
    "无线安全": RiskLevel.HIGH,
    "代码安全": RiskLevel.LOW,
    "漏洞情报": RiskLevel.SAFE,
}


EXTERNAL_TOOL_RISK: Dict[str, RiskLevel] = {
    # 信息收集 - 安全/低风险
    "whois": RiskLevel.SAFE, "dig": RiskLevel.SAFE, "nslookup": RiskLevel.SAFE,
    "nmap": RiskLevel.LOW, "masscan": RiskLevel.LOW, "rustscan": RiskLevel.LOW,
    "naabu": RiskLevel.LOW, "httpx": RiskLevel.LOW, "httprobe": RiskLevel.LOW,
    "subfinder": RiskLevel.LOW, "amass": RiskLevel.LOW, "assetfinder": RiskLevel.LOW,
    "sublist3r": RiskLevel.LOW, "dnsenum": RiskLevel.LOW, "dnsmap": RiskLevel.LOW,
    "dnsx": RiskLevel.LOW, "shuffledns": RiskLevel.LOW, "massdns": RiskLevel.LOW,
    "chaos": RiskLevel.LOW, "waybackurls": RiskLevel.LOW, "gau": RiskLevel.LOW,
    "whatweb": RiskLevel.LOW, "wappalyzer": RiskLevel.LOW, "wafw00f": RiskLevel.LOW,
    "shodan": RiskLevel.LOW, "ldapdomaindump": RiskLevel.LOW,
    # 网络诊断 - 低风险
    "ping": RiskLevel.LOW, "traceroute": RiskLevel.LOW, "nc": RiskLevel.LOW,
    "tshark": RiskLevel.LOW,
    # 扫描爆破 - 中风险
    "ffuf": RiskLevel.MEDIUM, "gobuster": RiskLevel.MEDIUM, "dirsearch": RiskLevel.MEDIUM,
    "feroxbuster": RiskLevel.MEDIUM, "arjun": RiskLevel.MEDIUM, "katana": RiskLevel.MEDIUM,
    "hakrawler": RiskLevel.MEDIUM, "enum4linux": RiskLevel.MEDIUM, "smbmap": RiskLevel.MEDIUM,
    # 漏洞扫描 - 中风险
    "nuclei": RiskLevel.MEDIUM, "nuclei-js": RiskLevel.MEDIUM, "xray": RiskLevel.MEDIUM,
    "nikto": RiskLevel.MEDIUM, "wpscan": RiskLevel.MEDIUM, "joomscan": RiskLevel.MEDIUM,
    "testssl": RiskLevel.LOW, "sslyze": RiskLevel.LOW, "openssl": RiskLevel.SAFE,
    "searchsploit": RiskLevel.SAFE, "wapiti3": RiskLevel.MEDIUM, "cve-bin-tool": RiskLevel.MEDIUM,
    "burp": RiskLevel.MEDIUM, "vuln-update": RiskLevel.MEDIUM,
    # 漏洞利用 - 高风险
    "sqlmap": RiskLevel.HIGH, "metasploit": RiskLevel.HIGH,
    # 密码破解 - 高风险
    "hashcat": RiskLevel.HIGH, "john": RiskLevel.HIGH,
    "hydra": RiskLevel.HIGH, "medusa": RiskLevel.HIGH, "ncrack": RiskLevel.HIGH,
    "hashcat-rules": RiskLevel.HIGH, "john-rules": RiskLevel.HIGH,
    "aircrack": RiskLevel.HIGH, "aircrack-ng": RiskLevel.HIGH,
    # 流量分析 - 中风险
    "mitmproxy": RiskLevel.MEDIUM, "bettercap": RiskLevel.MEDIUM, "snort": RiskLevel.MEDIUM,
    "zeek": RiskLevel.MEDIUM, "tcpdump": RiskLevel.MEDIUM, "ettercap": RiskLevel.MEDIUM,
    "impacket": RiskLevel.MEDIUM,
    # 逆向分析 - 中风险
    "pwn": RiskLevel.MEDIUM, "ROPgadget": RiskLevel.MEDIUM,
    "radare2": RiskLevel.MEDIUM, "rizin": RiskLevel.MEDIUM, "scapy": RiskLevel.MEDIUM,
    # 容器安全 - 中风险
    "trivy": RiskLevel.MEDIUM, "trivy-k8s": RiskLevel.MEDIUM,
    "kube-bench": RiskLevel.MEDIUM, "kube-hunter": RiskLevel.MEDIUM,
    # 取证/审计 - 低风险
    "volatility3": RiskLevel.LOW, "sleuthkit": RiskLevel.LOW, "binwalk": RiskLevel.LOW,
    "lynis": RiskLevel.LOW, "lynis-system": RiskLevel.LOW,
    "clamav": RiskLevel.LOW, "find-rshell": RiskLevel.LOW, "yara": RiskLevel.LOW,
    # 动态发现的已安装工具（来自TOOL_REGISTRY，不在config.yaml中）
    "curl": RiskLevel.SAFE, "wget": RiskLevel.SAFE, "host": RiskLevel.SAFE,
    "arp": RiskLevel.LOW, "fping": RiskLevel.LOW, "lsof": RiskLevel.LOW,
    "ncat": RiskLevel.LOW, "netcat": RiskLevel.LOW, "netstat": RiskLevel.LOW,
    "nping": RiskLevel.LOW, "ssh": RiskLevel.LOW, "snmpwalk": RiskLevel.LOW,
    "gdb": RiskLevel.LOW, "r2": RiskLevel.LOW, "rabin2": RiskLevel.LOW,
    "wireshark": RiskLevel.LOW, "ldapsearch": RiskLevel.LOW,
    "chisel": RiskLevel.MEDIUM, "sshuttle": RiskLevel.MEDIUM, "wapiti": RiskLevel.MEDIUM,
    "kubectl": RiskLevel.MEDIUM,
    "kerbrute": RiskLevel.HIGH, "msfconsole": RiskLevel.HIGH,
    "msfvenom": RiskLevel.HIGH, "sliver": RiskLevel.HIGH,
}

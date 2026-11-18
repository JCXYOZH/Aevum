# core/tool_assembler.py
"""
工具命令组装引擎 v2 - 零件池·标签体系·动态命令树

三个核心概念：
  1. AtomPool（零件池）：每个命令行片段是独立零件，有全局唯一ID和语义标签，
     不总结不简写，可标记重复，不绑定任何工具。
  2. TagSystem（标签体系）：零件按语义作用分类，标签分层（角色.语义），
     支持互斥组，是组装的索引依据。
  3. CommandTree（动态命令树）：工具只声明阶段顺序和标签匹配规则，
     组装时遍历阶段树，从零件池按标签动态选取零件，无任何硬编码组装逻辑。
"""
import os
import re
import shutil
import tempfile
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field

from .assembly import ToolAssemblerAssemblyMixin
from .atoms import Atom, AtomPool, Tag
from .builder import ToolAssemblerBuilderMixin
from .tree import CommandTree, SlotDef, ToolDef, Trie


class ToolAssembler(ToolAssemblerBuilderMixin, ToolAssemblerAssemblyMixin):
    MINIMAL_TOOL_HINTS = {
        "nmap": ("信息收集", ["target", "ports"]),
        "masscan": ("信息收集", ["target_file", "ports"]),
        "rustscan": ("信息收集", ["target", "ports"]),
        "naabu": ("信息收集", ["target", "ports"]),
        "subfinder": ("信息收集", ["target"]),
        "amass": ("信息收集", ["target"]),
        "assetfinder": ("信息收集", ["target"]),
        "sublist3r": ("信息收集", ["target"]),
        "dnsenum": ("信息收集", ["target"]),
        "dnsmap": ("信息收集", ["target", "wordlist"]),
        "dnsx": ("信息收集", ["target"]),
        "shuffledns": ("信息收集", ["target", "wordlist"]),
        "chaos": ("信息收集", ["target"]),
        "waybackurls": ("信息收集", ["target"]),
        "gau": ("信息收集", ["target"]),
        "whatweb": ("信息收集", ["target"]),
        "wappalyzer": ("信息收集", ["target"]),
        "httpx": ("信息收集", ["input_file"]),
        "httprobe": ("信息收集", ["target"]),
        "whois": ("信息收集", ["target"]),
        "ffuf": ("Web安全", ["url", "wordlist"]),
        "gobuster": ("Web安全", ["url", "wordlist"]),
        "dirsearch": ("Web安全", ["target", "extensions"]),
        "feroxbuster": ("Web安全", ["target", "wordlist"]),
        "arjun": ("Web安全", ["target"]),
        "dalfox": ("Web安全", ["target"]),
        "katana": ("Web安全", ["url"]),
        "hakrawler": ("Web安全", ["url", "depth"]),
        "nuclei": ("漏洞检测", ["target"]),
        "xray": ("漏洞检测", ["target"]),
        "nikto": ("漏洞检测", ["target"]),
        "wpscan": ("漏洞检测", ["target"]),
        "joomscan": ("漏洞检测", ["target"]),
        "sqlmap": ("漏洞检测", ["url"]),
        "wafw00f": ("漏洞检测", ["target"]),
        "hydra": ("密码破解", ["target", "username", "passlist", "service"]),
        "medusa": ("密码破解", ["target", "username", "passlist"]),
        "ncrack": ("密码破解", ["target", "service"]),
        "hashcat": ("密码破解", ["hash_file", "hash_type"]),
        "john": ("密码破解", ["hash_file", "format", "wordlist"]),
        "tshark": ("流量分析", ["pcap_file"]),
        "zeek": ("流量分析", ["pcap_file"]),
        "snort": ("流量分析", ["pcap_file"]),
        "tcpdump": ("流量分析", ["interface", "packet_count"]),
        "ngrep": ("流量分析", ["interface", "pattern"]),
        "volatility3": ("取证分析", ["memory_file"]),
        "sleuthkit": ("取证分析", ["image_file", "offset"]),
        "binwalk": ("取证分析", ["target"]),
        "lynis": ("系统审计", []),
        "osquery": ("系统审计", ["sql_query"]),
        "trivy": ("容器安全", ["target"]),
        "kube-bench": ("容器安全", []),
        "kube-hunter": ("容器安全", ["target"]),
        "kube-score": ("容器安全", ["manifest_file"]),
        "cloudfox": ("云安全", ["target"]),
        "prowler": ("云安全", ["target"]),
        "openssl": ("SSL/TLS", ["target", "port", "servername"]),
        "testssl": ("SSL/TLS", ["target", "port"]),
        "sslyze": ("SSL/TLS", ["target", "port"]),
        "ping": ("网络诊断", ["target"]),
        "traceroute": ("网络诊断", ["target"]),
        "mtr": ("网络诊断", ["target"]),
        "nc": ("网络诊断", ["target", "port"]),
        "telnet": ("网络诊断", ["target", "port"]),
        "socat": ("网络诊断", ["target", "port"]),
        "dig": ("DNS工具", ["target", "record_type"]),
        "nslookup": ("DNS工具", ["target"]),
        "dnsrecon": ("DNS工具", ["target"]),
        "fierce": ("DNS工具", ["target"]),
        "aircrack-ng": ("无线安全", ["bssid", "wordlist", "cap_file"]),
        "reaver": ("无线安全", ["interface", "bssid", "channel"]),
        "radare2": ("逆向分析", ["target"]),
        "rizin": ("逆向分析", ["target"]),
        "bandit": ("代码安全", ["target"]),
        "semgrep": ("代码安全", ["target"]),
        "gitleaks": ("代码安全", ["target"]),
        "trufflehog": ("代码安全", ["target"]),
        "yara": ("代码安全", ["rule_file", "target"]),
        "goaccess": ("日志分析", ["log_file"]),
        "lnav": ("日志分析", ["log_file"]),
        "subzy": ("信息收集", ["target"]),
        "subjack": ("信息收集", ["target"]),
        "enum4linux": ("信息收集", ["target"]),
        "smbmap": ("信息收集", ["target"]),
        "metasploit": ("漏洞检测", ["target", "module"]),
        "searchsploit": ("漏洞检测", ["query"]),
        "exploitdb": ("漏洞检测", ["query"]),
        "bettercap": ("流量分析", ["interface"]),
        "ettercap": ("流量分析", ["target", "interface"]),
        "jwt_tool": ("Web安全", ["token"]),
        "clamav": ("系统审计", ["target"]),
        "ssh-audit": ("系统审计", ["target"]),
    }

    SUGGEST_KEYWORDS = {
        "nmap": ["端口扫描", "端口", "port scan", "nmap", "扫端口"],
        "subfinder": ["子域名", "subdomain", "子域", "subfinder"],
        "ffuf": ["目录爆破", "目录扫描", "fuzz", "ffuf", "目录枚举", "目录"],
        "gobuster": ["目录爆破", "目录扫描", "gobuster", "目录"],
        "nuclei": ["漏洞扫描", "漏洞检测", "nuclei", "poc", "检测漏洞", "安全扫描", "漏扫", "检测", "漏洞"],
        "sqlmap": ["sql注入", "注入", "sqlmap", "数据库"],
        "hydra": ["爆破", "弱口令", "密码", "hydra", "暴力破解"],
        "whatweb": ["指纹", "whatweb", "识别", "cms"],
        "wpscan": ["wordpress", "wp", "wpscan"],
        "ping": ["ping", "连通", "通不通", "icmp"],
        "whois": ["whois", "域名信息", "注册信息"],
        "dig": ["dns", "解析", "dig", "域名解析"],
        "tshark": ["抓包", "流量分析", "pcap", "tshark"],
        "nikto": ["web扫描", "nikto", "web漏洞"],
        "xray": ["xray", "被动扫描"],
        "dirsearch": ["目录", "dirsearch", "枚举目录", "目录爆破"],
        "testssl": ["ssl", "tls", "证书", "testssl"],
        "sslyze": ["ssl", "tls", "sslyze"],
        "enum4linux": ["smb", "共享", "enum4linux", "windows共享"],
        "smbmap": ["smb", "共享", "smbmap"],
        "searchsploit": ["exp", "漏洞利用", "searchsploit", "exploit"],
        "bandit": ["python安全", "代码审计", "bandit"],
        "semgrep": ["代码审计", "semgrep", "代码扫描"],
        "john": ["哈希破解", "john", "hash破解"],
        "hashcat": ["哈希破解", "hashcat", "gpu破解"],
        "wafw00f": ["waf", "防火墙", "wafw00f"],
        "traceroute": ["路由", "traceroute", "tracert", "路由追踪"],
        "openssl": ["ssl", "证书", "openssl", "连接测试"],
        "metasploit": ["msf", "metasploit", "漏洞利用", "meterpreter"],
        "masscan": ["masscan", "高速扫描", "高速端口"],
        "rustscan": ["rustscan", "快速端口"],
        "amass": ["amass", "子域名枚举", "资产发现"],
        "httpx": ["httpx", "存活探测", "web探测"],
        "naabu": ["naabu", "端口发现"],
        "katana": ["katana", "爬虫", "爬行"],
        "dalfox": ["dalfox", "xss"],
        "arjun": ["arjun", "参数发现"],
        "trivy": ["trivy", "容器扫描", "镜像扫描"],
        "lynis": ["lynis", "系统审计", "安全审计"],
        "aircrack-ng": ["aircrack", "wifi破解", "无线破解"],
        "volatility3": ["volatility", "内存取证", "内存分析"],
        "binwalk": ["binwalk", "固件分析", "固件提取"],
        "yara": ["yara", "恶意软件", "特征匹配"],
    }

    def __init__(self, config_tools: Dict[str, Any] = None):
        self.pool = AtomPool()
        self.tools: Dict[str, ToolDef] = {}
        self.templates = self.tools
        self._register_builtin_atoms()
        if config_tools:
            self.load_from_config(config_tools)

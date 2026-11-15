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


logger = logging.getLogger(__name__)

WSL_SECURITY_TOOLS = {
    # 信息收集
    "信息收集": {
        "amass": "子域名枚举与攻击面映射",
        "subfinder": "子域名发现工具",
        "masscan": "高速端口扫描器",
        "whatweb": "Web指纹识别工具",
        "sslscan": "SSL/TLS安全扫描",
        "enum4linux": "SMB/Windows枚举工具",
        "nbtscan": "NetBIOS名称扫描",
        "arp-scan": "ARP扫描与主机发现",
        "hping3": "高级TCP/IP数据包制作工具",
        "netdiscover": "被动/主动网络发现",
        "recon-ng": "全功能侦察框架",
        "theharvester": "邮箱、子域名、主机名收集",
        "spiderfoot": "自动化侦察与OSINT框架",
        "sublist3r": "子域名枚举工具",
        "onesixtyone": "SNMP社区字符串爆破",
        "snmp-check": "SNMP枚举工具",
        "dnsenum": "DNS枚举与区域传输",
        "dnsrecon": "DNS侦察工具",
        "fierce": "DNS侦察与区域传输",
        "wafw00f": "Web应用防火墙识别",
        "whois": "域名WHOIS查询",
        "dig": "DNS查询工具",
    },
    # Web安全
    "Web安全": {
        "sqlmap": "自动化SQL注入工具",
        "nikto": "Web服务器扫描器",
        "gobuster": "目录/文件/DNS爆破工具",
        "ffuf": "快速Web模糊测试工具",
        "dirsearch": "Web目录扫描工具",
        "dirb": "Web内容扫描器",
        "wfuzz": "Web应用模糊测试工具",
        "wpscan": "WordPress安全扫描器",
        "zaproxy": "OWASP ZAP代理扫描器",
        "commix": "命令注入检测与利用工具",
        "nosqlmap": "NoSQL注入检测工具",
        "joomscan": "Joomla漏洞扫描器",
        "droopescan": "CMS漏洞扫描器",
        "cmseek": "CMS检测与利用工具",
        "magescan": "Magento信息收集工具",
    },
    # 密码破解
    "密码破解": {
        "hydra": "在线密码爆破工具",
        "john": "离线密码破解工具",
        "hashcat": "GPU加速密码破解",
        "medusa": "在线密码爆破工具",
        "patator": "多协议暴力破解工具",
        "crunch": "密码字典生成工具",
        "cewl": "自定义密码字典生成",
        "hashid": "哈希类型识别工具",
    },
    # 漏洞检测
    "漏洞检测": {
        "msfconsole": "Metasploit渗透框架控制台",
        "msfvenom": "Metasploit Payload生成器",
        "searchsploit": "Exploit-DB离线搜索",
        "bloodhound": "Active Directory攻击路径分析",
        "impacket-psexec": "PsExec远程命令执行",
        "impacket-wmiexec": "WMI远程命令执行",
        "impacket-secretsdump": "Windows凭据转储",
        "impacket-GetUserSPNs": "Kerberoast SPN查询",
        "impacket-GetNPUsers": "AS-REP Roasting攻击",
        "impacket-smbexec": "SMB远程命令执行",
        "impacket-smbclient": "SMB客户端工具",
        "impacket-rpcdump": "RPC端点枚举",
        "impacket-samrdump": "SAMR用户枚举",
        "impacket-lookupsid": "SID枚举工具",
        "impacket-ntlmrelayx": "NTLM中继攻击",
        "impacket-mssqlclient": "MSSQL客户端",
        "impacket-mssqlinstance": "MSSQL实例枚举",
        "impacket-netview": "网络共享枚举",
        "impacket-GetADUsers": "AD用户枚举",
        "impacket-GetADComputers": "AD计算机枚举",
        "impacket-GetLAPSPassword": "LAPS密码读取",
        "impacket-Get-GPPPassword": "GPP密码提取",
        "impacket-goldenPac": "黄金票据攻击",
        "impacket-ticketer": "票据制作工具",
        "impacket-getST": "服务票据请求",
        "impacket-getTGT": "TGT请求工具",
        "impacket-ticketConverter": "票据格式转换",
        "impacket-karmaSMB": "Karma SMB攻击",
        "impacket-sniffer": "网络嗅探工具",
        "impacket-smbserver": "SMB服务器",
        "impacket-wmiquery": "WMI查询工具",
        "impacket-reg": "注册表操作工具",
        "impacket-services": "服务管理工具",
        "impacket-atexec": "AT命令执行",
        "impacket-dcomexec": "DCOM命令执行",
        "impacket-dpapi": "DPAPI解密工具",
        "impacket-esentutl": "ESENT数据库工具",
        "impacket-findDelegation": "委派配置查找",
        "impacket-machine_role": "机器角色查询",
        "impacket-mimikatz": "Mimikatz功能集成",
        "impacket-mqtt_check": "MQTT检查工具",
        "impacket-ntfs-read": "NTFS读取工具",
        "impacket-owneredit": "所有者修改工具",
        "impacket-ping": "ICMP Ping工具",
        "impacket-ping6": "IPv6 Ping工具",
        "impacket-raiseChild": "子域提升攻击",
        "impacket-rbcd": "基于资源的约束委派",
        "impacket-rdp_check": "RDP检查工具",
        "impacket-registry-read": "注册表读取",
        "impacket-rpcmap": "RPC映射工具",
        "impacket-sambaPipe": "Samba管道工具",
        "impacket-split": "票据分割工具",
        "impacket-tstool": "终端服务工具",
        "impacket-wmipersist": "WMI持久化",
        "impacket-addcomputer": "添加计算机账户",
        "impacket-changepasswd": "修改密码工具",
        "impacket-dacledit": "DACL编辑工具",
        "impacket-describeTicket": "票据描述工具",
        "impacket-DumpNTLMInfo": "NTLM信息转储",
        "impacket-exchanger": "Exchange工具",
        "impacket-getArch": "架构查询工具",
        "impacket-getPac": "PAC查询工具",
        "impacket-keylistattack": "密钥列表攻击",
    },
    # 无线安全
    "无线安全": {
        "aircrack-ng": "无线网络安全审计套件",
        "airmon-ng": "无线网卡监控模式切换",
        "airodump-ng": "无线数据包捕获",
        "aireplay-ng": "无线数据包注入",
        "reaver": "WPS PIN破解工具",
        "wifite": "自动化无线网络审计",
        "bully": "WPS PIN爆破工具",
        "kismet": "无线网络检测与嗅探",
    },
    # 逆向分析
    "逆向分析": {
        "radare2": "逆向工程框架",
        "gdb": "GNU调试器",
        "binwalk": "固件分析工具",
        "exiftool": "文件元数据分析",
        "apktool": "APK反编译工具",
        "jadx": "DEX反编译工具",
        "frida": "动态插桩工具",
        "objdump": "目标文件反汇编",
        "strace": "系统调用跟踪",
        "ltrace": "库调用跟踪",
    },
    # 取证分析
    "取证分析": {
        "photorec": "文件恢复工具",
        "testdisk": "磁盘恢复工具",
        "scalpel": "文件雕刻工具",
        "foremost": "文件恢复工具",
        "volatility": "内存取证框架",
        "autopsy": "数字取证平台",
        "bulk_extractor": "批量数据提取工具",
    },
    # 流量分析
    "流量分析": {
        "tcpdump": "命令行数据包捕获",
        "tshark": "命令行Wireshark",
        "mitmproxy": "中间人代理工具",
        "ettercap": "中间人攻击套件",
        "bettercap": "网络攻击与监控框架",
        "ngrep": "网络数据包grep",
        "tcpflow": "TCP流提取工具",
    },
    # 网络诊断
    "网络诊断": {
        "netcat": "网络瑞士军刀",
        "ncat": "Nmap网络工具",
        "socat": "多功能网络工具",
        "sshuttle": "透明代理VPN",
        "openvpn": "开源VPN工具",
        "curl": "命令行HTTP客户端",
        "wget": "命令行文件下载",
    },
    # 其他
    "其他": {
        "psql": "PostgreSQL客户端",
        "sqlite3": "SQLite客户端",
        "mysql": "MySQL客户端",
        "redis-cli": "Redis客户端",
        "mongo": "MongoDB客户端",
        "ldapsearch": "LDAP查询工具",
        "snmpwalk": "SNMP遍历工具",
        "snmpget": "SNMP获取工具",
    },
}

WSL_TOOL_RISK = {
    # 高危工具
    "msfconsole": "high", "msfvenom": "high", "searchsploit": "medium",
    "hydra": "high", "john": "medium", "hashcat": "medium",
    "medusa": "high", "patator": "high",
    "aircrack-ng": "high", "aireplay-ng": "high", "reaver": "high",
    "ettercap": "high", "bettercap": "high", "mitmproxy": "medium",
    "sqlmap": "high", "nikto": "medium", "commix": "high",
    "nmap": "low", "masscan": "medium",
    "impacket-psexec": "high", "impacket-wmiexec": "high",
    "impacket-secretsdump": "high", "impacket-GetUserSPNs": "high",
    "impacket-GetNPUsers": "high", "impacket-smbexec": "high",
    "impacket-ntlmrelayx": "high", "impacket-goldenPac": "high",
    "impacket-ticketer": "high", "impacket-mimikatz": "high",
    "bloodhound": "medium",
    # 中危工具
    "gobuster": "medium", "ffuf": "medium", "dirsearch": "medium",
    "wfuzz": "medium", "wpscan": "medium", "zaproxy": "medium",
    "amass": "low", "subfinder": "low", "whatweb": "low",
    "sslscan": "low", "enum4linux": "medium", "nbtscan": "low",
    "arp-scan": "low", "hping3": "medium", "netdiscover": "low",
    "recon-ng": "low", "theharvester": "low", "spiderfoot": "low",
    "sublist3r": "low", "onesixtyone": "medium", "snmp-check": "low",
    "dnsenum": "low", "dnsrecon": "low", "fierce": "low",
    "wafw00f": "low", "whois": "safe", "dig": "safe",
    "crunch": "low", "cewl": "low", "hashid": "safe",
    "radare2": "medium", "gdb": "low", "binwalk": "low",
    "exiftool": "safe", "apktool": "low", "jadx": "low",
    "frida": "medium", "objdump": "low", "strace": "low", "ltrace": "low",
    "photorec": "low", "testdisk": "low", "scalpel": "low",
    "foremost": "low", "volatility": "medium", "autopsy": "low",
    "tcpdump": "low", "tshark": "low", "ngrep": "low", "tcpflow": "low",
    "netcat": "medium", "ncat": "medium", "socat": "medium",
    "sshuttle": "low", "openvpn": "low", "curl": "safe", "wget": "safe",
    "psql": "low", "sqlite3": "low", "mysql": "low",
    "redis-cli": "low", "mongo": "low",
    "ldapsearch": "low", "snmpwalk": "low", "snmpget": "low",
}

"""
网络安全工具安装管理器
- 检测工具是否已安装
- 提供各平台安装命令
- 执行安装（需用户授权）
- 安装验证
"""
import os
import shutil
import platform
import subprocess
import urllib.request
import urllib.error
import ssl
import time
from typing import Dict, List, Optional
from libertas.foundation.config import get_data_dir


KNOWN_SECURITY_CMDS = {
    # 信息收集
    "nmap", "masscan", "rustscan", "naabu", "unicornscan", "zmap", "fping",
    "hping3", "nping", "ping", "traceroute", "mtr", "arp", "arp-scan",
    "nbtscan", "enum4linux", "enum4linux-ng", "smbclient", "rpcclient",
    "snmpwalk", "snmpcheck", "onesixtyone", "ldapsearch", "dig", "nslookup",
    "host", "whois", "dnsenum", "dnsrecon", "dnsmap", "fierce", "amass",
    "subfinder", "findomain", "assetfinder", "altdns", "knockpy", "gospider",
    "hakrawler", "katana", "theharvester", "recon-ng", "maltego", "spiderfoot",
    "sherlock", "maigret", "holehe", "ignorant", "phoneinfoga", "osrframework",
    "twint", "instaloader", "gallery-dl", "youtube-dl", "yt-dlp",
    # Web扫描
    "nikto", "nuclei", "sqlmap", "dirsearch", "dirb", "gobuster", "ffuf",
    "wfuzz", "feroxbuster", "wpscan", "arachni", "vega", "skipfish", "wapiti",
    "wafw00f", "whatweb", "httpx", "httpx-toolkit", "dalfox", "xsstrike",
    "kxss", "commix", "burpsuite", "owasp-zap", "mitmproxy", "caido",
    "subjack", "nuclei-templates", "testssl.sh", "sslscan", "sslyze",
    # 密码攻击
    "hydra", "medusa", "ncrack", "patator", "crowbar", "hashcat", "john",
    "rainbowcrack", "cewl", "crunch", "cupp", "hashid", "findmyhash",
    "name-that-hash", "kerbrute", "brutespray", "responder", "crackmapexec",
    "netexec", "evil-winrm", "secretsdump",
    # 漏洞利用
    "metasploit", "msfconsole", "msfvenom", "armitage", "covenant", "sliver",
    "empire", "powersploit", "mimikatz", "bloodhound", "beef", "routersploit",
    "certipy", "bloodyad", "impacket", "pwncat", "ligolo-ng", "chisel",
    "sshuttle", "proxychains", "ngrok", "frp", "ncat", "netcat", "socat",
    # 无线安全
    "aircrack-ng", "reaver", "bully", "pixiewps", "wifite", "kismet",
    "hcxdumptool", "hcxtools", "bettercap",
    # 逆向工程
    "radare2", "r2", "rabin2", "ghidra", "jadx", "apktool", "frida",
    "binwalk", "yara", "strace", "ltrace", "gdb", "valgrind",
    # 取证
    "autopsy", "foremost", "scalpel", "bulk_extractor", "steghide",
    "stegseek", "zsteg", "exiftool", "tshark", "wireshark", "tcpdump",
    "netsniff-ng", "ngrep", "tcpreplay", "sslsplit", "volatility",
    "gitleaks", "trufflehog", "trivy", "semgrep",
    # 网络工具
    "curl", "wget", "httpie", "http", "websocat", "ssh", "sshpass", "ssh-audit",
    "openssl", "tor", "iptables", "nft", "lsof", "ss", "netstat", "socat",
    "docker", "kubectl", "helm", "aws", "gcloud", "azure",
    # 开发/系统工具
    "git", "make", "cmake", "go", "rustc", "cargo", "java", "python3",
    "python", "pip", "pip3", "node", "npm", "ruby", "gem", "perl",
    "jq", "vim", "tmux", "docker", "ansible", "terraform",
}

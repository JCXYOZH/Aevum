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

REGISTRY_PART = {
    "rainbowcrack": {
        "name": "RainbowCrack", "desc": "彩虹表密码破解", "category": "密码攻击",
        "install": {"darwin": "brew install rainbowcrack", "linux": "sudo apt-get install -y rainbowcrack", "win32": "从 http://project-rainbowcrack.com 下载"},
        "verify": "rcrack --help", "website": "http://project-rainbowcrack.com",
    },
    "findmyhash": {
        "name": "findmyhash", "desc": "在线哈希值查找", "category": "密码攻击",
        "install": {"darwin": "不支持macOS", "linux": "从 https://github.com/soxrok2212/findmyhash 下载", "win32": "从 https://github.com/soxrok2212/findmyhash 下载"},
        "verify": "findmyhash.py -h", "website": "https://github.com/soxrok2212/findmyhash",
    },
    "recon-ng": {
        "name": "Recon-ng", "desc": "Web侦察框架", "category": "信息收集",
        "install": {"darwin": "brew install recon-ng", "linux": "sudo apt-get install -y recon-ng || pip install recon-ng", "win32": "pip install recon-ng"},
        "verify": "recon-ng --version", "website": "https://github.com/lanmaster53/recon-ng",
    },
    "maltego": {
        "name": "Maltego", "desc": "开源情报和取证", "category": "信息收集",
        "install": {"darwin": "brew install --cask maltego", "linux": "从 https://www.maltego.com 下载", "win32": "从 https://www.maltego.com 下载"},
        "verify": "", "website": "https://www.maltego.com",
    },
    "osrframework": {
        "name": "OSRFramework", "desc": "开源情报收集框架", "category": "信息收集",
        "install": {"darwin": "pip install osrframework", "linux": "pip install osrframework", "win32": "pip install osrframework"},
        "verify": "usufy --help", "website": "https://github.com/i3visio/osrframework",
    },
    "sherlock": {
        "name": "Sherlock", "desc": "社交媒体账号搜索", "category": "信息收集",
        "install": {"darwin": "pip install sherlock-project", "linux": "pip install sherlock-project", "win32": "pip install sherlock-project"},
        "verify": "sherlock --version", "website": "https://github.com/sherlock-project/sherlock",
    },
    "maigret": {
        "name": "Maigret", "desc": "用户名情报收集（Sherlock增强版）", "category": "信息收集",
        "install": {"darwin": "pip install maigret", "linux": "pip install maigret", "win32": "pip install maigret"},
        "verify": "maigret --version", "website": "https://github.com/soxoj/maigret",
    },
    "holehe": {
        "name": "Holehe", "desc": "邮箱注册网站检查", "category": "信息收集",
        "install": {"darwin": "pip install holehe", "linux": "pip install holehe", "win32": "pip install holehe"},
        "verify": "holehe --help", "website": "https://github.com/megadose/holehe",
    },
    "ignorant": {
        "name": "Ignorant", "desc": "手机号注册网站检查", "category": "信息收集",
        "install": {"darwin": "pip install ignorant", "linux": "pip install ignorant", "win32": "pip install ignorant"},
        "verify": "ignorant --help", "website": "https://github.com/megadose/ignorant",
    },
    "phoneinfoga": {
        "name": "PhoneInfoga", "desc": "电话号码信息收集", "category": "信息收集",
        "install": {"darwin": "brew install phoneinfoga", "linux": "从 https://github.com/sundowndev/phoneinfoga/releases 下载", "win32": "从 https://github.com/sundowndev/phoneinfoga/releases 下载"},
        "verify": "phoneinfoga version", "website": "https://github.com/sundowndev/phoneinfoga",
    },
    "dnsrecon": {
        "name": "DNSRecon", "desc": "DNS枚举和侦察", "category": "信息收集",
        "install": {"darwin": "pip install dnsrecon", "linux": "sudo apt-get install -y dnsrecon || pip install dnsrecon", "win32": "pip install dnsrecon"},
        "verify": "dnsrecon --version", "website": "https://github.com/darkoperator/dnsrecon",
    },
    "dnsenum": {
        "name": "DNSEnum", "desc": "DNS枚举工具", "category": "信息收集",
        "install": {"darwin": "brew install dnsenum", "linux": "sudo apt-get install -y dnsenum", "win32": "从 https://github.com/fwaeytens/dnsenum 下载"},
        "verify": "dnsenum --version", "website": "https://github.com/fwaeytens/dnsenum",
    },
    "fierce": {
        "name": "Fierce", "desc": "DNS侦察工具", "category": "信息收集",
        "install": {"darwin": "brew install fierce", "linux": "sudo apt-get install -y fierce || pip install fierce", "win32": "pip install fierce"},
        "verify": "fierce --version", "website": "https://github.com/mschwager/fierce",
    },
    "dnsmap": {
        "name": "DNSMap", "desc": "DNS域名暴力扫描", "category": "信息收集",
        "install": {"darwin": "brew install dnsmap", "linux": "sudo apt-get install -y dnsmap", "win32": "从 https://code.google.com/archive/p/dnsmap 下载"},
        "verify": "dnsmap", "website": "https://code.google.com/p/dnsmap",
    },
    "fping": {
        "name": "fping", "desc": "批量Ping扫描", "category": "信息收集",
        "install": {"darwin": "brew install fping", "linux": "sudo apt-get install -y fping", "win32": "从 https://fping.org 下载"},
        "verify": "fping --version", "website": "https://fping.org",
    },
    "hping3": {
        "name": "hping3", "desc": "命令行TCP/IP数据包组装", "category": "信息收集",
        "install": {"darwin": "brew install hping", "linux": "sudo apt-get install -y hping3", "win32": "从 http://www.hping.org 下载"},
        "verify": "hping3 --version", "website": "http://www.hping.org",
    },
    "nping": {
        "name": "Nping", "desc": "网络包生成工具（Nmap套件）", "category": "信息收集",
        "install": {"darwin": "brew install nmap", "linux": "sudo apt-get install -y nmap", "win32": "winget install Insecure.Nmap"},
        "verify": "nping --version", "website": "https://nmap.org/nping",
    },
    "altdns": {
        "name": "Altdns", "desc": "子域名置换和扫描", "category": "信息收集",
        "install": {"darwin": "pip install py-altdns", "linux": "pip install py-altdns", "win32": "pip install py-altdns"},
        "verify": "altdns --help", "website": "https://github.com/infosec-au/altdns",
    },
    "knockpy": {
        "name": "Knockpy", "desc": "子域名枚举工具", "category": "信息收集",
        "install": {"darwin": "pip install knockpy", "linux": "sudo apt-get install -y knockpy || pip install knockpy", "win32": "pip install knockpy"},
        "verify": "knockpy --help", "website": "https://github.com/guelfoweb/knock",
    },
    "assetfinder": {
        "name": "Assetfinder", "desc": "域名相关资产查找", "category": "信息收集",
        "install": {"darwin": "brew install assetfinder", "linux": "go install github.com/tomnomnom/assetfinder@latest", "win32": "从 https://github.com/tomnomnom/assetfinder/releases 下载"},
        "verify": "assetfinder --help", "website": "https://github.com/tomnomnom/assetfinder",
    },
    "findomain": {
        "name": "Findomain", "desc": "跨平台子域名枚举器", "category": "信息收集",
        "install": {"darwin": "brew install findomain", "linux": "从 https://github.com/Findomain/Findomain/releases 下载", "win32": "从 https://github.com/Findomain/Findomain/releases 下载"},
        "verify": "findomain --version", "website": "https://github.com/Findomain/Findomain",
    },
    "tshark": {
        "name": "TShark", "desc": "Wireshark命令行版", "category": "网络分析",
        "install": {"darwin": "brew install wireshark", "linux": "sudo apt-get install -y tshark", "win32": "winget install WiresharkFoundation.Wireshark"},
        "verify": "tshark --version", "website": "https://www.wireshark.org",
    },
    "ngrep": {
        "name": "ngrep", "desc": "网络grep包匹配", "category": "网络分析",
        "install": {"darwin": "brew install ngrep", "linux": "sudo apt-get install -y ngrep", "win32": "从 https://github.com/jpr5/ngrep 下载"},
        "verify": "ngrep -V", "website": "https://github.com/jpr5/ngrep",
    },
    "netsniff-ng": {
        "name": "netsniff-ng", "desc": "高性能网络抓包套件", "category": "网络分析",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y netsniff-ng", "win32": "不支持Windows"},
        "verify": "netsniff-ng --version", "website": "http://netsniff-ng.org",
    },
    "bettercap": {
        "name": "Bettercap", "desc": "网络攻击和监控框架", "category": "网络分析",
        "install": {"darwin": "brew install bettercap", "linux": "sudo apt-get install -y bettercap || 从 https://www.bettercap.org 下载", "win32": "从 https://www.bettercap.org 下载"},
        "verify": "bettercap --version", "website": "https://www.bettercap.org",
    },
    "responder": {
        "name": "Responder", "desc": "LLMNR/NBT-NS/mDNS投毒", "category": "网络攻击",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y responder || git clone https://github.com/lgandx/Responder", "win32": "不支持Windows"},
        "verify": "responder --help", "website": "https://github.com/lgandx/Responder",
    },
    "impacket": {
        "name": "Impacket", "desc": "网络协议工具包", "category": "网络攻击",
        "install": {"darwin": "pip install impacket", "linux": "pip install impacket", "win32": "pip install impacket"},
        "verify": "python3 -c 'import impacket; print(impacket.__version__)'", "website": "https://github.com/fortra/impacket",
    },
    "netcat": {
        "name": "Netcat", "desc": "TCP/UDP网络瑞士军刀", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y netcat-openbsd", "win32": "从 https://nmap.org/ncat 下载"},
        "verify": "nc -h", "website": "https://nmap.org/ncat",
    },
    "ncat": {
        "name": "Ncat", "desc": "Nmap网络连接工具", "category": "网络工具",
        "install": {"darwin": "brew install nmap", "linux": "sudo apt-get install -y nmap", "win32": "winget install Insecure.Nmap"},
        "verify": "ncat --version", "website": "https://nmap.org/ncat",
    },
    "socat": {
        "name": "socat", "desc": "双向数据中继工具", "category": "网络工具",
        "install": {"darwin": "brew install socat", "linux": "sudo apt-get install -y socat", "win32": "从 http://www.dest-unreach.org/socat 下载"},
        "verify": "socat -V", "website": "http://www.dest-unreach.org/socat",
    },
    "proxychains": {
        "name": "ProxyChains-NG", "desc": "代理链工具", "category": "网络工具",
        "install": {"darwin": "brew install proxychains-ng", "linux": "sudo apt-get install -y proxychains4", "win32": "从 https://github.com/shunf4/proxychains-windows 下载"},
        "verify": "proxychains4 --version", "website": "https://github.com/rofl0r/proxychains-ng",
    },
    "tor": {
        "name": "Tor", "desc": "匿名网络代理", "category": "网络工具",
        "install": {"darwin": "brew install tor", "linux": "sudo apt-get install -y tor", "win32": "从 https://www.torproject.org 下载"},
        "verify": "tor --version", "website": "https://www.torproject.org",
    },
    "sshuttle": {
        "name": "sshuttle", "desc": "基于SSH的透明代理", "category": "网络工具",
        "install": {"darwin": "pip install sshuttle", "linux": "sudo apt-get install -y sshuttle || pip install sshuttle", "win32": "pip install sshuttle"},
        "verify": "sshuttle --version", "website": "https://github.com/sshuttle/sshuttle",
    },
    "chisel": {
        "name": "Chisel", "desc": "Go TCP/UDP隧道", "category": "网络工具",
        "install": {"darwin": "brew install chisel", "linux": "go install github.com/jpillora/chisel@latest", "win32": "从 https://github.com/jpillora/chisel/releases 下载"},
        "verify": "chisel --version", "website": "https://github.com/jpillora/chisel",
    },
    "ngrok": {
        "name": "ngrok", "desc": "内网穿透工具", "category": "网络工具",
        "install": {"darwin": "brew install ngrok", "linux": "从 https://ngrok.com/download 下载", "win32": "winget install ngrok"},
        "verify": "ngrok version", "website": "https://ngrok.com",
    },
    "reaver": {
        "name": "Reaver", "desc": "WPS PIN暴力破解", "category": "无线安全",
        "install": {"darwin": "brew install reaver", "linux": "sudo apt-get install -y reaver", "win32": "不支持Windows"},
        "verify": "reaver --help", "website": "https://github.com/t6x/reaver-wps-fork-t6x",
    },
    "bully": {
        "name": "Bully", "desc": "WPS PIN暴力破解（C实现）", "category": "无线安全",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y bully", "win32": "不支持Windows"},
        "verify": "bully --help", "website": "https://github.com/aanarchyy/bully",
    },
    "pixiewps": {
        "name": "Pixiewps", "desc": "WPS离线暴力破解", "category": "无线安全",
        "install": {"darwin": "brew install pixiewps", "linux": "sudo apt-get install -y pixiewps", "win32": "不支持Windows"},
        "verify": "pixiewps --help", "website": "https://github.com/wiire-a/pixiewps",
    },
    "wifite": {
        "name": "Wifite2", "desc": "自动化WiFi攻击工具", "category": "无线安全",
        "install": {"darwin": "brew install wifite", "linux": "sudo apt-get install -y wifite || git clone https://github.com/derv82/wifite2", "win32": "不支持Windows"},
        "verify": "wifite --help", "website": "https://github.com/derv82/wifite2",
    },
    "hcxdumptool": {
        "name": "hcxdumptool", "desc": "WiFi握手包捕获", "category": "无线安全",
        "install": {"darwin": "brew install hcxdumptool", "linux": "sudo apt-get install -y hcxdumptool", "win32": "不支持Windows"},
        "verify": "hcxdumptool --version", "website": "https://github.com/ZerBea/hcxdumptool",
    },
    "hcxtools": {
        "name": "hcxtools", "desc": "WiFi哈希转换工具", "category": "无线安全",
        "install": {"darwin": "brew install hcxtools", "linux": "sudo apt-get install -y hcxtools", "win32": "不支持Windows"},
        "verify": "hcxpcapngtool --version", "website": "https://github.com/ZerBea/hcxtools",
    },
    "kismet": {
        "name": "Kismet", "desc": "无线网络检测器", "category": "无线安全",
        "install": {"darwin": "brew install kismet", "linux": "sudo apt-get install -y kismet", "win32": "从 https://www.kismetwireless.net 下载"},
        "verify": "kismet --version", "website": "https://www.kismetwireless.net",
    },
    "beef": {
        "name": "BeEF", "desc": "浏览器攻击框架", "category": "渗透框架",
        "install": {"darwin": "brew install beef", "linux": "sudo apt-get install -y beef-xss || git clone https://github.com/beefproject/beef", "win32": "从 https://beefproject.com 下载"},
        "verify": "beef --help", "website": "https://beefproject.com",
    },
    "empire": {
        "name": "Empire", "desc": "后渗透利用框架", "category": "渗透框架",
        "install": {"darwin": "不支持macOS", "linux": "git clone https://github.com/EmpireProject/Empire", "win32": "不支持Windows"},
        "verify": "python3 empire --help", "website": "https://github.com/EmpireProject/Empire",
    },
    "covenant": {
        "name": "Covenant", "desc": ".NET命令控制框架", "category": "渗透框架",
        "install": {"darwin": "从 https://github.com/cobbr/Covenant/releases 下载", "linux": "从 https://github.com/cobbr/Covenant/releases 下载", "win32": "从 https://github.com/cobbr/Covenant/releases 下载"},
        "verify": "", "website": "https://github.com/cobbr/Covenant",
    },
    "sliver": {
        "name": "Sliver", "desc": "跨平台对抗模拟框架", "category": "渗透框架",
        "install": {"darwin": "brew install sliver", "linux": "curl https://sliver.sh/install | sudo bash", "win32": "从 https://github.com/BishopFox/sliver/releases 下载"},
        "verify": "sliver version", "website": "https://github.com/BishopFox/sliver",
    },
    "crackmapexec": {
        "name": "CrackMapExec", "desc": "后渗透横向移动工具", "category": "渗透框架",
        "install": {"darwin": "pip install crackmapexec", "linux": "sudo apt-get install -y crackmapexec || pip install crackmapexec", "win32": "pip install crackmapexec"},
        "verify": "cme --version", "website": "https://github.com/Pennyw0rth/NetExec",
    },
    "netexec": {
        "name": "NetExec", "desc": "CrackMapExec的活跃分支", "category": "渗透框架",
        "install": {"darwin": "pip install netexec", "linux": "pip install netexec", "win32": "pip install netexec"},
        "verify": "nxc --version", "website": "https://github.com/Pennyw0rth/NetExec",
    },
    "evil-winrm": {
        "name": "Evil-WinRM", "desc": "WinRM远程管理Shell", "category": "渗透框架",
        "install": {"darwin": "gem install evil-winrm", "linux": "gem install evil-winrm", "win32": "gem install evil-winrm"},
        "verify": "evil-winrm --version", "website": "https://github.com/Hackplayers/evil-winrm",
    },
    "bloodhound": {
        "name": "BloodHound", "desc": "Active Directory关系分析", "category": "渗透框架",
        "install": {"darwin": "brew install --cask bloodhound", "linux": "从 https://bloodhound.readthedocs.io 下载", "win32": "从 https://bloodhound.readthedocs.io 下载"},
        "verify": "", "website": "https://github.com/BloodHoundAD/BloodHound",
    },
    "mimikatz": {
        "name": "Mimikatz", "desc": "Windows凭证提取工具", "category": "渗透框架",
        "install": {"darwin": "不支持macOS", "linux": "不支持Linux", "win32": "从 https://github.com/gentilkiwi/mimikatz/releases 下载"},
        "verify": "", "website": "https://github.com/gentilkiwi/mimikatz",
    },
    "powersploit": {
        "name": "PowerSploit", "desc": "PowerShell后渗透框架", "category": "渗透框架",
        "install": {"darwin": "不支持macOS", "linux": "git clone https://github.com/PowerShellMafia/PowerSploit", "win32": "从 https://github.com/PowerShellMafia/PowerSploit 下载"},
        "verify": "", "website": "https://github.com/PowerShellMafia/PowerSploit",
    },
    "radare2": {
        "name": "radare2", "desc": "逆向工程框架", "category": "逆向工程",
        "install": {"darwin": "brew install radare2", "linux": "sudo apt-get install -y radare2 || git clone https://github.com/radareorg/radare2", "win32": "从 https://github.com/radareorg/radare2/releases 下载"},
        "verify": "r2 -v", "website": "https://rada.re",
    },
    "ghidra": {
        "name": "Ghidra", "desc": "NSA开源逆向工程工具", "category": "逆向工程",
        "install": {"darwin": "brew install --cask ghidra", "linux": "从 https://ghidra-sre.org 下载", "win32": "从 https://ghidra-sre.org 下载"},
        "verify": "", "website": "https://ghidra-sre.org",
    },
    "binwalk": {
        "name": "Binwalk", "desc": "固件分析工具", "category": "逆向工程",
        "install": {"darwin": "brew install binwalk", "linux": "sudo apt-get install -y binwalk || pip install binwalk", "win32": "pip install binwalk"},
        "verify": "binwalk --version", "website": "https://github.com/ReFirmLabs/binwalk",
    },
    "apktool": {
        "name": "Apktool", "desc": "APK反编译工具", "category": "逆向工程",
        "install": {"darwin": "brew install apktool", "linux": "sudo apt-get install -y apktool", "win32": "从 https://ibotpeaches.github.io/Apktool 下载"},
        "verify": "apktool --version", "website": "https://ibotpeaches.github.io/Apktool",
    },
    "jadx": {
        "name": "JADX", "desc": "Android DEX反编译器", "category": "逆向工程",
        "install": {"darwin": "brew install jadx", "linux": "从 https://github.com/skylot/jadx/releases 下载", "win32": "从 https://github.com/skylot/jadx/releases 下载"},
        "verify": "jadx --version", "website": "https://github.com/skylot/jadx",
    },
    "frida": {
        "name": "Frida", "desc": "动态插桩工具包", "category": "逆向工程",
        "install": {"darwin": "pip install frida-tools", "linux": "pip install frida-tools", "win32": "pip install frida-tools"},
        "verify": "frida --version", "website": "https://frida.re",
    },
    "strace": {
        "name": "strace", "desc": "系统调用跟踪器", "category": "逆向工程",
        "install": {"darwin": "brew install strace", "linux": "sudo apt-get install -y strace", "win32": "不支持Windows"},
        "verify": "strace --version", "website": "https://strace.io",
    },
    "ltrace": {
        "name": "ltrace", "desc": "库调用跟踪器", "category": "逆向工程",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y ltrace", "win32": "不支持Windows"},
        "verify": "ltrace --version", "website": "https://ltrace.org",
    },
}

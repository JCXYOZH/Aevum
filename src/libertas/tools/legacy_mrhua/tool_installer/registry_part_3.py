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
    "searchsploit": {
        "name": "SearchSploit", "desc": "Exploit-DB离线搜索", "category": "漏洞利用",
        "install": {"darwin": "brew install exploitdb", "linux": "sudo apt-get install -y exploitdb", "win32": "从 https://gitlab.com/exploit-database/exploitdb 下载"},
        "verify": "searchsploit --version", "website": "https://www.exploit-db.com",
    },
    "msfvenom": {
        "name": "MSFvenom", "desc": "Payload生成器（Metasploit）", "category": "漏洞利用",
        "install": {"darwin": "brew install metasploit", "linux": "随Metasploit安装", "win32": "随Metasploit安装"},
        "verify": "msfvenom --version", "website": "https://www.metasploit.com",
    },
    "armitage": {
        "name": "Armitage", "desc": "Metasploit图形界面", "category": "漏洞利用",
        "install": {"darwin": "brew install armitage", "linux": "sudo apt-get install -y armitage", "win32": "从 http://www.fastandeasyhacking.com 下载"},
        "verify": "armitage --help", "website": "http://www.fastandeasyhacking.com",
    },
    "routersploit": {
        "name": "RouterSploit", "desc": "嵌入式设备漏洞利用框架", "category": "漏洞利用",
        "install": {"darwin": "git clone https://github.com/threat9/routersploit", "linux": "git clone https://github.com/threat9/routersploit", "win32": "从 https://github.com/threat9/routersploit 下载"},
        "verify": "python3 rsf.py --help", "website": "https://github.com/threat9/routersploit",
    },
    "commix": {
        "name": "Commix", "desc": "命令注入自动化工具", "category": "漏洞利用",
        "install": {"darwin": "brew install commix", "linux": "sudo apt-get install -y commix || git clone https://github.com/commixproject/commix", "win32": "从 https://github.com/commixproject/commix 下载"},
        "verify": "commix --version", "website": "https://github.com/commixproject/commix",
    },
    "xsstrike": {
        "name": "XSStrike", "desc": "XSS扫描和利用套件", "category": "漏洞利用",
        "install": {"darwin": "pip install xsstrike", "linux": "git clone https://github.com/s0md3v/XSStrike", "win32": "从 https://github.com/s0md3v/XSStrike 下载"},
        "verify": "xsstrike --help", "website": "https://github.com/s0md3v/XSStrike",
    },
    "smbmap": {
        "name": "SMBMap", "desc": "SMB共享枚举", "category": "漏洞利用",
        "install": {"darwin": "pip install smbmap", "linux": "pip install smbmap", "win32": "pip install smbmap"},
        "verify": "smbmap --help", "website": "https://github.com/ShawnDEvans/smbmap",
    },
    "enum4linux": {
        "name": "enum4linux", "desc": "Windows/Samba枚举", "category": "漏洞利用",
        "install": {"darwin": "brew install enum4linux", "linux": "sudo apt-get install -y enum4linux", "win32": "从 https://labs.portcullis.co.uk/application/enum4linux 下载"},
        "verify": "enum4linux --help", "website": "https://labs.portcullis.co.uk/application/enum4linux",
    },
    "ldapsearch": {
        "name": "ldapsearch", "desc": "LDAP查询工具", "category": "信息收集",
        "install": {"darwin": "brew install openldap", "linux": "sudo apt-get install -y ldap-utils", "win32": "从 https://www.openldap.org 下载"},
        "verify": "ldapsearch --version 2>&1 | head -1", "website": "https://www.openldap.org",
    },
    "snmpwalk": {
        "name": "snmpwalk", "desc": "SNMP枚举工具", "category": "信息收集",
        "install": {"darwin": "brew install net-snmp", "linux": "sudo apt-get install -y snmp", "win32": "从 https://www.net-snmp.org 下载"},
        "verify": "snmpwalk -V", "website": "https://www.net-snmp.org",
    },
    "onesixtyone": {
        "name": "onesixtyone", "desc": "SNMP扫描器", "category": "信息收集",
        "install": {"darwin": "brew install onesixtyone", "linux": "sudo apt-get install -y onesixtyone", "win32": "从 https://github.com/trailofbits/onesixtyone 下载"},
        "verify": "onesixtyone", "website": "https://github.com/trailofbits/onesixtyone",
    },
    "sslscan": {
        "name": "SSLScan", "desc": "SSL/TLS扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install sslscan", "linux": "sudo apt-get install -y sslscan", "win32": "从 https://github.com/rbsec/sslscan 下载"},
        "verify": "sslscan --version", "website": "https://github.com/rbsec/sslscan",
    },
    "foremost": {
        "name": "Foremost", "desc": "文件恢复/数据雕刻", "category": "取证",
        "install": {"darwin": "brew install foremost", "linux": "sudo apt-get install -y foremost", "win32": "从 https://foremost.sourceforge.net 下载"},
        "verify": "foremost -V", "website": "https://foremost.sourceforge.net",
    },
    "binutils": {
        "name": "Binutils", "desc": "二进制工具集（strings/objdump）", "category": "取证",
        "install": {"darwin": "brew install binutils", "linux": "sudo apt-get install -y binutils", "win32": "从 https://www.gnu.org/software/binutils 下载"},
        "verify": "strings --version | head -1", "website": "https://www.gnu.org/software/binutils",
    },
    "exiftool": {
        "name": "ExifTool", "desc": "元数据读取和写入", "category": "取证",
        "install": {"darwin": "brew install exiftool", "linux": "sudo apt-get install -y libimage-exiftool-perl", "win32": "从 https://exiftool.org 下载"},
        "verify": "exiftool -ver", "website": "https://exiftool.org",
    },
    "steghide": {
        "name": "Steghide", "desc": "隐写术工具", "category": "取证",
        "install": {"darwin": "brew install steghide", "linux": "sudo apt-get install -y steghide", "win32": "从 https://steghide.sourceforge.net 下载"},
        "verify": "steghide --version", "website": "https://steghide.sourceforge.net",
    },
    "zsteg": {
        "name": "zsteg", "desc": "PNG/BMP隐写检测", "category": "取证",
        "install": {"darwin": "gem install zsteg", "linux": "gem install zsteg", "win32": "gem install zsteg"},
        "verify": "zsteg --version", "website": "https://github.com/zed-0xff/zsteg",
    },
    "stegseek": {
        "name": "Stegseek", "desc": "steghide极速爆破", "category": "取证",
        "install": {"darwin": "brew install stegseek", "linux": "从 https://github.com/RickdeJager/stegseek/releases 下载", "win32": "不支持Windows"},
        "verify": "stegseek --version", "website": "https://github.com/RickdeJager/stegseek",
    },
    "volatility": {
        "name": "Volatility 3", "desc": "内存取证框架", "category": "取证",
        "install": {"darwin": "pip install volatility3", "linux": "pip install volatility3", "win32": "pip install volatility3"},
        "verify": "vol --version", "website": "https://www.volatilityfoundation.org",
    },
    "autopsy": {
        "name": "Autopsy", "desc": "数字取证平台", "category": "取证",
        "install": {"darwin": "brew install --cask autopsy", "linux": "从 https://www.autopsy.com 下载", "win32": "从 https://www.autopsy.com 下载"},
        "verify": "", "website": "https://www.autopsy.com",
    },
    "python3": {
        "name": "Python 3", "desc": "Python编程语言", "category": "开发工具",
        "install": {"darwin": "brew install python3", "linux": "sudo apt-get install -y python3 python3-pip", "win32": "winget install Python.Python.3.12"},
        "verify": "python3 --version", "website": "https://www.python.org",
    },
    "nodejs": {
        "name": "Node.js", "desc": "JavaScript运行时", "category": "开发工具",
        "install": {"darwin": "brew install node", "linux": "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs", "win32": "winget install OpenJS.NodeJS.LTS"},
        "verify": "node --version", "website": "https://nodejs.org",
    },
    "rust": {
        "name": "Rust", "desc": "Rust编程语言", "category": "开发工具",
        "install": {"darwin": "brew install rust", "linux": "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh", "win32": "从 https://www.rust-lang.org/tools/install 下载"},
        "verify": "rustc --version", "website": "https://www.rust-lang.org",
    },
    "java": {
        "name": "Java JDK", "desc": "Java开发工具包", "category": "开发工具",
        "install": {"darwin": "brew install openjdk", "linux": "sudo apt-get install -y default-jdk", "win32": "winget install Microsoft.OpenJDK.17"},
        "verify": "java -version", "website": "https://openjdk.java.net",
    },
    "ruby": {
        "name": "Ruby", "desc": "Ruby编程语言", "category": "开发工具",
        "install": {"darwin": "brew install ruby", "linux": "sudo apt-get install -y ruby", "win32": "winget install RubyInstallerTeam.Ruby"},
        "verify": "ruby --version", "website": "https://www.ruby-lang.org",
    },
    "jq": {
        "name": "jq", "desc": "JSON命令行处理器", "category": "开发工具",
        "install": {"darwin": "brew install jq", "linux": "sudo apt-get install -y jq", "win32": "winget install jqlang.jq"},
        "verify": "jq --version", "website": "https://jqlang.github.io/jq",
    },
    "tmux": {
        "name": "tmux", "desc": "终端复用器", "category": "开发工具",
        "install": {"darwin": "brew install tmux", "linux": "sudo apt-get install -y tmux", "win32": "从 https://github.com/tmux/tmux 下载"},
        "verify": "tmux -V", "website": "https://github.com/tmux/tmux",
    },
    "vim": {
        "name": "Vim", "desc": "文本编辑器", "category": "开发工具",
        "install": {"darwin": "brew install vim", "linux": "sudo apt-get install -y vim", "win32": "winget install vim.vim"},
        "verify": "vim --version | head -1", "website": "https://www.vim.org",
    },
    "make": {
        "name": "Make", "desc": "构建自动化工具", "category": "开发工具",
        "install": {"darwin": "xcode-select --install", "linux": "sudo apt-get install -y build-essential", "win32": "winget install GnuWin32.Make"},
        "verify": "make --version | head -1", "website": "https://www.gnu.org/software/make",
    },
    "cmake": {
        "name": "CMake", "desc": "跨平台构建系统", "category": "开发工具",
        "install": {"darwin": "brew install cmake", "linux": "sudo apt-get install -y cmake", "win32": "winget install Kitware.CMake"},
        "verify": "cmake --version | head -1", "website": "https://cmake.org",
    },
    "sqlcipher": {
        "name": "SQLCipher", "desc": "加密SQLite数据库", "category": "数据库",
        "install": {"darwin": "brew install sqlcipher", "linux": "sudo apt-get install -y sqlcipher", "win32": "从 https://www.zetetic.net/sqlcipher 下载"},
        "verify": "sqlcipher --version", "website": "https://www.zetetic.net/sqlcipher",
    },
    "redis-tools": {
        "name": "Redis Tools", "desc": "Redis命令行工具", "category": "数据库",
        "install": {"darwin": "brew install redis", "linux": "sudo apt-get install -y redis-tools", "win32": "从 https://redis.io/download 下载"},
        "verify": "redis-cli --version", "website": "https://redis.io",
    },
    "mongodb-database-tools": {
        "name": "MongoDB Tools", "desc": "MongoDB命令行工具", "category": "数据库",
        "install": {"darwin": "brew install mongodb-database-tools", "linux": "从 https://www.mongodb.com/try/download/database-tools 下载", "win32": "从 https://www.mongodb.com/try/download/database-tools 下载"},
        "verify": "mongodump --version", "website": "https://www.mongodb.com",
    },
    "awscli": {
        "name": "AWS CLI", "desc": "Amazon Web Services命令行", "category": "云安全",
        "install": {"darwin": "brew install awscli", "linux": "sudo apt-get install -y awscli || pip install awscli", "win32": "winget install Amazon.AWSCLI"},
        "verify": "aws --version", "website": "https://aws.amazon.com/cli",
    },
    "gcloud": {
        "name": "Google Cloud SDK", "desc": "GCP命令行工具", "category": "云安全",
        "install": {"darwin": "brew install --cask google-cloud-sdk", "linux": "从 https://cloud.google.com/sdk/docs/install 下载", "win32": "从 https://cloud.google.com/sdk/docs/install 下载"},
        "verify": "gcloud --version", "website": "https://cloud.google.com/sdk",
    },
    "azure-cli": {
        "name": "Azure CLI", "desc": "Microsoft Azure命令行", "category": "云安全",
        "install": {"darwin": "brew install azure-cli", "linux": "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash", "win32": "winget install Microsoft.AzureCLI"},
        "verify": "az --version", "website": "https://docs.microsoft.com/cli/azure",
    },
    "pacu": {
        "name": "Pacu", "desc": "AWS渗透测试框架", "category": "云安全",
        "install": {"darwin": "git clone https://github.com/RhinoSecurityLabs/pacu", "linux": "git clone https://github.com/RhinoSecurityLabs/pacu", "win32": "从 https://github.com/RhinoSecurityLabs/pacu 下载"},
        "verify": "python3 pacu.py --help", "website": "https://github.com/RhinoSecurityLabs/pacu",
    },
    "cloud_enum": {
        "name": "cloud_enum", "desc": "多云资源枚举", "category": "云安全",
        "install": {"darwin": "git clone https://github.com/initstring/cloud_enum", "linux": "git clone https://github.com/initstring/cloud_enum", "win32": "从 https://github.com/initstring/cloud_enum 下载"},
        "verify": "python3 cloud_enum.py --help", "website": "https://github.com/initstring/cloud_enum",
    },
    "twint": {
        "name": "Twint", "desc": "Twitter情报收集（无需API）", "category": "OSINT",
        "install": {"darwin": "pip install twint", "linux": "pip install twint", "win32": "pip install twint"},
        "verify": "twint --version", "website": "https://github.com/twintproject/twint",
    },
    "instaloader": {
        "name": "Instaloader", "desc": "Instagram照片/视频下载", "category": "OSINT",
        "install": {"darwin": "pip install instaloader", "linux": "pip install instaloader", "win32": "pip install instaloader"},
        "verify": "instaloader --version", "website": "https://instaloader.github.io",
    },
    "youtube-dl": {
        "name": "yt-dlp", "desc": "视频下载工具（youtube-dl增强）", "category": "OSINT",
        "install": {"darwin": "brew install yt-dlp", "linux": "sudo apt-get install -y yt-dlp || pip install yt-dlp", "win32": "winget install yt-dlp.yt-dlp"},
        "verify": "yt-dlp --version", "website": "https://github.com/yt-dlp/yt-dlp",
    },
    "gallery-dl": {
        "name": "gallery-dl", "desc": "图片画廊下载器", "category": "OSINT",
        "install": {"darwin": "brew install gallery-dl", "linux": "pip install gallery-dl", "win32": "pip install gallery-dl"},
        "verify": "gallery-dl --version", "website": "https://github.com/mikf/gallery-dl",
    },
    "hashid": {
        "name": "HashID", "desc": "哈希类型识别", "category": "密码攻击",
        "install": {"darwin": "pip install hashid", "linux": "pip install hashid", "win32": "pip install hashid"},
        "verify": "hashid --help", "website": "https://github.com/psypanda/hashID",
    },
    "name-that-hash": {
        "name": "Name That Hash", "desc": "哈希类型识别（现代版）", "category": "密码攻击",
        "install": {"darwin": "pip install name-that-hash", "linux": "pip install name-that-hash", "win32": "pip install name-that-hash"},
        "verify": "nth --help", "website": "https://github.com/HashPals/Name-That-Hash",
    },
    "cyberchef": {
        "name": "CyberChef", "desc": "网络瑞士军刀（Web版）", "category": "杂项工具",
        "install": {"darwin": "brew install --cask cyberchef", "linux": "从 https://gchq.github.io/CyberChef 下载离线版", "win32": "从 https://gchq.github.io/CyberChef 下载离线版"},
        "verify": "", "website": "https://gchq.github.io/CyberChef",
    },
    "mobsf": {
        "name": "MobSF", "desc": "移动安全框架", "category": "移动安全",
        "install": {"darwin": "pip install mobsf", "linux": "pip install mobsf", "win32": "pip install mobsf"},
        "verify": "mobsf --help", "website": "https://github.com/MobSF/Mobile-Security-Framework-MobSF",
    },
    "frida-server": {
        "name": "Frida Server", "desc": "Android动态插桩服务端", "category": "移动安全",
        "install": {"darwin": "不适用", "linux": "从 https://github.com/frida/frida/releases 下载对应架构版本", "win32": "不适用"},
        "verify": "", "website": "https://github.com/frida/frida",
    },
    "objection": {
        "name": "Objection", "desc": "Frida移动运行时探索", "category": "移动安全",
        "install": {"darwin": "pip install objection", "linux": "pip install objection", "win32": "pip install objection"},
        "verify": "objection version", "website": "https://github.com/sensepost/objection",
    },
    "arp-scan": {
        "name": "ARP Scan", "desc": "ARP扫描发现局域网主机", "category": "信息收集",
        "install": {"darwin": "brew install arp-scan", "linux": "sudo apt-get install -y arp-scan", "win32": "不适用"},
        "verify": "arp-scan --version", "website": "https://github.com/royhills/arp-scan",
    },
    "nbtscan": {
        "name": "NBTscan", "desc": "NetBIOS名称网络扫描", "category": "信息收集",
        "install": {"darwin": "brew install nbtscan", "linux": "sudo apt-get install -y nbtscan", "win32": "从 https://github.com/resurrecting-open-source-projects/nbtscan 下载"},
        "verify": "nbtscan -h", "website": "https://github.com/resurrecting-open-source-projects/nbtscan",
    },
    "enum4linux-ng": {
        "name": "enum4linux-ng", "desc": "Windows/Samba枚举工具（下一代）", "category": "信息收集",
        "install": {"darwin": "pip install enum4linux-ng", "linux": "pip install enum4linux-ng || git clone https://github.com/cddmp/enum4linux-ng", "win32": "pip install enum4linux-ng"},
        "verify": "enum4linux-ng --version", "website": "https://github.com/cddmp/enum4linux-ng",
    },
    "snmpcheck": {
        "name": "SNMPCheck", "desc": "SNMP设备信息枚举", "category": "信息收集",
        "install": {"darwin": "brew install snmpcheck", "linux": "sudo apt-get install -y snmpcheck || git clone https://github.com/sensepost/snmpcheck", "win32": "从 https://github.com/sensepost/snmpcheck 下载"},
        "verify": "snmpcheck -h", "website": "https://github.com/sensepost/snmpcheck",
    },
    "smbclient": {
        "name": "Samba Client", "desc": "SMB/CIFS共享访问客户端", "category": "信息收集",
        "install": {"darwin": "brew install samba", "linux": "sudo apt-get install -y smbclient", "win32": "Windows自带"},
        "verify": "smbclient --version", "website": "https://www.samba.org",
    },
    "rpcclient": {
        "name": "RPCClient", "desc": "MS-RPC客户端枚举工具", "category": "信息收集",
        "install": {"darwin": "brew install samba", "linux": "sudo apt-get install -y smbclient", "win32": "Windows自带"},
        "verify": "rpcclient --help", "website": "https://www.samba.org",
    },
    "traceroute": {
        "name": "Traceroute", "desc": "网络路径追踪", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y traceroute", "win32": "tracert（系统自带）"},
        "verify": "traceroute --version 2>&1 || traceroute", "website": "",
    },
    "mtr": {
        "name": "MTR", "desc": "网络诊断工具（traceroute+ping结合）", "category": "网络工具",
        "install": {"darwin": "brew install mtr", "linux": "sudo apt-get install -y mtr", "win32": "从 https://github.com/PowerShell/Win32-OpenSSH 下载"},
        "verify": "mtr --version", "website": "https://www.bitwizard.nl/mtr/",
    },
    "iptables": {
        "name": "iptables", "desc": "Linux防火墙规则管理", "category": "网络工具",
        "install": {"darwin": "不适用", "linux": "系统自带", "win32": "不适用（使用netsh）"},
        "verify": "iptables --version", "website": "https://netfilter.org",
    },
    "nft": {
        "name": "nftables", "desc": "Linux下一代防火墙框架", "category": "网络工具",
        "install": {"darwin": "不适用", "linux": "sudo apt-get install -y nftables", "win32": "不适用"},
        "verify": "nft --version", "website": "https://netfilter.org",
    },
    "subjack": {
        "name": "Subjack", "desc": "子域名接管检测工具", "category": "Web扫描",
        "install": {"darwin": "go install github.com/haccer/subjack@latest", "linux": "go install github.com/haccer/subjack@latest", "win32": "从 https://github.com/haccer/subjack/releases 下载"},
        "verify": "subjack -h", "website": "https://github.com/haccer/subjack",
    },
    "nuclei-templates": {
        "name": "Nuclei Templates", "desc": "Nuclei漏洞模板库", "category": "Web扫描",
        "install": {"darwin": "nuclei -update-templates", "linux": "nuclei -update-templates", "win32": "nuclei -update-templates"},
        "verify": "", "website": "https://github.com/projectdiscovery/nuclei-templates",
    },
}

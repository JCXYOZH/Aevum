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
    "nmap": {
        "name": "Nmap", "desc": "网络扫描和安全审计工具", "category": "扫描器",
        "install": {"darwin": "brew install nmap", "linux": "sudo apt-get install -y nmap || sudo yum install -y nmap", "win32": "winget install Insecure.Nmap"},
        "verify": "nmap --version", "website": "https://nmap.org",
    },
    "masscan": {
        "name": "Masscan", "desc": "大规模端口扫描器", "category": "扫描器",
        "install": {"darwin": "brew install masscan", "linux": "sudo apt-get install -y masscan", "win32": "从 https://github.com/robertdavidgraham/masscan/releases 下载"},
        "verify": "masscan --version", "website": "https://github.com/robertdavidgraham/masscan",
    },
    "rustscan": {
        "name": "RustScan", "desc": "快速端口扫描器（Rust）", "category": "扫描器",
        "install": {"darwin": "brew install rustscan", "linux": "从 https://github.com/RustScan/RustScan/releases 下载", "win32": "从 https://github.com/RustScan/RustScan/releases 下载"},
        "verify": "rustscan --version", "website": "https://github.com/RustScan/RustScan",
    },
    "naabu": {
        "name": "Naabu", "desc": "Go语言快速端口扫描器", "category": "扫描器",
        "install": {"darwin": "brew install naabu", "linux": "sudo apt install -y naabu || go install github.com/projectdiscovery/naabu/v2/cmd/naabu@latest", "win32": "从 https://github.com/projectdiscovery/naabu/releases 下载"},
        "verify": "naabu -version", "website": "https://github.com/projectdiscovery/naabu",
    },
    "nikto": {
        "name": "Nikto", "desc": "Web服务器漏洞扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install nikto", "linux": "sudo apt-get install -y nikto", "win32": "从 https://github.com/sullo/nikto 下载"},
        "verify": "nikto -Version", "website": "https://github.com/sullo/nikto",
    },
    "nuclei": {
        "name": "Nuclei", "desc": "基于模板的漏洞扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install nuclei", "linux": "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest", "win32": "从 https://github.com/projectdiscovery/nuclei/releases 下载"},
        "verify": "nuclei -version", "website": "https://github.com/projectdiscovery/nuclei",
    },
    "sqlmap": {
        "name": "SQLMap", "desc": "SQL注入自动化检测工具", "category": "Web扫描",
        "install": {"darwin": "brew install sqlmap", "linux": "sudo apt-get install -y sqlmap || pip install sqlmap", "win32": "pip install sqlmap"},
        "verify": "sqlmap --version", "website": "https://sqlmap.org",
    },
    "dirsearch": {
        "name": "Dirsearch", "desc": "Web目录暴力扫描", "category": "Web扫描",
        "install": {"darwin": "brew install dirsearch", "linux": "pip install dirsearch || git clone https://github.com/maurosoria/dirsearch", "win32": "pip install dirsearch"},
        "verify": "dirsearch --version", "website": "https://github.com/maurosoria/dirsearch",
    },
    "gobuster": {
        "name": "Gobuster", "desc": "目录/DNS/子域名暴力破解", "category": "Web扫描",
        "install": {"darwin": "brew install gobuster", "linux": "sudo apt install -y gobuster || go install github.com/OJ/gobuster/v3@latest", "win32": "从 https://github.com/OJ/gobuster/releases 下载"},
        "verify": "gobuster version", "website": "https://github.com/OJ/gobuster",
    },
    "ffuf": {
        "name": "ffuf", "desc": "快速Web Fuzzer", "category": "Web扫描",
        "install": {"darwin": "brew install ffuf", "linux": "go install github.com/ffuf/ffuf/v2@latest", "win32": "从 https://github.com/ffuf/ffuf/releases 下载"},
        "verify": "ffuf -V", "website": "https://github.com/ffuf/ffuf",
    },
    "wpscan": {
        "name": "WPScan", "desc": "WordPress漏洞扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install wpscan", "linux": "sudo apt install -y wpscan || gem install wpscan", "win32": "gem install wpscan"},
        "verify": "wpscan --version", "website": "https://wpscan.com",
    },
    "hydra": {
        "name": "Hydra", "desc": "在线密码爆破工具", "category": "密码攻击",
        "install": {"darwin": "brew install hydra", "linux": "sudo apt-get install -y hydra", "win32": "从 https://github.com/vanhauser-thc/thc-hydra 下载"},
        "verify": "hydra -h", "website": "https://github.com/vanhauser-thc/thc-hydra",
    },
    "medusa": {
        "name": "Medusa", "desc": "快速并行登录爆破", "category": "密码攻击",
        "install": {"darwin": "brew install medusa", "linux": "sudo apt-get install -y medusa", "win32": "从 https://github.com/jmk-foofus/medusa 下载"},
        "verify": "medusa -h", "website": "https://github.com/jmk-foofus/medusa",
    },
    "john": {
        "name": "John the Ripper", "desc": "密码哈希破解器", "category": "密码攻击",
        "install": {"darwin": "brew install john", "linux": "sudo apt-get install -y john", "win32": "从 https://www.openwall.com/john/ 下载"},
        "verify": "john --version", "website": "https://www.openwall.com/john/",
    },
    "hashcat": {
        "name": "Hashcat", "desc": "GPU加速密码破解", "category": "密码攻击",
        "install": {"darwin": "brew install hashcat", "linux": "sudo apt-get install -y hashcat", "win32": "从 https://hashcat.net/hashcat/ 下载"},
        "verify": "hashcat --version", "website": "https://hashcat.net",
    },
    "aircrack-ng": {
        "name": "Aircrack-ng", "desc": "WiFi安全审计套件", "category": "无线安全",
        "install": {"darwin": "brew install aircrack-ng", "linux": "sudo apt-get install -y aircrack-ng", "win32": "从 https://www.aircrack-ng.org/ 下载"},
        "verify": "aircrack-ng --help", "website": "https://www.aircrack-ng.org",
    },
    "wireshark": {
        "name": "Wireshark", "desc": "网络协议分析器", "category": "网络分析",
        "install": {"darwin": "brew install --cask wireshark", "linux": "sudo apt-get install -y wireshark", "win32": "winget install WiresharkFoundation.Wireshark"},
        "verify": "tshark --version", "website": "https://www.wireshark.org",
    },
    "tcpdump": {
        "name": "tcpdump", "desc": "命令行抓包工具", "category": "网络分析",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y tcpdump", "win32": "从 https://www.tcpdump.org/ 下载"},
        "verify": "tcpdump --version", "website": "https://www.tcpdump.org",
    },
    "burpsuite": {
        "name": "Burp Suite", "desc": "Web渗透测试代理", "category": "Web代理",
        "install": {"darwin": "brew install --cask burp-suite", "linux": "从 https://portswigger.net/burp 下载", "win32": "从 https://portswigger.net/burp 下载"},
        "verify": "", "website": "https://portswigger.net/burp",
    },
    "mitmproxy": {
        "name": "mitmproxy", "desc": "交互式HTTPS代理", "category": "Web代理",
        "install": {"darwin": "brew install mitmproxy", "linux": "pip install mitmproxy", "win32": "pip install mitmproxy"},
        "verify": "mitmproxy --version", "website": "https://mitmproxy.org",
    },
    "metasploit": {
        "name": "Metasploit", "desc": "渗透测试框架", "category": "渗透框架",
        "install": {"darwin": "brew install metasploit", "linux": "curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb | sudo bash", "win32": "从 https://docs.metasploit.com/ 下载"},
        "verify": "msfconsole --version", "website": "https://www.metasploit.com",
    },
    "whois": {
        "name": "Whois", "desc": "域名WHOIS查询", "category": "信息收集",
        "install": {"darwin": "brew install whois", "linux": "sudo apt-get install -y whois", "win32": "从 Sysinternals 下载 whois.exe"},
        "verify": "whois --version", "website": "",
    },
    "dig": {
        "name": "Dig", "desc": "DNS查询工具", "category": "信息收集",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y dnsutils", "win32": "随 BIND 安装"},
        "verify": "dig -v", "website": "",
    },
    "subfinder": {
        "name": "Subfinder", "desc": "子域名发现工具", "category": "信息收集",
        "install": {"darwin": "brew install subfinder", "linux": "go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest", "win32": "从 https://github.com/projectdiscovery/subfinder/releases 下载"},
        "verify": "subfinder -version", "website": "https://github.com/projectdiscovery/subfinder",
    },
    "amass": {
        "name": "Amass", "desc": "深度攻击面映射", "category": "信息收集",
        "install": {"darwin": "brew install amass", "linux": "sudo apt install -y amass || go install github.com/owasp-amass/amass/v4/...@master", "win32": "从 https://github.com/owasp-amass/amass/releases 下载"},
        "verify": "amass -version", "website": "https://github.com/owasp-amass/amass",
    },
    "theharvester": {
        "name": "theHarvester", "desc": "邮件/子域名/员工收集", "category": "信息收集",
        "install": {"darwin": "brew install theharvester", "linux": "sudo apt install -y theharvester || git clone https://github.com/laramies/theHarvester", "win32": "从 https://github.com/laramies/theHarvester 下载"},
        "verify": "theHarvester -h", "website": "https://github.com/laramies/theHarvester",
    },
    "curl": {
        "name": "cURL", "desc": "HTTP请求工具", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y curl", "win32": "winget install cURL.cURL"},
        "verify": "curl --version", "website": "https://curl.se",
    },
    "wget": {
        "name": "Wget", "desc": "文件下载工具", "category": "网络工具",
        "install": {"darwin": "brew install wget", "linux": "sudo apt-get install -y wget", "win32": "从 https://www.gnu.org/software/wget/ 下载"},
        "verify": "wget --version", "website": "https://www.gnu.org/software/wget/",
    },
    "openssl": {
        "name": "OpenSSL", "desc": "SSL/TLS工具包", "category": "加密",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y openssl", "win32": "从 https://slproweb.com/products/Win32OpenSSL.html 下载"},
        "verify": "openssl version", "website": "https://www.openssl.org",
    },
    "git": {
        "name": "Git", "desc": "版本控制系统", "category": "开发工具",
        "install": {"darwin": "xcode-select --install", "linux": "sudo apt-get install -y git", "win32": "winget install Git.Git"},
        "verify": "git --version", "website": "https://git-scm.com",
    },
    "go": {
        "name": "Go", "desc": "Go语言环境（安装Go工具链）", "category": "开发工具",
        "install": {"darwin": "brew install go", "linux": "sudo apt-get install -y golang", "win32": "winget install GoLang.Go"},
        "verify": "go version", "website": "https://go.dev",
    },
    "docker": {
        "name": "Docker", "desc": "容器运行时", "category": "开发工具",
        "install": {"darwin": "brew install --cask docker", "linux": "curl -fsSL https://get.docker.com | sh", "win32": "winget install Docker.DockerDesktop"},
        "verify": "docker --version", "website": "https://www.docker.com",
    },
    "zmap": {
        "name": "ZMap", "desc": "单包高速网络扫描器", "category": "扫描器",
        "install": {"darwin": "brew install zmap", "linux": "sudo apt-get install -y zmap", "win32": "从 https://github.com/zmap/zmap/releases 下载"},
        "verify": "zmap --version", "website": "https://zmap.io",
    },
    "unicornscan": {
        "name": "Unicornscan", "desc": "异步端口扫描器", "category": "扫描器",
        "install": {"darwin": "brew install unicornscan", "linux": "sudo apt-get install -y unicornscan", "win32": "不支持Windows"},
        "verify": "unicornscan --version", "website": "https://sourceforge.net/projects/osace/",
    },
    "sparta": {
        "name": "Sparta", "desc": "网络基础设施渗透测试GUI", "category": "扫描器",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y sparta", "win32": "不支持Windows"},
        "verify": "sparta --help", "website": "https://github.com/SECFORCE/sparta",
    },
    "legion": {
        "name": "Legion", "desc": "Sparta的增强分支，半自动渗透测试", "category": "扫描器",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y legion", "win32": "不支持Windows"},
        "verify": "legion --help", "website": "https://github.com/GoVanguard/legion",
    },
    "whatweb": {
        "name": "WhatWeb", "desc": "Web指纹识别工具", "category": "Web扫描",
        "install": {"darwin": "brew install whatweb", "linux": "sudo apt-get install -y whatweb", "win32": "从 https://github.com/urbanadventurer/WhatWeb 下载"},
        "verify": "whatweb --version", "website": "https://github.com/urbanadventurer/WhatWeb",
    },
    "wafw00f": {
        "name": "wafw00f", "desc": "WAF防火墙识别工具", "category": "Web扫描",
        "install": {"darwin": "pip install wafw00f", "linux": "sudo apt-get install -y wafw00f || pip install wafw00f", "win32": "pip install wafw00f"},
        "verify": "wafw00f --version", "website": "https://github.com/EnableSecurity/wafw00f",
    },
    "arachni": {
        "name": "Arachni", "desc": "Web应用安全扫描框架", "category": "Web扫描",
        "install": {"darwin": "brew install arachni", "linux": "从 https://www.arachni-scanner.com 下载", "win32": "从 https://www.arachni-scanner.com 下载"},
        "verify": "arachni --version", "website": "https://www.arachni-scanner.com",
    },
    "skipfish": {
        "name": "Skipfish", "desc": "主动Web应用安全侦察工具", "category": "Web扫描",
        "install": {"darwin": "brew install skipfish", "linux": "sudo apt-get install -y skipfish", "win32": "从 https://code.google.com/archive/p/skipfish 下载"},
        "verify": "skipfish -V", "website": "https://code.google.com/p/skipfish",
    },
    "wapiti": {
        "name": "Wapiti", "desc": "Web应用漏洞扫描器", "category": "Web扫描",
        "install": {"darwin": "pip install wapiti3", "linux": "sudo apt-get install -y wapiti || pip install wapiti3", "win32": "pip install wapiti3"},
        "verify": "wapiti --version", "website": "https://wapiti.sourceforge.io",
    },
    "vega": {
        "name": "Vega", "desc": "Web安全扫描平台", "category": "Web扫描",
        "install": {"darwin": "从 https://subgraph.com/vega 下载", "linux": "从 https://subgraph.com/vega 下载", "win32": "从 https://subgraph.com/vega 下载"},
        "verify": "", "website": "https://subgraph.com/vega",
    },
    "owasp-zap": {
        "name": "OWASP ZAP", "desc": "Web应用安全扫描代理", "category": "Web扫描",
        "install": {"darwin": "brew install --cask owasp-zap", "linux": "从 https://www.zaproxy.org/download 下载", "win32": "winget install OWASP.ZAP"},
        "verify": "zap.sh -version", "website": "https://www.zaproxy.org",
    },
    "testssl": {
        "name": "testssl.sh", "desc": "TLS/SSL安全检测", "category": "Web扫描",
        "install": {"darwin": "brew install testssl", "linux": "git clone https://github.com/drwetter/testssl.sh.git", "win32": "从 https://github.com/drwetter/testssl.sh 下载"},
        "verify": "testssl --version", "website": "https://testssl.sh",
    },
    "sslyze": {
        "name": "SSLyze", "desc": "SSL配置扫描库和工具", "category": "Web扫描",
        "install": {"darwin": "pip install sslyze", "linux": "pip install sslyze", "win32": "pip install sslyze"},
        "verify": "sslyze --version", "website": "https://github.com/nabla-c0d3/sslyze",
    },
    "feroxbuster": {
        "name": "Feroxbuster", "desc": "Rust快速内容发现工具", "category": "Web扫描",
        "install": {"darwin": "brew install feroxbuster", "linux": "从 https://github.com/epi052/feroxbuster/releases 下载", "win32": "从 https://github.com/epi052/feroxbuster/releases 下载"},
        "verify": "feroxbuster --version", "website": "https://github.com/epi052/feroxbuster",
    },
    "dirb": {
        "name": "Dirb", "desc": "Web内容暴力扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install dirb", "linux": "sudo apt-get install -y dirb", "win32": "从 https://sourceforge.net/projects/dirb 下载"},
        "verify": "dirb", "website": "https://sourceforge.net/projects/dirb",
    },
    "wfuzz": {
        "name": "Wfuzz", "desc": "Web应用暴力破解工具", "category": "Web扫描",
        "install": {"darwin": "pip install wfuzz", "linux": "sudo apt-get install -y wfuzz || pip install wfuzz", "win32": "pip install wfuzz"},
        "verify": "wfuzz --version", "website": "https://github.com/xmendez/wfuzz",
    },
    "katana": {
        "name": "Katana", "desc": "下一代爬虫和蜘蛛框架", "category": "Web扫描",
        "install": {"darwin": "brew install katana", "linux": "go install github.com/projectdiscovery/katana/cmd/katana@latest", "win32": "从 https://github.com/projectdiscovery/katana/releases 下载"},
        "verify": "katana -version", "website": "https://github.com/projectdiscovery/katana",
    },
    "httpx": {
        "name": "HTTPX", "desc": "快速HTTP探测工具包", "category": "Web扫描",
        "install": {"darwin": "brew install httpx", "linux": "go install github.com/projectdiscovery/httpx/cmd/httpx@latest", "win32": "从 https://github.com/projectdiscovery/httpx/releases 下载"},
        "verify": "httpx -version", "website": "https://github.com/projectdiscovery/httpx",
    },
    "hakrawler": {
        "name": "Hakrawler", "desc": "快速Web爬虫", "category": "Web扫描",
        "install": {"darwin": "从 https://github.com/hakluke/hakrawler/releases 下载", "linux": "go install github.com/hakluke/hakrawler@latest", "win32": "从 https://github.com/hakluke/hakrawler/releases 下载"},
        "verify": "hakrawler -h", "website": "https://github.com/hakluke/hakrawler",
    },
    "gospider": {
        "name": "GoSpider", "desc": "Go语言Web爬虫", "category": "Web扫描",
        "install": {"darwin": "从 https://github.com/jaeles-project/gospider/releases 下载", "linux": "go install github.com/jaeles-project/gospider@latest", "win32": "从 https://github.com/jaeles-project/gospider/releases 下载"},
        "verify": "gospider --version", "website": "https://github.com/jaeles-project/gospider",
    },
    "dalfox": {
        "name": "Dalfox", "desc": "快速XSS参数分析和扫描器", "category": "Web扫描",
        "install": {"darwin": "brew install dalfox", "linux": "go install github.com/hahwul/dalfox/v2@latest", "win32": "从 https://github.com/hahwul/dalfox/releases 下载"},
        "verify": "dalfox version", "website": "https://dalfox.hahwul.com",
    },
    "kxss": {
        "name": "kxss", "desc": "XSS参数发现工具", "category": "Web扫描",
        "install": {"darwin": "不支持macOS", "linux": "go install github.com/Emoe/kxss@latest", "win32": "从 https://github.com/Emoe/kxss/releases 下载"},
        "verify": "kxss -h", "website": "https://github.com/Emoe/kxss",
    },
    "ncrack": {
        "name": "Ncrack", "desc": "网络认证破解工具", "category": "密码攻击",
        "install": {"darwin": "brew install ncrack", "linux": "sudo apt-get install -y ncrack", "win32": "从 https://nmap.org/ncrack 下载"},
        "verify": "ncrack --version", "website": "https://nmap.org/ncrack",
    },
    "crowbar": {
        "name": "Crowbar", "desc": "SSH/RDP/VNC密钥破解", "category": "密码攻击",
        "install": {"darwin": "不支持macOS", "linux": "sudo apt-get install -y crowbar", "win32": "不支持Windows"},
        "verify": "crowbar --help", "website": "https://github.com/galkan/crowbar",
    },
    "cewl": {
        "name": "CeWL", "desc": "自定义单词表生成器", "category": "密码攻击",
        "install": {"darwin": "brew install cewl", "linux": "sudo apt-get install -y cewl", "win32": "从 https://github.com/digininja/CeWL 下载"},
        "verify": "cewl --help", "website": "https://github.com/digininja/CeWL",
    },
    "crunch": {
        "name": "Crunch", "desc": "自定义字典生成器", "category": "密码攻击",
        "install": {"darwin": "brew install crunch", "linux": "sudo apt-get install -y crunch", "win32": "从 https://sourceforge.net/projects/crunch-wordlist 下载"},
        "verify": "crunch", "website": "https://sourceforge.net/projects/crunch-wordlist",
    },
    "cupp": {
        "name": "CUPP", "desc": "个人信息密码字典生成", "category": "密码攻击",
        "install": {"darwin": "git clone https://github.com/Mebus/cupp.git", "linux": "git clone https://github.com/Mebus/cupp.git", "win32": "从 https://github.com/Mebus/cupp 下载"},
        "verify": "python3 cupp.py -h", "website": "https://github.com/Mebus/cupp",
    },
    "patator": {
        "name": "Patator", "desc": "多用途暴力破解器", "category": "密码攻击",
        "install": {"darwin": "pip install patator", "linux": "sudo apt-get install -y patator || pip install patator", "win32": "pip install patator"},
        "verify": "patator --help", "website": "https://github.com/lanjelot/patator",
    },
}

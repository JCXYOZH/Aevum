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
    "httpx-toolkit": {
        "name": "HTTPX Toolkit", "desc": "多用途HTTP探测工具（ProjectDiscovery）", "category": "Web扫描",
        "install": {"darwin": "brew install httpx", "linux": "go install github.com/projectdiscovery/httpx/cmd/httpx@latest", "win32": "从 https://github.com/projectdiscovery/httpx/releases 下载"},
        "verify": "httpx -version", "website": "https://github.com/projectdiscovery/httpx",
    },
    "waybackurls": {
        "name": "waybackurls", "desc": "从Wayback Machine获取已知URL", "category": "OSINT",
        "install": {"darwin": "go install github.com/tomnomnom/waybackurls@latest", "linux": "go install github.com/tomnomnom/waybackurls@latest", "win32": "从 https://github.com/tomnomnom/waybackurls/releases 下载"},
        "verify": "waybackurls -h", "website": "https://github.com/tomnomnom/waybackurls",
    },
    "gau": {
        "name": "gau", "desc": "获取已知URL（多搜索引擎）", "category": "OSINT",
        "install": {"darwin": "brew install gau", "linux": "go install github.com/lc/gau/v2/cmd/gau@latest", "win32": "从 https://github.com/lc/gau/releases 下载"},
        "verify": "gau --version", "website": "https://github.com/lc/gau",
    },
    "anew": {
        "name": "anew", "desc": "追加新行到文件（去重工具）", "category": "开发工具",
        "install": {"darwin": "go install github.com/tomnomnom/anew@latest", "linux": "go install github.com/tomnomnom/anew@latest", "win32": "从 https://github.com/tomnomnom/anew/releases 下载"},
        "verify": "anew -h", "website": "https://github.com/tomnomnom/anew",
    },
    "unfurl": {
        "name": "unfurl", "desc": "URL解析和提取工具", "category": "开发工具",
        "install": {"darwin": "go install github.com/tomnomnom/unfurl@latest", "linux": "go install github.com/tomnomnom/unfurl@latest", "win32": "从 https://github.com/tomnomnom/unfurl/releases 下载"},
        "verify": "unfurl -h", "website": "https://github.com/tomnomnom/unfurl",
    },
    "qsreplace": {
        "name": "qsreplace", "desc": "URL查询字符串替换工具", "category": "开发工具",
        "install": {"darwin": "go install github.com/tomnomnom/qsreplace@latest", "linux": "go install github.com/tomnomnom/qsreplace@latest", "win32": "从 https://github.com/tomnomnom/qsreplace/releases 下载"},
        "verify": "qsreplace -h", "website": "https://github.com/tomnomnom/qsreplace",
    },
    "gron": {
        "name": "gron", "desc": "JSON转可grep的离散赋值", "category": "开发工具",
        "install": {"darwin": "brew install gron", "linux": "go install github.com/tomnomnom/gron@latest", "win32": "从 https://github.com/tomnomnom/gron/releases 下载"},
        "verify": "gron --version", "website": "https://github.com/tomnomnom/gron",
    },
    "httpie": {
        "name": "HTTPie", "desc": "现代化HTTP命令行客户端", "category": "网络工具",
        "install": {"darwin": "brew install httpie", "linux": "pip install httpie", "win32": "pip install httpie"},
        "verify": "http --version", "website": "https://httpie.io",
    },
    "websocat": {
        "name": "websocat", "desc": "WebSocket命令行客户端（netcat for WebSocket）", "category": "网络工具",
        "install": {"darwin": "brew install websocat", "linux": "从 https://github.com/vi/websocat/releases 下载", "win32": "从 https://github.com/vi/websocat/releases 下载"},
        "verify": "websocat --version", "website": "https://github.com/vi/websocat",
    },
    "kerbrute": {
        "name": "Kerbrute", "desc": "Kerberos预认证暴力枚举", "category": "密码攻击",
        "install": {"darwin": "brew install kerbrute", "linux": "从 https://github.com/ropnop/kerbrute/releases 下载", "win32": "从 https://github.com/ropnop/kerbrute/releases 下载"},
        "verify": "kerbrute version", "website": "https://github.com/ropnop/kerbrute",
    },
    "certipy": {
        "name": "Certipy", "desc": "AD CS证书服务滥用工具", "category": "漏洞利用",
        "install": {"darwin": "pip install certipy-ad", "linux": "pip install certipy-ad", "win32": "pip install certipy-ad"},
        "verify": "certipy --version", "website": "https://github.com/ly4k/Certipy",
    },
    "bloodyad": {
        "name": "BloodyAD", "desc": "AD权限提升框架", "category": "漏洞利用",
        "install": {"darwin": "pip install bloodyAD", "linux": "pip install bloodyAD", "win32": "pip install bloodyAD"},
        "verify": "bloodyad --help", "website": "https://github.com/CravateRouge/bloodyAD",
    },
    "brutespray": {
        "name": "BruteSpray", "desc": "基于nmap输出自动暴力破解", "category": "密码攻击",
        "install": {"darwin": "brew install brutespray", "linux": "sudo apt-get install -y brutespray || git clone https://github.com/x90skysn3k/brutespray", "win32": "从 https://github.com/x90skysn3k/brutespray 下载"},
        "verify": "brutespray -h", "website": "https://github.com/x90skysn3k/brutespray",
    },
    "ligolo-ng": {
        "name": "Ligolo-ng", "desc": "反向隧道/代理工具（无TUN/TAP）", "category": "网络工具",
        "install": {"darwin": "从 https://github.com/nicocha30/ligolo-ng/releases 下载", "linux": "go install github.com/nicocha30/ligolo-ng/cmd/ligolo-ng@latest", "win32": "从 https://github.com/nicocha30/ligolo-ng/releases 下载"},
        "verify": "ligolo-ng -h", "website": "https://github.com/nicocha30/ligolo-ng",
    },
    "chisel": {
        "name": "Chisel", "desc": "快速TCP/UDP隧道（HTTP）", "category": "网络工具",
        "install": {"darwin": "brew install chisel", "linux": "go install github.com/jpillora/chisel@latest", "win32": "从 https://github.com/jpillora/chisel/releases 下载"},
        "verify": "chisel --version", "website": "https://github.com/jpillora/chisel",
    },
    "ssh-audit": {
        "name": "SSH Audit", "desc": "SSH服务器配置审计", "category": "扫描器",
        "install": {"darwin": "brew install ssh-audit", "linux": "pip install ssh-audit", "win32": "pip install ssh-audit"},
        "verify": "ssh-audit --version", "website": "https://github.com/jtesta/ssh-audit",
    },
    "gitleaks": {
        "name": "Gitleaks", "desc": "Git仓库密钥泄露扫描", "category": "取证",
        "install": {"darwin": "brew install gitleaks", "linux": "go install github.com/zricethezav/gitleaks/v8@latest", "win32": "从 https://github.com/zricethezav/gitleaks/releases 下载"},
        "verify": "gitleaks version", "website": "https://github.com/zricethezav/gitleaks",
    },
    "trufflehog": {
        "name": "TruffleHog", "desc": "密钥和凭据扫描器", "category": "取证",
        "install": {"darwin": "brew install trufflehog", "linux": "从 https://github.com/trufflesecurity/trufflehog/releases 下载", "win32": "从 https://github.com/trufflesecurity/trufflehog/releases 下载"},
        "verify": "trufflehog --version", "website": "https://github.com/trufflesecurity/trufflehog",
    },
    "trivy": {
        "name": "Trivy", "desc": "容器/代码/依赖漏洞扫描器", "category": "扫描器",
        "install": {"darwin": "brew install trivy", "linux": "sudo apt-get install -y trivy || curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh", "win32": "从 https://github.com/aquasecurity/trivy/releases 下载"},
        "verify": "trivy --version", "website": "https://github.com/aquasecurity/trivy",
    },
    "semgrep": {
        "name": "Semgrep", "desc": "静态代码安全分析", "category": "扫描器",
        "install": {"darwin": "brew install semgrep", "linux": "pip install semgrep", "win32": "pip install semgrep"},
        "verify": "semgrep --version", "website": "https://github.com/returntocorp/semgrep",
    },
    "kubectl": {
        "name": "kubectl", "desc": "Kubernetes命令行工具", "category": "云安全",
        "install": {"darwin": "brew install kubectl", "linux": "curl -LO https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl", "win32": "从 https://kubernetes.io/docs/tasks/tools/ 下载"},
        "verify": "kubectl version --client", "website": "https://kubernetes.io",
    },
    "helm": {
        "name": "Helm", "desc": "Kubernetes包管理器", "category": "云安全",
        "install": {"darwin": "brew install helm", "linux": "curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash", "win32": "从 https://github.com/helm/helm/releases 下载"},
        "verify": "helm version", "website": "https://helm.sh",
    },
    "bulk_extractor": {
        "name": "bulk_extractor", "desc": "数字取证信息提取工具", "category": "取证",
        "install": {"darwin": "brew install bulk_extractor", "linux": "sudo apt-get install -y bulk-extractor", "win32": "从 https://github.com/simsong/bulk_extractor 下载"},
        "verify": "bulk_extractor -h", "website": "https://github.com/simsong/bulk_extractor",
    },
    "binwalk": {
        "name": "Binwalk", "desc": "固件分析和提取工具", "category": "逆向工程",
        "install": {"darwin": "brew install binwalk", "linux": "sudo apt-get install -y binwalk || pip install binwalk", "win32": "pip install binwalk"},
        "verify": "binwalk --help", "website": "https://github.com/ReFirmLabs/binwalk",
    },
    "foremost": {
        "name": "Foremost", "desc": "文件雕刻/数据恢复工具", "category": "取证",
        "install": {"darwin": "brew install foremost", "linux": "sudo apt-get install -y foremost", "win32": "从 https://sourceforge.net/projects/foremost/ 下载"},
        "verify": "foremost -V", "website": "https://sourceforge.net/projects/foremost/",
    },
    "scalpel": {
        "name": "Scalpel", "desc": "文件雕刻工具（foremost增强版）", "category": "取证",
        "install": {"darwin": "brew install scalpel", "linux": "sudo apt-get install -y scalpel", "win32": "从 https://github.com/sleuthkit/scalpel 下载"},
        "verify": "scalpel -h", "website": "https://github.com/sleuthkit/scalpel",
    },
    "yara": {
        "name": "YARA", "desc": "恶意软件模式匹配引擎", "category": "逆向工程",
        "install": {"darwin": "brew install yara", "linux": "sudo apt-get install -y yara", "win32": "从 https://github.com/VirusTotal/yara/releases 下载"},
        "verify": "yara --version", "website": "https://github.com/VirusTotal/yara",
    },
    "rlwrap": {
        "name": "rlwrap", "desc": "命令行readline包装器", "category": "开发工具",
        "install": {"darwin": "brew install rlwrap", "linux": "sudo apt-get install -y rlwrap", "win32": "不适用"},
        "verify": "rlwrap --version", "website": "https://github.com/hanslub42/rlwrap",
    },
    "pwncat": {
        "name": "pwncat", "desc": "增强版反向Shell（带自动提权）", "category": "渗透框架",
        "install": {"darwin": "pip install pwncat-cs", "linux": "pip install pwncat-cs", "win32": "pip install pwncat-cs"},
        "verify": "pwncat --help", "website": "https://github.com/calebstewart/pwncat"},
    "sshpass": {
        "name": "sshpass", "desc": "SSH非交互式密码认证", "category": "网络工具",
        "install": {"darwin": "brew install sshpass", "linux": "sudo apt-get install -y sshpass", "win32": "从 https://sourceforge.net/projects/sshpass/ 下载"},
        "verify": "sshpass -V", "website": "https://sourceforge.net/projects/sshpass/"},
    "gdb": {
        "name": "GDB", "desc": "GNU调试器", "category": "逆向工程",
        "install": {"darwin": "brew install gdb", "linux": "sudo apt-get install -y gdb", "win32": "从 https://www.gnu.org/software/gdb/ 下载"},
        "verify": "gdb --version", "website": "https://www.gnu.org/software/gdb/"},
    "ltrace": {
        "name": "ltrace", "desc": "库调用跟踪工具", "category": "逆向工程",
        "install": {"darwin": "brew install ltrace", "linux": "sudo apt-get install -y ltrace", "win32": "不适用"},
        "verify": "ltrace --version", "website": "https://linux.die.net/man/1/ltrace"},
    "strace": {
        "name": "strace", "desc": "系统调用跟踪工具", "category": "逆向工程",
        "install": {"darwin": "brew install strace", "linux": "系统自带 || sudo apt-get install -y strace", "win32": "不适用"},
        "verify": "strace --version", "website": "https://strace.io/"},
    "lsof": {
        "name": "lsof", "desc": "列出打开的文件和网络连接", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "系统自带 || sudo apt-get install -y lsof", "win32": "从 https://github.com/lsof-org/lsof 下载"},
        "verify": "lsof -v", "website": "https://github.com/lsof-org/lsof"},
    "ss": {
        "name": "iproute2 ss", "desc": "套接字统计（netstat替代）", "category": "网络工具",
        "install": {"darwin": "不适用（使用netstat）", "linux": "系统自带 || sudo apt-get install -y iproute2", "win32": "不适用"},
        "verify": "ss -V", "website": "https://wiki.linuxfoundation.org/networking/iproute2"},
    "tcpreplay": {
        "name": "Tcpreplay", "desc": "PCAP网络流量重放", "category": "网络分析",
        "install": {"darwin": "brew install tcpreplay", "linux": "sudo apt-get install -y tcpreplay", "win32": "从 https://tcpreplay.appneta.com/ 下载"},
        "verify": "tcpreplay --version", "website": "https://tcpreplay.appneta.com/"},
    "sslsplit": {
        "name": "SSLSplit", "desc": "SSL/TLS中间人攻击工具", "category": "网络攻击",
        "install": {"darwin": "brew install sslsplit", "linux": "sudo apt-get install -y sslsplit", "win32": "从 https://github.com/droe/sslsplit 下载"},
        "verify": "sslsplit -V", "website": "https://github.com/droe/sslsplit"},
    "testssl.sh": {
        "name": "testssl.sh", "desc": "TLS/SSL配置扫描器", "category": "扫描器",
        "install": {"darwin": "brew install testssl", "linux": "git clone https://github.com/drwetter/testssl.sh.git", "win32": "从 https://github.com/drwetter/testssl.sh 下载"},
        "verify": "testssl.sh --version", "website": "https://github.com/drwetter/testssl.sh"},
    "arp": {
        "name": "ARP", "desc": "查看和控制系统ARP缓存", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "系统自带（net-tools）", "win32": "系统自带（arp命令）"},
        "verify": "arp -a 2>&1 || arp", "website": "",
    },
    "host": {
        "name": "host", "desc": "DNS查询工具", "category": "信息收集",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y bind9-host || dnsutils", "win32": "nslookup（系统自带）"},
        "verify": "host 2>&1 | head -1", "website": "",
    },
    "nslookup": {
        "name": "nslookup", "desc": "DNS查询工具（交互式）", "category": "信息收集",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y dnsutils", "win32": "系统自带"},
        "verify": "nslookup 2>&1 | head -1", "website": "",
    },
    "ping": {
        "name": "Ping", "desc": "ICMP连通性测试", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "系统自带（iputils-ping）", "win32": "系统自带"},
        "verify": "ping -V 2>&1 || ping", "website": "",
    },
    "netstat": {
        "name": "netstat", "desc": "网络连接/路由表/接口统计", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "系统自带（net-tools）", "win32": "系统自带"},
        "verify": "netstat 2>&1 | head -1", "website": "",
    },
    "ssh": {
        "name": "SSH Client", "desc": "SSH远程连接客户端", "category": "网络工具",
        "install": {"darwin": "系统自带", "linux": "系统自带（openssh-client）", "win32": "系统自带或安装OpenSSH"},
        "verify": "ssh -V", "website": "https://www.openssh.com",
    },
    "msfconsole": {
        "name": "MSFConsole", "desc": "Metasploit Framework控制台", "category": "渗透框架",
        "install": {"darwin": "brew install metasploit", "linux": "curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb | sh", "win32": "从 https://windows.metasploit.com 下载"},
        "verify": "msfconsole --version", "website": "https://www.metasploit.com",
    },
    "r2": {
        "name": "radare2 (r2)", "desc": "radare2逆向工程框架命令行", "category": "逆向工程",
        "install": {"darwin": "brew install radare2", "linux": "sudo apt-get install -y radare2 || git clone https://github.com/radareorg/radare2", "win32": "从 https://github.com/radareorg/radare2/releases 下载"},
        "verify": "r2 -v", "website": "https://rada.re",
    },
    "rabin2": {
        "name": "rabin2", "desc": "radare2二进制信息提取工具", "category": "逆向工程",
        "install": {"darwin": "brew install radare2", "linux": "sudo apt-get install -y radare2", "win32": "随radare2安装"},
        "verify": "rabin2 -v", "website": "https://rada.re",
    },
    "node": {
        "name": "Node.js", "desc": "JavaScript运行时", "category": "开发工具",
        "install": {"darwin": "brew install node", "linux": "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs", "win32": "从 nodejs.org 下载"},
        "verify": "node --version", "website": "https://nodejs.org",
    },
    "npm": {
        "name": "npm", "desc": "Node.js包管理器", "category": "开发工具",
        "install": {"darwin": "随node安装", "linux": "随nodejs安装", "win32": "随node安装"},
        "verify": "npm --version", "website": "https://www.npmjs.com",
    },
    "perl": {
        "name": "Perl", "desc": "Perl脚本运行时", "category": "开发工具",
        "install": {"darwin": "系统自带", "linux": "sudo apt-get install -y perl", "win32": "从 strawberryperl.com 下载"},
        "verify": "perl --version", "website": "https://www.perl.org",
    },
    "pip": {
        "name": "pip", "desc": "Python包管理器", "category": "开发工具",
        "install": {"darwin": "随python3安装", "linux": "sudo apt-get install -y python3-pip", "win32": "随Python安装"},
        "verify": "pip --version", "website": "https://pip.pypa.io",
    },
    "pip3": {
        "name": "pip3", "desc": "Python3包管理器", "category": "开发工具",
        "install": {"darwin": "随python3安装", "linux": "sudo apt-get install -y python3-pip", "win32": "随Python安装"},
        "verify": "pip3 --version", "website": "https://pip.pypa.io",
    },
    "gem": {
        "name": "RubyGems", "desc": "Ruby包管理器", "category": "开发工具",
        "install": {"darwin": "系统自带（随ruby）", "linux": "sudo apt-get install -y rubygems", "win32": "从 rubyinstaller.org 下载"},
        "verify": "gem --version", "website": "https://rubygems.org",
    },
}

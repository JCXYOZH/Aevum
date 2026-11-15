"""职责模块：constants。"""

from __future__ import annotations

import logging
import os
import sys

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30.0

MAX_OUTPUT_SIZE = 10 * 1024 * 1024

MAX_CACHE_ENTRIES = 500

CACHE_TTL = 300

WINDOWS_TOOL_PATHS = {
    "nmap": [r"C:\Program Files (x86)\Nmap\nmap.exe", r"C:\Program Files\Nmap\nmap.exe"],
    "python": [sys.executable],
    "python3": [sys.executable],
    "ping": [r"C:\Windows\System32\ping.exe"],
    "tracert": [r"C:\Windows\System32\tracert.exe"],
    "netstat": [r"C:\Windows\System32\netstat.exe"],
    "ipconfig": [r"C:\Windows\System32\ipconfig.exe"],
    "curl": [r"C:\Windows\System32\curl.exe"],
    "ssh": [r"C:\Windows\System32\OpenSSH\ssh.exe"],
    "scp": [r"C:\Windows\System32\OpenSSH\scp.exe"],
}

UNIX_TOOL_PATHS = {
    "nmap": ["/usr/bin/nmap", "/usr/local/bin/nmap", "/opt/homebrew/bin/nmap"],
    "python": [sys.executable, "/usr/bin/python3", "/usr/local/bin/python3"],
    "python3": [sys.executable, "/usr/bin/python3", "/usr/local/bin/python3"],
    "ping": ["/bin/ping", "/usr/sbin/ping", "/sbin/ping"],
    "traceroute": ["/usr/bin/traceroute", "/usr/sbin/traceroute", "/bin/traceroute"],
    "netstat": ["/bin/netstat", "/usr/bin/netstat"],
    "ifconfig": ["/sbin/ifconfig", "/usr/sbin/ifconfig"],
    "curl": ["/usr/bin/curl", "/usr/local/bin/curl", "/opt/homebrew/bin/curl"],
    "wget": ["/usr/bin/wget", "/usr/local/bin/wget"],
    "ssh": ["/usr/bin/ssh", "/usr/local/bin/ssh"],
    "scp": ["/usr/bin/scp", "/usr/local/bin/scp"],
    "masscan": ["/usr/bin/masscan", "/usr/local/bin/masscan"],
    "nikto": ["/usr/bin/nikto", "/usr/local/bin/nikto"],
    "sqlmap": ["/usr/bin/sqlmap", "/usr/local/bin/sqlmap"],
    "gobuster": ["/usr/bin/gobuster", "/usr/local/bin/gobuster", "/opt/homebrew/bin/gobuster"],
    "ffuf": ["/usr/bin/ffuf", "/usr/local/bin/ffuf", "/opt/homebrew/bin/ffuf"],
    "hydra": ["/usr/bin/hydra", "/usr/local/bin/hydra"],
    "john": ["/usr/sbin/john", "/usr/bin/john", "/usr/local/bin/john"],
    "dig": ["/usr/bin/dig", "/opt/homebrew/bin/dig"],
    "whois": ["/usr/bin/whois", "/usr/local/bin/whois", "/opt/homebrew/bin/whois"],
}

BLACKLIST_COMMANDS = {
    "rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:",
    "shutdown", "reboot", "halt", "poweroff",
    "format", "del /f /s /q",
}

DANGEROUS_PATTERNS = [
    r";\s*rm\s", r"\|\s*rm\s", r"&&\s*rm\s",
    r">\s*/dev/", r">\s*/etc/",
    r"chmod\s+777", r"chown\s+root",
]

WSL_DISTRO = "kali-linux"

WSL_ENABLED = True

WSL_CACHE = {}

PIP_TOOL_PATHS = [
    # Windows
    os.path.join(sys.prefix, "Scripts"),
    os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Python", "Scripts"),
    # Linux/macOS
    os.path.join(os.path.expanduser("~"), ".local", "bin"),
    "/usr/local/bin",
    "/usr/bin",
]

GO_TOOL_PATHS = [
    # Windows
    os.path.join(os.path.expanduser("~"), "go", "bin"),
    os.path.join(os.path.expanduser("~"), "scoop", "apps", "go", "current", "bin"),
    # Linux/macOS
    os.path.join(os.path.expanduser("~"), "go", "bin"),
    "/usr/local/go/bin",
    "/usr/lib/go/bin",
]

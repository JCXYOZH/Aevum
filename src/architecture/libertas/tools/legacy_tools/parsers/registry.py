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

from .parser_1 import *
from .parser_2 import *
from .parser_3 import *
from .parser_4 import *
from .parser_5 import *
from .parser_6 import *
from .parser_7 import *


PARSER_MAP = {
    "dns_lookup": native_dns_parser,
    "native_dns_lookup": native_dns_parser,
    "http_fingerprint": native_http_fingerprint_parser,
    "ssl_info": native_ssl_parser,
    "ssl_cert_info": native_ssl_parser,
    "port_scan": native_port_scan_parser,
    "tcp_port_scan": native_port_scan_parser,
    "whois": native_whois_parser,
    "nmap": nmap_text_parser,
    "nuclei": nuclei_jsonl_parser,
    "subfinder": subfinder_parser,
    "masscan": masscan_parser,
    "ffuf": ffuf_parser,
    "hydra": hydra_parser,
    "nikto": nikto_parser,
    "amass": amass_parser,
    "gobuster": gobuster_parser,
    "rustscan": rustscan_parser,
    "naabu": naabu_parser,
    "sqlmap": sqlmap_parser,
    "whatweb": whatweb_parser,
    "wpscan": wpscan_parser,
    "httpx": httpx_parser,
    "katana": katana_parser,
    "hakrawler": hakrawler_parser,
    "waybackurls": waybackurls_parser,
    "gau": gau_parser,
    "assetfinder": assetfinder_parser,
    "dirsearch": dirsearch_parser,
    "feroxbuster": feroxbuster_parser,
    "dalfox": dalfox_parser,
    "wafw00f": wafw00f_parser,
    "dig": dig_parser,
    "nslookup": nslookup_parser,
    "ping": ping_parser,
    "traceroute": traceroute_parser,
    "openssl": openssl_parser,
    "searchsploit": searchsploit_parser,
    "trivy": trivy_parser,
    "cve_search": cve_search_parser,
    "crt_sh": subfinder_parser,
    "wayback": waybackurls_parser,
}

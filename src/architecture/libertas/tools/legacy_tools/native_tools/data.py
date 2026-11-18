# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .args import *
from .core import *
from .creds import *
from .dns import *
from .dns_enum import *
from .dns_records import *
from .exploit_builders import *
from .exploit_helpers import *
from .http import *
from .http_checks import *
from .http_crawl import *
from .misc import *
from .scan import *
from .scan_advanced import *
from .security_payloads import *
from .web_vuln import *
from .web_vuln_checks import *

NATIVE_TOOLS = {
    "vuln_intel": {
        "fn": native_vuln_intel,
        "description": "按漏洞编号（CVE/GHSA/OSV）直接查询并返回该漏洞的完整情报，无需先同步；"
                       "也支持关键词/产品/严重程度检索与统计（标题、完整描述、CVSS 分数与向量、严重等级、"
                       "CWE、发布日期、参考链接、受影响产品、是否有利用/补丁）",
        "params": {"action": "动作(lookup/search/detail/save/stats/sources/sync，不传时给编号走lookup、否则search)",
                   "query": "编号或关键词：CVE-2021-44228 / GHSA-… / OSV-… / local_id / 标题",
                   "cve": "query 的别名：直接传 CVE 编号",
                   "vuln_id": "query 的别名：直接传漏洞编号",
                   "keyword": "关键词，空格分词为 AND",
                   "severity": "严重程度，逗号分隔多值(critical,high)",
                   "min_cvss": "CVSS 下限(0-10)",
                   "product": "受影响产品名",
                   "source": "漏洞源名称(NVD/CISA-KEV/OSV等)",
                   "since": "发布时间下限(YYYY-MM-DD 或时间戳)",
                   "sort": "排序(cvss/date/severity/relevance，默认cvss)",
                   "limit": "返回条数(默认20，上限200)",
                   "offset": "分页偏移",
                   "source_id": "sync 用：漏洞源 id",
                   "feed_id": "sync 用：漏洞源 id（兼容写法）",
                   "status": "save 用：保存后的状态(saved/reviewed/patched/ignored)；search 用：按状态过滤",
                   "notes": "save 用：给这条漏洞附一句备注"},
        "category": "漏洞情报",
    },
    "port_scan": {
        "fn": native_port_scan,
        "description": "原生TCP端口扫描（不依赖nmap）",
        "params": {"target": "目标IP/域名", "ports": "端口范围(默认1-1024)", "timeout": "单端口超时秒数",
                   "max_workers": "并发线程数", "overall_timeout": "总超时秒数(默认120)"},
        "category": "信息收集",
    },
    "dns_lookup": {
        "fn": native_dns_lookup,
        "description": "原生DNS查询（A/AAAA/MX/NS/TXT/ALL，ALL一次并行返回A+MX+NS+TXT）",
        "params": {"domain": "域名", "record_type": "记录类型(A/MX/NS/TXT/ALL，默认ALL)"},
        "category": "DNS工具",
    },
    "whois": {
        "fn": native_whois,
        "description": "原生WHOIS域名信息查询",
        "params": {"domain": "域名"},
        "category": "信息收集",
    },
    "http_fingerprint": {
        "fn": native_http_fingerprint,
        "description": "原生HTTP指纹识别（技术栈/标题/响应头）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "ssl_info": {
        "fn": native_ssl_info,
        "description": "原生SSL/TLS证书信息获取",
        "params": {"host": "主机名", "port": "端口(默认443)"},
        "category": "SSL/TLS",
    },
    "ping": {
        "fn": native_ping,
        "description": "原生Ping连通性测试（跨平台）",
        "params": {"target": "目标IP/域名", "count": "次数(默认4)"},
        "category": "网络诊断",
    },
    "subdomain_enum": {
        "fn": native_subdomain_enum,
        "description": "原子域名枚举（DNS解析常见子域名，支持SecLists字典）",
        "params": {"domain": "主域名", "wordlist_name": "字典名(subdomains/passwords等)",
                   "timeout": "单条超时秒数", "max_workers": "并发数", "overall_timeout": "总超时秒数(默认60)"},
        "category": "信息收集",
    },
    "traceroute": {
        "fn": native_traceroute,
        "description": "原生路由追踪（跨平台）",
        "params": {"target": "目标IP/域名", "max_hops": "最大跳数(默认20)"},
        "category": "网络诊断",
    },
    "dir_bruteforce": {
        "fn": native_dir_bruteforce,
        "description": "原生HTTP目录扫描（支持SecLists字典：directories_small/directories/directories_large）",
        "params": {"url": "目标URL", "wordlist_name": "字典名",
                   "timeout": "单请求超时秒数", "max_workers": "并发数", "overall_timeout": "总超时秒数(默认120)"},
        "category": "Web安全",
    },
    "banner_grab": {
        "fn": native_banner_grab,
        "description": "Banner抓取（连接端口读取服务标识，用于服务版本识别）",
        "params": {"target": "目标IP/域名", "port": "端口", "timeout": "超时秒数", "payload": "可选发送数据"},
        "category": "信息收集",
    },
    "http_headers": {
        "fn": native_http_headers,
        "description": "HTTP安全头检测（HSTS/CSP/X-Frame-Options等8项安全头评分）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "robots_scanner": {
        "fn": native_robots_scanner,
        "description": "robots.txt/sitemap.xml扫描（提取隐藏路径和敏感目录）",
        "params": {"url": "目标URL"},
        "category": "信息收集",
    },
    "cors_checker": {
        "fn": native_cors_checker,
        "description": "CORS跨域配置检测（检测错误配置导致的跨域数据泄露）",
        "params": {"url": "目标URL", "origin": "测试用Origin(默认evil.example.com)"},
        "category": "Web安全",
    },
    "cookie_analyzer": {
        "fn": native_cookie_analyzer,
        "description": "Cookie安全属性分析（Secure/HttpOnly/SameSite检测）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "jwt_decoder": {
        "fn": native_jwt_decoder,
        "description": "JWT Token解码（解码Header/Payload，检测alg=none和过期问题）",
        "params": {"token": "JWT Token字符串"},
        "category": "加密工具",
    },
    "hash_calculator": {
        "fn": native_hash_calculator,
        "description": "哈希计算（MD5/SHA1/SHA256等，支持文本和文件）",
        "params": {"text": "要计算哈希的文本", "file_path": "或文件路径", "algorithms": "算法(逗号分隔,默认md5,sha1,sha256)"},
        "category": "加密工具",
    },
    "ip_info": {
        "fn": native_ip_info,
        "description": "IP信息查询（地理位置/ISP/ASN/坐标，支持域名自动解析）",
        "params": {"target": "IP地址或域名"},
        "category": "信息收集",
    },
    "subnet_calculator": {
        "fn": native_subnet_calculator,
        "description": "子网计算器（网络地址/广播/掩码/可用主机数/IP范围）",
        "params": {"cidr": "CIDR表示法(如192.168.1.0/24)"},
        "category": "网络工具",
    },
    "http_methods": {
        "fn": native_http_methods,
        "description": "HTTP方法枚举（检测PUT/DELETE/TRACE等危险方法是否启用）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "backup_finder": {
        "fn": native_backup_finder,
        "description": "备份文件扫描（检测.bak/.old/.zip/.sql/.git/.env等30+种敏感文件）",
        "params": {"url": "目标URL", "timeout": "单请求超时", "max_workers": "并发数", "overall_timeout": "总超时秒数"},
        "category": "Web安全",
    },
    "email_harvester": {
        "fn": native_email_harvester,
        "description": "邮箱采集器（爬取网页提取邮箱地址，支持多页同域爬取）",
        "params": {"url": "起始URL", "max_pages": "最大爬取页数(默认5)"},
        "category": "信息收集",
    },
    "link_extractor": {
        "fn": native_link_extractor,
        "description": "链接提取器（提取页面所有内/外部链接和资源引用）",
        "params": {"url": "目标URL"},
        "category": "信息收集",
    },
    "password_strength": {
        "fn": native_password_strength,
        "description": "密码强度检测（长度/复杂度/常见密码/连续字符7项评分）",
        "params": {"password": "要检测的密码"},
        "category": "加密工具",
    },
    "encode_decode": {
        "fn": native_encode_decode,
        "description": "编码解码工具（URL/HTML/Base64/Hex/JSON编解码）",
        "params": {"text": "要处理的文本", "mode": "模式(url/html/base64/hex/json)", "action": "encode或decode"},
        "category": "编码工具",
    },
    "cert_transparency": {
        "fn": native_cert_transparency,
        "description": "证书透明度日志查询（通过crt.sh发现子域名，无需字典）",
        "params": {"domain": "主域名"},
        "category": "信息收集",
    },
    "open_redirect": {
        "fn": native_open_redirect,
        "description": "开放重定向检测（检测url/redirect/next等20个参数的重定向漏洞）",
        "params": {"url": "含参数的目标URL"},
        "category": "Web安全",
    },
    "host_discovery": {
        "fn": native_host_discovery,
        "description": "存活主机发现（TCP ping扫描IP范围，支持CIDR，并发50）",
        "params": {"target_range": "IP范围(如192.168.1.0/24)", "timeout": "单主机超时", "max_workers": "并发数", "overall_timeout": "总超时秒数"},
        "category": "网络诊断",
    },
    "directory_listing": {
        "fn": native_directory_listing,
        "description": "目录列表检测（检测/images/、/css/、/uploads/等10个路径是否开启目录浏览）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "tcp_ping": {
        "fn": native_tcp_ping,
        "description": "TCP Ping（连接指定端口测量延迟和丢包率）",
        "params": {"target": "目标IP/域名", "port": "端口(默认80)", "count": "次数(默认4)", "timeout": "超时秒数"},
        "category": "网络诊断",
    },
    "reverse_dns": {
        "fn": native_reverse_dns,
        "description": "反向DNS查询（IP反查主机名和别名）",
        "params": {"ip": "IP地址"},
        "category": "DNS工具",
    },
    "whois_ip": {
        "fn": native_whois_ip,
        "description": "IP WHOIS查询（查询IP的ASN/网络名称/所属机构/国家）",
        "params": {"ip": "IP地址"},
        "category": "信息收集",
    },
    "http_compare": {
        "fn": native_http_compare,
        "description": "HTTP/HTTPS对比（检测HTTP未跳转HTTPS、HSTS缺失等安全问题）",
        "params": {"url": "目标域名(不含协议)"},
        "category": "Web安全",
    },
    "udp_scan": {
        "fn": native_udp_scan,
        "description": "UDP端口扫描（DNS/SNMP/NTP等UDP服务发现）",
        "params": {"target": "目标IP", "ports": "端口列表", "timeout": "超时秒数", "max_workers": "并发数"},
        "category": "端口扫描",
    },
    "service_scan": {
        "fn": native_service_scan,
        "description": "服务版本扫描（常见端口+Banner抓取，一键识别27个常用服务）",
        "params": {"target": "目标IP", "ports": "端口列表", "timeout": "超时秒数", "max_workers": "并发数"},
        "category": "端口扫描",
    },
    "ssh_audit": {
        "fn": native_ssh_audit,
        "description": "SSH安全审计（版本检测、SSHv1/旧版本漏洞识别）",
        "params": {"host": "目标主机", "port": "端口(默认22)"},
        "category": "服务审计",
    },
    "ftp_anon": {
        "fn": native_ftp_anon,
        "description": "FTP匿名登录检测（检测是否允许anonymous访问并列出文件）",
        "params": {"host": "目标主机", "port": "端口(默认21)"},
        "category": "服务审计",
    },
    "redis_check": {
        "fn": native_redis_check,
        "description": "Redis未授权访问检测（PING/INFO/CONFIG GET，获取版本和配置）",
        "params": {"host": "目标主机", "port": "端口(默认6379)"},
        "category": "数据库安全",
    },
    "mongo_check": {
        "fn": native_mongo_check,
        "description": "MongoDB未授权访问检测（ismaster命令探测）",
        "params": {"host": "目标主机", "port": "端口(默认27017)"},
        "category": "数据库安全",
    },
    "mysql_check": {
        "fn": native_mysql_check,
        "description": "MySQL服务检测（握手包获取版本信息）",
        "params": {"host": "目标主机", "port": "端口(默认3306)"},
        "category": "数据库安全",
    },
    "elastic_check": {
        "fn": native_elastic_check,
        "description": "Elasticsearch未授权检测（版本/集群/索引列表）",
        "params": {"host": "目标主机", "port": "端口(默认9200)"},
        "category": "数据库安全",
    },
    "docker_check": {
        "fn": native_docker_check,
        "description": "Docker API未授权检测（版本/容器列表，2375端口）",
        "params": {"host": "目标主机", "port": "端口(默认2375)"},
        "category": "服务审计",
    },
    "memcached_check": {
        "fn": native_memcached_check,
        "description": "Memcached未授权检测（版本/统计信息/连接数）",
        "params": {"host": "目标主机", "port": "端口(默认11211)"},
        "category": "数据库安全",
    },
    "dns_zonetransfer": {
        "fn": native_dns_zonetransfer,
        "description": "DNS区域传送检测（AXFR，获取全部DNS记录）",
        "params": {"domain": "目标域名"},
        "category": "DNS工具",
    },
    "comment_scraper": {
        "fn": native_comment_scraper,
        "description": "HTML注释采集（提取TODO/FIXME/密码/密钥等开发者遗留注释）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "js_endpoint_finder": {
        "fn": native_js_endpoint_finder,
        "description": "JS端点提取（从HTML和JS文件中发现API接口路径）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "swagger_finder": {
        "fn": native_swagger_finder,
        "description": "API文档发现（Swagger/OpenAPI/GraphQL/GraphiQL等17个路径）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "graphql_check": {
        "fn": native_graphql_check,
        "description": "GraphQL内省检测（获取schema、类型、Query/Mutation列表）",
        "params": {"url": "GraphQL端点URL"},
        "category": "Web安全",
    },
    "crlf_injection": {
        "fn": native_crlf_injection,
        "description": "CRLF注入检测（HTTP响应拆分，Set-Cookie注入测试）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "host_header_injection": {
        "fn": native_host_header_injection,
        "description": "Host头注入检测（密码重置投毒/缓存投毒）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "csp_evaluator": {
        "fn": native_csp_evaluator,
        "description": "CSP安全评估（unsafe-inline/unsafe-eval/通配符等6项检测评分）",
        "params": {"url": "目标URL"},
        "category": "Web安全",
    },
    "ssl_vuln_check": {
        "fn": native_ssl_vuln_check,
        "description": "SSL/TLS漏洞检测（SSLv3/TLS1.0/1.1版本检测，POODLE/BEAST）",
        "params": {"host": "目标主机", "port": "端口(默认443)"},
        "category": "SSL/TLS",
    },
    "smb_enum": {
        "fn": native_smb_enum,
        "description": "SMB/NetBIOS枚举（NetBIOS名称、SMB1支持检测）",
        "params": {"host": "目标主机", "port": "端口(默认445)"},
        "category": "服务审计",
    },
    "snmp_check": {
        "fn": native_snmp_check,
        "description": "SNMP团体字检测（public/private等9个常见团体字爆破）",
        "params": {"host": "目标主机", "port": "端口(默认161)", "communities": "团体字列表(逗号分隔)"},
        "category": "服务审计",
    },
    "mac_lookup": {
        "fn": native_mac_lookup,
        "description": "MAC地址厂商查询（OUI本地数据库，识别Cisco/VMware/Apple等）",
        "params": {"mac": "MAC地址(如 00:50:56:C0:00:01)"},
        "category": "网络工具",
    },
    "uuid_generator": {
        "fn": native_uuid_generator,
        "description": "UUID/GUID生成器（v4随机/v1时间基，批量生成）",
        "params": {"count": "生成数量(默认5)", "version": "版本(1或4)"},
        "category": "编码工具",
    },
    "regex_tester": {
        "fn": native_regex_tester,
        "description": "正则表达式测试（匹配/分组/命名分组，支持i/m/s/x标志）",
        "params": {"pattern": "正则表达式", "text": "测试文本", "flags": "标志(i/m/s/x)"},
        "category": "编码工具",
    },
    "web_crawler": {
        "fn": native_web_crawler,
        "description": "网页爬虫（递归爬取，收集标题/表单/输入框/链接，支持深度控制）",
        "params": {"url": "起始URL", "max_pages": "最大页数(默认20)", "max_depth": "最大深度(默认2)", "same_domain": "仅同域(true/false)", "timeout": "单页超时秒数(默认10)", "overall_timeout": "整轮总超时秒数(默认60)"},
        "category": "信息收集",
    },
    "wappalyzer": {
        "fn": native_wappalyzer,
        "description": "技术栈指纹识别（CMS/框架/服务器/JS库/CDN/安全头，20+类技术识别）",
        "params": {"url": "目标URL", "timeout": "超时时间(默认8秒)"},
        "category": "信息收集",
    },
    "wayback_urls": {
        "fn": native_wayback_urls,
        "description": "Wayback Machine历史URL查询（CDX API，获取网站历史URL/状态码/内容类型）",
        "params": {"domain": "目标域名", "limit": "返回数量(默认100)", "timeout": "超时时间(默认15秒)"},
        "category": "信息收集",
    },
    "dns_dumpster": {
        "fn": native_dns_dumpster,
        "description": "DNS记录聚合查询（A/AAAA/MX/TXT/NS/子域名，证书透明度枚举）",
        "params": {"domain": "目标域名", "timeout": "超时时间(默认15秒)"},
        "category": "DNS工具",
    },
    "subdomain_takeover": {
        "fn": native_subdomain_takeover,
        "description": "子域名接管检测（CNAME分析+15种服务指纹匹配，识别可被接管的子域名）",
        "params": {"domain": "目标域名", "timeout": "超时时间(默认8秒)"},
        "category": "Web安全",
    },
    "error_extractor": {
        "fn": native_error_extractor,
        "description": "错误信息提取（16种错误触发Payload，提取SQL/PHP/Python/Java堆栈跟踪和敏感路径）",
        "params": {"url": "目标URL", "timeout": "超时时间(默认8秒)"},
        "category": "Web安全",
    },
    "reverse_shell": {
        "fn": native_reverse_shell,
        "description": "反向Shell生成器（Bash/Python/Perl/PHP/Ruby/NetCat/PowerShell等8种语言，15+Payload）",
        "params": {"ip": "攻击机IP", "port": "攻击机端口(默认4444)", "language": "语言(all/bash/python/php/nc/powershell/perl/ruby)"},
        "category": "利用工具",
    },
    "webshell_generator": {
        "fn": native_webshell_generator,
        "description": "WebShell生成器（PHP/ASP/ASPX/JSP，一句话木马+加密变形，15+模板）",
        "params": {"language": "语言(all/php/asp/aspx/jsp)", "password": "连接密码(默认cmd)"},
        "category": "利用工具",
    },
    "payload_obfuscator": {
        "fn": native_payload_obfuscator,
        "description": "Payload混淆器（Base64/Hex/Unicode/ROT13/URL/字符拼接/反转/ASCII数组/双重编码，9种混淆方式）",
        "params": {"payload": "要混淆的Payload", "method": "混淆方式(all/base64/hex/unicode/rot13/url/char/reverse/ascii/double)"},
        "category": "利用工具",
    },
    "cors_exploit": {
        "fn": native_cors_exploit,
        "description": "CORS漏洞利用POC生成（自动窃取数据，含漏洞原理/检测/修复建议）",
        "params": {"target_url": "目标URL", "victim_cookie": "受害者Cookie(可选)"},
        "category": "漏洞利用",
    },
    "csrf_poc": {
        "fn": native_csrf_poc,
        "description": "CSRF漏洞利用POC生成（GET/POST方法，自动表单提交，含漏洞原理/检测/修复建议）",
        "params": {"target_url": "目标URL", "method": "请求方法(GET/POST)", "params": "请求参数(key=value&key2=value2)"},
        "category": "漏洞利用",
    },
}

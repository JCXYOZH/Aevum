"""职责模块：security_tools。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union

from .models import ToolDefinition
from .models import ToolParameter
from .registry import ToolRegistry

class NetworkSecurityTools:
    """网络安全工具统一封装 - 15+常用安全工具的标准封装"""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry
        self._register_all()

    def _register_all(self):
        """注册所有网络安全工具（按类别分组）"""
        self._register_scanners()
        self._register_recon_tools()
        self._register_network_tools()
        self._register_exploit_tools()

    def _register_scanners(self):
        """注册扫描器类工具（nmap/masscan/nikto/dirb）"""
        # 1. nmap_scan
        # 1. Nmap端口扫描
        self.registry.register(ToolDefinition(
            name="nmap_scan",
            description="Nmap端口扫描器，支持SYN扫描、UDP扫描、服务版本检测、操作系统检测、漏洞脚本扫描",
            category="scanner",
            risk_level="low_risk",
            parameters=[
                ToolParameter("target", "string", "目标IP或域名", required=True),
                ToolParameter("ports", "string", "端口范围，如 1-1000 或 80,443,8080", default="1-1000"),
                ToolParameter("scan_type", "string", "扫描类型",
                            enum=["syn", "udp", "connect", "version", "os", "vuln", "intense", "ping"],
                            default="syn"),
                ToolParameter("timing", "string", "扫描速度",
                            enum=["T0", "T1", "T2", "T3", "T4", "T5"], default="T3"),
                ToolParameter("output_xml", "boolean", "是否输出XML格式", default=True),
            ],
            returns="扫描结果，包含主机状态、开放端口、服务信息",
            examples=[{"input": {"target": "192.168.1.1", "ports": "1-1000", "scan_type": "syn"}}],
            tags=["端口扫描", "nmap", "信息收集"],
            timeout=120.0,
            command="nmap -{scan_type_flag} -p {ports} -{timing} {xml_flag} {target}",
            output_parser="nmap_xml",
        ))

        # 2. masscan_scan
        # 2. Masscan快速扫描
        self.registry.register(ToolDefinition(
            name="masscan_scan",
            description="Masscan高速端口扫描器，适用于大范围端口扫描",
            category="scanner",
            risk_level="low_risk",
            parameters=[
                ToolParameter("target", "string", "目标IP或CIDR范围", required=True),
                ToolParameter("ports", "string", "端口范围", default="1-65535"),
                ToolParameter("rate", "integer", "发包速率（包/秒）", default=1000, minimum=10, maximum=10000000),
            ],
            returns="快速扫描结果",
            tags=["端口扫描", "masscan", "高速扫描"],
            timeout=300.0,
            command="masscan {target} -p {ports} --rate={rate}",
            output_parser="text",
        ))

        # 3. nikto_scan
        # 3. Nikto Web扫描
        self.registry.register(ToolDefinition(
            name="nikto_scan",
            description="Nikto Web服务器漏洞扫描器，检测危险文件、过时服务器、版本漏洞等",
            category="scanner",
            risk_level="medium_risk",
            parameters=[
                ToolParameter("url", "string", "目标URL", required=True),
                ToolParameter("port", "integer", "端口", default=80),
                ToolParameter("ssl", "boolean", "是否使用SSL", default=False),
            ],
            returns="Web漏洞扫描结果",
            tags=["web扫描", "nikto", "漏洞检测"],
            timeout=300.0,
            command="nikto -h {url} -p {port} {ssl_flag}",
            output_parser="text",
        ))

        # 4. dirb_scan
        # 4. Dirb目录扫描
        self.registry.register(ToolDefinition(
            name="dirb_scan",
            description="Dirb目录爆破工具，发现Web服务器隐藏目录和文件",
            category="scanner",
            risk_level="medium_risk",
            parameters=[
                ToolParameter("url", "string", "目标URL", required=True),
                ToolParameter("wordlist", "string", "字典文件路径", default="/usr/share/dirb/wordlists/common.txt"),
                ToolParameter("extensions", "string", "文件扩展名，如 php,asp,aspx", default=""),
            ],
            returns="目录扫描结果",
            tags=["目录扫描", "dirb", "web扫描"],
            timeout=600.0,
            command="dirb {url} {wordlist} -X {extensions}",
            output_parser="text",
        ))

    def _register_recon_tools(self):
        """注册侦察类工具（whois/dns/http_headers/dig/subfinder）"""
        # 1. whois_lookup
        # 1. WHOIS查询
        self.registry.register(ToolDefinition(
            name="whois_lookup",
            description="WHOIS域名信息查询，获取域名注册商、注册日期、过期日期、DNS服务器等信息",
            category="recon",
            risk_level="read_only",
            parameters=[
                ToolParameter("domain", "string", "要查询的域名", required=True),
            ],
            returns="域名WHOIS信息",
            tags=["whois", "信息收集", "域名"],
            timeout=30.0,
            command="whois {domain}",
            output_parser="key_value",
        ))

        # 2. dns_lookup
        # 2. DNS查询
        self.registry.register(ToolDefinition(
            name="dns_lookup",
            description="DNS记录查询，支持A、AAAA、MX、NS、TXT、CNAME、SOA等记录类型",
            category="recon",
            risk_level="read_only",
            parameters=[
                ToolParameter("domain", "string", "要查询的域名", required=True),
                ToolParameter("record_type", "string", "记录类型",
                            enum=["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR", "ANY"],
                            default="A"),
                ToolParameter("dns_server", "string", "指定DNS服务器", default=""),
            ],
            returns="DNS查询结果",
            tags=["dns", "信息收集", "域名"],
            timeout=30.0,
            command="dig {record_type} {domain} {server}",
            output_parser="text",
        ))

        # 3. http_headers
        # 3. HTTP头获取
        self.registry.register(ToolDefinition(
            name="http_headers",
            description="获取HTTP响应头信息，检测安全头配置、服务器版本、Cookie属性等",
            category="recon",
            risk_level="read_only",
            parameters=[
                ToolParameter("url", "string", "目标URL", required=True),
                ToolParameter("method", "string", "HTTP方法", enum=["GET", "HEAD", "OPTIONS"], default="GET"),
                ToolParameter("follow_redirects", "boolean", "是否跟随重定向", default=True),
            ],
            returns="HTTP响应头信息",
            tags=["http", "信息收集", "安全头"],
            timeout=30.0,
            command="curl -sI -{method} {url} {redirect_flag}",
            output_parser="key_value",
        ))

        # 4. dig_query
        # 4. Dig DNS查询
        self.registry.register(ToolDefinition(
            name="dig_query",
            description="Dig DNS查询工具，详细的DNS记录查询",
            category="recon",
            risk_level="read_only",
            parameters=[
                ToolParameter("domain", "string", "域名", required=True),
                ToolParameter("record_type", "string", "记录类型", default="A"),
                ToolParameter("dns_server", "string", "DNS服务器", default=""),
            ],
            returns="DNS查询详细结果",
            tags=["dns", "dig", "信息收集"],
            timeout=30.0,
            command="dig {domain} {record_type} {dns_server}",
            output_parser="text",
        ))

        # 5. subfinder_enum
        # 5. Subfinder子域名枚举
        self.registry.register(ToolDefinition(
            name="subfinder_enum",
            description="Subfinder子域名枚举工具，通过被动数据源发现子域名",
            category="recon",
            risk_level="read_only",
            parameters=[
                ToolParameter("domain", "string", "目标域名", required=True),
                ToolParameter("silent", "boolean", "静默模式", default=True),
                ToolParameter("threads", "integer", "线程数", default=10),
            ],
            returns="子域名列表",
            tags=["子域名", "subfinder", "信息收集"],
            timeout=120.0,
            command="subfinder -d {domain} -t {threads} {silent_flag}",
            output_parser="text",
        ))

    def _register_network_tools(self):
        """注册网络类工具（ping/traceroute/curl/netstat）"""
        # 1. ping_host
        # 1. Ping检测
        self.registry.register(ToolDefinition(
            name="ping_host",
            description="Ping主机检测连通性和延迟",
            category="network",
            risk_level="read_only",
            parameters=[
                ToolParameter("target", "string", "目标IP或域名", required=True),
                ToolParameter("count", "integer", "ping次数", default=4, minimum=1, maximum=100),
                ToolParameter("timeout", "integer", "超时时间（秒）", default=2),
            ],
            returns="Ping结果，包含延迟和丢包率",
            tags=["ping", "网络", "连通性"],
            timeout=30.0,
            command="ping -c {count} -W {timeout} {target}",
            output_parser="text",
        ))

        # 2. traceroute
        # 2. Traceroute路由追踪
        self.registry.register(ToolDefinition(
            name="traceroute",
            description="Traceroute路由追踪，显示数据包到目标主机经过的路由节点",
            category="network",
            risk_level="read_only",
            parameters=[
                ToolParameter("target", "string", "目标IP或域名", required=True),
                ToolParameter("max_hops", "integer", "最大跳数", default=30, minimum=1, maximum=255),
            ],
            returns="路由追踪结果",
            tags=["traceroute", "网络", "路由"],
            timeout=120.0,
            command="traceroute -m {max_hops} {target}",
            output_parser="text",
        ))

        # 3. curl_request
        # 3. Curl HTTP请求
        self.registry.register(ToolDefinition(
            name="curl_request",
            description="Curl HTTP请求工具，支持各种HTTP方法和自定义头",
            category="network",
            risk_level="low_risk",
            parameters=[
                ToolParameter("url", "string", "目标URL", required=True),
                ToolParameter("method", "string", "HTTP方法",
                            enum=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"], default="GET"),
                ToolParameter("headers", "string", "自定义请求头，JSON格式", default=""),
                ToolParameter("data", "string", "请求体数据", default=""),
                ToolParameter("timeout", "integer", "超时时间（秒）", default=30),
            ],
            returns="HTTP响应内容",
            tags=["curl", "http", "网络"],
            timeout=60.0,
            command="curl -s -X {method} {headers_flag} {data_flag} --max-time {timeout} {url}",
            output_parser="text",
        ))

        # 4. netstat_connections
        # 4. Netstat网络连接
        self.registry.register(ToolDefinition(
            name="netstat_connections",
            description="查看网络连接和监听端口",
            category="network",
            risk_level="read_only",
            parameters=[
                ToolParameter("show_listening", "boolean", "只显示监听端口", default=True),
                ToolParameter("show_process", "boolean", "显示进程信息", default=True),
                ToolParameter("protocol", "string", "协议过滤", enum=["all", "tcp", "udp"], default="all"),
            ],
            returns="网络连接列表",
            tags=["netstat", "网络", "连接"],
            timeout=10.0,
            command="netstat -tulnp",
            output_parser="table",
        ))

    def _register_exploit_tools(self):
        """注册利用类工具（hydra/sqlmap）"""
        # 1. hydra_brute
        # 1. Hydra暴力破解
        self.registry.register(ToolDefinition(
            name="hydra_brute",
            description="Hydra网络登录暴力破解工具，支持SSH、FTP、HTTP、SMB等多种协议",
            category="exploit",
            risk_level="high_risk",
            parameters=[
                ToolParameter("target", "string", "目标IP", required=True),
                ToolParameter("service", "string", "服务类型",
                            enum=["ssh", "ftp", "http-get", "http-post-form", "smb", "rdp", "mysql", "vnc", "pop3", "imap"],
                            default="ssh"),
                ToolParameter("username", "string", "用户名或用户名字典", required=True),
                ToolParameter("password", "string", "密码或密码字典", default=""),
                ToolParameter("wordlist", "string", "密码字典路径", default=""),
                ToolParameter("threads", "integer", "线程数", default=4, minimum=1, maximum=64),
            ],
            returns="暴力破解结果",
            tags=["暴力破解", "hydra", "密码"],
            timeout=600.0,
            requires_confirmation=True,
            command="hydra -l {username} -P {wordlist} {target} {service} -t {threads}",
            output_parser="text",
        ))

        # 2. sqlmap_scan
        # 2. SQLMap SQL注入
        self.registry.register(ToolDefinition(
            name="sqlmap_scan",
            description="SQLMap自动化SQL注入检测和利用工具",
            category="exploit",
            risk_level="high_risk",
            parameters=[
                ToolParameter("url", "string", "目标URL", required=True),
                ToolParameter("data", "string", "POST数据", default=""),
                ToolParameter("level", "integer", "检测等级", default=1, minimum=1, maximum=5),
                ToolParameter("risk", "integer", "风险等级", default=1, minimum=1, maximum=3),
                ToolParameter("dbs", "boolean", "枚举数据库", default=False),
                ToolParameter("dump", "boolean", "导出数据", default=False),
            ],
            returns="SQL注入检测和利用结果",
            tags=["sql注入", "sqlmap", "漏洞利用"],
            timeout=600.0,
            requires_confirmation=True,
            command="sqlmap -u {url} --level={level} --risk={risk} {dbs_flag} {dump_flag} --batch",
            output_parser="text",
        ))

    def get_tool_names(self) -> List[str]:
        return [t.name for t in self.registry.list_tools()]

    def get_tools_by_category(self, category: str) -> List[ToolDefinition]:
        return self.registry.list_tools(category=category)

    def get_tools_by_risk(self, risk_level: str) -> List[ToolDefinition]:
        return self.registry.list_tools(risk_level=risk_level)

"""插件: 增强版IP信息查询
版本: 2.0.0
分类: 信息收集
描述: 查询IP地址的地理位置、ASN、组织、时区、开放端口等信息，支持ip-api.com和ipinfo.io
"""
import socket
import json
import urllib.request
import urllib.error


def register(registry):
    registry.register_tool(
        "ip_info",
        ip_info,
        params={"target": "IP地址或域名", "scan_ports": "是否扫描常见端口（默认true）"},
        category="信息收集",
        desc="增强版IP信息查询，地理位置/ASN/组织/时区/ISP/端口扫描"
    )


def _query_ip_api(ip):
    """通过ip-api.com查询IP信息"""
    try:
        url = f"http://ip-api.com/json/{ip}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,proxy,hosting,query"
        req = urllib.request.Request(url, headers={"User-Agent": "Libertas-IP-Scanner/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "success":
                return data
    except Exception:
        pass
    return None


def _query_ipinfo(ip):
    """通过ipinfo.io查询IP信息（备用）"""
    try:
        url = f"https://ipinfo.io/{ip}/json"
        req = urllib.request.Request(url, headers={"User-Agent": "Libertas-IP-Scanner/2.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        pass
    return None


def _scan_ports(ip, ports=None):
    """扫描常见端口"""
    if ports is None:
        ports = [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445,
                 993, 995, 1433, 1521, 1723, 3306, 3389, 5432, 5900, 5901,
                 6379, 8080, 8443, 8888, 9200, 11211, 27017, 50070]
    open_ports = []
    import concurrent.futures
    def check_port(port):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(1.5)
            result = s.connect_ex((ip, port))
            s.close()
            if result == 0:
                return port
        except Exception:
            pass
        return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(check_port, port) for port in ports]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            if result:
                open_ports.append(result)
    return sorted(open_ports)


def ip_info(target: str = "", scan_ports: bool = True) -> dict:
    """查询IP地址信息（增强版）"""
    if not target:
        return {"success": False, "error": "请输入IP地址或域名"}
    try:
        # 解析域名
        is_domain = False
        try:
            socket.inet_aton(target)
            ip = target
        except socket.error:
            try:
                ip = socket.gethostbyname(target)
                is_domain = True
            except socket.gaierror:
                return {"success": False, "error": f"无法解析域名: {target}"}

        # 反向解析
        try:
            hostname = socket.gethostbyaddr(ip)[0]
        except Exception:
            hostname = "未知"

        # 查询地理位置信息（优先ip-api.com，备用ipinfo.io）
        geo_info = _query_ip_api(ip)
        if not geo_info:
            geo_info = _query_ipinfo(ip)

        # 端口扫描
        open_ports = []
        if scan_ports:
            open_ports = _scan_ports(ip)

        # 构建结果
        result = {
            "输入": target,
            "是否域名": is_domain,
            "IP地址": ip,
            "主机名(反向解析)": hostname,
        }

        if geo_info:
            # ip-api.com格式
            if "country" in geo_info:
                result.update({
                    "国家": geo_info.get("country", "未知"),
                    "国家代码": geo_info.get("countryCode", ""),
                    "省份/州": geo_info.get("regionName", "未知"),
                    "城市": geo_info.get("city", "未知"),
                    "邮编": geo_info.get("zip", ""),
                    "纬度": geo_info.get("lat", ""),
                    "经度": geo_info.get("lon", ""),
                    "时区": geo_info.get("timezone", "未知"),
                    "ISP": geo_info.get("isp", "未知"),
                    "组织": geo_info.get("org", "未知"),
                    "ASN": geo_info.get("as", "未知"),
                    "AS名称": geo_info.get("asname", ""),
                    "是否代理": geo_info.get("proxy", False),
                    "是否托管": geo_info.get("hosting", False),
                })
            # ipinfo.io格式
            elif "loc" in geo_info:
                loc = geo_info.get("loc", "").split(",")
                result.update({
                    "国家": geo_info.get("country", "未知"),
                    "省份/州": geo_info.get("region", "未知"),
                    "城市": geo_info.get("city", "未知"),
                    "邮编": geo_info.get("postal", ""),
                    "纬度": loc[0] if len(loc) > 0 else "",
                    "经度": loc[1] if len(loc) > 1 else "",
                    "时区": geo_info.get("timezone", "未知"),
                    "ISP": geo_info.get("org", "未知"),
                    "ASN": geo_info.get("org", "未知"),
                })

        result["常见开放端口"] = open_ports
        result["开放端口数"] = len(open_ports)

        # 端口服务识别
        port_services = {
            21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
            80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 445: "SMB",
            3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 6379: "Redis",
            8080: "HTTP-Proxy", 8443: "HTTPS-Alt", 9200: "Elasticsearch",
            11211: "Memcached", 27017: "MongoDB",
        }
        result["端口服务"] = {str(p): port_services.get(p, "未知") for p in open_ports}

        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

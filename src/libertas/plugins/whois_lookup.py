"""插件: 增强版WHOIS查询
版本: 2.0.0
分类: 信息收集
描述: 查询域名注册信息、注册商、到期时间、DNSSEC、域名年龄等，支持whois命令和在线API
"""
import subprocess
import re
import socket
import time
from datetime import datetime
from ..utils.text_decode import decode_output


def register(registry):
    registry.register_tool(
        "whois_lookup",
        whois_lookup,
        params={"target": "域名"},
        category="信息收集",
        desc="增强版WHOIS查询，注册商/注册人/到期时间/DNSSEC/域名年龄/状态码分析"
    )


def _query_whois_command(domain):
    """通过系统whois命令查询"""
    try:
        r = subprocess.run(["whois", domain], capture_output=True, timeout=15)
        return decode_output(r.stdout)
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _query_whois_socket(domain):
    """通过WHOIS协议直接查询（备用方案）"""
    try:
        # 先查询whois.iana.org获取顶级域WHOIS服务器
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(10)
        s.connect(("whois.iana.org", 43))
        s.send((domain + "\r\n").encode())
        response = b""
        while True:
            data = s.recv(4096)
            if not data:
                break
            response += data
        s.close()
        iana_response = response.decode("utf-8", errors="replace")
        # 提取refer字段
        refer_match = re.search(r"refer:\s*(\S+)", iana_response, re.IGNORECASE)
        if not refer_match:
            return iana_response
        whois_server = refer_match.group(1).strip()
        # 查询具体WHOIS服务器
        s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s2.settimeout(10)
        s2.connect((whois_server, 43))
        s2.send((domain + "\r\n").encode())
        response2 = b""
        while True:
            data = s2.recv(4096)
            if not data:
                break
            response2 += data
        s2.close()
        return response2.decode("utf-8", errors="replace")
    except Exception:
        return None


def _parse_date(date_str):
    """解析日期字符串"""
    date_formats = [
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d-%b-%Y",
        "%d/%m/%Y",
    ]
    for fmt in date_formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    return None


def whois_lookup(target: str = "") -> dict:
    """WHOIS查询（增强版）"""
    if not target:
        return {"success": False, "error": "请输入域名"}

    # 去除协议和路径
    domain = target
    if "://" in domain:
        domain = domain.split("://")[1]
    domain = domain.split("/")[0].split(":")[0].strip().lower()

    # 查询WHOIS（优先系统命令，备用socket直接查询）
    output = _query_whois_command(domain)
    if not output:
        output = _query_whois_socket(domain)

    if not output:
        return {"success": False, "error": "无法查询WHOIS信息（系统未安装whois命令且网络查询失败）"}

    if "No match" in output or "NOT FOUND" in output.upper() or "No Data Found" in output:
        return {"success": False, "error": "未找到注册信息"}

    # 提取关键字段
    fields = {}
    patterns = {
        "注册商": r"(?:Registrar|Sponsoring Registrar):\s*(.+)",
        "注册商IANA ID": r"Registrar IANA ID:\s*(.+)",
        "注册商URL": r"Registrar URL:\s*(.+)",
        "注册日期": r"(?:Creation Date|Created|Registration Time|created):\s*(.+)",
        "到期日期": r"(?:Expir\w+ Date|Registry Expiry Date|Expiration Time|expires):\s*(.+)",
        "更新日期": r"(?:Updated Date|Last Updated|Updated|changed):\s*(.+)",
        "注册人姓名": r"(?:Registrant Name|person):\s*(.+)",
        "注册人组织": r"(?:Registrant Organization|org):\s*(.+)",
        "注册人邮箱": r"(?:Registrant Email|e-mail):\s*(.+)",
        "注册人电话": r"(?:Registrant Phone|phone):\s*(.+)",
        "注册人国家": r"(?:Registrant Country|country):\s*(.+)",
        "管理员姓名": r"Admin Name:\s*(.+)",
        "管理员邮箱": r"Admin Email:\s*(.+)",
        "技术联系人姓名": r"Tech Name:\s*(.+)",
        "技术联系人邮箱": r"Tech Email:\s*(.+)",
        "DNS服务器": r"(?:Name Server|nserver):\s*(.+)",
        "状态": r"(?:Domain Status|status):\s*(.+)",
        "DNSSEC": r"(?:DNSSEC|dnssec):\s*(.+)",
    }

    for label, pattern in patterns.items():
        matches = re.findall(pattern, output, re.IGNORECASE)
        if matches:
            cleaned = list({m.strip().rstrip(".") for m in matches if m.strip()})
            if cleaned:
                fields[label] = cleaned[:5]

    # 域名年龄计算
    domain_age_days = None
    domain_age_years = None
    creation_date_str = fields.get("注册日期", [""])[0] if fields.get("注册日期") else ""
    expiry_date_str = fields.get("到期日期", [""])[0] if fields.get("到期日期") else ""
    if creation_date_str:
        creation_date = _parse_date(creation_date_str)
        if creation_date:
            now = datetime.now()
            delta = now - creation_date
            domain_age_days = delta.days
            domain_age_years = round(delta.days / 365.25, 1)
            fields["域名年龄"] = f"{domain_age_days}天 ({domain_age_years}年)"

    # 到期剩余时间
    if expiry_date_str:
        expiry_date = _parse_date(expiry_date_str)
        if expiry_date:
            now = datetime.now()
            delta = expiry_date - now
            if delta.days > 0:
                fields["到期剩余"] = f"{delta.days}天"
                if delta.days < 30:
                    fields["到期警告"] = "域名即将到期（30天内）"
            else:
                fields["到期状态"] = "已过期"

    # 状态码分析
    statuses = fields.get("状态", [])
    status_analysis = []
    for status in statuses:
        status_lower = status.lower()
        if "clienttransferprohibited" in status_lower or "servertransferprohibited" in status_lower:
            status_analysis.append("注册商锁定（防止域名转移）")
        if "clientdeleteprohibited" in status_lower or "serverdeleteprohibited" in status_lower:
            status_analysis.append("删除锁定（防止域名删除）")
        if "clientupdateprohibited" in status_lower or "serverupdateprohibited" in status_lower:
            status_analysis.append("更新锁定（防止域名信息修改）")
        if "redemptionperiod" in status_lower:
            status_analysis.append("赎回期（域名已过期，可高价赎回）")
        if "pendingdelete" in status_lower:
            status_analysis.append("待删除（域名即将被释放）")
        if "ok" in status_lower and not status_analysis:
            status_analysis.append("正常状态")
    if status_analysis:
        fields["状态分析"] = list(set(status_analysis))

    # DNSSEC检测
    dnssec = fields.get("DNSSEC", [""])[0] if fields.get("DNSSEC") else ""
    if dnssec:
        if dnssec.lower() in ("signed", "active", "yes", "true"):
            fields["DNSSEC状态"] = "已启用（安全）"
        elif dnssec.lower() in ("unsigned", "inactive", "no", "false"):
            fields["DNSSEC状态"] = "未启用（存在DNS缓存投毒风险）"
        else:
            fields["DNSSEC状态"] = dnssec

    return {
        "success": True,
        "result": {
            "域名": domain,
            "信息": fields,
            "原始内容长度": len(output),
            "原始内容(前2000字符)": output[:2000],
        }
    }

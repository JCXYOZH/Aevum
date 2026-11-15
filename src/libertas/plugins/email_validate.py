"""插件: 增强版邮件地址验证
版本: 2.0.0
分类: 工具
描述: 验证邮件地址格式、MX记录、SMTP可达性，检测一次性邮箱、角色邮箱、免费邮箱
"""
import re
import socket
import smtplib
import subprocess
from ..utils.text_decode import decode_output


# 增强版邮箱正则（支持国际域名）
EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# 一次性邮箱域名（常见临时邮箱服务）
DISPOSABLE_DOMAINS = {
    "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
    "throwawaymail.com", "yopmail.com", "trashmail.com", "getnada.com",
    "mohmal.com", "temp-mail.org", "fakeinbox.com", "maildrop.cc",
    "dispostable.com", "mailnesia.com", "spam4.me", "grr.la",
    "mailcatch.com", "mailboxinator.com", "sogetthis.com", "spamgourmet.com",
    "mailnull.com", "pookmail.com", "spamhole.com", "dodgeit.com",
    "mailscrap.com", "mintemail.com", "filzmail.com", "soodonims.com",
}

# 免费邮箱域名
FREE_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
    "msn.com", "aol.com", "icloud.com", "me.com", "mac.com",
    "protonmail.com", "proton.me", "tutanota.com", "gmx.com", "gmx.net",
    "mail.com", "zoho.com", "yandex.com", "mail.ru", "bk.ru",
    "inbox.ru", "list.ru", "qq.com", "163.com", "126.com", "yeah.net",
    "sina.com", "sina.cn", "sohu.com", "tom.com", "21cn.com",
    "foxmail.com", "aliyun.com", "139.com", "189.cn", "wo.cn",
}

# 角色邮箱前缀（非个人邮箱）
ROLE_PREFIXES = {
    "admin", "administrator", "root", "postmaster", "abuse", "support",
    "help", "info", "contact", "sales", "marketing", "hr", "jobs",
    "career", "careers", "press", "media", "webmaster", "hostmaster",
    "noc", "security", "privacy", "legal", "finance", "accounting",
    "billing", "invoice", "payments", "orders", "order", "service",
    "services", "team", "staff", "employees", "management", "ceo",
    "cto", "cfo", "coo", "director", "manager", "office", "reception",
    "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon",
    "mailer", "daemon", "bounce", "bounces", "return", "returns",
    "undisclosed-recipients", "unknown", "guest", "test", "testing",
    "dev", "developer", "developers", "tech", "technical", "it",
    "system", "systems", "sysadmin", "sys-admin", "network", "net",
    "dns", "domain", "domains", "hosting", "host", "server", "servers",
    "database", "db", "data", "backup", "backups", "archive", "archives",
    "log", "logs", "monitor", "monitoring", "alert", "alerts", "report",
    "reports", "analytics", "stats", "statistics", "metrics", "tracking",
    "tracker", "pixel", "beacon", "cdn", "cache", "proxy", "proxies",
    "vpn", "gateway", "api", "apis", "rest", "graphql", "soap", "rpc",
    "webhook", "webhooks", "callback", "callbacks", "redirect", "redirects",
    "short", "shortener", "url", "urls", "link", "links", "download",
    "downloads", "upload", "uploads", "file", "files", "asset", "assets",
    "static", "media", "images", "image", "img", "video", "videos",
    "audio", "audios", "doc", "docs", "document", "documents", "pdf",
    "ebook", "ebooks", "book", "books", "course", "courses", "tutorial",
    "tutorials", "guide", "guides", "manual", "manuals", "faq", "faqs",
    "helpdesk", "ticket", "tickets", "issue", "issues", "bug", "bugs",
    "feature", "features", "request", "requests", "feedback", "survey",
    "surveys", "poll", "polls", "vote", "votes", "contest", "contests",
    "giveaway", "giveaways", "promo", "promos", "promotion", "promotions",
    "coupon", "coupons", "discount", "discounts", "deal", "deals", "offer",
    "offers", "sale", "sales", "shop", "store", "cart", "checkout",
    "payment", "payments", "wallet", "wallets", "bank", "banks", "credit",
    "loan", "loans", "invest", "investment", "investments", "trading",
    "trade", "trades", "stock", "stocks", "crypto", "bitcoin", "ethereum",
    "blockchain", "nft", "metaverse", "vr", "ar", "ai", "ml", "data-science",
}


def register(registry):
    registry.register_tool(
        "email_validate",
        email_validate,
        params={"email": "邮件地址", "deep": "是否深度验证MX(true/false)"},
        category="工具",
        desc="增强版邮箱验证，格式/MX/SMTP/一次性邮箱/角色邮箱/免费邮箱检测"
    )


def email_validate(email: str = "", deep: str = "false") -> dict:
    """验证邮件（增强版）"""
    if not email:
        return {"success": False, "error": "请输入邮件地址"}
    email = email.strip().lower()
    result = {
        "邮件": email,
        "格式有效": False,
        "MX记录": [],
        "SMTP可达": "未检测",
        "邮箱类型": "未知",
        "域名类型": "未知",
        "风险等级": "未知",
    }
    # 格式检查
    if not EMAIL_RE.match(email):
        result["错误"] = "邮件格式不正确"
        result["风险等级"] = "高风险（格式无效）"
        return {"success": True, "result": result}
    result["格式有效"] = True

    # 解析邮箱
    local_part, domain = email.split("@", 1)
    result["本地部分"] = local_part
    result["域名"] = domain

    # 检测一次性邮箱
    is_disposable = domain in DISPOSABLE_DOMAINS
    result["一次性邮箱"] = is_disposable
    if is_disposable:
        result["邮箱类型"] = "一次性/临时邮箱"
        result["风险等级"] = "高风险（一次性邮箱）"

    # 检测免费邮箱
    is_free = domain in FREE_EMAIL_DOMAINS
    result["免费邮箱"] = is_free
    if is_free and not is_disposable:
        result["邮箱类型"] = "免费邮箱"
        if result["风险等级"] == "未知":
            result["风险等级"] = "低风险（免费邮箱）"

    # 检测角色邮箱
    is_role = local_part in ROLE_PREFIXES
    result["角色邮箱"] = is_role
    if is_role:
        result["邮箱类型"] = "角色/功能邮箱"
        if result["风险等级"] == "未知":
            result["风险等级"] = "中风险（角色邮箱）"

    # 企业邮箱判断
    if not is_disposable and not is_free and not is_role:
        result["邮箱类型"] = "企业/个人邮箱"
        result["风险等级"] = "安全"

    # MX记录查询
    try:
        r = subprocess.run(["nslookup", "-type=mx", domain],
                           capture_output=True, timeout=8)
        mx_lines = [l.strip() for l in decode_output(r.stdout).split("\n")
                    if "mail exchanger" in l.lower()]
        mx_records = []
        for l in mx_lines:
            if "exchange = " in l.lower():
                mx_records.append(l.split("exchange = ")[-1].strip().rstrip("."))
            else:
                parts = l.split()
                if parts:
                    mx_records.append(parts[-1].rstrip("."))
        result["MX记录"] = list(set(mx_records))
        result["MX记录数"] = len(result["MX记录"])
        if not result["MX记录"]:
            result["MX记录"] = []
            result["MX记录数"] = 0
            if result["风险等级"] in ("安全", "未知"):
                result["风险等级"] = "中风险（无MX记录）"
    except Exception as e:
        result["MX查询错误"] = str(e)

    # 深度验证SMTP
    if str(deep).lower() in ("true", "1", "yes") and result["MX记录"]:
        for mx in result["MX记录"][:3]:
            try:
                server = smtplib.SMTP(mx, 25, timeout=8)
                server.ehlo("libertas.local")
                server.mail("verify@libertas.local")
                code, msg = server.rcpt(email)
                server.quit()
                if code == 250:
                    result["SMTP可达"] = "✅ 邮箱存在"
                    result["SMTP状态码"] = code
                elif code == 251:
                    result["SMTP可达"] = "⚠️ 邮箱将被转发"
                    result["SMTP状态码"] = code
                elif code == 550:
                    result["SMTP可达"] = "❌ 邮箱不存在"
                    result["SMTP状态码"] = code
                    if result["风险等级"] in ("安全", "未知"):
                        result["风险等级"] = "高风险（邮箱不存在）"
                else:
                    result["SMTP可达"] = f"⚠️ 状态码 {code}: {msg.decode(errors='replace')[:100]}"
                    result["SMTP状态码"] = code
                break
            except Exception as e:
                result["SMTP可达"] = f"❌ 连接失败: {str(e)[:80]}"
    return {"success": True, "result": result}

"""插件: 增强版SSL证书检查
版本: 2.0.0
分类: 信息收集
描述: 检查目标网站SSL证书的详细信息，包括证书链、弱密码套件、密钥算法、有效期等
"""
import ssl
import socket
import datetime


def register(registry):
    registry.register_tool(
        "ssl_cert_check",
        ssl_cert_check,
        params={"target": "域名", "port": "端口（默认443）"},
        category="信息收集",
        desc="增强版SSL证书检查，支持证书链、弱密码套件、密钥算法检测"
    )


def ssl_cert_check(target: str = "", port: int = 443) -> dict:
    """检查SSL证书（增强版）"""
    if not target:
        return {"success": False, "error": "请输入域名"}
    try:
        port = int(port) if port else 443
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((target, port), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=target) as ssock:
                cert = ssock.getpeercert()
                cert_binary = ssock.getpeercert(binary_form=True)
                cipher = ssock.cipher()
                version = ssock.version()
                # 获取证书链
                try:
                    chain = ssock.get_unverified_chain()
                    chain_info = []
                    if chain:
                        for i, c in enumerate(chain):
                            c_dict = dict(x[0] for x in c.get("subject", []))
                            i_dict = dict(x[0] for x in c.get("issuer", []))
                            chain_info.append({
                                "位置": i,
                                "主体": c_dict.get("commonName", str(c_dict)),
                                "颁发者": i_dict.get("organizationName", i_dict.get("commonName", str(i_dict))),
                                "有效期至": c.get("notAfter", ""),
                            })
                except Exception:
                    chain_info = []

        if not cert:
            return {"success": False, "error": "无法获取证书信息"}

        # 解析证书
        subject = dict(x[0] for x in cert.get("subject", []))
        issuer = dict(x[0] for x in cert.get("issuer", []))
        not_before = cert.get("notBefore", "")
        not_after = cert.get("notAfter", "")

        # 计算天数
        days_left = None
        if not_after:
            expiry = datetime.datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
            days_left = (expiry - datetime.datetime.utcnow()).days

        # SAN扩展
        sans = []
        san_ips = []
        for field in cert.get("subjectAltName", []):
            if field[0] == "DNS":
                sans.append(field[1])
            elif field[0] == "IP Address":
                san_ips.append(field[1])

        # 密钥算法检测（从证书二进制OID检测）
        key_algorithm = "未知"
        try:
            if cert_binary:
                cert_hex = cert_binary.hex()
                if "2a864886f70d010101" in cert_hex:
                    key_algorithm = "RSA"
                elif "2a8648ce3d0201" in cert_hex:
                    key_algorithm = "ECDSA"
                elif "2a8648ce3d030107" in cert_hex:
                    key_algorithm = "ECDSA (P-256)"
        except Exception:
            pass

        # 弱密码套件检测
        weak_ciphers = ["RC4", "DES", "3DES", "MD5", "NULL", "EXPORT", "anon", "CBC"]
        cipher_name = cipher[0] if cipher else ""
        is_weak_cipher = any(w in cipher_name.upper() for w in weak_ciphers)

        # 协议版本安全检查
        protocol_issues = []
        if version in ("SSLv3", "TLSv1", "TLSv1.1"):
            protocol_issues.append(f"使用过时协议: {version}")

        # 证书状态
        if days_left is None:
            cert_status = "未知"
        elif days_left < 0:
            cert_status = "已过期"
        elif days_left <= 7:
            cert_status = "即将过期(7天内)"
        elif days_left <= 30:
            cert_status = "即将过期(30天内)"
        else:
            cert_status = "有效"

        # 安全问题汇总
        security_issues = []
        if is_weak_cipher:
            security_issues.append(f"使用弱密码套件: {cipher_name}")
        security_issues.extend(protocol_issues)
        if days_left is not None and days_left < 0:
            security_issues.append(f"证书已过期({abs(days_left)}天)")
        elif days_left is not None and days_left <= 30:
            security_issues.append(f"证书即将过期(剩余{days_left}天)")

        return {
            "success": True,
            "result": {
                "目标": f"{target}:{port}",
                "协议版本": version,
                "密码套件": cipher_name,
                "密码套件强度": "弱" if is_weak_cipher else "安全",
                "主体CN": subject.get("commonName", "未知"),
                "组织": subject.get("organizationName", "未知"),
                "颁发者": issuer.get("commonName", "未知"),
                "颁发者组织": issuer.get("organizationName", "未知"),
                "有效期自": not_before,
                "有效期至": not_after,
                "剩余天数": days_left,
                "证书状态": cert_status,
                "SAN域名数": len(sans),
                "SAN域名": sans[:30],
                "SAN IP": san_ips,
                "密钥算法": key_algorithm,
                "证书版本": cert.get("version", 0),
                "证书链长度": len(chain_info),
                "证书链": chain_info,
                "安全问题": security_issues,
            }
        }
    except ssl.SSLError as e:
        return {"success": False, "error": f"SSL错误: {e}"}
    except socket.timeout:
        return {"success": False, "error": "连接超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}

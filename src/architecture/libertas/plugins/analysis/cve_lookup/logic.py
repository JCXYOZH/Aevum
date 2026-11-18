"""查询CVE漏洞详情，支持从NVD API获取描述、CVSS评分、受影响产品、参考链接和弱点分类实现。"""

import json

import urllib.request

import urllib.error

def cve_lookup(cve_id: str = "") -> dict:
    """查询CVE详情"""
    if not cve_id:
        return {"success": False, "error": "请输入CVE编号"}
    cve_id = cve_id.strip().upper()
    if not cve_id.startswith("CVE-"):
        cve_id = "CVE-" + cve_id
    try:
        url = f"https://services.nvd.nist.gov/rest/json/cves/2.0?cveId={cve_id}"
        req = urllib.request.Request(url, headers={"User-Agent": "Libertas-Security/2.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        vulns = data.get("vulnerabilities", [])
        if not vulns:
            return {"success": True, "result": {"cve": cve_id, "message": "未找到该CVE"}}
        cve = vulns[0].get("cve", {})

        # 描述（英文+中文尝试）
        descriptions = cve.get("descriptions", [])
        desc_en = next((d["value"] for d in descriptions if d["lang"] == "en"), "无描述")
        desc_zh = next((d["value"] for d in descriptions if d["lang"] == "zh"), "")

        # CVSS评分（优先v3.1，然后v3.0，最后v2）
        metrics = cve.get("metrics", {})
        cvss = None
        cvss_version = ""
        for key, ver in [("cvssMetricV31", "3.1"), ("cvssMetricV30", "3.0"), ("cvssMetricV2", "2.0")]:
            if key in metrics and metrics[key]:
                cvss = metrics[key][0].get("cvssData", {})
                cvss_version = ver
                break

        # CWE弱点分类
        weaknesses = cve.get("weaknesses", [])
        cwe_list = []
        for w in weaknesses:
            desc = w.get("description", [])
            for d in desc:
                if d.get("value", "").startswith("CWE-"):
                    cwe_list.append(d["value"])
        cwe_list = list(set(cwe_list))

        # 受影响产品（CPE）
        configurations = cve.get("configurations", [])
        affected_products = []
        for config in configurations:
            nodes = config.get("nodes", [])
            for node in nodes:
                cpe_match = node.get("cpeMatch", [])
                for cm in cpe_match:
                    if cm.get("vulnerable", False):
                        criteria = cm.get("criteria", "")
                        parts = criteria.split(":")
                        if len(parts) >= 5:
                            vendor = parts[3]
                            product = parts[4]
                            version = cm.get("versionStartIncluding", "") or cm.get("versionEndExcluding", "") or "*"
                            affected_products.append({
                                "vendor": vendor,
                                "product": product,
                                "version": version,
                                "criteria": criteria,
                            })
        # 去重
        seen = set()
        unique_products = []
        for p in affected_products:
            key = f"{p['vendor']}:{p['product']}"
            if key not in seen:
                seen.add(key)
                unique_products.append(p)
        affected_products = unique_products[:20]

        # 参考链接
        refs = []
        for r in cve.get("references", [])[:15]:
            refs.append({
                "url": r.get("url", ""),
                "source": r.get("source", ""),
                "tags": r.get("tags", []),
            })

        # 漏洞状态
        vuln_status = cve.get("vulnStatus", "未知")
        published = cve.get("published", "")
        last_modified = cve.get("lastModified", "")

        # 严重度评级
        base_score = cvss.get("baseScore") if cvss else None
        if base_score is not None:
            if base_score >= 9.0:
                severity = "严重 (Critical)"
            elif base_score >= 7.0:
                severity = "高危 (High)"
            elif base_score >= 4.0:
                severity = "中危 (Medium)"
            else:
                severity = "低危 (Low)"
        else:
            severity = "未知"

        # 攻击向量等详细信息
        attack_vector = cvss.get("attackVector", "") if cvss else ""
        attack_complexity = cvss.get("attackComplexity", "") if cvss else ""
        privileges_required = cvss.get("privilegesRequired", "") if cvss else ""
        user_interaction = cvss.get("userInteraction", "") if cvss else ""
        scope = cvss.get("scope", "") if cvss else ""
        confidentiality_impact = cvss.get("confidentialityImpact", "") if cvss else ""
        integrity_impact = cvss.get("integrityImpact", "") if cvss else ""
        availability_impact = cvss.get("availabilityImpact", "") if cvss else ""

        result = {
            "cve": cve_id,
            "状态": vuln_status,
            "发布时间": published,
            "最后修改": last_modified,
            "描述(英文)": desc_en,
            "描述(中文)": desc_zh or "暂无中文描述",
            "CVSS版本": cvss_version,
            "CVSS基础分": base_score,
            "严重度": severity,
            "攻击向量": attack_vector,
            "攻击复杂度": attack_complexity,
            "所需权限": privileges_required,
            "用户交互": user_interaction,
            "影响范围": scope,
            "机密性影响": confidentiality_impact,
            "完整性影响": integrity_impact,
            "可用性影响": availability_impact,
            "CWE分类": cwe_list,
            "受影响产品数": len(affected_products),
            "受影响产品": affected_products,
            "参考链接数": len(refs),
            "参考链接": refs,
        }

        return {"success": True, "result": result}
    except urllib.error.URLError as e:
        return {"success": False, "error": f"网络请求失败: {e}"}
    except json.JSONDecodeError:
        return {"success": False, "error": "API返回数据格式错误"}
    except Exception as e:
        return {"success": False, "error": str(e)}

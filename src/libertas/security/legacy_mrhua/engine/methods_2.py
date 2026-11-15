"""WAF/IDS/IPS 集中防护引擎 - 统一入口，整合指纹识别、载荷分析、沙箱测试、流量监控。

防护模式：
- off: 关闭
- detect: 仅检测记录（默认）
- alert: 检测+告警
- protect: 检测+告警+阻断（IPS模式）
"""

import time
import json
import threading
import logging
from typing import Dict, List, Optional, Any
from collections import deque

from libertas.security.legacy_mrhua.waf_fingerprint import detect_waf, is_blocked_by_waf
from libertas.security.legacy_mrhua.payload_analyzer import analyze_request, analyze_response, PAYLOAD_CATEGORIES
from libertas.security.legacy_mrhua.waf_sandbox import get_waf_sandbox
from libertas.security.legacy_mrhua.traffic_monitor import get_traffic_detector
from .constants import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403

class SecurityEnginePart2(object):
    def get_bypass_suggestions(self, host: str) -> List[str]:
        """基于WAF检测结果和载荷反馈，给出绕过建议。"""
        waf_info = self._target_waf_cache.get(host)
        if not waf_info:
            return ["未检测到WAF，无需绕过"]

        waf_name = waf_info["wafs"][0]["name"] if waf_info["wafs"] else "未知WAF"
        suggestions = []

        blocked_payloads = [e for e in self._payload_feedback
                          if e.get("host") == host and e.get("blocked")]

        if "cloudflare" in waf_name.lower():
            suggestions.extend([
                "Cloudflare: 使用curl_cffi/tls-client模拟浏览器TLS指纹",
                "Cloudflare: cf_clearance绑定IP+UA+TLS指纹，需保持一致",
                "Cloudflare: 尝试使用Playwright带cookie请求",
                "Cloudflare: 降低请求频率，避免触发速率限制",
            ])
        elif any(w in waf_name.lower() for w in ("modsecurity", "owasp")):
            suggestions.extend([
                "ModSecurity/CRS: 尝试大小写混合(UnIoN SeLeCt)",
                "ModSecurity/CRS: 使用内联注释 /**/ 替代空格",
                "ModSecurity/CRS: 双重URL编码",
                "ModSecurity/CRS: HTTP参数污染(HPP)",
                "ModSecurity/CRS: Content-Type从application/x-www-form-urlencoded改为multipart/form-data",
            ])
        elif any(w in waf_name.lower() for w in ("aliyun", "tencent", "huawei", "安全狗", "宝塔", "雷池")):
            suggestions.extend([
                "国产WAF: 尝试分块传输(Transfer-Encoding: chunked)",
                "国产WAF: 使用Unicode/中文编码绕过",
                "国产WAF: 协议层面绕过(HTTP/2、异常Method)",
                "国产WAF: 静态资源路径绕过(/js/..;/admin)",
            ])
        else:
            suggestions.append(f"{waf_name}: 先在本地WAF沙箱测试payload变形")

        if blocked_payloads:
            suggestions.append(f"已有 {len(blocked_payloads)} 个payload被拦截，可在沙箱中测试变形")

        return suggestions
    def test_payload(self, payload: str, source: str = "url") -> Dict:
        """在本地WAF沙箱中测试payload。"""
        return self._sandbox.test(payload, source)
    def test_payload_batch(self, payloads: List[str], source: str = "url") -> List[Dict]:
        """批量测试payload。"""
        return self._sandbox.test_batch(payloads, source)
    def test_payload_with_transforms(self, payload: str, source: str = "url") -> Dict:
        """测试payload及其所有变形版本，返回完整结果。"""
        from libertas.security.legacy_mrhua.payload_library import apply_all_transforms
        original = self._sandbox.test(payload, source)
        transforms = apply_all_transforms(payload)
        transform_results = []
        for t in transforms:
            r = self._sandbox.test(t["transformed"], source)
            transform_results.append({
                "name": t["name"],
                "transformed": t["transformed"][:200],
                "blocked": r["blocked"],
                "hits": r["hits"],
                "severity": r["severity"],
            })
        bypassed = [t for t in transform_results if not t["blocked"]]
        return {
            "original": original,
            "transforms": transform_results,
            "bypass_count": len(bypassed),
            "bypassed": bypassed,
        }
    def get_target_posture(self, host: str = "") -> List[Dict]:
        """获取目标安全态势。"""
        results = []
        with self._lock:
            targets = [host] if host else list(self._target_waf_cache.keys())
        for h in targets:
            waf = self._target_waf_cache.get(h)
            feedback = [e for e in list(self._payload_feedback) if e.get("host") == h]
            blocked = [e for e in feedback if e.get("blocked")]
            passed = [e for e in feedback if not e.get("blocked")]
            traffic = self._traffic._host_stats.get(h, {})
            suggestions = self.get_bypass_suggestions(h)
            results.append({
                "host": h,
                "waf": waf,
                "waf_name": waf["wafs"][0]["name"] if waf and waf.get("wafs") else None,
                "total_payloads": len(feedback),
                "blocked_count": len(blocked),
                "passed_count": len(passed),
                "block_rate": round(len(blocked) / len(feedback) * 100, 1) if feedback else 0,
                "blocked_payloads": [e["payload"] for e in blocked[-10:]],
                "passed_payloads": [e["payload"] for e in passed[-10:]],
                "request_count": traffic.get("request_count", 0),
                "error_count": traffic.get("error_count", 0),
                "suggestions": suggestions,
                "last_seen": waf.get("last_seen", 0) if waf else traffic.get("last_seen", 0),
                "paths": waf.get("paths", []) if waf else [],
                "path_count": waf.get("path_count", 0) if waf else 0,
                "status_code": waf.get("status_code", 0) if waf else 0,
                "source": waf.get("source", "") if waf else "",
            })
        return results if host else results
    def get_traffic_log(self, host: str = "", limit: int = 100) -> List[Dict]:
        """获取流量日志。"""
        return self._traffic.get_recent_events(limit=limit, host=host)
    def get_timeline(self, limit: int = 100) -> List[Dict]:
        """获取安全事件时间线（告警+载荷反馈+流量异常合并排序）。"""
        events = []
        with self._lock:
            for a in list(self._alerts):
                events.append({
                    "type": "alert",
                    "severity": a.get("severity", "info"),
                    "message": a.get("message", ""),
                    "host": a.get("host", ""),
                    "timestamp": a.get("timestamp", 0),
                })
            for p in list(self._payload_feedback):
                events.append({
                    "type": "payload_blocked" if p.get("blocked") else "payload_passed",
                    "severity": "high" if p.get("blocked") else "low",
                    "message": f"{'被拦截' if p.get('blocked') else '放行'}: {p.get('payload', '')[:60]}",
                    "host": p.get("host", ""),
                    "waf": p.get("waf", ""),
                    "timestamp": p.get("timestamp", 0),
                })
        for a in self._traffic.get_anomalies():
            events.append({
                "type": "anomaly",
                "severity": a.get("severity", "medium"),
                "message": a.get("message", ""),
                "host": a.get("host", ""),
                "timestamp": time.time(),
            })
        events.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return events[:limit]
    def get_alerts(self, limit: int = 50, severity: str = "") -> List[Dict]:
        with self._lock:
            alerts = list(self._alerts)
        if severity:
            alerts = [a for a in alerts if a.get("severity") == severity]
        return alerts[-limit:]
    def get_stats(self) -> Dict:
        with self._lock:
            stats = dict(self._stats)
        stats["mode"] = self._mode
        stats["active_hosts"] = len(self._target_waf_cache)
        stats["blocklist_size"] = len(self._blocklist)
        stats["traffic_hosts"] = len(self._traffic.get_all_stats())
        return stats
    def get_traffic_summary(self) -> List[Dict]:
        return self._traffic.get_all_stats()
    def get_traffic_anomalies(self, host: str = "") -> List[Dict]:
        return self._traffic.get_anomalies(host)
    def is_blocked(self, host: str) -> bool:
        return host in self._blocklist
    def block_host(self, host: str, reason: str = "manual"):
        with self._lock:
            self._blocklist[host] = {"reason": reason, "time": time.time()}
    def unblock_host(self, host: str):
        with self._lock:
            self._blocklist.pop(host, None)
    def allowlist_host(self, host: str):
        with self._lock:
            self._allowlist.add(host)
    def unallowlist_host(self, host: str):
        with self._lock:
            self._allowlist.discard(host)
    def get_blocklist(self) -> Dict:
        with self._lock:
            return dict(self._blocklist)
    def get_allowlist(self) -> List[str]:
        with self._lock:
            return list(self._allowlist)
    def clear_alerts(self):
        with self._lock:
            self._alerts.clear()
    def get_categories(self) -> Dict:
        return {k: {"label": v["label"], "severity": v["severity"]}
                for k, v in PAYLOAD_CATEGORIES.items()}
    def list_sandbox_rules(self) -> List[Dict]:
        return self._sandbox.list_rules()

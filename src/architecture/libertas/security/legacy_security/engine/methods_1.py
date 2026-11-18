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

from libertas.security.legacy_security.waf_fingerprint import detect_waf, is_blocked_by_waf
from libertas.security.legacy_security.payload_analyzer import analyze_request, analyze_response, PAYLOAD_CATEGORIES
from libertas.security.legacy_security.waf_sandbox import get_waf_sandbox
from libertas.security.legacy_security.traffic_monitor import get_traffic_detector
from .constants import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403

class SecurityEnginePart1(object):
    def __init__(self):
        self._mode = self.MODE_DETECT
        self._lock = threading.Lock()
        self._alerts: deque = deque(maxlen=500)
        self._blocklist: Dict[str, Dict] = {}
        self._allowlist: set = set()
        self._target_waf_cache: Dict[str, Dict] = {}
        self._payload_feedback: deque = deque(maxlen=1000)
        self._sandbox = get_waf_sandbox()
        self._traffic = get_traffic_detector()
        self._callbacks: List[Any] = []
        self._stats = {
            "requests_inspected": 0,
            "alerts_generated": 0,
            "blocks": 0,
            "wafs_detected": 0,
            "payloads_flagged": 0,
        }
    @property
    def mode(self) -> str:
        return self._mode
    def set_mode(self, mode: str):
        if mode in (self.MODE_OFF, self.MODE_DETECT, self.MODE_ALERT, self.MODE_PROTECT):
            self._mode = mode
    def register_callback(self, cb):
        self._callbacks.append(cb)
    def _fire_alert(self, alert: Dict):
        with self._lock:
            self._alerts.append(alert)
            self._stats["alerts_generated"] += 1
        for cb in self._callbacks:
            try:
                cb(alert)
            except Exception:
                pass
    def inspect_request(
        self,
        url: str = "",
        method: str = "GET",
        headers: Optional[Dict] = None,
        body: str = "",
        cookies: Optional[Dict] = None,
        source: str = "proxy",
    ) -> Dict:
        """检查出站请求。

        Returns:
            {
                "allowed": bool,
                "risk_level": str,
                "findings": [...],
                "alerts": [...],
                "risk_score": int,
            }
        """
        if self._mode == self.MODE_OFF:
            return {"allowed": True, "risk_level": "off", "findings": [], "alerts": [], "risk_score": 0}

        with self._lock:
            self._stats["requests_inspected"] += 1

        host = ""
        try:
            from urllib.parse import urlparse
            host = urlparse(url).netloc
        except Exception:
            pass

        if host in self._allowlist:
            return {"allowed": True, "risk_level": "allowlisted", "findings": [], "alerts": [], "risk_score": 0}

        analysis = analyze_request(url, method, headers, body, cookies)
        findings = analysis["findings"]
        risk_level = analysis["risk_level"]
        risk_score = analysis["risk_score"]

        alerts = []
        allowed = True

        if findings:
            with self._lock:
                self._stats["payloads_flagged"] += 1

            for f in findings:
                alert = {
                    "type": "payload_detected",
                    "severity": f["severity"],
                    "category": f["category"],
                    "label": f["label"],
                    "message": f"{f['label']}特征 ({f['matched'][:60]})",
                    "source": source,
                    "url": url[:200],
                    "method": method,
                    "timestamp": time.time(),
                }
                alerts.append(alert)

                if self._mode in (self.MODE_ALERT, self.MODE_PROTECT):
                    self._fire_alert(alert)

            if self._mode == self.MODE_PROTECT and risk_level in ("critical", "high"):
                if host and host not in self._allowlist:
                    self._blocklist[host] = {"reason": risk_level, "time": time.time()}
                    allowed = False
                    with self._lock:
                        self._stats["blocks"] += 1
                    block_alert = {
                        "type": "blocked",
                        "severity": "critical",
                        "message": f"IPS阻断: {host} ({risk_level})",
                        "url": url[:200],
                        "timestamp": time.time(),
                    }
                    alerts.append(block_alert)
                    self._fire_alert(block_alert)

        return {
            "allowed": allowed,
            "risk_level": risk_level,
            "findings": findings,
            "alerts": alerts,
            "risk_score": risk_score,
        }
    def inspect_response(
        self,
        url: str = "",
        status_code: int = 0,
        headers: Optional[Dict] = None,
        body: str = "",
        response_time: float = 0.0,
        source: str = "proxy",
    ) -> Dict:
        """检查入站响应，检测WAF、拦截、信息泄露。"""
        if self._mode == self.MODE_OFF:
            return {"waf": [], "blocked": False, "anomalies": []}

        host = ""
        try:
            from urllib.parse import urlparse
            host = urlparse(url).netloc
        except Exception:
            pass

        resp_analysis = analyze_response(status_code, headers, body)
        wafs = resp_analysis["waf_detected"]
        blocked = resp_analysis["blocked"]
        blocked_by = resp_analysis["blocked_by"]

        # 提取路径信息
        url_path = ""
        try:
            from urllib.parse import urlparse as _up
            url_path = _up(url).path or "/"
        except Exception:
            url_path = "/"

        # 记录所有访问过的目标（即使没有WAF），确保目标态势能显示
        if host and host not in self._target_waf_cache:
            with self._lock:
                self._target_waf_cache[host] = {
                    "wafs": [],
                    "blocked": False,
                    "last_seen": time.time(),
                    "source": source,
                    "status_code": status_code,
                    "paths": [url_path] if url_path else [],
                    "path_count": 1,
                }
        elif host:
            # 更新已有目标的最后访问时间和路径
            with self._lock:
                if host in self._target_waf_cache:
                    self._target_waf_cache[host]["last_seen"] = time.time()
                    self._target_waf_cache[host]["status_code"] = status_code
                    # 记录路径（去重，最多保留50条）
                    if "paths" not in self._target_waf_cache[host]:
                        self._target_waf_cache[host]["paths"] = []
                    if url_path and url_path not in self._target_waf_cache[host]["paths"]:
                        self._target_waf_cache[host]["paths"].append(url_path)
                        if len(self._target_waf_cache[host]["paths"]) > 50:
                            self._target_waf_cache[host]["paths"] = self._target_waf_cache[host]["paths"][-50:]
                    self._target_waf_cache[host]["path_count"] = len(self._target_waf_cache[host].get("paths", []))

        if wafs:
            with self._lock:
                self._stats["wafs_detected"] += 1
            if host:
                self._target_waf_cache[host] = {
                    "wafs": wafs,
                    "blocked": blocked,
                    "last_seen": time.time(),
                }

            if self._mode in (self.MODE_ALERT, self.MODE_PROTECT):
                for waf in wafs:
                    self._fire_alert({
                        "type": "waf_detected",
                        "severity": "info" if not blocked else "medium",
                        "message": f"目标 {host} 检测到 {waf['name']} (置信度: {waf['confidence']})",
                        "waf": waf["name"],
                        "host": host,
                        "url": url[:200],
                        "timestamp": time.time(),
                    })

        if blocked and blocked_by:
            with self._lock:
                self._payload_feedback.append({
                    "url": url[:200],
                    "host": host,
                    "waf": blocked_by,
                    "status": status_code,
                    "timestamp": time.time(),
                    "bypassed": False,
                })
            if self._mode in (self.MODE_ALERT, self.MODE_PROTECT):
                self._fire_alert({
                    "type": "waf_blocked",
                    "severity": "high",
                    "message": f"请求被 {blocked_by} 拦截 (HTTP {status_code})",
                    "waf": blocked_by,
                    "host": host,
                    "url": url[:200],
                    "timestamp": time.time(),
                })

        if resp_analysis["error_disclosure"] and self._mode != self.MODE_OFF:
            for err in resp_analysis["error_disclosure"]:
                self._fire_alert({
                    "type": "info_disclosure",
                    "severity": "low",
                    "message": f"目标 {host} 泄露错误信息: {err}",
                    "host": host,
                    "url": url[:200],
                    "timestamp": time.time(),
                })

        traffic_result = self._traffic.record(
            url=url, status_code=status_code, response_time=response_time,
            content_length=len(body) if body else 0,
            blocked=blocked, waf_name=blocked_by or "",
            source=source,
        )

        return {
            "wafs": wafs,
            "blocked": blocked,
            "blocked_by": blocked_by,
            "error_disclosure": resp_analysis["error_disclosure"],
            "sensitive_info": resp_analysis["sensitive_info"],
            "anomalies": traffic_result.get("anomalies", []),
        }
    def detect_waf_visual(self, screenshot_bytes, host=""):
        """通过截图视觉分析检测WAF/挑战页（OCR文字特征）。"""
        try:
            from libertas.vision.engine import get_vision_engine
            ve = get_vision_engine()
            if not ve.enabled or not ve.ocr_enabled:
                return None
            analysis = ve.analyze_screenshot(screenshot_bytes, url=f"http://{host}")
            text = analysis.get("text", "").lower()
            page_type = analysis.get("page_type", "")
            visual_wafs = []
            if "checking your browser" in text or "just a moment" in text or "cf-chl" in text or "ray id" in text:
                visual_wafs.append({"name": "cloudflare", "confidence": "high", "source": "visual_ocr"})
            elif "正在验证" in text or "安全检查" in text or "浏览器验证" in text:
                visual_wafs.append({"name": "generic_waf_challenge", "confidence": "high", "source": "visual_ocr"})
            if "access denied" in text or "网站防火墙" in text or "waf" in text:
                visual_wafs.append({"name": "generic_waf", "confidence": "medium", "source": "visual_ocr"})
            if "请输入验证码" in text or "captcha" in text:
                visual_wafs.append({"name": "captcha_page", "confidence": "medium", "source": "visual_ocr"})
            if page_type and "WAF" in page_type:
                if not visual_wafs:
                    visual_wafs.append({"name": "generic_waf_challenge", "confidence": "medium", "source": "visual_classifier"})
            if visual_wafs and host:
                self._target_waf_cache[host] = {
                    "wafs": visual_wafs,
                    "blocked": True,
                    "last_seen": time.time(),
                    "source": "visual",
                }
            return visual_wafs
        except Exception:
            return None
    def _get_graph(self):
        """获取漏洞知识图谱单例（视觉/WAF 结果的入库入口）。

        图谱由 mrhua.core.vulnerability_graph 提供模块级单例；取不到时
        返回 None 并记录日志，调用方按「无图谱」降级处理，不抛异常。
        """
        try:
            from libertas.security.vulnerability_graph import get_vulnerability_graph
            return get_vulnerability_graph()
        except Exception as e:
            logger.warning("获取漏洞知识图谱失败，跳过入库: %s", e)
            return None
    def analyze_image_url(self, url, target_host=""):
        """分析图片URL（安全工具发现的图片），返回OCR文字和哈希。"""
        try:
            from libertas.vision.engine import get_vision_engine
            ve = get_vision_engine()
            if not ve.enabled:
                return None
            result = ve.analyze_image_url(url)
            if result and result.get("text") and target_host:
                # 视觉结果入库：失败不再静默吞掉——日志与返回值可读字段都要落地
                try:
                    graph = self._get_graph()
                    if not graph:
                        raise RuntimeError("漏洞知识图谱不可用")
                    graph.ingest_image_data(target_host, url, result)
                except Exception as e:
                    reason = f"图像分析结果入库失败：{e}"
                    logger.warning("%s（target=%s, url=%s）", reason, target_host, url)
                    if isinstance(result, dict):
                        result.setdefault("graph_ingest_error", reason)
            return result
        except Exception as e:
            logger.warning("图片分析失败（url=%s）: %s", url, e)
            return None
    def record_payload_result(self, url: str, payload: str, waf_name: str,
                              blocked: bool, status_code: int = 0):
        """记录攻击载荷的反馈结果（攻击载荷反馈环）。"""
        host = ""
        try:
            from urllib.parse import urlparse
            host = urlparse(url).netloc
        except Exception:
            pass

        entry = {
            "url": url[:200],
            "host": host,
            "payload": payload[:200],
            "waf": waf_name,
            "blocked": blocked,
            "status": status_code,
            "timestamp": time.time(),
        }
        with self._lock:
            self._payload_feedback.append(entry)

        if blocked and self._mode in (self.MODE_ALERT, self.MODE_PROTECT):
            self._fire_alert({
                "type": "payload_blocked",
                "severity": "medium",
                "message": f"载荷被 {waf_name} 拦截: {payload[:60]}",
                "host": host,
                "waf": waf_name,
                "timestamp": time.time(),
            })
    def get_target_waf(self, host: str) -> Optional[Dict]:
        return self._target_waf_cache.get(host)
    def get_payload_feedback(self, host: str = "", limit: int = 50) -> List[Dict]:
        with self._lock:
            entries = list(self._payload_feedback)
        if host:
            entries = [e for e in entries if e.get("host") == host]
        return entries[-limit:]

"""流量异常检测 - 被动监控HTTP流量，发现工具未覆盖的异常信号。"""

import time
import threading
from collections import defaultdict, deque
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse


class TrafficAnomalyDetector:
    """流量异常检测器：滑动窗口统计 + 异常评分。"""

    def __init__(self, window_seconds: int = 300, max_events: int = 10000):
        self._window = window_seconds
        self._events: deque = deque(maxlen=max_events)
        self._lock = threading.Lock()
        self._host_stats: Dict[str, Dict] = defaultdict(lambda: {
            "request_count": 0, "error_count": 0, "blocked_count": 0,
            "status_codes": defaultdict(int), "methods": defaultdict(int),
            "content_lengths": deque(maxlen=100), "response_times": deque(maxlen=100),
            "first_seen": 0, "last_seen": 0, "paths": set(),
            "user_agents": set(), "waf_detected": None,
        })

    def record(
        self,
        url: str,
        method: str = "GET",
        status_code: int = 0,
        response_time: float = 0.0,
        content_length: int = 0,
        user_agent: str = "",
        blocked: bool = False,
        waf_name: str = "",
        source: str = "proxy",
    ) -> Dict[str, Any]:
        """记录一次HTTP请求/响应，返回检测到的异常列表。"""
        now = time.time()
        parsed = urlparse(url)
        host = parsed.netloc or "unknown"
        path = parsed.path or "/"

        anomalies = []

        with self._lock:
            self._events.append({
                "url": url[:200], "host": host, "method": method,
                "status": status_code, "time": response_time,
                "size": content_length, "blocked": blocked,
                "waf": waf_name, "source": source, "timestamp": now,
            })

            stats = self._host_stats[host]
            stats["request_count"] += 1
            stats["status_codes"][str(status_code)] += 1
            stats["methods"][method] += 1
            if content_length:
                stats["content_lengths"].append(content_length)
            if response_time:
                stats["response_times"].append(response_time)
            if not stats["first_seen"]:
                stats["first_seen"] = now
            stats["last_seen"] = now
            stats["paths"].add(path[:100])
            if user_agent:
                stats["user_agents"].add(user_agent[:100])
            if blocked:
                stats["error_count"] += 1
                stats["blocked_count"] += 1
            elif status_code >= 400:
                stats["error_count"] += 1
            if waf_name and not stats["waf_detected"]:
                stats["waf_detected"] = waf_name

            self._prune_old(now)

            anomalies = self._detect_anomalies(host, stats, now)

        return {"host": host, "anomalies": anomalies, "stats": self._summary(host)}

    def _prune_old(self, now: float):
        cutoff = now - self._window
        while self._events and self._events[0]["timestamp"] < cutoff:
            self._events.popleft()

    def _detect_anomalies(self, host: str, stats: Dict, now: float) -> List[Dict]:
        anomalies = []
        elapsed = max(now - stats["first_seen"], 1)
        rate = stats["request_count"] / elapsed

        if rate > 20 and elapsed > 5:
            anomalies.append({
                "type": "high_request_rate",
                "severity": "medium",
                "message": f"{host} 请求频率异常: {rate:.1f} req/s",
                "value": round(rate, 2),
            })

        if stats["request_count"] >= 10:
            error_ratio = stats["error_count"] / stats["request_count"]
            if error_ratio > 0.5:
                anomalies.append({
                    "type": "high_error_rate",
                    "severity": "high",
                    "message": f"{host} 错误率异常: {error_ratio:.0%} ({stats['error_count']}/{stats['request_count']})",
                    "value": round(error_ratio, 2),
                })

        if stats["blocked_count"] >= 3:
            block_ratio = stats["blocked_count"] / stats["request_count"]
            if block_ratio > 0.3:
                anomalies.append({
                    "type": "waf_blocking",
                    "severity": "high",
                    "message": f"{host} WAF拦截率 {block_ratio:.0%}，可能触发了防护规则",
                    "value": round(block_ratio, 2),
                    "waf": stats.get("waf_detected", ""),
                })

        if len(stats["response_times"]) >= 5:
            times = list(stats["response_times"])
            avg_time = sum(times) / len(times)
            if avg_time > 10:
                anomalies.append({
                    "type": "slow_response",
                    "severity": "low",
                    "message": f"{host} 平均响应时间 {avg_time:.1f}s，可能有限速或WAF延迟",
                    "value": round(avg_time, 2),
                })
            if len(times) >= 10:
                recent = times[-5:]
                earlier = times[:-5]
                if earlier and sum(earlier) / len(earlier) > 0:
                    ratio = (sum(recent) / len(recent)) / (sum(earlier) / len(earlier))
                    if ratio > 3 and sum(recent) / len(recent) > 3:
                        anomalies.append({
                            "type": "response_time_spike",
                            "severity": "medium",
                            "message": f"{host} 响应时间突然增加 {ratio:.1f}x，可能触发限速",
                            "value": round(ratio, 2),
                        })

        if len(stats["content_lengths"]) >= 10:
            sizes = list(stats["content_lengths"])
            avg_size = sum(sizes) / len(sizes)
            if sizes[-1] > 0 and avg_size > 0:
                ratio = sizes[-1] / avg_size
                if ratio < 0.1 and sizes[-1] < 500:
                    anomalies.append({
                        "type": "response_shrunk",
                        "severity": "medium",
                        "message": f"{host} 响应体突然变小（{sizes[-1]}B vs 平均{avg_size:.0f}B），可能被WAF拦截",
                        "value": round(ratio, 3),
                    })

        if len(stats["user_agents"]) > 5 and stats["request_count"] > 20:
            anomalies.append({
                "type": "multiple_user_agents",
                "severity": "low",
                "message": f"{host} 使用了 {len(stats['user_agents'])} 种不同User-Agent",
                "value": len(stats["user_agents"]),
            })

        return anomalies

    def _summary(self, host: str) -> Dict:
        stats = self._host_stats.get(host, {})
        return {
            "host": host,
            "request_count": stats.get("request_count", 0),
            "error_count": stats.get("error_count", 0),
            "blocked_count": stats.get("blocked_count", 0),
            "waf_detected": stats.get("waf_detected"),
            "path_count": len(stats.get("paths", set())),
            "first_seen": stats.get("first_seen", 0),
            "last_seen": stats.get("last_seen", 0),
        }

    def get_all_stats(self) -> List[Dict]:
        with self._lock:
            return [self._summary(h) for h in self._host_stats]

    def get_recent_events(self, limit: int = 50, host: str = "") -> List[Dict]:
        with self._lock:
            events = list(self._events)
        if host:
            events = [e for e in events if e["host"] == host]
        return events[-limit:]

    def get_anomalies(self, host: str = "") -> List[Dict]:
        with self._lock:
            results = []
            for h, stats in self._host_stats.items():
                if host and h != host:
                    continue
                anomalies = self._detect_anomalies(h, stats, time.time())
                for a in anomalies:
                    a["host"] = h
                    results.append(a)
            return results

    def clear(self):
        with self._lock:
            self._events.clear()
            self._host_stats.clear()


_detector_instance: Optional[TrafficAnomalyDetector] = None
_detector_lock = threading.Lock()


def get_traffic_detector() -> TrafficAnomalyDetector:
    global _detector_instance
    if _detector_instance is None:
        with _detector_lock:
            if _detector_instance is None:
                _detector_instance = TrafficAnomalyDetector()
    return _detector_instance

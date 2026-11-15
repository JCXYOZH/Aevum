"""
core/alert_system.py - 事件告警系统

支持告警分级、多渠道通知、去重与抑制、升级机制、规则引擎、统计报告。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 告警级别
# ================================================================
class AlertLevel(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
    FATAL = "fatal"


# ================================================================
# 告警状态
# ================================================================
class AlertStatus(Enum):
    NEW = "new"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    SUPPRESSED = "suppressed"
    ESCALATED = "escalated"


# ================================================================
# 告警对象
# ================================================================
class Alert:
    """告警对象"""

    def __init__(self, title: str = "", message: str = "",
                 level: str = "info", category: str = "general",
                 source: str = "", severity: int = 0,
                 metadata: Optional[Dict[str, Any]] = None,
                 tags: Optional[List[str]] = None,
                 dedup_key: str = ""):
        self.alert_id = f"alert_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.message = message
        self.level = level
        self.category = category
        self.source = source
        self.severity = severity
        self.metadata = metadata or {}
        self.tags = tags or []
        self.dedup_key = dedup_key or f"{category}:{title}"
        self.status = AlertStatus.NEW
        self.created_at = time.time()
        self.updated_at = time.time()
        self.acknowledged_at = 0.0
        self.acknowledged_by = ""
        self.resolved_at = 0.0
        self.resolved_by = ""
        self.occurrence_count = 1
        self.first_occurrence = self.created_at
        self.last_occurrence = self.created_at
        self.escalation_level = 0
        self.suppressed_until = 0.0
        self.notification_channels: List[str] = []

    def acknowledge(self, by: str = ""):
        self.status = AlertStatus.ACKNOWLEDGED
        self.acknowledged_at = time.time()
        self.acknowledged_by = by
        self.updated_at = time.time()

    def resolve(self, by: str = "", resolution: str = ""):
        self.status = AlertStatus.RESOLVED
        self.resolved_at = time.time()
        self.resolved_by = by
        self.metadata["resolution"] = resolution
        self.updated_at = time.time()

    def suppress(self, duration_seconds: float = 3600):
        self.status = AlertStatus.SUPPRESSED
        self.suppressed_until = time.time() + duration_seconds
        self.updated_at = time.time()

    def escalate(self):
        self.escalation_level += 1
        self.status = AlertStatus.ESCALATED
        self.updated_at = time.time()

    def is_suppressed(self) -> bool:
        return self.status == AlertStatus.SUPPRESSED and time.time() < self.suppressed_until

    def to_dict(self) -> Dict[str, Any]:
        return {
            "alert_id": self.alert_id, "title": self.title,
            "message": self.message, "level": self.level,
            "category": self.category, "source": self.source,
            "severity": self.severity, "metadata": self.metadata,
            "tags": self.tags, "dedup_key": self.dedup_key,
            "status": self.status.value, "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": self.updated_at,
            "acknowledged_at": self.acknowledged_at,
            "acknowledged_by": self.acknowledged_by,
            "resolved_at": self.resolved_at,
            "resolved_by": self.resolved_by,
            "occurrence_count": self.occurrence_count,
            "first_occurrence": self.first_occurrence,
            "last_occurrence": self.last_occurrence,
            "escalation_level": self.escalation_level,
            "suppressed_until": self.suppressed_until,
            "notification_channels": self.notification_channels,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Alert":
        alert = cls(
            title=data.get("title", ""), message=data.get("message", ""),
            level=data.get("level", "info"), category=data.get("category", "general"),
            source=data.get("source", ""), severity=data.get("severity", 0),
            metadata=data.get("metadata", {}), tags=data.get("tags", []),
            dedup_key=data.get("dedup_key", ""),
        )
        alert.alert_id = data.get("alert_id", alert.alert_id)
        alert.status = AlertStatus(data.get("status", "new"))
        alert.created_at = data.get("created_at", time.time())
        alert.updated_at = data.get("updated_at", time.time())
        alert.occurrence_count = data.get("occurrence_count", 1)
        alert.escalation_level = data.get("escalation_level", 0)
        return alert


# ================================================================
# 告警规则
# ================================================================
class AlertRule:
    """告警规则"""

    def __init__(self, name: str = "", condition: str = "",
                 level: str = "warning", category: str = "general",
                 enabled: bool = True,
                 cooldown_seconds: float = 300,
                 threshold: int = 1,
                 window_seconds: float = 60,
                 action: str = "notify"):
        self.rule_id = f"rule_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.condition = condition
        self.level = level
        self.category = category
        self.enabled = enabled
        self.cooldown_seconds = cooldown_seconds
        self.threshold = threshold
        self.window_seconds = window_seconds
        self.action = action
        self.last_triggered = 0.0
        self.trigger_count = 0
        self.created_at = time.time()

    def can_trigger(self) -> bool:
        if not self.enabled:
            return False
        return time.time() - self.last_triggered >= self.cooldown_seconds

    def trigger(self):
        self.last_triggered = time.time()
        self.trigger_count += 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "rule_id": self.rule_id, "name": self.name,
            "condition": self.condition, "level": self.level,
            "category": self.category, "enabled": self.enabled,
            "cooldown_seconds": self.cooldown_seconds,
            "threshold": self.threshold, "window_seconds": self.window_seconds,
            "action": self.action, "last_triggered": self.last_triggered,
            "trigger_count": self.trigger_count, "created_at": self.created_at,
        }


# ================================================================
# 告警系统
# ================================================================
class AlertSystem:
    """事件告警系统"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "alerts")
        os.makedirs(self.data_dir, exist_ok=True)
        self._alerts: Dict[str, Alert] = {}
        self._rules: Dict[str, AlertRule] = {}
        self._dedup_cache: Dict[str, Alert] = {}
        self._notification_handlers: Dict[str, Callable[[Alert], None]] = {}
        self._lock = threading.RLock()
        self._maintenance_interval = 60.0
        self._last_maintenance = 0.0
        self._load()
        self._init_default_rules()

    def _init_default_rules(self):
        defaults = [
            AlertRule(name="高CPU使用率", condition="cpu > 90", level="critical",
                      category="system", threshold=3, window_seconds=60),
            AlertRule(name="高内存使用率", condition="memory > 90", level="warning",
                      category="system", threshold=3, window_seconds=60),
            AlertRule(name="磁盘空间不足", condition="disk > 90", level="critical",
                      category="system", threshold=1, window_seconds=300),
            AlertRule(name="工具执行失败", condition="tool_failure", level="warning",
                      category="tool", threshold=5, window_seconds=60),
            AlertRule(name="安全事件", condition="security_event", level="critical",
                      category="security", threshold=1, window_seconds=10),
        ]
        for rule in defaults:
            if rule.name not in [r.name for r in self._rules.values()]:
                self._rules[rule.rule_id] = rule

    def _load(self):
        alert_file = os.path.join(self.data_dir, "alerts.json")
        try:
            if os.path.exists(alert_file):
                with open(alert_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for a_data in data.get("alerts", [])[-500:]:
                    alert = Alert.from_dict(a_data)
                    self._alerts[alert.alert_id] = alert
                    if alert.status in (AlertStatus.NEW, AlertStatus.ACKNOWLEDGED):
                        self._dedup_cache[alert.dedup_key] = alert
        except Exception as e:
            terminal.warn(f"加载告警失败: {e}", "alert_system")

    def _save(self):
        alert_file = os.path.join(self.data_dir, "alerts.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "alerts": [a.to_dict() for a in list(self._alerts.values())[-500:]],
                "rules": [r.to_dict() for r in self._rules.values()],
            }
            with open(alert_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def register_notification_handler(self, channel: str, handler: Callable[[Alert], None]):
        self._notification_handlers[channel] = handler

    def trigger_alert(self, title: str, message: str = "",
                      level: str = "info", category: str = "general",
                      source: str = "", metadata: Optional[Dict[str, Any]] = None,
                      tags: Optional[List[str]] = None,
                      dedup_key: str = "",
                      dedup_window: float = 300.0) -> Alert:
        """触发告警"""
        # 去重检查
        dk = dedup_key or f"{category}:{title}"
        with self._lock:
            existing = self._dedup_cache.get(dk)
            if existing and existing.is_suppressed():
                return existing
            if existing and time.time() - existing.last_occurrence < dedup_window:
                existing.occurrence_count += 1
                existing.last_occurrence = time.time()
                existing.updated_at = time.time()
                self._save()
                return existing

            alert = Alert(
                title=title, message=message, level=level,
                category=category, source=source, metadata=metadata,
                tags=tags, dedup_key=dk,
            )
            self._alerts[alert.alert_id] = alert
            self._dedup_cache[dk] = alert

            # 检查规则
            self._check_rules(alert)

            # 发送通知
            self._send_notifications(alert)

            self._save()

        # 终端输出
        if level == "critical":
            terminal.error(f"[CRITICAL] [严重告警] {title}: {message}", "alert")
        elif level == "warning":
            terminal.warn(f"[WARN] [警告] {title}: {message}", "alert")
        elif level == "fatal":
            terminal.error(f"[FATAL] [致命] {title}: {message}", "alert")
        else:
            terminal.info(f"[INFO] [通知] {title}: {message}", "alert")

        return alert

    def _check_rules(self, alert: Alert):
        """检查告警规则"""
        for rule in self._rules.values():
            if not rule.enabled or rule.category != alert.category:
                continue
            if rule.can_trigger():
                # 简化规则匹配
                if rule.condition in alert.message or rule.condition in alert.title:
                    rule.trigger()
                    alert.level = rule.level
                    alert.tags.append(f"rule:{rule.name}")

    def _send_notifications(self, alert: Alert):
        """发送通知到所有注册的渠道"""
        for channel, handler in self._notification_handlers.items():
            try:
                handler(alert)
                alert.notification_channels.append(channel)
            except Exception as e:
                terminal.warn(f"通知渠道 [{channel}] 发送失败: {e}", "alert_system")

    def acknowledge_alert(self, alert_id: str, by: str = "") -> bool:
        alert = self._alerts.get(alert_id)
        if alert:
            alert.acknowledge(by)
            self._save()
            return True
        return False

    def resolve_alert(self, alert_id: str, by: str = "", resolution: str = "") -> bool:
        alert = self._alerts.get(alert_id)
        if alert:
            alert.resolve(by, resolution)
            self._dedup_cache.pop(alert.dedup_key, None)
            self._save()
            return True
        return False

    def suppress_alert(self, alert_id: str, duration_seconds: float = 3600) -> bool:
        alert = self._alerts.get(alert_id)
        if alert:
            alert.suppress(duration_seconds)
            self._save()
            return True
        return False

    def escalate_alert(self, alert_id: str) -> bool:
        alert = self._alerts.get(alert_id)
        if alert:
            alert.escalate()
            self._send_notifications(alert)
            self._save()
            return True
        return False

    def get_alert(self, alert_id: str) -> Optional[Alert]:
        return self._alerts.get(alert_id)

    def list_alerts(self, status: str = "", level: str = "",
                     category: str = "", source: str = "",
                     unacknowledged_only: bool = False,
                     limit: int = 100) -> List[Alert]:
        alerts = list(self._alerts.values())
        if status:
            alerts = [a for a in alerts if a.status.value == status]
        if level:
            alerts = [a for a in alerts if a.level == level]
        if category:
            alerts = [a for a in alerts if a.category == category]
        if source:
            alerts = [a for a in alerts if a.source == source]
        if unacknowledged_only:
            alerts = [a for a in alerts if a.status == AlertStatus.NEW]
        alerts.sort(key=lambda a: a.created_at, reverse=True)
        return alerts[:limit]

    def get_active_alerts(self) -> List[Alert]:
        return [a for a in self._alerts.values()
                if a.status in (AlertStatus.NEW, AlertStatus.ACKNOWLEDGED, AlertStatus.ESCALATED)]


    def clear_alerts(self) -> int:
        """清空全部告警记录，返回清掉的条数。

        Web 层原来调用的是不存在的 clear_history()，所以 /api/alerts/clear 必 500。
        """
        with self._lock:
            count = len(self._alerts)
            self._alerts.clear()
            self._dedup_cache.clear()
            self._save()
        return count

    def add_rule(self, rule: AlertRule) -> str:
        with self._lock:
            self._rules[rule.rule_id] = rule
            self._save()
        return rule.rule_id

    def remove_rule(self, rule_id: str) -> bool:
        with self._lock:
            if rule_id in self._rules:
                del self._rules[rule_id]
                self._save()
                return True
            return False

    def list_rules(self, enabled_only: bool = False) -> List[AlertRule]:
        rules = list(self._rules.values())
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        return rules

    def maintenance(self):
        """定期维护（清理过期抑制、保存）"""
        now = time.time()
        if now - self._last_maintenance < self._maintenance_interval:
            return
        self._last_maintenance = now
        # 清理过期的抑制告警
        for alert in self._alerts.values():
            if alert.status == AlertStatus.SUPPRESSED and now >= alert.suppressed_until:
                alert.status = AlertStatus.NEW
                alert.updated_at = now
        # 清理旧的去重缓存
        to_remove = [k for k, a in self._dedup_cache.items()
                     if a.status in (AlertStatus.RESOLVED, AlertStatus.SUPPRESSED)
                     and now - a.last_occurrence > 3600]
        for k in to_remove:
            del self._dedup_cache[k]
        self._save()

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._alerts)
        active = len(self.get_active_alerts())
        by_level = {}
        by_category = {}
        by_status = {}
        for alert in self._alerts.values():
            by_level[alert.level] = by_level.get(alert.level, 0) + 1
            by_category[alert.category] = by_category.get(alert.category, 0) + 1
            by_status[alert.status.value] = by_status.get(alert.status.value, 0) + 1
        return {
            "total": total, "active": active,
            "by_level": by_level, "by_category": by_category,
            "by_status": by_status,
            "rules": len(self._rules),
            "notification_channels": len(self._notification_handlers),
            "dedup_cache": len(self._dedup_cache),
        }

    def generate_report(self, days: int = 7) -> Dict[str, Any]:
        """生成告警报告"""
        cutoff = time.time() - days * 86400
        alerts = [a for a in self._alerts.values() if a.created_at >= cutoff]
        by_day = {}
        for alert in alerts:
            day = datetime.fromtimestamp(alert.created_at).strftime("%Y-%m-%d")
            by_day.setdefault(day, {"total": 0, "critical": 0, "warning": 0, "resolved": 0})
            by_day[day]["total"] += 1
            if alert.level == "critical":
                by_day[day]["critical"] += 1
            elif alert.level == "warning":
                by_day[day]["warning"] += 1
            if alert.status == AlertStatus.RESOLVED:
                by_day[day]["resolved"] += 1
        return {
            "period_days": days,
            "total_alerts": len(alerts),
            "by_day": by_day,
            "top_categories": sorted(
                [(c, sum(1 for a in alerts if a.category == c)) for c in set(a.category for a in alerts)],
                key=lambda x: x[1], reverse=True
            )[:10],
            "most_frequent": sorted(
                [(t, a.occurrence_count) for a in alerts for t in [a.title]],
                key=lambda x: x[1], reverse=True
            )[:10],
        }


# 全局告警系统
_alert_system = AlertSystem()


def get_alert_system() -> AlertSystem:
    return _alert_system


def trigger_alert(title: str, message: str = "", **kwargs) -> Alert:
    return _alert_system.trigger_alert(title, message, **kwargs)

"""
Libertas - 监控诊断与协议兼容
==============================
节点健康监控、性能诊断、协议版本协商、错误恢复。

版本：1.0.0
"""

import asyncio
import time
import hashlib
import json
import os
import traceback
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable
from collections import defaultdict, deque
import logging

logger = logging.getLogger(__name__)


@dataclass
class HealthCheck:
    """健康检查结果"""
    node_id: str
    timestamp: float = field(default_factory=time.time)
    is_healthy: bool = True
    cpu_usage: float = 0.0
    memory_usage: float = 0.0
    disk_usage: float = 0.0
    network_in_kbps: float = 0.0
    network_out_kbps: float = 0.0
    active_connections: int = 0
    dht_nodes: int = 0
    pending_tasks: int = 0
    uptime_seconds: float = 0.0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "node_id": self.node_id,
            "timestamp": self.timestamp,
            "is_healthy": self.is_healthy,
            "cpu_usage": self.cpu_usage,
            "memory_usage": self.memory_usage,
            "disk_usage": self.disk_usage,
            "network_in_kbps": self.network_in_kbps,
            "network_out_kbps": self.network_out_kbps,
            "active_connections": self.active_connections,
            "dht_nodes": self.dht_nodes,
            "pending_tasks": self.pending_tasks,
            "uptime_seconds": self.uptime_seconds,
            "errors": self.errors,
            "warnings": self.warnings,
        }


@dataclass
class DiagnosticReport:
    """诊断报告"""
    report_id: str
    generated_at: float = field(default_factory=time.time)
    category: str = ""
    severity: str = "info"  # info/warning/error/critical
    title: str = ""
    description: str = ""
    recommendations: List[str] = field(default_factory=list)
    metrics: Dict = field(default_factory=dict)
    affected_components: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "report_id": self.report_id,
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "description": self.description,
            "recommendations": self.recommendations,
            "metrics": self.metrics,
            "affected_components": self.affected_components,
        }


class HealthMonitor:
    """
    节点健康监控
    """

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.start_time = time.time()
        self._history: deque = deque(maxlen=1000)
        self._callbacks: Dict[str, Callable] = {}
        self._alert_thresholds = {
            "cpu": 90.0,
            "memory": 90.0,
            "disk": 95.0,
            "connections": 1000,
            "error_rate": 0.1,
        }

    def register_callback(self, component: str, callback: Callable):
        """注册组件状态回调"""
        self._callbacks[component] = callback

    async def check_health(self) -> HealthCheck:
        """执行健康检查"""
        check = HealthCheck(node_id=self.node_id)
        check.uptime_seconds = time.time() - self.start_time

        # 系统资源
        try:
            import psutil
            check.cpu_usage = psutil.cpu_percent(interval=0.1)
            check.memory_usage = psutil.virtual_memory().percent
            check.disk_usage = psutil.disk_usage("/").percent
        except ImportError:
            # psutil不可用，使用估算
            check.cpu_usage = 0.0
            check.memory_usage = 0.0
            check.disk_usage = 0.0

        # 组件状态
        for component, callback in self._callbacks.items():
            try:
                status = await callback() if asyncio.iscoroutinefunction(callback) else callback()
                if isinstance(status, dict):
                    if component == "network":
                        check.active_connections = status.get("connections", 0)
                        check.network_in_kbps = status.get("in_kbps", 0)
                        check.network_out_kbps = status.get("out_kbps", 0)
                    elif component == "dht":
                        check.dht_nodes = status.get("nodes", 0)
                    elif component == "tasks":
                        check.pending_tasks = status.get("pending", 0)
            except Exception as e:
                check.errors.append(f"{component}: {e}")

        # 阈值检查
        if check.cpu_usage > self._alert_thresholds["cpu"]:
            check.warnings.append(f"CPU使用率过高: {check.cpu_usage}%")
        if check.memory_usage > self._alert_thresholds["memory"]:
            check.warnings.append(f"内存使用率过高: {check.memory_usage}%")
        if check.disk_usage > self._alert_thresholds["disk"]:
            check.warnings.append(f"磁盘使用率过高: {check.disk_usage}%")
        if check.errors:
            check.is_healthy = False

        self._history.append(check)
        return check

    def get_history(self, limit: int = 100) -> List[HealthCheck]:
        return list(self._history)[-limit:]

    def get_uptime(self) -> float:
        return time.time() - self.start_time


class DiagnosticEngine:
    """
    性能诊断引擎
    自动检测问题并生成诊断报告
    """

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.reports: List[DiagnosticReport] = []
        self._error_log: deque = deque(maxlen=1000)
        self._performance_samples: deque = deque(maxlen=1000)

    def log_error(self, component: str, error: str, context: Dict = None):
        """记录错误"""
        self._error_log.append({
            "timestamp": time.time(),
            "component": component,
            "error": error,
            "context": context or {},
        })

    def record_performance(self, operation: str, duration_ms: float,
                             success: bool = True):
        """记录性能样本"""
        self._performance_samples.append({
            "timestamp": time.time(),
            "operation": operation,
            "duration_ms": duration_ms,
            "success": success,
        })

    async def run_diagnostics(self, health: Optional[HealthCheck] = None) -> List[DiagnosticReport]:
        """运行诊断"""
        reports = []

        # 网络诊断
        network_report = self._diagnose_network(health)
        if network_report:
            reports.append(network_report)

        # 性能诊断
        perf_report = self._diagnose_performance()
        if perf_report:
            reports.append(perf_report)

        # 错误率诊断
        error_report = self._diagnose_errors()
        if error_report:
            reports.append(error_report)

        # DHT诊断
        dht_report = self._diagnose_dht(health)
        if dht_report:
            reports.append(dht_report)

        self.reports.extend(reports)
        if len(self.reports) > 500:
            self.reports = self.reports[-500:]

        return reports

    def _diagnose_network(self, health: Optional[HealthCheck]) -> Optional[DiagnosticReport]:
        """网络诊断"""
        if not health:
            return None

        if health.active_connections == 0:
            return DiagnosticReport(
                report_id=hashlib.md5(f"net_{time.time()}".encode()).hexdigest()[:12],
                category="network",
                severity="warning",
                title="无活跃连接",
                description="节点没有任何活跃的P2P连接，可能无法参与网络",
                recommendations=["检查NAT穿透配置", "添加种子节点", "检查防火墙设置"],
                affected_components=["transport", "dht"],
            )

        if health.active_connections > 500:
            return DiagnosticReport(
                report_id=hashlib.md5(f"net_{time.time()}".encode()).hexdigest()[:12],
                category="network",
                severity="warning",
                title="连接数过多",
                description=f"活跃连接数达到{health.active_connections}，可能影响性能",
                recommendations=["增加连接数限制", "优化连接管理", "启用连接池"],
                metrics={"connections": health.active_connections},
                affected_components=["transport"],
            )

        return None

    def _diagnose_performance(self) -> Optional[DiagnosticReport]:
        """性能诊断"""
        if len(self._performance_samples) < 10:
            return None

        recent = list(self._performance_samples)[-50:]
        durations = [s["duration_ms"] for s in recent]
        avg_duration = sum(durations) / len(durations)
        success_rate = sum(1 for s in recent if s["success"]) / len(recent)

        if avg_duration > 5000:
            return DiagnosticReport(
                report_id=hashlib.md5(f"perf_{time.time()}".encode()).hexdigest()[:12],
                category="performance",
                severity="warning",
                title="操作延迟过高",
                description=f"平均操作延迟{avg_duration:.0f}ms，超过5秒阈值",
                recommendations=["检查网络连接", "优化数据库查询", "增加并发处理"],
                metrics={"avg_duration_ms": avg_duration, "samples": len(recent)},
                affected_components=["all"],
            )

        if success_rate < 0.9:
            return DiagnosticReport(
                report_id=hashlib.md5(f"perf_{time.time()}".encode()).hexdigest()[:12],
                category="performance",
                severity="error",
                title="操作成功率低",
                description=f"操作成功率仅{success_rate:.1%}，低于90%阈值",
                recommendations=["检查错误日志", "验证网络连通性", "检查依赖服务状态"],
                metrics={"success_rate": success_rate, "samples": len(recent)},
                affected_components=["all"],
            )

        return None

    def _diagnose_errors(self) -> Optional[DiagnosticReport]:
        """错误率诊断"""
        if len(self._error_log) < 5:
            return None

        recent_errors = list(self._error_log)[-100:]
        error_by_component = defaultdict(int)
        for e in recent_errors:
            error_by_component[e["component"]] += 1

        top_component = max(error_by_component, key=error_by_component.get)
        if error_by_component[top_component] > 20:
            return DiagnosticReport(
                report_id=hashlib.md5(f"err_{time.time()}".encode()).hexdigest()[:12],
                category="errors",
                severity="error",
                title=f"{top_component}组件错误频繁",
                description=f"{top_component}组件在最近100次错误中占{error_by_component[top_component]}次",
                recommendations=[f"检查{top_component}组件日志", "验证配置正确性", "考虑重启该组件"],
                metrics={"error_count": error_by_component[top_component],
                         "total_errors": len(recent_errors)},
                affected_components=[top_component],
            )

        return None

    def _diagnose_dht(self, health: Optional[HealthCheck]) -> Optional[DiagnosticReport]:
        """DHT诊断"""
        if not health:
            return None

        if health.dht_nodes == 0:
            return DiagnosticReport(
                report_id=hashlib.md5(f"dht_{time.time()}".encode()).hexdigest()[:12],
                category="dht",
                severity="warning",
                title="DHT路由表为空",
                description="DHT路由表中没有任何节点，无法进行分布式查找",
                recommendations=["加入已知种子节点", "检查节点发现服务", "验证网络连通性"],
                affected_components=["dht", "node_discovery"],
            )

        if health.dht_nodes < 5:
            return DiagnosticReport(
                report_id=hashlib.md5(f"dht_{time.time()}".encode()).hexdigest()[:12],
                category="dht",
                severity="info",
                title="DHT节点数较少",
                description=f"DHT路由表仅有{health.dht_nodes}个节点，查找效率可能较低",
                recommendations=["主动发现更多节点", "参与PEX节点交换"],
                metrics={"dht_nodes": health.dht_nodes},
                affected_components=["dht"],
            )

        return None

    def get_reports(self, category: Optional[str] = None,
                    severity: Optional[str] = None,
                    limit: int = 50) -> List[DiagnosticReport]:
        reports = self.reports
        if category:
            reports = [r for r in reports if r.category == category]
        if severity:
            reports = [r for r in reports if r.severity == severity]
        return reports[-limit:]


class ProtocolNegotiator:
    """
    协议版本协商
    支持多版本协议，自动协商最优版本
    """

    CURRENT_VERSION = "2.0.0"
    SUPPORTED_VERSIONS = ["1.0.0", "1.5.0", "2.0.0"]

    def __init__(self, node_id: str):
        self.node_id = node_id
        self._peer_versions: Dict[str, str] = {}
        self._version_features: Dict[str, List[str]] = {
            "1.0.0": ["basic_transport", "basic_dht", "basic_gossip"],
            "1.5.0": ["basic_transport", "basic_dht", "basic_gossip",
                       "reputation", "task_distribution", "asset_merging"],
            "2.0.0": ["basic_transport", "enhanced_dht", "enhanced_gossip",
                       "reputation_v2", "task_scheduler", "asset_analytics",
                       "nat_traversal", "e2e_encryption", "message_signing",
                       "attack_detection", "topology_optimization", "qos",
                       "incremental_sync", "result_verification"],
        }

    def negotiate(self, peer_node_id: str, peer_version: str) -> str:
        """
        协商协议版本

        Returns:
            协商后的版本号
        """
        if peer_version in self.SUPPORTED_VERSIONS:
            negotiated = peer_version
        else:
            # 找最接近的版本
            negotiated = self.SUPPORTED_VERSIONS[0]
            for v in self.SUPPORTED_VERSIONS:
                if self._version_compare(v, peer_version) <= 0:
                    negotiated = v

        self._peer_versions[peer_node_id] = negotiated
        return negotiated

    def get_peer_version(self, peer_node_id: str) -> str:
        return self._peer_versions.get(peer_node_id, "1.0.0")

    def get_common_features(self, peer_node_id: str) -> List[str]:
        """获取与对端共同支持的功能"""
        peer_version = self.get_peer_version(peer_node_id)
        my_features = set(self._version_features.get(self.CURRENT_VERSION, []))
        peer_features = set(self._version_features.get(peer_version, []))
        return sorted(my_features & peer_features)

    def is_feature_supported(self, peer_node_id: str, feature: str) -> bool:
        """检查对端是否支持某功能"""
        return feature in self.get_common_features(peer_node_id)

    def _version_compare(self, v1: str, v2: str) -> int:
        """比较版本号"""
        parts1 = [int(x) for x in v1.split(".")]
        parts2 = [int(x) for x in v2.split(".")]
        for i in range(max(len(parts1), len(parts2))):
            p1 = parts1[i] if i < len(parts1) else 0
            p2 = parts2[i] if i < len(parts2) else 0
            if p1 < p2:
                return -1
            if p1 > p2:
                return 1
        return 0

    def get_stats(self) -> Dict:
        version_counts = defaultdict(int)
        for v in self._peer_versions.values():
            version_counts[v] += 1
        return {
            "current_version": self.CURRENT_VERSION,
            "supported_versions": self.SUPPORTED_VERSIONS,
            "peers_by_version": dict(version_counts),
            "total_peers": len(self._peer_versions),
        }


class MonitoringEngine:
    """监控诊断引擎（整合）"""

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.health = HealthMonitor(node_id)
        self.diagnostics = DiagnosticEngine(node_id)
        self.protocol = ProtocolNegotiator(node_id)
        self._monitoring_task: Optional[asyncio.Task] = None
        self._running = False

    def register_component(self, name: str, callback: Callable):
        self.health.register_callback(name, callback)

    async def start(self, interval: float = 60.0):
        """启动监控"""
        self._running = True
        self._monitoring_task = asyncio.create_task(self._monitoring_loop(interval))

    async def stop(self):
        self._running = False
        if self._monitoring_task:
            self._monitoring_task.cancel()

    async def _monitoring_loop(self, interval: float):
        while self._running:
            try:
                health = await self.health.check_health()
                await self.diagnostics.run_diagnostics(health)
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"监控异常: {e}")
                await asyncio.sleep(interval)

    async def get_full_status(self) -> Dict:
        """获取完整状态"""
        health = await self.health.check_health()
        return {
            "health": health.to_dict(),
            "diagnostics": [r.to_dict() for r in self.diagnostics.get_reports(limit=10)],
            "protocol": self.protocol.get_stats(),
            "uptime": self.health.get_uptime(),
        }

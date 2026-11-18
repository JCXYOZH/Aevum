"""职责模块：health。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import time

class ToolHealthChecker:
    """工具健康检查器 - 检测工具可用性、性能退化、异常模式"""

    def __init__(self, registry: "ToolRegistry"):
        self.registry = registry
        self.health_records: Dict[str, Dict[str, Any]] = {}
        self.alert_thresholds = {
            "failure_rate": 0.3,
            "avg_duration_ms": 30000,
            "consecutive_failures": 3,
        }

    def record_execution(self, result: "ToolResult"):
        """记录一次执行结果用于健康分析"""
        name = result.tool_name
        if name not in self.health_records:
            self.health_records[name] = {
                "total": 0, "success": 0, "failed": 0, "timeout": 0,
                "consecutive_failures": 0, "last_failure": "",
                "durations": [], "last_execution": 0,
            }
        record = self.health_records[name]
        record["total"] += 1
        record["last_execution"] = time.time()
        record["durations"].append(result.duration_ms)
        if len(record["durations"]) > 100:
            record["durations"] = record["durations"][-100:]
        if result.status == "success":
            record["success"] += 1
            record["consecutive_failures"] = 0
        elif result.status == "timeout":
            record["timeout"] += 1
            record["consecutive_failures"] += 1
            record["last_failure"] = result.error or "timeout"
        else:
            record["failed"] += 1
            record["consecutive_failures"] += 1
            record["last_failure"] = result.error or "unknown"

    def check_health(self, tool_name: str) -> Dict[str, Any]:
        """检查单个工具的健康状态"""
        record = self.health_records.get(tool_name)
        tool = self.registry.get(tool_name)
        result = {
            "tool_name": tool_name,
            "status": "unknown",
            "score": 1.0,
            "issues": [],
            "stats": {},
        }
        if not tool:
            result["status"] = "not_registered"
            result["score"] = 0
            result["issues"].append("工具未注册")
            return result
        if not tool.enabled:
            result["status"] = "disabled"
            result["score"] = 0.2
            result["issues"].append("工具已被禁用")
            return result
        if not record or record["total"] == 0:
            result["status"] = "untested"
            result["score"] = 0.5
            result["issues"].append("工具尚未执行过，健康状态未知")
            return result
        # 计算健康分数
        failure_rate = (record["failed"] + record["timeout"]) / record["total"]
        avg_duration = sum(record["durations"]) / len(record["durations"])
        score = 1.0
        if failure_rate > self.alert_thresholds["failure_rate"]:
            score -= 0.4
            result["issues"].append(f"失败率过高: {failure_rate:.1%}")
        if avg_duration > self.alert_thresholds["avg_duration_ms"]:
            score -= 0.2
            result["issues"].append(f"平均执行时间过长: {avg_duration:.0f}ms")
        if record["consecutive_failures"] >= self.alert_thresholds["consecutive_failures"]:
            score -= 0.3
            result["issues"].append(f"连续失败 {record['consecutive_failures']} 次")
        score = max(0.0, score)
        result["score"] = score
        result["status"] = "healthy" if score >= 0.7 else ("degraded" if score >= 0.4 else "unhealthy")
        result["stats"] = {
            "total_executions": record["total"],
            "success": record["success"],
            "failed": record["failed"],
            "timeout": record["timeout"],
            "failure_rate": failure_rate,
            "avg_duration_ms": avg_duration,
            "consecutive_failures": record["consecutive_failures"],
            "last_failure": record["last_failure"],
        }
        return result

    def check_all(self) -> List[Dict[str, Any]]:
        """检查所有已注册工具的健康状态"""
        results = []
        for tool in self.registry.list_tools():
            results.append(self.check_health(tool.name))
        return results

    def get_unhealthy_tools(self) -> List[Dict[str, Any]]:
        """获取所有不健康的工具"""
        return [r for r in self.check_all() if r["status"] in ("unhealthy", "degraded")]

    def get_summary(self) -> Dict[str, Any]:
        """获取健康检查摘要"""
        all_results = self.check_all()
        total = len(all_results)
        healthy = sum(1 for r in all_results if r["status"] == "healthy")
        degraded = sum(1 for r in all_results if r["status"] == "degraded")
        unhealthy = sum(1 for r in all_results if r["status"] == "unhealthy")
        untested = sum(1 for r in all_results if r["status"] == "untested")
        avg_score = sum(r["score"] for r in all_results) / total if total > 0 else 0
        return {
            "total_tools": total,
            "healthy": healthy,
            "degraded": degraded,
            "unhealthy": unhealthy,
            "untested": untested,
            "average_health_score": avg_score,
            "overall_status": "healthy" if avg_score >= 0.7 else ("degraded" if avg_score >= 0.4 else "unhealthy"),
        }

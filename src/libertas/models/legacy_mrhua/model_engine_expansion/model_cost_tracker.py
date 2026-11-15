"""
models/model_engine_expansion.py - 模型引擎综合扩展模块

高级模型管理功能：模型路由调度器、多模型负载均衡、模型健康监控、
模型性能基准测试、模型缓存层、模型请求队列、模型成本追踪器。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 模型状态
# ================================================================
from .models import *  # noqa: F401,F403
from .model_router import *  # noqa: F401,F403
from .model_health_monitor import *  # noqa: F401,F403

class ModelCostTracker:
    """模型成本追踪器"""

    def __init__(self):
        self.tracker_id = f"cost_{uuid.uuid4().hex[:8]}"
        self.usage_records: deque = deque(maxlen=5000)
        self.daily_totals: Dict[str, Dict[str, Any]] = {}
        self.monthly_budget: float = 0.0
        self.alert_threshold: float = 0.8
        self._lock = threading.RLock()

    def record_usage(self, model_id: str, model_name: str,
                     tokens_input: int, tokens_output: int,
                     cost_input: float, cost_output: float,
                     request_id: str = ""):
        total_cost = cost_input + cost_output
        record = {
            "record_id": f"usage_{uuid.uuid4().hex[:8]}",
            "request_id": request_id,
            "model_id": model_id,
            "model_name": model_name,
            "tokens_input": tokens_input,
            "tokens_output": tokens_output,
            "tokens_total": tokens_input + tokens_output,
            "cost_input": round(cost_input, 6),
            "cost_output": round(cost_output, 6),
            "total_cost": round(total_cost, 6),
            "timestamp": time.time(),
            "date": time.strftime("%Y-%m-%d"),
            "hour": time.strftime("%Y-%m-%d %H"),
        }
        with self._lock:
            self.usage_records.append(record)
            date = record["date"]
            if date not in self.daily_totals:
                self.daily_totals[date] = {
                    "total_cost": 0.0,
                    "total_tokens": 0,
                    "request_count": 0,
                    "by_model": {},
                }
            daily = self.daily_totals[date]
            daily["total_cost"] += total_cost
            daily["total_tokens"] += tokens_input + tokens_output
            daily["request_count"] += 1
            if model_name not in daily["by_model"]:
                daily["by_model"][model_name] = {"cost": 0.0, "tokens": 0, "count": 0}
            daily["by_model"][model_name]["cost"] += total_cost
            daily["by_model"][model_name]["tokens"] += tokens_input + tokens_output
            daily["by_model"][model_name]["count"] += 1

    def get_daily_cost(self, date: str = "") -> Dict[str, Any]:
        date = date or time.strftime("%Y-%m-%d")
        return self.daily_totals.get(date, {
            "total_cost": 0.0, "total_tokens": 0, "request_count": 0, "by_model": {}
        })

    def get_monthly_cost(self, year_month: str = "") -> Dict[str, Any]:
        year_month = year_month or time.strftime("%Y-%m")
        total_cost = 0.0
        total_tokens = 0
        request_count = 0
        by_model: Dict[str, Dict] = {}
        for date, daily in self.daily_totals.items():
            if date.startswith(year_month):
                total_cost += daily["total_cost"]
                total_tokens += daily["total_tokens"]
                request_count += daily["request_count"]
                for model, data in daily["by_model"].items():
                    if model not in by_model:
                        by_model[model] = {"cost": 0.0, "tokens": 0, "count": 0}
                    by_model[model]["cost"] += data["cost"]
                    by_model[model]["tokens"] += data["tokens"]
                    by_model[model]["count"] += data["count"]
        return {
            "year_month": year_month,
            "total_cost": round(total_cost, 4),
            "total_tokens": total_tokens,
            "request_count": request_count,
            "by_model": by_model,
            "budget": self.monthly_budget,
            "budget_used_pct": round(total_cost / max(self.monthly_budget, 0.001) * 100, 2),
            "budget_remaining": round(max(0, self.monthly_budget - total_cost), 4),
        }

    def set_budget(self, monthly_budget: float, alert_threshold: float = 0.8):
        self.monthly_budget = monthly_budget
        self.alert_threshold = alert_threshold

    def check_budget_alert(self) -> Optional[Dict[str, Any]]:
        monthly = self.get_monthly_cost()
        if monthly["budget_used_pct"] >= self.alert_threshold * 100:
            return {
                "alert": True,
                "budget_used_pct": monthly["budget_used_pct"],
                "threshold": self.alert_threshold * 100,
                "total_cost": monthly["total_cost"],
                "budget": monthly["budget"],
                "message": f"月度预算已使用 {monthly['budget_used_pct']}%",
            }
        return None

    def get_usage_history(self, limit: int = 100, model_id: str = "") -> List[Dict]:
        records = list(reversed(self.usage_records))
        if model_id:
            records = [r for r in records if r["model_id"] == model_id]
        return records[:limit]

    def get_stats(self) -> Dict[str, Any]:
        total_cost = sum(r["total_cost"] for r in self.usage_records)
        total_tokens = sum(r["tokens_total"] for r in self.usage_records)
        return {
            "tracker_id": self.tracker_id,
            "total_records": len(self.usage_records),
            "total_cost": round(total_cost, 4),
            "total_tokens": total_tokens,
            "avg_cost_per_request": round(total_cost / max(len(self.usage_records), 1), 6),
            "avg_tokens_per_request": round(total_tokens / max(len(self.usage_records), 1), 1),
            "monthly_budget": self.monthly_budget,
            "days_tracked": len(self.daily_totals),
        }

class ModelBenchmark:
    """模型性能基准测试器"""

    def __init__(self):
        self.benchmark_id = f"bench_{uuid.uuid4().hex[:8]}"
        self.test_prompts: List[Dict[str, Any]] = []
        self.results: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._init_default_tests()

    def _init_default_tests(self):
        self.test_prompts = [
            {"id": "simple_qa", "prompt": "什么是人工智能？", "max_tokens": 100, "category": "simple"},
            {"id": "reasoning", "prompt": "如果所有的猫都是动物，所有的动物都需要水，那么猫需要水吗？请解释推理过程。", "max_tokens": 200, "category": "reasoning"},
            {"id": "coding", "prompt": "用Python写一个快速排序函数。", "max_tokens": 300, "category": "coding"},
            {"id": "creative", "prompt": "写一首关于春天的短诗。", "max_tokens": 150, "category": "creative"},
            {"id": "long_context", "prompt": "请详细解释量子计算的基本原理，包括量子比特、叠加态和纠缠。", "max_tokens": 500, "category": "long"},
            {"id": "math", "prompt": "计算：一个长方体的长、宽、高分别是3、4、5米，求它的体积和表面积。", "max_tokens": 100, "category": "math"},
            {"id": "translation", "prompt": "将这句话翻译成英文：知识就是力量。", "max_tokens": 50, "category": "translation"},
            {"id": "summarization", "prompt": "请用一句话总结：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。", "max_tokens": 50, "category": "summary"},
        ]

    def add_test_prompt(self, prompt_id: str, prompt: str,
                        max_tokens: int = 100, category: str = "custom"):
        self.test_prompts.append({
            "id": prompt_id, "prompt": prompt,
            "max_tokens": max_tokens, "category": category,
        })

    def run_benchmark(self, model_id: str, model_name: str,
                      call_fn: Callable) -> Dict[str, Any]:
        """运行基准测试"""
        results = {
            "benchmark_id": self.benchmark_id,
            "model_id": model_id,
            "model_name": model_name,
            "started_at": time.time(),
            "completed_at": 0.0,
            "duration_ms": 0.0,
            "tests": [],
            "summary": {},
        }
        latencies = []
        tokens_per_second = []
        success_count = 0
        total_tokens = 0

        for test in self.test_prompts:
            test_result = {
                "test_id": test["id"],
                "category": test["category"],
                "prompt_length": len(test["prompt"]),
                "max_tokens": test["max_tokens"],
                "status": "pending",
                "latency_ms": 0.0,
                "tokens_output": 0,
                "tokens_per_second": 0.0,
                "error": "",
            }
            start = time.time()
            try:
                response = call_fn(test["prompt"], test["max_tokens"])
                test_result["status"] = "success"
                test_result["latency_ms"] = (time.time() - start) * 1000
                if isinstance(response, dict):
                    test_result["tokens_output"] = response.get("tokens_output", len(response.get("content", "").split()))
                else:
                    test_result["tokens_output"] = len(str(response).split())
                test_result["tokens_per_second"] = (
                    test_result["tokens_output"] / max(test_result["latency_ms"] / 1000, 0.001)
                )
                latencies.append(test_result["latency_ms"])
                tokens_per_second.append(test_result["tokens_per_second"])
                success_count += 1
                total_tokens += test_result["tokens_output"]
            except Exception as e:
                test_result["status"] = "failed"
                test_result["error"] = str(e)
                test_result["latency_ms"] = (time.time() - start) * 1000

            results["tests"].append(test_result)

        results["completed_at"] = time.time()
        results["duration_ms"] = (results["completed_at"] - results["started_at"]) * 1000
        results["summary"] = {
            "total_tests": len(self.test_prompts),
            "success_count": success_count,
            "failed_count": len(self.test_prompts) - success_count,
            "success_rate": round(success_count / max(len(self.test_prompts), 1), 4),
            "avg_latency_ms": round(sum(latencies) / max(len(latencies), 1), 1),
            "min_latency_ms": round(min(latencies), 1) if latencies else 0,
            "max_latency_ms": round(max(latencies), 1) if latencies else 0,
            "avg_tokens_per_second": round(sum(tokens_per_second) / max(len(tokens_per_second), 1), 1),
            "total_tokens": total_tokens,
            "by_category": self._summarize_by_category(results["tests"]),
        }

        with self._lock:
            self.results[model_id] = results

        return results

    def _summarize_by_category(self, tests: List[Dict]) -> Dict[str, Dict]:
        by_category = {}
        for test in tests:
            cat = test["category"]
            if cat not in by_category:
                by_category[cat] = {"count": 0, "success": 0, "avg_latency": 0.0}
            by_category[cat]["count"] += 1
            if test["status"] == "success":
                by_category[cat]["success"] += 1
                by_category[cat]["avg_latency"] += test["latency_ms"]
        for cat in by_category:
            if by_category[cat]["success"] > 0:
                by_category[cat]["avg_latency"] /= by_category[cat]["success"]
            by_category[cat]["success_rate"] = round(
                by_category[cat]["success"] / by_category[cat]["count"], 4
            )
        return by_category

    def compare_models(self, model_ids: List[str]) -> Dict[str, Any]:
        """比较多个模型的基准测试结果"""
        comparison = {
            "compared_models": model_ids,
            "metrics": {},
            "winner": "",
        }
        summaries = []
        for mid in model_ids:
            if mid in self.results:
                summaries.append((mid, self.results[mid]["summary"]))

        if not summaries:
            return comparison

        # 比较各指标
        metrics = ["success_rate", "avg_latency_ms", "avg_tokens_per_second"]
        for metric in metrics:
            values = {mid: s.get(metric, 0) for mid, s in summaries}
            if metric == "avg_latency_ms":
                winner = min(values, key=values.get)
            else:
                winner = max(values, key=values.get)
            comparison["metrics"][metric] = {
                "values": values,
                "winner": winner,
            }

        # 综合评分
        scores = {}
        for mid, s in summaries:
            score = (
                s.get("success_rate", 0) * 0.4 +
                (1 - min(s.get("avg_latency_ms", 10000) / 10000, 1)) * 0.3 +
                min(s.get("avg_tokens_per_second", 0) / 100, 1) * 0.3
            )
            scores[mid] = round(score, 4)
        comparison["composite_scores"] = scores
        comparison["winner"] = max(scores, key=scores.get) if scores else ""

        return comparison

    def get_result(self, model_id: str) -> Optional[Dict]:
        return self.results.get(model_id)

    def get_stats(self) -> Dict[str, Any]:
        return {
            "benchmark_id": self.benchmark_id,
            "test_prompts": len(self.test_prompts),
            "benchmarked_models": len(self.results),
            "categories": list(set(t["category"] for t in self.test_prompts)),
        }

_model_router = ModelRouter()

_model_load_balancer = ModelLoadBalancer()

_model_health_monitor = ModelHealthMonitor()

_model_cache = ModelCache()

_model_request_queue = ModelRequestQueue()

_model_cost_tracker = ModelCostTracker()

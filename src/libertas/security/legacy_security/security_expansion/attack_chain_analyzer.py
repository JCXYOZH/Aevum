"""
security/security_expansion.py - 安全模块综合扩展

高级安全功能：威胁情报中心、攻击链分析器、漏洞利用模拟器、
安全事件响应引擎、入侵检测规则引擎、安全合规检查器、
蜜罐管理系统、安全评分卡系统。
"""
import os
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 威胁等级
# ================================================================
from .threat_level import *  # noqa: F401,F403

class AttackChainAnalyzer:
    """攻击链分析器（Cyber Kill Chain模型）"""

    def __init__(self):
        self.analyzer_id = f"aca_{uuid.uuid4().hex[:8]}"
        self.chains: Dict[str, Dict[str, Any]] = {}
        self.stages = [
            "reconnaissance",      # 侦察
            "weaponization",       # 武器化
            "delivery",            # 投递
            "exploitation",        # 利用
            "installation",        # 安装
            "command_and_control", # 命令与控制
            "actions_on_objectives", # 目标行动
        ]
        self._lock = threading.RLock()

    def create_chain(self, chain_name: str, description: str = "") -> str:
        chain_id = f"chain_{uuid.uuid4().hex[:6]}"
        self.chains[chain_id] = {
            "chain_id": chain_id,
            "name": chain_name,
            "description": description,
            "created_at": time.time(),
            "events": [],
            "stage_progress": {stage: [] for stage in self.stages},
            "current_stage": 0,
            "severity": "unknown",
            "status": "active",
            "attributed_actor": "",
            "targets": [],
            "indicators": [],
        }
        return chain_id

    def add_event(self, chain_id: str, stage: str, event_type: str,
                  description: str = "", source_ip: str = "",
                  target: str = "", timestamp: float = 0.0,
                  metadata: Optional[Dict] = None) -> bool:
        chain = self.chains.get(chain_id)
        if not chain or stage not in self.stages:
            return False
        event = {
            "event_id": f"evt_{uuid.uuid4().hex[:6]}",
            "stage": stage,
            "event_type": event_type,
            "description": description,
            "source_ip": source_ip,
            "target": target,
            "timestamp": timestamp or time.time(),
            "metadata": metadata or {},
        }
        chain["events"].append(event)
        chain["stage_progress"][stage].append(event)
        # 更新当前阶段
        stage_idx = self.stages.index(stage)
        if stage_idx > chain["current_stage"]:
            chain["current_stage"] = stage_idx
        # 更新严重程度
        chain["severity"] = self._calculate_severity(chain)
        return True

    def _calculate_severity(self, chain: Dict) -> str:
        stage = chain["current_stage"]
        event_count = len(chain["events"])
        if stage >= 6:
            return "critical"
        elif stage >= 4:
            return "high"
        elif stage >= 2:
            return "medium"
        elif event_count > 5:
            return "medium"
        elif event_count > 0:
            return "low"
        return "info"

    def analyze_chain(self, chain_id: str) -> Dict[str, Any]:
        """分析攻击链"""
        chain = self.chains.get(chain_id)
        if not chain:
            return {"error": "chain not found"}
        stage_idx = chain["current_stage"]
        analysis = {
            "chain_id": chain_id,
            "name": chain["name"],
            "current_stage": self.stages[stage_idx],
            "stage_index": stage_idx,
            "completion_pct": round((stage_idx + 1) / len(self.stages) * 100, 1),
            "severity": chain["severity"],
            "status": chain["status"],
            "total_events": len(chain["events"]),
            "events_by_stage": {stage: len(events) for stage, events in chain["stage_progress"].items()},
            "next_stage": self.stages[stage_idx + 1] if stage_idx < len(self.stages) - 1 else "completed",
            "recommendations": self._generate_recommendations(chain),
            "time_span": (
                chain["events"][-1]["timestamp"] - chain["events"][0]["timestamp"]
                if len(chain["events"]) >= 2 else 0
            ),
        }
        return analysis

    def _generate_recommendations(self, chain: Dict) -> List[str]:
        stage = chain["current_stage"]
        recommendations = []
        if stage <= 0:
            recommendations.append("加强网络边界监控，检测异常扫描行为")
            recommendations.append("部署威胁情报系统，实时匹配已知攻击源")
        if stage <= 1:
            recommendations.append("检查邮件网关，过滤可疑附件和链接")
            recommendations.append("对用户进行钓鱼攻击防范培训")
        if stage <= 2:
            recommendations.append("及时修补已知漏洞，特别是高危漏洞")
            recommendations.append("部署Web应用防火墙，拦截常见攻击载荷")
        if stage <= 3:
            recommendations.append("监控异常进程创建和文件写入行为")
            recommendations.append("启用应用白名单，阻止未授权程序运行")
        if stage <= 4:
            recommendations.append("检测异常网络连接，特别是到已知C2服务器的连接")
            recommendations.append("实施网络分段，限制横向移动")
        if stage <= 5:
            recommendations.append("立即隔离受感染系统，防止数据外泄")
            recommendations.append("启动事件响应流程，收集取证证据")
            recommendations.append("评估数据泄露范围，通知相关方")
        return recommendations

    def correlate_events(self, events: List[Dict]) -> List[str]:
        """将安全事件关联到攻击链"""
        # 简化关联：基于事件类型和时间窗口
        correlated_chains = []
        for chain_id, chain in self.chains.items():
            if chain["status"] != "active":
                continue
            for event in events:
                event_type = event.get("type", "")
                for stage in self.stages:
                    stage_events = chain["stage_progress"][stage]
                    if any(e["event_type"] == event_type for e in stage_events):
                        if chain_id not in correlated_chains:
                            correlated_chains.append(chain_id)
        return correlated_chains

    def list_chains(self, status: str = "", severity: str = "",
                    limit: int = 20) -> List[Dict]:
        chains = list(self.chains.values())
        if status:
            chains = [c for c in chains if c["status"] == status]
        if severity:
            chains = [c for c in chains if c["severity"] == severity]
        chains.sort(key=lambda c: c["created_at"], reverse=True)
        return chains[:limit]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "analyzer_id": self.analyzer_id,
            "total_chains": len(self.chains),
            "active_chains": sum(1 for c in self.chains.values() if c["status"] == "active"),
            "by_severity": dict(Counter(c["severity"] for c in self.chains.values())),
            "avg_completion": (
                sum(c["current_stage"] for c in self.chains.values()) /
                max(len(self.chains), 1)
            ),
        }

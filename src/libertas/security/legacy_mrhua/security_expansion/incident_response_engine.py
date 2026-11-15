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
from .attack_chain_analyzer import *  # noqa: F401,F403
from .ids_rule_engine import *  # noqa: F401,F403

class IncidentResponseEngine:
    """安全事件响应引擎"""

    def __init__(self):
        self.engine_id = f"ire_{uuid.uuid4().hex[:8]}"
        self.incidents: Dict[str, Dict[str, Any]] = {}
        self.playbooks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._load_default_playbooks()

    def _load_default_playbooks(self):
        """加载默认响应剧本"""
        self.playbooks = {
            "malware_outbreak": {
                "name": "恶意软件爆发响应",
                "steps": [
                    {"step": 1, "action": "isolate_hosts", "description": "隔离受感染主机"},
                    {"step": 2, "action": "collect_evidence", "description": "收集取证证据"},
                    {"step": 3, "action": "analyze_malware", "description": "分析恶意软件样本"},
                    {"step": 4, "action": "remove_malware", "description": "清除恶意软件"},
                    {"step": 5, "action": "restore_systems", "description": "恢复系统正常运行"},
                    {"step": 6, "action": "post_incident_review", "description": "事后复盘"},
                ],
                "severity": "critical",
            },
            "data_breach": {
                "name": "数据泄露响应",
                "steps": [
                    {"step": 1, "action": "contain_breach", "description": "控制泄露范围"},
                    {"step": 2, "action": "assess_impact", "description": "评估影响范围"},
                    {"step": 3, "action": "notify_stakeholders", "description": "通知相关方"},
                    {"step": 4, "action": "remediate_vulnerability", "description": "修复漏洞"},
                    {"step": 5, "action": "monitor_for_misuse", "description": "监控数据滥用"},
                ],
                "severity": "critical",
            },
            "ddos_attack": {
                "name": "DDoS攻击响应",
                "steps": [
                    {"step": 1, "action": "activate_mitigation", "description": "启动DDoS防护"},
                    {"step": 2, "action": "identify_attack_vectors", "description": "识别攻击向量"},
                    {"step": 3, "action": "filter_malicious_traffic", "description": "过滤恶意流量"},
                    {"step": 4, "action": "scale_resources", "description": "扩容资源"},
                    {"step": 5, "action": "post_attack_analysis", "description": "攻击后分析"},
                ],
                "severity": "high",
            },
            "phishing_incident": {
                "name": "钓鱼事件响应",
                "steps": [
                    {"step": 1, "action": "block_sender", "description": "封锁发件人"},
                    {"step": 2, "action": "quarantine_email", "description": "隔离邮件"},
                    {"step": 3, "action": "identify_affected_users", "description": "识别受影响用户"},
                    {"step": 4, "action": "reset_credentials", "description": "重置凭证"},
                    {"step": 5, "action": "user_training", "description": "用户培训"},
                ],
                "severity": "medium",
            },
        }

    def create_incident(self, title: str, severity: str = "medium",
                        description: str = "", incident_type: str = "general",
                        affected_systems: Optional[List[str]] = None,
                        source: str = "") -> str:
        incident_id = f"inc_{uuid.uuid4().hex[:8]}"
        self.incidents[incident_id] = {
            "incident_id": incident_id,
            "title": title,
            "severity": severity,
            "description": description,
            "incident_type": incident_type,
            "affected_systems": affected_systems or [],
            "source": source,
            "created_at": time.time(),
            "updated_at": time.time(),
            "status": "open",  # open / investigating / contained / resolved / closed
            "assignee": "",
            "timeline": [{
                "time": time.time(),
                "event": "事件创建",
                "details": description,
            }],
            "playbook_executions": [],
            "indicators": [],
            "lessons_learned": "",
        }
        terminal.warn(f"创建安全事件: {title} ({severity})", "incident_response")
        return incident_id

    def update_incident(self, incident_id: str, status: str = "",
                         assignee: str = "", comment: str = "") -> bool:
        incident = self.incidents.get(incident_id)
        if not incident:
            return False
        if status:
            incident["status"] = status
            incident["timeline"].append({
                "time": time.time(),
                "event": f"状态变更: {status}",
                "details": comment,
            })
        if assignee:
            incident["assignee"] = assignee
        if comment:
            incident["timeline"].append({
                "time": time.time(),
                "event": "备注",
                "details": comment,
            })
        incident["updated_at"] = time.time()
        return True

    def execute_playbook(self, incident_id: str, playbook_id: str) -> Dict[str, Any]:
        """执行响应剧本"""
        incident = self.incidents.get(incident_id)
        playbook = self.playbooks.get(playbook_id)
        if not incident or not playbook:
            return {"error": "incident or playbook not found"}
        execution = {
            "execution_id": f"exec_{uuid.uuid4().hex[:6]}",
            "playbook_id": playbook_id,
            "playbook_name": playbook["name"],
            "started_at": time.time(),
            "completed_at": 0.0,
            "current_step": 0,
            "steps": [],
            "status": "running",
        }
        for step in playbook["steps"]:
            execution["steps"].append({
                "step": step["step"],
                "action": step["action"],
                "description": step["description"],
                "status": "pending",
                "completed_at": 0.0,
                "result": "",
            })
        incident["playbook_executions"].append(execution)
        incident["timeline"].append({
            "time": time.time(),
            "event": f"启动响应剧本: {playbook['name']}",
            "details": f"共{len(playbook['steps'])}个步骤",
        })
        return execution

    def complete_step(self, incident_id: str, execution_id: str,
                      step: int, result: str = "") -> bool:
        incident = self.incidents.get(incident_id)
        if not incident:
            return False
        for execution in incident["playbook_executions"]:
            if execution["execution_id"] == execution_id:
                for s in execution["steps"]:
                    if s["step"] == step:
                        s["status"] = "completed"
                        s["completed_at"] = time.time()
                        s["result"] = result
                        execution["current_step"] = step
                        if all(s["status"] == "completed" for s in execution["steps"]):
                            execution["status"] = "completed"
                            execution["completed_at"] = time.time()
                        return True
        return False

    def get_incident(self, incident_id: str) -> Optional[Dict]:
        return self.incidents.get(incident_id)

    def list_incidents(self, status: str = "", severity: str = "",
                       limit: int = 20) -> List[Dict]:
        incidents = list(self.incidents.values())
        if status:
            incidents = [i for i in incidents if i["status"] == status]
        if severity:
            incidents = [i for i in incidents if i["severity"] == severity]
        incidents.sort(key=lambda i: i["created_at"], reverse=True)
        return incidents[:limit]

    def list_playbooks(self) -> List[Dict]:
        return list(self.playbooks.values())

    def get_stats(self) -> Dict[str, Any]:
        return {
            "engine_id": self.engine_id,
            "total_incidents": len(self.incidents),
            "open_incidents": sum(1 for i in self.incidents.values() if i["status"] == "open"),
            "investigating": sum(1 for i in self.incidents.values() if i["status"] == "investigating"),
            "resolved": sum(1 for i in self.incidents.values() if i["status"] == "resolved"),
            "by_severity": dict(Counter(i["severity"] for i in self.incidents.values())),
            "playbooks": len(self.playbooks),
        }

class SecurityScorecard:
    """安全评分卡系统"""

    def __init__(self):
        self.scorecard_id = f"sc_{uuid.uuid4().hex[:8]}"
        self.scores: Dict[str, Dict[str, Any]] = {}
        self.categories = [
            "network_security",
            "endpoint_security",
            "application_security",
            "data_security",
            "identity_management",
            "incident_response",
            "compliance",
            "security_awareness",
        ]
        self._lock = threading.RLock()

    def update_score(self, entity: str, category: str, score: float,
                     evidence: str = "", details: Optional[Dict] = None):
        if category not in self.categories:
            return
        if entity not in self.scores:
            self.scores[entity] = {
                "entity": entity,
                "scores": {c: 0.0 for c in self.categories},
                "evidence": {c: [] for c in self.categories},
                "last_updated": time.time(),
                "history": [],
            }
        entity_score = self.scores[entity]
        entity_score["scores"][category] = max(0.0, min(100.0, score))
        entity_score["evidence"][category].append({
            "score": score,
            "evidence": evidence,
            "details": details or {},
            "timestamp": time.time(),
        })
        entity_score["last_updated"] = time.time()
        entity_score["history"].append({
            "category": category,
            "score": score,
            "timestamp": time.time(),
        })

    def get_overall_score(self, entity: str) -> Dict[str, Any]:
        entity_score = self.scores.get(entity)
        if not entity_score:
            return {"entity": entity, "overall_score": 0, "grade": "N/A"}
        scores = entity_score["scores"]
        # 加权平均
        weights = {
            "network_security": 0.15,
            "endpoint_security": 0.15,
            "application_security": 0.15,
            "data_security": 0.15,
            "identity_management": 0.15,
            "incident_response": 0.10,
            "compliance": 0.10,
            "security_awareness": 0.05,
        }
        overall = sum(scores.get(cat, 0) * weights.get(cat, 0.1) for cat in self.categories)
        grade = (
            "A" if overall >= 90 else
            "B" if overall >= 80 else
            "C" if overall >= 70 else
            "D" if overall >= 60 else
            "F"
        )
        return {
            "entity": entity,
            "overall_score": round(overall, 1),
            "grade": grade,
            "category_scores": {c: round(s, 1) for c, s in scores.items()},
            "weakest_category": min(scores, key=scores.get) if scores else "",
            "strongest_category": max(scores, key=scores.get) if scores else "",
            "last_updated": entity_score["last_updated"],
        }

    def get_score_history(self, entity: str, limit: int = 50) -> List[Dict]:
        entity_score = self.scores.get(entity)
        if not entity_score:
            return []
        return list(reversed(entity_score["history"]))[-limit:]

    def list_entities(self, min_score: float = 0.0) -> List[Dict]:
        entities = []
        for entity in self.scores:
            overall = self.get_overall_score(entity)
            if overall["overall_score"] >= min_score:
                entities.append(overall)
        entities.sort(key=lambda x: x["overall_score"], reverse=True)
        return entities

    def get_recommendations(self, entity: str) -> List[Dict[str, str]]:
        entity_score = self.scores.get(entity)
        if not entity_score:
            return []
        recommendations = []
        scores = entity_score["scores"]
        for category, score in scores.items():
            if score < 60:
                recommendations.append({
                    "category": category,
                    "current_score": str(round(score, 1)),
                    "priority": "high",
                    "recommendation": f"{category}得分较低，需要立即改进",
                })
            elif score < 80:
                recommendations.append({
                    "category": category,
                    "current_score": str(round(score, 1)),
                    "priority": "medium",
                    "recommendation": f"{category}有提升空间，建议定期审查",
                })
        return recommendations

    def get_stats(self) -> Dict[str, Any]:
        return {
            "scorecard_id": self.scorecard_id,
            "total_entities": len(self.scores),
            "avg_score": (
                sum(self.get_overall_score(e)["overall_score"] for e in self.scores) /
                max(len(self.scores), 1)
            ),
            "categories": self.categories,
        }

_threat_intel_center = ThreatIntelCenter()

_attack_chain_analyzer = AttackChainAnalyzer()

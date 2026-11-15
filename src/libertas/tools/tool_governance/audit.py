"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK
from .models import PendingApproval, RiskLevel, ToolCallRecord


class GovernanceAuditMixin:
    """调用记录、参数脱敏、审计日志与统计。"""

    def record_call(self, tool_name: str, tool_type: str, params: Dict,
                    target: str, success: bool, duration: float,
                    error: str = "", result_summary: str = "",
                    user_approved: bool = False, session_id: str = "") -> ToolCallRecord:
        """记录一次工具调用"""
        info = self.get_tool_info(tool_name, tool_type)
        record = ToolCallRecord(
            id=str(uuid.uuid4())[:12],
            timestamp=time.time(),
            tool_name=tool_name,
            tool_type=tool_type,
            risk_level=info["risk"],
            params=self._sanitize_params(params),
            target=target,
            success=success,
            duration=round(duration, 3),
            error=error[:500],
            result_summary=result_summary[:500],
            user_approved=user_approved,
            session_id=session_id,
        )
    
        with self._lock:
            self._audit_log.append(record)
            if len(self._audit_log) > 1000:
                self._audit_log = self._audit_log[-1000:]
    
            if self._config["audit_enabled"]:
                self._write_audit(record)
    
        self._notify_listeners("tool_called", record)
        return record

    def _sanitize_params(self, params: Dict) -> Dict:
        """脱敏参数中的敏感信息"""
        if not params:
            return {}
        sanitized = {}
        sensitive_keys = {"password", "passwd", "token", "api_key", "secret",
                         "key", "credential", "auth", "cookie"}
        for k, v in params.items():
            if k.lower() in sensitive_keys:
                sanitized[k] = "***"
            else:
                sanitized[k] = v
        return sanitized

    def _write_audit(self, record: ToolCallRecord):
        """追加写入审计日志文件"""
        try:
            with open(self._audit_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning(f"写入审计日志失败: {e}")

    def get_audit_log(self, limit: int = 100, tool_name: str = "",
                      success_only: bool = False, risk_level: str = "") -> List[Dict]:
        """查询审计日志"""
        with self._lock:
            records = list(self._audit_log)
    
        # 也从文件读取
        try:
            if os.path.exists(self._audit_file):
                file_records = []
                with open(self._audit_file, "r", encoding="utf-8") as f:
                    for line in f:
                        try:
                            file_records.append(json.loads(line.strip()))
                        except Exception:
                            pass
                # 合并去重
                seen_ids = {r.id for r in records}
                for fr in file_records:
                    if fr.get("id") not in seen_ids:
                        records.append(ToolCallRecord(**fr))
        except Exception:
            pass
    
        # 过滤
        if tool_name:
            records = [r for r in records if r.tool_name == tool_name]
        if success_only:
            records = [r for r in records if r.success]
        if risk_level:
            records = [r for r in records if r.risk_level == risk_level]
    
        records.sort(key=lambda r: r.timestamp, reverse=True)
        return [asdict(r) if isinstance(r, ToolCallRecord) else r for r in records[:limit]]

    def get_audit_stats(self) -> Dict:
        """审计统计"""
        with self._lock:
            records = list(self._audit_log)
    
        stats = {
            "total_calls": len(records),
            "success_count": sum(1 for r in records if r.success),
            "failed_count": sum(1 for r in records if not r.success),
            "by_tool": {},
            "by_risk": {},
            "by_type": {},
            "pending_approvals": len([a for a in self._pending.values() if not a.resolved]),
        }
        for r in records:
            stats["by_tool"][r.tool_name] = stats["by_tool"].get(r.tool_name, 0) + 1
            stats["by_risk"][r.risk_level] = stats["by_risk"].get(r.risk_level, 0) + 1
            stats["by_type"][r.tool_type] = stats["by_type"].get(r.tool_type, 0) + 1
    
        return stats

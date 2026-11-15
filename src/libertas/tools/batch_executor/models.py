"""职责模块：models。"""

from __future__ import annotations

from typing import Dict, List, Any, Optional, Callable
from enum import Enum
from dataclasses import dataclass, field
import json

@dataclass
class ToolTask:
    """单个工具任务"""
    tool_name: str
    target: str
    kwargs: Dict[str, Any] = field(default_factory=dict)
    index: int = 0  # 原始顺序

    def label(self) -> str:
        """生成任务标签"""
        parts = [self.tool_name, self.target]
        for k, v in self.kwargs.items():
            if v is True:
                parts.append(f"-{k}")
            else:
                parts.append(f"-{k} {v}")
        return " ".join(str(p) for p in parts)

@dataclass
class ToolResult:
    """单个工具执行结果"""
    task: ToolTask
    success: bool
    data: Any = None
    error: str = ""
    duration: float = 0.0
    timed_out: bool = False

    def summary(self, max_chars: int = 500) -> str:
        """生成结构化摘要"""
        head = f"[{self.task.tool_name} → {self.task.target}]"
        if self.timed_out:
            return f"{head} ⏱ 超时（{self.duration:.1f}s），已跳过"
        if not self.success:
            return f"{head} [FAIL] {self.error[:200]}"
        body = self._format_data()
        if len(body) > max_chars:
            body = body[:max_chars] + f"\n... (共{len(body)}字符，详细结果在前端展开)"
        return f"{head} [OK] ({self.duration:.1f}s)\n{body}"

    def _format_data(self) -> str:
        """智能格式化数据"""
        d = self.data
        if isinstance(d, dict):
            dd = d.get("data", d)
            if isinstance(dd, dict):
                # DNS记录
                if "records" in dd:
                    lines = []
                    for rec in dd["records"][:10]:
                        if isinstance(rec, dict):
                            parts = [f"{rec.get('type', '?')}"]
                            if "value" in rec:
                                parts.append(str(rec["value"]))
                            if "priority" in rec:
                                parts.append(f"priority={rec['priority']}")
                            lines.append("  " + " ".join(parts))
                        else:
                            lines.append(f"  {rec}")
                    return "\n".join(lines)
                # 端口扫描
                if "open_ports" in dd:
                    ports = dd["open_ports"]
                    lines = [f"开放端口: {len(ports)}个"]
                    for p in ports[:15]:
                        lines.append(f"  {p.get('port')}/{p.get('protocol','tcp')} {p.get('service','')} {p.get('version','')}")
                    return "\n".join(lines)
                # HTTP指纹
                if "technologies" in dd:
                    lines = [f"标题: {dd.get('title', '')}"]
                    lines.append(f"技术栈: {', '.join(dd['technologies'])}")
                    if "status_code" in dd:
                        lines.append(f"状态码: {dd['status_code']}")
                    return "\n".join(lines)
                # WHOIS
                if "registrar" in dd or "creation_date" in dd:
                    lines = []
                    for k in ("registrar", "creation_date", "expiry_date", "name_servers"):
                        if k in dd:
                            lines.append(f"{k}: {dd[k]}")
                    return "\n".join(lines)
                # SSL证书
                if "subject" in dd or "issuer" in dd:
                    lines = []
                    for k in ("subject", "issuer", "not_before", "not_after", "serial_number"):
                        if k in dd:
                            lines.append(f"{k}: {dd[k]}")
                    return "\n".join(lines)
                # 通用JSON
                return json.dumps(dd, ensure_ascii=False, indent=2)
            return str(dd)
        return str(d)

class BatchTaskStatus(Enum):
    """批量任务状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

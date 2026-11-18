"""应用运行状态。"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List


@dataclass
class ApplicationState:
    """记录生命周期与组件初始化结果。"""

    running: bool = False
    started_at: datetime = field(default_factory=datetime.now)
    stopped_at: datetime | None = None
    dialogue_count: int = 0
    active_user: str = "anonymous"
    component_status: Dict[str, str] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)

    def mark_component(self, name: str, available: bool, detail: str = "") -> None:
        self.component_status[name] = "ready" if available else f"unavailable: {detail}"

    def mark_running(self) -> None:
        self.running = True
        self.started_at = datetime.now()

    def mark_stopped(self) -> None:
        self.running = False
        self.stopped_at = datetime.now()

    def record_dialogue(self) -> None:
        self.dialogue_count += 1

    def record_error(self, message: str) -> None:
        self.errors.append(message)

    def snapshot(self) -> Dict[str, object]:
        return {
            "running": self.running,
            "started_at": self.started_at.isoformat(timespec="seconds"),
            "stopped_at": self.stopped_at.isoformat(timespec="seconds") if self.stopped_at else "",
            "dialogue_count": self.dialogue_count,
            "active_user": self.active_user,
            "components": dict(self.component_status),
            "errors": list(self.errors),
        }

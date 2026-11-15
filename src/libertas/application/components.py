"""应用组件容器。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict


@dataclass
class ApplicationComponents:
    """持有已初始化组件，不承担初始化逻辑。"""

    memory: Any = None
    users: Any = None
    guardian: Any = None
    cognitive: Any = None
    knowledge: Any = None
    character: Any = None
    monitor: Any = None
    output: Any = None
    binary: Any = None
    living_memory: Any = None
    tools: Any = None
    extras: Dict[str, Any] = field(default_factory=dict)

"""控制平面的公共契约。

这里只定义核心运行时身份与运行状态，不导入任何核心实现。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class CoreKind(str, Enum):
    """核心的实现类型。"""

    PYTHON = "python"
    PROCESS = "process"
    NATIVE = "native"


@dataclass(frozen=True)
class CoreSpec:
    """一个核心运行时的静态描述。"""

    name: str
    root: str
    package: str
    kind: CoreKind = CoreKind.PYTHON
    entry: str = ""


@dataclass
class CoreStatus:
    """核心在当前进程中的运行状态。"""

    name: str
    state: str = "stopped"
    pid: int | None = None
    exitcode: int | None = None
    detail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

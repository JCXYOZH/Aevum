"""三个核心运行时的登记表。"""

from __future__ import annotations

from .contract import CoreKind, CoreSpec


DEFAULT_CORES: tuple[CoreSpec, ...] = (
    CoreSpec("kernel", "src/kernel", "fortuna", CoreKind.PYTHON),
    CoreSpec("architecture", "src/architecture", "libertas", CoreKind.PYTHON),
    CoreSpec("engine", "engine", "", CoreKind.PROCESS),
)


def by_name(name: str) -> CoreSpec:
    """按核心名取登记项；不存在时抛出 KeyError，不静默造一个。"""
    for spec in DEFAULT_CORES:
        if spec.name == name:
            return spec
    raise KeyError(f"unknown core: {name}")

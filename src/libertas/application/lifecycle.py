"""应用关闭与资源释放。"""

from __future__ import annotations

from libertas.application.components import ApplicationComponents
from libertas.application.state import ApplicationState
from libertas.foundation.terminal import terminal


class ShutdownService:
    """按依赖顺序释放应用资源。"""

    def __init__(self, components: ApplicationComponents, state: ApplicationState):
        self.components = components
        self.state = state

    def shutdown(self) -> None:
        living_memory = self.components.living_memory
        if living_memory is not None:
            try:
                living_memory.save()
            except Exception as exc:
                terminal.warn(f"活的记忆保存失败: {exc}", "shutdown")
            try:
                living_memory.stop()
            except Exception as exc:
                terminal.warn(f"活的记忆停止失败: {exc}", "shutdown")

        monitor = self.components.monitor
        if monitor is not None:
            try:
                monitor.stop_monitoring()
            except Exception as exc:
                terminal.warn(f"监控停止失败: {exc}", "shutdown")

        self.state.mark_stopped()
        terminal.info("应用已停止", "application")

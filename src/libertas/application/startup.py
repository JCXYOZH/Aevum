"""应用组件初始化。"""

from __future__ import annotations

import os
from typing import Any, Callable

from libertas.application.components import ApplicationComponents
from libertas.application.settings import RuntimeSettings
from libertas.application.state import ApplicationState
from libertas.foundation.terminal import terminal


class ApplicationBootstrap:
    """按组件职责初始化，单个组件失败不阻断其余组件。"""

    def __init__(self, settings: RuntimeSettings, state: ApplicationState):
        self.settings = settings
        self.state = state

    def _build(self, name: str, factory: Callable[[], Any]) -> Any:
        try:
            instance = factory()
            self.state.mark_component(name, True)
            return instance
        except Exception as exc:
            self.state.mark_component(name, False, type(exc).__name__)
            self.state.record_error(f"{name}: {exc}")
            terminal.warn(f"组件初始化失败 {name}: {exc}", "application")
            return None

    def build(self) -> ApplicationComponents:
        os.makedirs(self.settings.data_dir, exist_ok=True)
        os.makedirs(self.settings.memory_dir, exist_ok=True)
        os.makedirs(self.settings.log_dir, exist_ok=True)

        from libertas.ai.cognitive import CognitiveNetwork
        from libertas.ai.character import CharacterRecognizer
        from libertas.ai.knowledge import KnowledgeEngine
        from libertas.ai.living_memory import LivingMemory
        from libertas.ai.memory import MemorySystem
        from libertas.ai.output_controller import OutputController
        from libertas.identity.user import UserManager
        from libertas.observability.monitor import MonitorManager
        from libertas.security.guardian import GuardianSystem
        from libertas.tools.binary_executor import BinaryExecutor
        from libertas.tools.tool_library import ToolLibrary

        components = ApplicationComponents()

        components.memory = self._build(
            "memory",
            lambda: MemorySystem(
                data_dir=self.settings.data_dir,
                memory_directory=self.settings.memory_dir,
                global_dir=self.settings.memory_global_dir,
            ),
        )
        components.users = self._build(
            "users",
            lambda: UserManager(data_dir=self.settings.user_dir),
        )
        components.guardian = self._build(
            "guardian",
            lambda: GuardianSystem(
                memory_system=components.memory,
                user_manager=components.users,
            ),
        )
        components.cognitive = self._build(
            "cognitive",
            lambda: CognitiveNetwork(
                data_dir=self.settings.data_dir,
                memory_system=components.memory,
            ),
        )
        components.knowledge = self._build(
            "knowledge",
            lambda: KnowledgeEngine(
                data_dir=self.settings.data_dir,
                memory_system=components.memory,
            ),
        )
        components.character = self._build(
            "character",
            lambda: CharacterRecognizer(
                data_dir=self.settings.data_dir,
                memory_system=components.memory,
            ),
        )
        components.monitor = self._build("monitor", lambda: MonitorManager())
        components.output = self._build("output", lambda: OutputController())
        components.binary = self._build("binary", lambda: BinaryExecutor())
        components.living_memory = self._build(
            "living_memory",
            lambda: LivingMemory(storage_dir=os.path.join(self.settings.data_dir, "living_memory")),
        )
        components.tools = self._build(
            "tools",
            lambda: ToolLibrary(auto_register_security_tools=False, default_max_risk="low_risk"),
        )
        return components

"""应用门面。"""

from __future__ import annotations

from typing import Any, Dict, Optional

from libertas.application.commands import CommandHandler
from libertas.application.components import ApplicationComponents
from libertas.application.conversation import ConversationService
from libertas.application.lifecycle import ShutdownService
from libertas.application.settings import RuntimeSettings
from libertas.application.startup import ApplicationBootstrap
from libertas.application.state import ApplicationState
from libertas.foundation.terminal import terminal


class LibertasSystem:
    """装配并对外提供统一入口。"""

    def __init__(self, settings: Optional[RuntimeSettings] = None):
        self.settings = settings or RuntimeSettings.load()
        self.state = ApplicationState()
        self.components = ApplicationComponents()
        self._bootstrap: Optional[ApplicationBootstrap] = None
        self._conversation: Optional[ConversationService] = None
        self._commands: Optional[CommandHandler] = None
        self._shutdown: Optional[ShutdownService] = None

    @property
    def running(self) -> bool:
        return self.state.running

    def start(self) -> "LibertasSystem":
        if self.state.running:
            return self
        terminal.info("正在初始化 Libertas 组件", "application")
        self._bootstrap = ApplicationBootstrap(self.settings, self.state)
        self.components = self._bootstrap.build()
        self._conversation = ConversationService(self.components, self.state)
        self._commands = CommandHandler(self.components, self.state)
        self._shutdown = ShutdownService(self.components, self.state)
        self.state.mark_running()
        ready = sum(1 for value in self.state.component_status.values() if value == "ready")
        terminal.success(f"Libertas 已启动，组件 {ready}/{len(self.state.component_status)} 可用", "application")
        return self

    def handle(self, user_input: str, user_id: str = "anonymous") -> str:
        if not self.state.running:
            self.start()
        if self._commands is None or self._conversation is None:
            raise RuntimeError("应用未完成初始化")
        result = self._commands.handle(user_input)
        if result is not None:
            if result.should_exit:
                self.stop()
            return result.output
        return self._conversation.respond(user_input, user_id)

    def status(self) -> Dict[str, Any]:
        return self.state.snapshot()

    def stop(self) -> None:
        if self._shutdown is not None:
            self._shutdown.shutdown()
        else:
            self.state.mark_stopped()

    def __enter__(self) -> "LibertasSystem":
        return self.start()

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.stop()

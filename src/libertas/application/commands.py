"""本地命令处理。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from libertas.application.components import ApplicationComponents
from libertas.application.state import ApplicationState


@dataclass
class CommandResult:
    handled: bool
    output: str = ""
    should_exit: bool = False


class CommandHandler:
    """解析并执行斜杠命令。"""

    def __init__(self, components: ApplicationComponents, state: ApplicationState):
        self.components = components
        self.state = state

    def handle(self, text: str) -> Optional[CommandResult]:
        stripped = text.strip()
        if not stripped.startswith("/"):
            return None
        command, _, argument = stripped[1:].partition(" ")
        command = command.lower()
        argument = argument.strip()
        handlers = {
            "帮助": self._help,
            "help": self._help,
            "?": self._help,
            "状态": self._status,
            "status": self._status,
            "记忆": lambda: self._memory(argument),
            "memory": lambda: self._memory(argument),
            "清空": self._clear,
            "clear": self._clear,
            "工具": self._tools,
            "tools": self._tools,
            "退出": self._exit,
            "exit": self._exit,
            "quit": self._exit,
        }
        handler = handlers.get(command)
        if handler is None:
            return CommandResult(False, f"未知命令: /{command}。使用 /帮助 查看可用命令。")
        return handler()

    def _help(self) -> CommandResult:
        return CommandResult(
            True,
            "\n".join(
                [
                    "可用命令:",
                    "  /帮助            显示命令列表",
                    "  /状态            显示运行状态与组件可用性",
                    "  /记忆 <关键词>   检索记忆",
                    "  /工具            列出已注册工具",
                    "  /清空            清空工作记忆与短期记忆",
                    "  /退出            保存并退出",
                ]
            ),
        )

    def _status(self) -> CommandResult:
        snapshot = self.state.snapshot()
        lines = [
            "系统状态:",
            f"  运行中: {snapshot['running']}",
            f"  启动时间: {snapshot['started_at']}",
            f"  对话次数: {snapshot['dialogue_count']}",
            f"  当前用户: {snapshot['active_user']}",
            "组件:",
        ]
        for name, status in snapshot["components"].items():
            lines.append(f"  {name}: {status}")
        if self.components.memory is not None:
            try:
                stats = self.components.memory.get_stats()
                lines.append(f"  记忆条目: {stats.get('total_memories', stats.get('total', 0))}")
            except Exception as exc:
                lines.append(f"  记忆统计不可用: {exc}")
        return CommandResult(True, "\n".join(lines))

    def _memory(self, query: str) -> CommandResult:
        if not query:
            return CommandResult(True, "用法: /记忆 <关键词>")
        memory = self.components.memory
        if memory is None:
            return CommandResult(True, "记忆组件不可用。")
        try:
            results = memory.retrieve_mixed(query, quantity=5) or []
        except Exception as exc:
            return CommandResult(True, f"记忆检索失败: {exc}")
        if not results:
            return CommandResult(True, f"未找到与“{query}”相关的记忆。")
        lines = [f"与“{query}”相关的记忆:"]
        for index, item in enumerate(results, 1):
            content = item.get("内容") or item.get("content") or item.get("full_content") or ""
            lines.append(f"  {index}. {str(content)[:160]}")
        return CommandResult(True, "\n".join(lines))

    def _tools(self) -> CommandResult:
        tools = self.components.tools
        if tools is None:
            return CommandResult(True, "工具组件不可用。")
        try:
            definitions = tools.list_tools()
        except Exception as exc:
            return CommandResult(True, f"工具列表读取失败: {exc}")
        if not definitions:
            return CommandResult(True, "当前未注册工具。")
        lines = [f"已注册工具 ({len(definitions)}):"]
        for definition in definitions[:50]:
            name = getattr(definition, "name", "unknown")
            description = getattr(definition, "description", "")
            lines.append(f"  {name}: {description}")
        return CommandResult(True, "\n".join(lines))

    def _clear(self) -> CommandResult:
        cleared = []
        memory = self.components.memory
        living_memory = self.components.living_memory
        if memory is not None:
            try:
                memory.clear_short_term()
                cleared.append("短期记忆")
            except Exception as exc:
                cleared.append(f"短期记忆失败: {exc}")
        if living_memory is not None:
            try:
                living_memory.clear_working()
                cleared.append("工作记忆")
            except Exception as exc:
                cleared.append(f"工作记忆失败: {exc}")
        return CommandResult(True, "已清空: " + "、".join(cleared) if cleared else "没有可清空的组件。")

    def _exit(self) -> CommandResult:
        return CommandResult(True, "正在保存并退出。", True)

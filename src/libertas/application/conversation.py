"""本地对话处理。"""

from __future__ import annotations

import time
from typing import Dict, List

from libertas.application.components import ApplicationComponents
from libertas.application.state import ApplicationState
from libertas.foundation.terminal import terminal


class ConversationService:
    """执行安全检查、记忆读写与本地规则回复。"""

    def __init__(self, components: ApplicationComponents, state: ApplicationState):
        self.components = components
        self.state = state

    def respond(self, user_input: str, user_id: str = "anonymous") -> str:
        text = self._normalize(user_input)
        self.state.active_user = user_id
        started = time.time()

        security = self._security_check(text)
        if not security.get("通过", True):
            reasons = "；".join(security.get("风险原因", [])) or "输入未通过安全检查"
            return f"请求未处理。原因: {reasons}"

        self._remember(text, user_id)
        reply = self._rule_reply(text)
        reply = self._post_process(reply, text)
        self._remember(reply, "assistant", memory_type="对话回复")
        self.state.record_dialogue()

        elapsed_ms = (time.time() - started) * 1000
        terminal.debug(f"对话处理完成，耗时 {elapsed_ms:.1f} ms", "conversation")
        return reply

    def _normalize(self, value: str) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace").strip()
        return str(value).strip()

    def _security_check(self, text: str) -> Dict:
        guardian = self.components.guardian
        if guardian is None:
            return {"通过": True}
        try:
            return guardian.check_dialogue_security(text)
        except Exception as exc:
            terminal.warn(f"安全检查不可用: {exc}", "conversation")
            return {"通过": True}

    def _remember(self, content: str, source: str, memory_type: str = "对话") -> None:
        memory = self.components.memory
        if memory is None or not content:
            return
        try:
            memory.record_memory(
                content=content,
                memory_type=memory_type,
                context={"source": source},
                context_description=source,
            )
        except Exception as exc:
            terminal.warn(f"记忆写入失败: {exc}", "conversation")

    def _related_memories(self, query: str, limit: int = 3) -> List[str]:
        memory = self.components.memory
        if memory is None:
            return []
        try:
            results = memory.retrieve_mixed(query, quantity=limit) or []
        except Exception:
            return []
        snippets = []
        for item in results:
            content = item.get("内容") or item.get("content") or item.get("full_content") or ""
            if content:
                snippets.append(str(content)[:80])
        return snippets

    def _rule_reply(self, text: str) -> str:
        lower = text.lower()
        if any(word in text for word in ("你好", "您好", "嗨", "在吗")) or lower in ("hi", "hello"):
            return "你好。我是 Libertas，本地系统已启动。有什么需要处理的？"
        if any(word in text for word in ("谢谢", "感谢", "多谢")):
            return "不用客气。"
        if any(word in text for word in ("再见", "拜拜", "晚安")) or lower in ("bye", "goodbye"):
            return "再见。"
        if any(word in text for word in ("你是谁", "你叫什么", "介绍一下你自己")):
            return "我是 Libertas，当前运行的是本地规则模式，可读写记忆、调用已注册工具并执行安全检查。"
        if any(word in text for word in ("帮助", "怎么用", "能做什么")):
            return "输入 /帮助 查看命令。直接输入文字会先经过安全检查，再写入记忆并生成本地规则回复。"
        if any(word in text for word in ("状态", "运行情况")) or lower == "status":
            return "输入 /状态 查看组件可用性与运行计数。"
        if "?" in text or "？" in text or any(word in text for word in ("什么", "怎么", "为什么", "如何")):
            related = self._related_memories(text)
            if related:
                return "相关记忆:\n" + "\n".join(f"  - {item}" for item in related)
            return "当前为本地规则模式，模型接口尚未配置，无法生成深度回答。可先用 /记忆 检索已有记录。"
        return "已记录。当前为本地规则模式；配置模型接口后可由模型生成回答。"

    def _post_process(self, reply: str, prompt: str) -> str:
        output = self.components.output
        if output is None:
            return reply
        try:
            result = output.process(reply, prompt=prompt)
            return result.content
        except Exception as exc:
            terminal.warn(f"输出处理失败: {exc}", "conversation")
            return reply

"""意图路由职责：core。"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.ai.intent_classifier import ClassificationResult, get_intent_classifier
from libertas.foundation.config import get_data_dir

from .models import DialogContext
from .models import DialogState
from .models import IntentHandler
from .ui import UIControlDetector

class IntentRouter:
    """意图识别与前端指挥系统（融合完整路由系统和UI控制检测）"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "intent_router")
        os.makedirs(self.data_dir, exist_ok=True)
        self._handlers: Dict[str, IntentHandler] = {}
        self._sessions: Dict[str, DialogContext] = {}
        self._lock = threading.RLock()
        self._classifier = get_intent_classifier()
        self._fallback_handler: Optional[Callable] = None
        self._middleware: List[Callable] = []
        # UI控制检测器（吸收0.1.5）
        self._ui_detector = UIControlDetector()
        self._init_default_handlers()

    def _init_default_handlers(self):
        """初始化默认处理器"""
        def greeting_handler(ctx, cls):
            return {"message": "你好！有什么可以帮你的吗？", "action": "respond"}

        def farewell_handler(ctx, cls):
            return {"message": "再见！有需要随时找我。", "action": "respond", "end_session": True}

        def help_handler(ctx, cls):
            return {"message": "我可以帮你处理各种任务，包括代码编写、信息查询、安全扫描等。请告诉我你的需求。", "action": "respond"}

        def unknown_handler(ctx, cls):
            return {"message": "抱歉，我不太理解你的意思。能换一种说法吗？", "action": "clarify"}

        # UI控制处理器（吸收0.1.5）
        def switch_theme_handler(ctx, cls):
            theme = cls.entities.get("theme", "")
            return {"message": f"已切换到{THEMES.get(theme, {}).get('name', theme)}主题", "action": "switch_theme", "theme": theme}

        def open_window_handler(ctx, cls):
            window = cls.entities.get("window", "")
            return {"message": f"已打开{window}窗口", "action": "open_window", "window": window}

        def orb_command_handler(ctx, cls):
            command = cls.entities.get("command", "")
            return {"message": f"灵体执行{command}动作", "action": "orb_command", "command": command}

        def change_setting_handler(ctx, cls):
            key = cls.entities.get("key", "")
            value = cls.entities.get("value", "")
            return {"message": f"已将{key}设置为{value}", "action": "change_setting", "key": key, "value": value}

        self.register_handler("greeting", greeting_handler, "问候处理")
        self.register_handler("farewell", farewell_handler, "告别处理")
        self.register_handler("help", help_handler, "帮助处理")
        self.register_handler("unknown", unknown_handler, "未知意图处理")
        # UI控制处理器（吸收0.1.5）
        self.register_handler("switch_theme", switch_theme_handler, "切换主题", ["theme"], 10)
        self.register_handler("open_window", open_window_handler, "打开窗口", ["window"], 10)
        self.register_handler("orb_command", orb_command_handler, "灵体指令", ["command"], 10)
        self.register_handler("change_setting", change_setting_handler, "修改设置", ["key", "value"], 5)
        self._fallback_handler = unknown_handler

    def register_handler(self, intent_name: str, handler: Callable,
                         description: str = "", required_slots: Optional[List[str]] = None,
                         priority: int = 0) -> str:
        h = IntentHandler(intent_name, handler, description, required_slots, priority)
        with self._lock:
            self._handlers[intent_name] = h
        return intent_name

    def unregister_handler(self, intent_name: str) -> bool:
        with self._lock:
            if intent_name in self._handlers:
                del self._handlers[intent_name]
                return True
        return False

    def get_handler(self, intent_name: str) -> Optional[IntentHandler]:
        return self._handlers.get(intent_name)

    def list_handlers(self) -> List[IntentHandler]:
        return sorted(self._handlers.values(), key=lambda h: h.priority, reverse=True)

    def add_middleware(self, middleware: Callable):
        self._middleware.append(middleware)

    def set_fallback_handler(self, handler: Callable):
        self._fallback_handler = handler

    def get_or_create_session(self, session_id: str = "", user_id: str = "") -> DialogContext:
        with self._lock:
            if session_id and session_id in self._sessions:
                return self._sessions[session_id]
            ctx = DialogContext(session_id, user_id)
            self._sessions[ctx.session_id] = ctx
            return ctx

    def get_session(self, session_id: str) -> Optional[DialogContext]:
        return self._sessions.get(session_id)

    def end_session(self, session_id: str) -> bool:
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
        return False

    def detect_ui_controls(self, text: str) -> List[Dict[str, Any]]:
        """检测UI控制指令（吸收0.1.5，公开方法）"""
        return self._ui_detector.detect(text)

    def process(self, user_input: str, session_id: str = "",
                user_id: str = "") -> Dict[str, Any]:
        """处理用户输入（分类→UI检测→中间件→处理器→回退）"""
        ctx = self.get_or_create_session(session_id, user_id)

        # 1. UI控制检测（吸收0.1.5，优先检测）
        ui_commands = self._ui_detector.detect(user_input)

        # 2. 意图分类（使用外部分类器）
        classification = self._classifier.classify(user_input)
        intent = classification.intent

        # 3. 如果检测到UI控制指令，覆盖意图
        if ui_commands:
            first_cmd = ui_commands[0]
            action = first_cmd.get("action", "")
            intent_map = {
                "switch_theme": "switch_theme",
                "open_window": "open_window",
                "orb_command": "orb_command",
                "change_setting": "change_setting",
            }
            if action in intent_map:
                intent = intent_map[action]
                classification.intent = intent
                classification.confidence = 0.95
                # 填充实体
                if action == "switch_theme":
                    classification.entities["theme"] = first_cmd.get("theme", "")
                elif action == "open_window":
                    classification.entities["window"] = first_cmd.get("window", "")
                elif action == "orb_command":
                    classification.entities["command"] = first_cmd.get("command", "")
                elif action == "change_setting":
                    classification.entities["key"] = first_cmd.get("key", "")
                    classification.entities["value"] = first_cmd.get("value", "")

        # 4. 中间件处理
        for middleware in self._middleware:
            try:
                result = middleware(ctx, classification)
                if result and isinstance(result, dict) and result.get("skip"):
                    return result
            except Exception:
                pass

        # 5. 更新上下文
        ctx.set_intent(intent)
        ctx.last_user_input = user_input
        # 填充分类器提取的实体到槽位（UI控制处理器需要的槽位会被自动填充）
        for key, value in classification.entities.items():
            if value:
                ctx.fill_slot(key, value)

        # 6. 检查是否需要收集槽位
        handler = self._handlers.get(intent)
        if handler and handler.required_slots:
            ctx.required_slots = handler.required_slots
            missing = ctx.get_missing_slots()
            if missing:
                ctx.state = DialogState.COLLECTING
                response = {
                    "success": True,
                    "intent": intent,
                    "confidence": classification.confidence,
                    "state": ctx.state.value,
                    "missing_slots": missing,
                    "message": f"需要更多信息：{', '.join(missing)}",
                    "action": "collect",
                    "session_id": ctx.session_id,
                    "ui_commands": ui_commands,
                }
                ctx.add_turn(user_input, response["message"])
                return response

        # 7. 执行处理器
        if handler and handler.handler:
            ctx.state = DialogState.EXECUTING
            result = handler.execute(ctx, classification)
            ctx.state = DialogState.COMPLETED if result.get("success") else DialogState.FAILED
            message = result.get("result", {}).get("message", "处理完成") if result.get("success") else result.get("error", "处理失败")
            response = {
                "success": result.get("success", False),
                "intent": intent,
                "confidence": classification.confidence,
                "state": ctx.state.value,
                "message": message,
                "result": result.get("result"),
                "action": result.get("result", {}).get("action", "respond"),
                "alternatives": classification.alternatives,
                "ambiguous": classification.ambiguous,
                "session_id": ctx.session_id,
                "entities": classification.entities,
                "ui_commands": ui_commands,
            }
        elif self._fallback_handler:
            ctx.state = DialogState.EXECUTING
            try:
                result = self._fallback_handler(ctx, classification)
                ctx.state = DialogState.COMPLETED
                message = result.get("message", "抱歉，我不太理解。")
            except Exception as e:
                ctx.state = DialogState.FAILED
                message = str(e)
            response = {
                "success": True,
                "intent": intent,
                "confidence": classification.confidence,
                "state": ctx.state.value,
                "message": message,
                "action": "respond",
                "session_id": ctx.session_id,
                "ui_commands": ui_commands,
            }
        else:
            response = {
                "success": False,
                "intent": intent,
                "confidence": classification.confidence,
                "state": DialogState.FAILED.value,
                "message": "无可用处理器",
                "session_id": ctx.session_id,
                "ui_commands": ui_commands,
            }

        ctx.add_turn(user_input, response.get("message", ""))
        return response

    def fill_slot(self, session_id: str, key: str, value: Any) -> bool:
        ctx = self._sessions.get(session_id)
        if ctx:
            ctx.fill_slot(key, value)
            return True
        return False

    def reset_session(self, session_id: str) -> bool:
        ctx = self._sessions.get(session_id)
        if ctx:
            ctx.reset()
            return True
        return False

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_handlers": len(self._handlers),
            "active_sessions": len(self._sessions),
            "total_calls": sum(h.call_count for h in self._handlers.values()),
            "middleware_count": len(self._middleware),
            "has_fallback": self._fallback_handler is not None,
            "supported_windows": len(WINDOW_ALIASES),
            "supported_themes": len(THEMES),
            "supported_orb_commands": len(ORB_COMMANDS),
        }

"""意图路由职责：models。"""

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


class DialogState(Enum):
    IDLE = "idle"
    COLLECTING = "collecting"
    CONFIRMING = "confirming"
    EXECUTING = "executing"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"

class DialogContext:
    """对话上下文"""

    def __init__(self, session_id: str = "", user_id: str = ""):
        self.session_id = session_id or f"sess_{uuid.uuid4().hex[:8]}"
        self.user_id = user_id
        self.state = DialogState.IDLE
        self.current_intent = ""
        self.intent_history: List[str] = []
        self.slots: Dict[str, Any] = {}
        self.required_slots: List[str] = []
        self.confirmed = False
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_user_input = ""
        self.last_response = ""
        self.turn_count = 0
        self.context_window: List[Dict[str, str]] = []
        self.pending_action: str = ""
        self.error_message = ""

    def add_turn(self, user_input: str, response: str):
        """添加对话轮次"""
        self.turn_count += 1
        self.last_user_input = user_input
        self.last_response = response
        self.context_window.append({"role": "user", "content": user_input})
        self.context_window.append({"role": "assistant", "content": response})
        if len(self.context_window) > 20:
            self.context_window = self.context_window[-20:]
        self.updated_at = time.time()

    def set_intent(self, intent: str):
        """设置当前意图"""
        self.current_intent = intent
        self.intent_history.append(intent)
        if len(self.intent_history) > 20:
            self.intent_history = self.intent_history[-20:]
        self.updated_at = time.time()

    def fill_slot(self, key: str, value: Any):
        """填充槽位"""
        self.slots[key] = value
        self.updated_at = time.time()

    def get_missing_slots(self) -> List[str]:
        """获取缺失的槽位（基于required_slots）"""
        return [s for s in self.required_slots if s not in self.slots]

    def reset(self):
        """重置对话上下文"""
        self.state = DialogState.IDLE
        self.current_intent = ""
        self.slots = {}
        self.required_slots = []
        self.confirmed = False
        self.pending_action = ""
        self.error_message = ""
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "state": self.state.value,
            "current_intent": self.current_intent,
            "intent_history": self.intent_history[-5:],
            "slots": self.slots,
            "required_slots": self.required_slots,
            "confirmed": self.confirmed,
            "turn_count": self.turn_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

class IntentHandler:
    """意图处理器"""

    def __init__(self, intent_name: str = "", handler: Optional[Callable] = None,
                 description: str = "", required_slots: Optional[List[str]] = None,
                 priority: int = 0):
        self.intent_name = intent_name
        self.handler = handler
        self.description = description
        self.required_slots = required_slots or []
        self.priority = priority
        self.call_count = 0
        self.last_called = 0.0

    def can_handle(self, intent: str) -> bool:
        return intent == self.intent_name

    def execute(self, context: DialogContext, classification: ClassificationResult) -> Dict[str, Any]:
        if not self.handler:
            return {"success": False, "error": "无处理函数"}
        self.call_count += 1
        self.last_called = time.time()
        try:
            result = self.handler(context, classification)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}

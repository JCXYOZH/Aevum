"""
core/event_bus.py - 进程内发布订阅事件总线

解耦模块间直接调用，支持同步/异步 handler、事件持久化、事件过滤。
"""
import time
import json
import threading
import queue
from typing import Any, Callable, Dict, List, Optional, Set
from dataclasses import dataclass, field
from datetime import datetime
from .terminal import terminal


# ================================================================
# 事件对象
# ================================================================
@dataclass
class Event:
    """事件对象"""
    event_type: str
    data: Dict[str, Any] = field(default_factory=dict)
    source: str = ""
    event_id: str = ""
    timestamp: float = field(default_factory=time.time)
    priority: int = 0
    persistent: bool = False

    def __post_init__(self):
        if not self.event_id:
            self.event_id = f"evt_{int(self.timestamp * 1000)}_{id(self) % 10000}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "data": self.data,
            "source": self.source,
            "timestamp": self.timestamp,
            "time": datetime.fromtimestamp(self.timestamp).strftime("%Y-%m-%d %H:%M:%S"),
            "priority": self.priority,
        }


# ================================================================
# 事件处理器
# ================================================================
@dataclass
class EventHandler:
    """事件处理器注册信息"""
    handler_id: str
    event_type: str
    callback: Callable[[Event], Any]
    async_mode: bool = False
    priority: int = 0
    filter_func: Optional[Callable[[Event], bool]] = None
    active: bool = True
    call_count: int = 0
    error_count: int = 0
    last_called: float = 0.0


# ================================================================
# 事件总线
# ================================================================
class EventBus:
    """进程内事件总线"""

    def __init__(self, max_queue_size: int = 10000, persist_path: str = ""):
        self._handlers: Dict[str, List[EventHandler]] = {}
        self._lock = threading.RLock()
        self._async_queue: "queue.PriorityQueue[Any]" = queue.PriorityQueue(maxsize=max_queue_size)
        self._async_thread: Optional[threading.Thread] = None
        self._running = False
        self._event_history: List[Event] = []
        self._max_history = 1000
        self._persist_path = persist_path
        self._subscribers: Set[str] = set()

    def start(self):
        """启动异步事件处理线程"""
        if self._running:
            return
        self._running = True
        self._async_thread = threading.Thread(
            target=self._async_worker, daemon=True, name="EventBusWorker"
        )
        self._async_thread.start()
        terminal.info("事件总线已启动", "event_bus")

    def stop(self, wait: bool = True):
        """停止事件总线"""
        self._running = False
        if wait and self._async_thread:
            self._async_thread.join(timeout=5)
        terminal.info("事件总线已停止", "event_bus")

    def subscribe(self, event_type: str, callback: Callable[[Event], Any],
                  handler_id: str = "", async_mode: bool = False,
                  priority: int = 0, filter_func: Optional[Callable[[Event], bool]] = None) -> str:
        """订阅事件"""
        hid = handler_id or f"h_{id(callback)}_{int(time.time() * 1000)}"
        handler = EventHandler(
            handler_id=hid, event_type=event_type, callback=callback,
            async_mode=async_mode, priority=priority, filter_func=filter_func,
        )
        with self._lock:
            if event_type not in self._handlers:
                self._handlers[event_type] = []
            self._handlers[event_type].append(handler)
            self._handlers[event_type].sort(key=lambda h: h.priority, reverse=True)
            self._subscribers.add(hid)
        terminal.debug(f"订阅事件: {event_type} -> {hid}", "event_bus")
        return hid

    def unsubscribe(self, handler_id: str):
        """取消订阅"""
        with self._lock:
            for event_type, handlers in self._handlers.items():
                self._handlers[event_type] = [h for h in handlers if h.handler_id != handler_id]
            self._subscribers.discard(handler_id)

    def unsubscribe_all(self, event_type: str = ""):
        """取消所有订阅（或指定类型的所有订阅）"""
        with self._lock:
            if event_type:
                self._handlers.pop(event_type, None)
            else:
                self._handlers.clear()
                self._subscribers.clear()

    def publish(self, event_type: str, data: Optional[Dict[str, Any]] = None,
                source: str = "", priority: int = 0, persistent: bool = False) -> Event:
        """发布事件"""
        event = Event(
            event_type=event_type, data=data or {}, source=source,
            priority=priority, persistent=persistent,
        )
        return self.publish_event(event)

    def publish_event(self, event: Event) -> Event:
        """发布事件对象"""
        # 记录历史
        with self._lock:
            self._event_history.append(event)
            if len(self._event_history) > self._max_history:
                self._event_history = self._event_history[-self._max_history:]

        # 获取匹配的处理器
        with self._lock:
            handlers = list(self._handlers.get(event.event_type, []))
            # 通配符订阅
            wildcard = list(self._handlers.get("*", []))
            all_handlers = handlers + wildcard
            all_handlers.sort(key=lambda h: h.priority, reverse=True)

        sync_handlers = [h for h in all_handlers if h.active and not h.async_mode]
        async_handlers = [h for h in all_handlers if h.active and h.async_mode]

        # 同步执行
        for handler in sync_handlers:
            self._invoke_handler(handler, event)

        # 异步执行
        for handler in async_handlers:
            try:
                self._async_queue.put((-handler.priority, handler.handler_id, handler, event), block=False)
            except queue.Full:
                terminal.warn(f"异步事件队列已满，丢弃: {event.event_type}", "event_bus")

        # 持久化
        if event.persistent and self._persist_path:
            self._persist_event(event)

        return event

    def _invoke_handler(self, handler: EventHandler, event: Event):
        """调用单个处理器"""
        if handler.filter_func and not handler.filter_func(event):
            return
        try:
            handler.callback(event)
            handler.call_count += 1
            handler.last_called = time.time()
        except Exception as e:
            handler.error_count += 1
            terminal.error(f"事件处理器异常 [{handler.handler_id}]: {e}", "event_bus")

    def _async_worker(self):
        """异步事件处理工作线程"""
        while self._running:
            try:
                _, _, handler, event = self._async_queue.get(timeout=0.5)
                self._invoke_handler(handler, event)
                self._async_queue.task_done()
            except queue.Empty:
                continue
            except Exception as e:
                terminal.error(f"异步事件处理异常: {e}", "event_bus")

    def _persist_event(self, event: Event):
        """持久化事件到文件"""
        try:
            import os
            os.makedirs(self._persist_path, exist_ok=True)
            filename = f"event_{event.event_id}.json"
            filepath = os.path.join(self._persist_path, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(event.to_dict(), f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"事件持久化失败: {e}", "event_bus")

    def get_history(self, event_type: str = "", limit: int = 100) -> List[Event]:
        """获取事件历史"""
        with self._lock:
            history = list(reversed(self._event_history))
        if event_type:
            history = [e for e in history if e.event_type == event_type]
        return history[:limit]

    def get_handler_stats(self) -> List[Dict[str, Any]]:
        """获取处理器统计"""
        with self._lock:
            stats = []
            for event_type, handlers in self._handlers.items():
                for h in handlers:
                    stats.append({
                        "handler_id": h.handler_id,
                        "event_type": event_type,
                        "async": h.async_mode,
                        "priority": h.priority,
                        "active": h.active,
                        "call_count": h.call_count,
                        "error_count": h.error_count,
                        "last_called": h.last_called,
                    })
            return stats

    def get_subscribed_types(self) -> List[str]:
        """获取所有有订阅的事件类型"""
        with self._lock:
            return sorted(self._handlers.keys())

    def clear_history(self):
        with self._lock:
            self._event_history.clear()

    def wait_for_event(self, event_type: str, timeout: float = 10.0,
                       filter_func: Optional[Callable[[Event], bool]] = None) -> Optional[Event]:
        """同步等待特定事件"""
        result: Dict[str, Optional[Event]] = {"event": None}
        event_received = threading.Event()

        def on_event(evt: Event):
            if filter_func and not filter_func(evt):
                return
            result["event"] = evt
            event_received.set()

        hid = self.subscribe(event_type, on_event, async_mode=False)
        try:
            event_received.wait(timeout=timeout)
        finally:
            self.unsubscribe(hid)
        return result["event"]


# ================================================================
# 全局事件总线
# ================================================================
_event_bus = EventBus()


def get_event_bus() -> EventBus:
    return _event_bus


def publish(event_type: str, data: Optional[Dict[str, Any]] = None, source: str = "", **kwargs):
    """便捷发布事件"""
    return _event_bus.publish(event_type, data, source, **kwargs)


def subscribe(event_type: str, callback: Callable[[Event], Any], **kwargs) -> str:
    """便捷订阅事件"""
    return _event_bus.subscribe(event_type, callback, **kwargs)


def unsubscribe(handler_id: str):
    """便捷取消订阅"""
    _event_bus.unsubscribe(handler_id)


def start_event_bus():
    """启动全局事件总线"""
    _event_bus.start()


def stop_event_bus():
    """停止全局事件总线"""
    _event_bus.stop()


# ================================================================
# 预定义事件类型常量
# ================================================================
class EventTypes:
    """预定义事件类型"""
    SYSTEM_STARTUP = "system.startup"
    SYSTEM_SHUTDOWN = "system.shutdown"
    SYSTEM_ERROR = "system.error"
    CONFIG_CHANGED = "config.changed"
    MODULE_LOADED = "module.loaded"
    MODULE_UNLOADED = "module.unloaded"
    MODULE_ERROR = "module.error"
    USER_LOGIN = "user.login"
    USER_LOGOUT = "user.logout"
    USER_ACTION = "user.action"
    TOOL_EXECUTED = "tool.executed"
    TOOL_ERROR = "tool.error"
    MODEL_REQUEST = "model.request"
    MODEL_RESPONSE = "model.response"
    MODEL_ERROR = "model.error"
    SECURITY_ALERT = "security.alert"
    SECURITY_SCAN_COMPLETE = "security.scan_complete"
    VULNERABILITY_FOUND = "security.vulnerability_found"
    AUDIT_LOG = "audit.log"
    FEEDBACK_RECEIVED = "feedback.received"
    NODE_CONNECTED = "node.connected"
    NODE_DISCONNECTED = "node.disconnected"
    SYNC_COMPLETE = "sync.complete"
    SYNC_CONFLICT = "sync.conflict"
    TASK_CREATED = "task.created"
    TASK_COMPLETED = "task.completed"
    TASK_FAILED = "task.failed"
    WORKFLOW_STARTED = "workflow.started"
    WORKFLOW_COMPLETED = "workflow.completed"
    PLUGIN_LOADED = "plugin.loaded"
    PLUGIN_ERROR = "plugin.error"
    UPDATE_AVAILABLE = "update.available"
    UPDATE_COMPLETE = "update.complete"
    LICENSE_EXPIRED = "license.expired"
    RATE_LIMIT_EXCEEDED = "rate_limit.exceeded"

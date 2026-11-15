"""
core/node_manager.py - 远程节点管理

节点注册、发现、心跳、状态管理、分组、能力声明、健康检查、拓扑构建。
"""
import os
import json
import time
import uuid
import socket
import threading
from typing import Any, Dict, List, Optional, Set
from datetime import datetime
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 节点信息
# ================================================================
class NodeInfo:
    """远程节点信息"""

    def __init__(self, node_id: str = "", name: str = "", address: str = "",
                 port: int = 0, node_type: str = "slave", platform: str = ""):
        self.node_id = node_id or f"node_{uuid.uuid4().hex[:8]}"
        self.name = name or self.node_id
        self.address = address
        self.port = port
        self.node_type = node_type  # master / slave / edge
        self.platform = platform or socket.gethostname()
        self.status = "offline"  # online / offline / busy / maintenance
        self.capabilities: Dict[str, Any] = {}
        self.resources: Dict[str, Any] = {"cpu": 0, "memory": 0, "disk": 0, "load": 0}
        self.tags: List[str] = []
        self.group: str = "default"
        self.first_seen = time.time()
        self.last_seen = 0.0
        self.last_heartbeat = 0.0
        self.heartbeat_interval = 30.0
        self.timeout = 90.0
        self.latency_ms = 0.0
        self.packet_loss = 0.0
        self.ssl_enabled = False
        self.auth_token = ""
        self.metadata: Dict[str, Any] = {}
        self.error_count = 0
        self.max_errors = 5

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id, "name": self.name,
            "address": self.address, "port": self.port,
            "node_type": self.node_type, "platform": self.platform,
            "status": self.status, "capabilities": self.capabilities,
            "resources": self.resources, "tags": self.tags,
            "group": self.group, "first_seen": self.first_seen,
            "last_seen": self.last_seen, "last_heartbeat": self.last_heartbeat,
            "heartbeat_interval": self.heartbeat_interval,
            "latency_ms": self.latency_ms, "packet_loss": self.packet_loss,
            "ssl_enabled": self.ssl_enabled, "metadata": self.metadata,
            "error_count": self.error_count,
            "last_seen_time": datetime.fromtimestamp(self.last_seen).strftime("%Y-%m-%d %H:%M:%S") if self.last_seen else "",
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "NodeInfo":
        node = cls()
        for k, v in data.items():
            if hasattr(node, k):
                setattr(node, k, v)
        return node

    def is_online(self) -> bool:
        if self.status == "offline":
            return False
        if self.last_heartbeat > 0 and (time.time() - self.last_heartbeat) > self.timeout:
            return False
        return True

    def is_healthy(self) -> bool:
        return self.is_online() and self.error_count < self.max_errors

    def update_heartbeat(self, resources: Optional[Dict[str, Any]] = None):
        self.last_heartbeat = time.time()
        self.last_seen = self.last_heartbeat
        self.status = "online"
        self.error_count = max(0, self.error_count - 1)
        if resources:
            self.resources.update(resources)

    def mark_error(self):
        self.error_count += 1
        if self.error_count >= self.max_errors:
            self.status = "offline"

    def add_capability(self, name: str, details: Optional[Dict[str, Any]] = None):
        self.capabilities[name] = details or {"enabled": True}

    def has_capability(self, name: str) -> bool:
        return name in self.capabilities and self.capabilities[name].get("enabled", True)


# ================================================================
# 节点管理器
# ================================================================
class NodeManager:
    """远程节点管理器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "nodes")
        os.makedirs(self.data_dir, exist_ok=True)
        self._nodes: Dict[str, NodeInfo] = {}
        self._groups: Dict[str, Set[str]] = {"default": set()}
        self._lock = threading.RLock()
        self._discovery_enabled = False
        self._discovery_thread: Optional[threading.Thread] = None
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._running = False
        self._callbacks: Dict[str, List[Any]] = {
            "node_online": [], "node_offline": [], "node_joined": [], "node_left": [],
        }
        self._load()

    def _load(self):
        """加载已注册节点"""
        index_file = os.path.join(self.data_dir, "nodes.json")
        try:
            if os.path.exists(index_file):
                with open(index_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for node_data in data.get("nodes", []):
                    node = NodeInfo.from_dict(node_data)
                    self._nodes[node.node_id] = node
                    self._groups.setdefault(node.group, set()).add(node.node_id)
        except Exception as e:
            terminal.warn(f"加载节点信息失败: {e}", "node_manager")

    def _save(self):
        """保存节点信息"""
        index_file = os.path.join(self.data_dir, "nodes.json")
        try:
            data = {
                "version": "1.0",
                "updated_at": time.time(),
                "nodes": [n.to_dict() for n in self._nodes.values()],
            }
            with open(index_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"保存节点信息失败: {e}", "node_manager")

    def register_node(self, node: NodeInfo) -> str:
        """注册节点"""
        with self._lock:
            is_new = node.node_id not in self._nodes
            self._nodes[node.node_id] = node
            self._groups.setdefault(node.group, set()).add(node.node_id)
            self._save()
        if is_new:
            self._fire_event("node_joined", node)
            terminal.info(f"新节点注册: {node.name} ({node.address}:{node.port})", "node_manager")
        return node.node_id

    def unregister_node(self, node_id: str) -> bool:
        """注销节点"""
        with self._lock:
            node = self._nodes.pop(node_id, None)
            if node:
                for group_nodes in self._groups.values():
                    group_nodes.discard(node_id)
                self._save()
                self._fire_event("node_left", node)
                return True
            return False

    def get_node(self, node_id: str) -> Optional[NodeInfo]:
        return self._nodes.get(node_id)

    def get_node_by_address(self, address: str, port: int = 0) -> Optional[NodeInfo]:
        for node in self._nodes.values():
            if node.address == address and (port == 0 or node.port == port):
                return node
        return None

    def list_nodes(self, status: str = "", group: str = "", node_type: str = "",
                    capability: str = "", tag: str = "") -> List[NodeInfo]:
        """列出节点"""
        with self._lock:
            nodes = list(self._nodes.values())

        if status:
            nodes = [n for n in nodes if n.status == status]
        if group:
            nodes = [n for n in nodes if n.group == group]
        if node_type:
            nodes = [n for n in nodes if n.node_type == node_type]
        if capability:
            nodes = [n for n in nodes if n.has_capability(capability)]
        if tag:
            nodes = [n for n in nodes if tag in n.tags]

        return sorted(nodes, key=lambda n: n.name)

    def get_online_nodes(self) -> List[NodeInfo]:
        return [n for n in self._nodes.values() if n.is_online()]

    def get_healthy_nodes(self) -> List[NodeInfo]:
        return [n for n in self._nodes.values() if n.is_healthy()]

    def update_node_status(self, node_id: str, status: str) -> bool:
        node = self._nodes.get(node_id)
        if not node:
            return False
        old_status = node.status
        node.status = status
        if old_status != "online" and status == "online":
            self._fire_event("node_online", node)
        elif old_status == "online" and status != "online":
            self._fire_event("node_offline", node)
        with self._lock:
            self._save()
        return True

    def heartbeat(self, node_id: str, resources: Optional[Dict[str, Any]] = None) -> bool:
        """处理节点心跳"""
        node = self._nodes.get(node_id)
        if not node:
            return False
        was_offline = not node.is_online()
        node.update_heartbeat(resources)
        if was_offline:
            self._fire_event("node_online", node)
            terminal.info(f"节点上线: {node.name}", "node_manager")
        return True

    def create_group(self, group_name: str) -> bool:
        with self._lock:
            if group_name not in self._groups:
                self._groups[group_name] = set()
                return True
            return False

    def add_to_group(self, node_id: str, group_name: str) -> bool:
        node = self._nodes.get(node_id)
        if not node:
            return False
        with self._lock:
            self._groups.setdefault(group_name, set()).add(node_id)
            node.group = group_name
            self._save()
        return True

    def get_group_nodes(self, group_name: str) -> List[NodeInfo]:
        node_ids = self._groups.get(group_name, set())
        return [self._nodes[nid] for nid in node_ids if nid in self._nodes]

    def list_groups(self) -> List[str]:
        return sorted(self._groups.keys())

    def select_best_node(self, capability: str = "", group: str = "") -> Optional[NodeInfo]:
        """选择最佳节点（基于负载和延迟）"""
        candidates = self.get_healthy_nodes()
        if capability:
            candidates = [n for n in candidates if n.has_capability(capability)]
        if group:
            candidates = [n for n in candidates if n.group == group]
        if not candidates:
            return None
        # 按负载（CPU+内存）和延迟综合排序
        def score(n):
            load = n.resources.get("cpu", 0) + n.resources.get("memory", 0)
            return load + n.latency_ms / 100.0
        return min(candidates, key=score)

    def get_topology(self) -> Dict[str, Any]:
        """获取网络拓扑"""
        nodes = self.list_nodes()
        edges = []
        # 基于分组构建拓扑
        for group in self.list_groups():
            group_nodes = self.get_group_nodes(group)
            for i in range(len(group_nodes)):
                for j in range(i + 1, len(group_nodes)):
                    edges.append({
                        "source": group_nodes[i].node_id,
                        "target": group_nodes[j].node_id,
                        "group": group,
                    })
        return {
            "nodes": [{"id": n.node_id, "name": n.name, "status": n.status,
                       "type": n.node_type, "group": n.group} for n in nodes],
            "edges": edges,
            "groups": self.list_groups(),
        }

    def check_timeouts(self):
        """检查节点超时（应在后台线程调用）"""
        now = time.time()
        for node in self._nodes.values():
            if node.status == "online" and node.last_heartbeat > 0:
                if now - node.last_heartbeat > node.timeout:
                    node.status = "offline"
                    self._fire_event("node_offline", node)
                    terminal.warn(f"节点超时离线: {node.name}", "node_manager")

    def start_monitoring(self):
        """启动节点监控"""
        if self._running:
            return
        self._running = True
        self._heartbeat_thread = threading.Thread(
            target=self._monitor_loop, daemon=True, name="NodeMonitor"
        )
        self._heartbeat_thread.start()
        terminal.info("节点监控已启动", "node_manager")

    def stop_monitoring(self):
        self._running = False
        if self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=5)

    def _monitor_loop(self):
        while self._running:
            try:
                self.check_timeouts()
            except Exception as e:
                terminal.error(f"节点监控异常: {e}", "node_manager")
            time.sleep(10)

    def on_event(self, event_type: str, callback):
        """注册事件回调"""
        if event_type in self._callbacks:
            self._callbacks[event_type].append(callback)

    def _fire_event(self, event_type: str, node: NodeInfo):
        for cb in self._callbacks.get(event_type, []):
            try:
                cb(node)
            except Exception:
                pass

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._nodes)
        online = len(self.get_online_nodes())
        offline = total - online
        by_type = {}
        by_group = {}
        by_status = {}
        for node in self._nodes.values():
            by_type[node.node_type] = by_type.get(node.node_type, 0) + 1
            by_group[node.group] = by_group.get(node.group, 0) + 1
            by_status[node.status] = by_status.get(node.status, 0) + 1

        return {
            "total": total, "online": online, "offline": offline,
            "by_type": by_type, "by_group": by_group, "by_status": by_status,
            "groups": self.list_groups(),
            "monitoring": self._running,
        }


# 全局管理器
_node_manager = NodeManager()


def get_node_manager() -> NodeManager:
    return _node_manager


def register_node(**kwargs) -> str:
    node = NodeInfo(**kwargs)
    return _node_manager.register_node(node)

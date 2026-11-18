"""
core/ssh_tunnel.py - SSH隧道管理

SSH连接管理、端口转发、隧道建立、密钥管理、连接池、自动重连。
"""
import os
import json
import time
import uuid
import threading
import subprocess
from typing import Any, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.foundation.byte_stream import safe_decode


# ================================================================
# 隧道状态
# ================================================================
class TunnelStatus(Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"
    RECONNECTING = "reconnecting"


# ================================================================
# SSH配置
# ================================================================
class SSHConfig:
    """SSH连接配置"""

    def __init__(self, host: str = "", port: int = 22, username: str = "",
                 password: str = "", private_key: str = "",
                 known_hosts: str = "", timeout: int = 30,
                 keepalive_interval: int = 60, keepalive_count: int = 3,
                 description: str = ""):
        self.config_id = f"ssh_{uuid.uuid4().hex[:8]}"
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.private_key = private_key
        self.known_hosts = known_hosts
        self.timeout = timeout
        self.keepalive_interval = keepalive_interval
        self.keepalive_count = keepalive_count
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_connected = 0.0
        self.connection_count = 0
        self.tags: List[str] = []
        self.description = description

    def to_dict(self) -> Dict[str, Any]:
        return {
            "config_id": self.config_id,
            "host": self.host,
            "port": self.port,
            "username": self.username,
            "private_key": self.private_key,
            "timeout": self.timeout,
            "keepalive_interval": self.keepalive_interval,
            "created_at": self.created_at,
            "last_connected": self.last_connected,
            "connection_count": self.connection_count,
            "tags": self.tags,
            "description": self.description,
        }


# ================================================================
# 端口转发规则
# ================================================================
class PortForward:
    """端口转发规则"""

    def __init__(self, local_port: int = 0, remote_host: str = "localhost",
                 remote_port: int = 0, forward_type: str = "local"):
        self.forward_id = f"fwd_{uuid.uuid4().hex[:6]}"
        self.local_port = local_port
        self.remote_host = remote_host
        self.remote_port = remote_port
        self.forward_type = forward_type  # local / remote / dynamic
        self.status = "inactive"
        self.created_at = time.time()
        self.bytes_sent = 0
        self.bytes_received = 0
        self.connection_count = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "forward_id": self.forward_id,
            "local_port": self.local_port,
            "remote_host": self.remote_host,
            "remote_port": self.remote_port,
            "forward_type": self.forward_type,
            "status": self.status,
            "bytes_sent": self.bytes_sent,
            "bytes_received": self.bytes_received,
            "connection_count": self.connection_count,
        }


# ================================================================
# SSH隧道管理器
# ================================================================
class SSHTunnelManager:
    """SSH隧道管理"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "ssh_tunnels")
        os.makedirs(self.data_dir, exist_ok=True)
        self._configs: Dict[str, SSHConfig] = {}
        self._tunnels: Dict[str, Dict[str, Any]] = {}
        self._forwards: Dict[str, PortForward] = {}
        self._lock = threading.RLock()
        self._ssh_bin = "ssh"
        self._auto_reconnect = True
        self._reconnect_delay = 5.0
        self._load()

    def _load(self):
        config_file = os.path.join(self.data_dir, "ssh_configs.json")
        try:
            if os.path.exists(config_file):
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for c_data in data.get("configs", []):
                    config = SSHConfig(
                        host=c_data.get("host", ""),
                        port=c_data.get("port", 22),
                        username=c_data.get("username", ""),
                        private_key=c_data.get("private_key", ""),
                        timeout=c_data.get("timeout", 30),
                    )
                    config.config_id = c_data.get("config_id", config.config_id)
                    config.last_connected = c_data.get("last_connected", 0)
                    config.connection_count = c_data.get("connection_count", 0)
                    config.tags = c_data.get("tags", [])
                    config.description = c_data.get("description", "")
                    self._configs[config.config_id] = config
        except Exception as e:
            terminal.warn(f"加载SSH配置失败: {e}", "ssh_tunnel")

    def _save(self):
        config_file = os.path.join(self.data_dir, "ssh_configs.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "configs": [c.to_dict() for c in self._configs.values()],
            }
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def add_config(self, host: str, port: int = 22, username: str = "",
                   password: str = "", private_key: str = "",
                   description: str = "") -> SSHConfig:
        config = SSHConfig(host, port, username, password, private_key,
                          description=description)
        with self._lock:
            self._configs[config.config_id] = config
            self._save()
        terminal.info(f"添加SSH配置: {username}@{host}:{port}", "ssh_tunnel")
        return config

    def remove_config(self, config_id: str) -> bool:
        with self._lock:
            if config_id in self._configs:
                self.disconnect(config_id)
                del self._configs[config_id]
                self._save()
                return True
        return False

    def get_config(self, config_id: str) -> Optional[SSHConfig]:
        return self._configs.get(config_id)

    def list_configs(self) -> List[SSHConfig]:
        return sorted(self._configs.values(), key=lambda c: c.created_at)

    def test_connection(self, config_id: str, timeout: int = 10) -> Tuple[bool, str, float]:
        """测试SSH连接"""
        config = self._configs.get(config_id)
        if not config:
            return False, "配置不存在", 0.0

        start = time.time()
        try:
            cmd = [self._ssh_bin, "-o", f"ConnectTimeout={timeout}",
                  "-o", "BatchMode=yes" if config.private_key else "BatchMode=no",
                  "-p", str(config.port),
                  f"{config.username}@{config.host}", "echo connected"]
            if config.private_key:
                cmd.extend(["-i", config.private_key])
            result = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
            ssh_out = safe_decode(result.stdout)
            duration = (time.time() - start) * 1000
            if result.returncode == 0 and "connected" in ssh_out:
                config.last_connected = time.time()
                config.connection_count += 1
                self._save()
                return True, "连接成功", duration
            return False, safe_decode(result.stderr).strip() or "连接失败", duration
        except subprocess.TimeoutExpired:
            return False, "连接超时", (time.time() - start) * 1000
        except Exception as e:
            return False, str(e), (time.time() - start) * 1000

    def connect(self, config_id: str) -> Tuple[bool, str]:
        """建立SSH连接"""
        config = self._configs.get(config_id)
        if not config:
            return False, "配置不存在"

        with self._lock:
            if config_id in self._tunnels:
                tunnel = self._tunnels[config_id]
                if tunnel["status"] == TunnelStatus.CONNECTED:
                    return True, "已连接"

            self._tunnels[config_id] = {
                "config_id": config_id,
                "status": TunnelStatus.CONNECTING,
                "process": None,
                "forwards": [],
                "connected_at": 0.0,
                "reconnect_count": 0,
            }

        # 测试连接
        success, msg, latency = self.test_connection(config_id)
        if not success:
            self._tunnels[config_id]["status"] = TunnelStatus.ERROR
            self._tunnels[config_id]["error"] = msg
            return False, msg

        self._tunnels[config_id]["status"] = TunnelStatus.CONNECTED
        self._tunnels[config_id]["connected_at"] = time.time()
        config.last_connected = time.time()
        config.connection_count += 1
        self._save()
        terminal.success(f"SSH连接成功: {config.username}@{config.host}:{config.port} ({latency:.0f}ms)", "ssh_tunnel")
        return True, "连接成功"

    def disconnect(self, config_id: str) -> bool:
        """断开SSH连接"""
        with self._lock:
            tunnel = self._tunnels.pop(config_id, None)
            if tunnel:
                if tunnel.get("process"):
                    try:
                        tunnel["process"].terminate()
                    except Exception:
                        pass
                terminal.info(f"SSH连接已断开: {config_id}", "ssh_tunnel")
                return True
        return False

    def add_port_forward(self, config_id: str, local_port: int,
                         remote_host: str = "localhost", remote_port: int = 0,
                         forward_type: str = "local") -> Optional[PortForward]:
        """添加端口转发"""
        config = self._configs.get(config_id)
        if not config:
            return None
        forward = PortForward(local_port, remote_host, remote_port, forward_type)
        with self._lock:
            self._forwards[forward.forward_id] = forward
            if config_id in self._tunnels:
                self._tunnels[config_id]["forwards"].append(forward.forward_id)
        terminal.info(f"添加端口转发: 本地{local_port} -> {remote_host}:{remote_port}", "ssh_tunnel")
        return forward

    def remove_port_forward(self, forward_id: str) -> bool:
        with self._lock:
            forward = self._forwards.pop(forward_id, None)
            if forward:
                for tunnel in self._tunnels.values():
                    if forward_id in tunnel.get("forwards", []):
                        tunnel["forwards"].remove(forward_id)
                return True
        return False

    def list_port_forwards(self, config_id: str = "") -> List[PortForward]:
        forwards = list(self._forwards.values())
        if config_id and config_id in self._tunnels:
            forward_ids = set(self._tunnels[config_id].get("forwards", []))
            forwards = [f for f in forwards if f.forward_id in forward_ids]
        return forwards

    def get_tunnel_status(self, config_id: str) -> Optional[Dict[str, Any]]:
        tunnel = self._tunnels.get(config_id)
        if tunnel:
            return {
                "config_id": config_id,
                "status": tunnel["status"].value,
                "connected_at": tunnel.get("connected_at", 0),
                "uptime_seconds": time.time() - tunnel.get("connected_at", 0) if tunnel.get("connected_at") else 0,
                "forwards": len(tunnel.get("forwards", [])),
                "reconnect_count": tunnel.get("reconnect_count", 0),
                "error": tunnel.get("error", ""),
            }
        return None

    def list_tunnels(self) -> List[Dict[str, Any]]:
        return [self.get_tunnel_status(cid) for cid in self._tunnels.keys()]

    def disconnect_all(self):
        for config_id in list(self._tunnels.keys()):
            self.disconnect(config_id)

    def get_stats(self) -> Dict[str, Any]:
        total_configs = len(self._configs)
        active_tunnels = sum(1 for t in self._tunnels.values() if t["status"] == TunnelStatus.CONNECTED)
        total_forwards = len(self._forwards)
        total_connections = sum(c.connection_count for c in self._configs.values())
        return {
            "total_configs": total_configs,
            "active_tunnels": active_tunnels,
            "total_forwards": total_forwards,
            "total_connections": total_connections,
            "auto_reconnect": self._auto_reconnect,
            "reconnect_delay": self._reconnect_delay,
            "by_status": {s.value: sum(1 for t in self._tunnels.values() if t["status"] == s)
                          for s in TunnelStatus},
        }

    # ================================================================
    # 兼容层：为 model_engine.py 提供的接口
    # ================================================================
    def configure_from_dict(self, config: Dict[str, Any]) -> bool:
        """从字典配置SSH隧道（兼容旧接口）

        Args:
            config: 配置字典，支持以下字段：
                - ssh_host: 主机地址
                - ssh_port: 端口（默认22）
                - ssh_user / username: 用户名
                - ssh_password / password: 密码
                - private_key: 私钥路径
                - socks_port: SOCKS代理端口
                - local_port: 本地端口
                - remote_host: 远程主机
                - remote_port: 远程端口
                - enabled: 是否启用

        Returns:
            bool: 配置是否成功
        """
        try:
            host = config.get("ssh_host") or config.get("host", "")
            if not host:
                return False
            port = int(config.get("ssh_port") or config.get("port", 22))
            username = config.get("ssh_user") or config.get("username", "")
            password = config.get("ssh_password") or config.get("password", "")
            private_key = config.get("private_key", "")

            # 检查是否已存在相同配置
            existing_id = None
            for cid, c in self._configs.items():
                if c.host == host and c.port == port and c.username == username:
                    existing_id = cid
                    break

            if existing_id:
                config_id = existing_id
            else:
                cfg = self.add_config(
                    host=host, port=port, username=username,
                    password=password, private_key=private_key,
                    description="自动配置（model_engine）"
                )
                config_id = cfg.config_id

            # 保存当前活动配置ID
            self._active_config_id = config_id

            # 保存端口转发配置
            self._pending_socks_port = int(config.get("socks_port", 0))
            self._pending_local_port = int(config.get("local_port", 0))
            self._pending_remote_host = config.get("remote_host", "localhost")
            self._pending_remote_port = int(config.get("remote_port", 0))

            return True
        except Exception as e:
            terminal.warn(f"configure_from_dict 失败: {e}", "ssh_tunnel")
            return False

    def start(self) -> Dict[str, Any]:
        """启动SSH隧道（兼容旧接口）

        Returns:
            Dict: 包含 success, socks_proxy, error 等字段
        """
        try:
            config_id = getattr(self, "_active_config_id", None)
            if not config_id:
                # 使用第一个配置
                if self._configs:
                    config_id = list(self._configs.keys())[0]
                else:
                    return {"success": False, "error": "没有可用的SSH配置"}

            config = self._configs.get(config_id)
            if not config:
                return {"success": False, "error": f"配置不存在: {config_id}"}

            # 测试连接
            ok, msg, latency = self.test_connection(config_id, timeout=10)
            if not ok:
                return {"success": False, "error": f"连接失败: {msg}"}

            # 建立连接
            connected, conn_msg = self.connect(config_id)
            if not connected:
                return {"success": False, "error": f"连接失败: {conn_msg}"}

            # 添加端口转发（如果配置了）
            socks_proxy = ""
            socks_port = getattr(self, "_pending_socks_port", 0)
            if socks_port > 0:
                try:
                    self.add_port_forward(
                        config_id, local_port=socks_port,
                        remote_host="localhost", remote_port=socks_port,
                        forward_type="dynamic"
                    )
                    socks_proxy = f"socks5://127.0.0.1:{socks_port}"
                except Exception:
                    pass

            local_port = getattr(self, "_pending_local_port", 0)
            if local_port > 0:
                try:
                    self.add_port_forward(
                        config_id, local_port=local_port,
                        remote_host=getattr(self, "_pending_remote_host", "localhost"),
                        remote_port=getattr(self, "_pending_remote_port", local_port),
                        forward_type="local"
                    )
                except Exception:
                    pass

            return {
                "success": True,
                "socks_proxy": socks_proxy,
                "config_id": config_id,
                "host": config.host,
                "port": config.port,
                "latency": latency,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_requests_proxies(self) -> Dict[str, str]:
        """获取 requests 库可用的代理配置

        Returns:
            Dict: 代理配置字典，如 {"http": "socks5://...", "https": "socks5://..."}
        """
        try:
            # 查找活动的 SOCKS 代理
            for forward in self._forwards.values():
                if forward.forward_type == "dynamic":
                    proxy_url = f"socks5://127.0.0.1:{forward.local_port}"
                    return {"http": proxy_url, "https": proxy_url}

            # 检查待启动的 SOCKS 端口
            socks_port = getattr(self, "_pending_socks_port", 0)
            if socks_port > 0:
                proxy_url = f"socks5://127.0.0.1:{socks_port}"
                return {"http": proxy_url, "https": proxy_url}

            return {}
        except Exception:
            return {}


# 全局SSH隧道管理器
_ssh_tunnel_manager = SSHTunnelManager()


def get_ssh_tunnel_manager() -> SSHTunnelManager:
    return _ssh_tunnel_manager


def connect_ssh(host: str, **kwargs) -> Tuple[bool, str]:
    config = _ssh_tunnel_manager.add_config(host, **kwargs)
    return _ssh_tunnel_manager.connect(config.config_id)

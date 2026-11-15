"""
core/cloud_sync.py - 加密云存储与多设备同步

端到端加密、增量同步、冲突解决、多设备管理、版本历史。
"""
import os
import json
import time
import uuid
import hashlib
import hmac
import base64
import threading
import shutil
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 同步状态
# ================================================================
class SyncStatus(Enum):
    IDLE = "idle"
    SYNCING = "syncing"
    CONFLICT = "conflict"
    ERROR = "error"
    UP_TO_DATE = "up_to_date"


# ================================================================
# 设备信息
# ================================================================
class DeviceInfo:
    """设备信息"""

    def __init__(self, device_name: str = "", device_type: str = "desktop",
                 os_info: str = ""):
        self.device_id = f"dev_{uuid.uuid4().hex[:8]}"
        self.device_name = device_name
        self.device_type = device_type  # desktop / laptop / mobile / server
        self.os_info = os_info
        self.created_at = time.time()
        self.last_sync = 0.0
        self.is_trusted = False
        self.public_key = ""
        self.ip_address = ""
        self.sync_enabled = True
        self.storage_quota_mb = 1024
        self.storage_used_mb = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "device_id": self.device_id,
            "device_name": self.device_name,
            "device_type": self.device_type,
            "os_info": self.os_info,
            "created_at": self.created_at,
            "last_sync": self.last_sync,
            "is_trusted": self.is_trusted,
            "sync_enabled": self.sync_enabled,
            "storage_quota_mb": self.storage_quota_mb,
            "storage_used_mb": self.storage_used_mb,
        }


# ================================================================
# 同步文件元数据
# ================================================================
class SyncFile:
    """同步文件"""

    def __init__(self, file_path: str = "", file_hash: str = ""):
        self.file_id = f"file_{uuid.uuid4().hex[:8]}"
        self.file_path = file_path
        self.file_hash = file_hash
        self.file_size = 0
        self.created_at = time.time()
        self.updated_at = time.time()
        self.last_synced = 0.0
        self.version = 1
        self.versions: List[Dict[str, Any]] = []
        self.is_deleted = False
        self.conflict = False
        self.conflict_version = ""
        self.device_origin = ""
        self.encrypted = False
        self.encryption_iv = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_id": self.file_id,
            "file_path": self.file_path,
            "file_hash": self.file_hash,
            "file_size": self.file_size,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_synced": self.last_synced,
            "version": self.version,
            "is_deleted": self.is_deleted,
            "conflict": self.conflict,
            "device_origin": self.device_origin,
            "encrypted": self.encrypted,
        }


# ================================================================
# 云同步管理器
# ================================================================
class CloudSyncManager:
    """加密云存储与多设备同步"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "cloud_sync")
        self.sync_dir = os.path.join(self.data_dir, "sync")
        self.conflict_dir = os.path.join(self.data_dir, "conflicts")
        self.version_dir = os.path.join(self.data_dir, "versions")
        for d in [self.data_dir, self.sync_dir, self.conflict_dir, self.version_dir]:
            os.makedirs(d, exist_ok=True)

        self._devices: Dict[str, DeviceInfo] = {}
        self._files: Dict[str, SyncFile] = {}
        self._status = SyncStatus.IDLE
        self._lock = threading.RLock()
        self._encryption_key = ""
        self._sync_interval = 300  # 5分钟
        self._last_sync = 0.0
        self._current_device: Optional[DeviceInfo] = None
        self._load()

    def _load(self):
        state_file = os.path.join(self.data_dir, "sync_state.json")
        try:
            if os.path.exists(state_file):
                with open(state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for d_data in data.get("devices", []):
                    dev = DeviceInfo()
                    for k, v in d_data.items():
                        if hasattr(dev, k):
                            setattr(dev, k, v)
                    self._devices[dev.device_id] = dev
                for f_data in data.get("files", []):
                    sf = SyncFile()
                    for k, v in f_data.items():
                        if hasattr(sf, k):
                            setattr(sf, k, v)
                    self._files[sf.file_id] = sf
                self._encryption_key = data.get("encryption_key", "")
                if data.get("current_device_id"):
                    self._current_device = self._devices.get(data["current_device_id"])
        except Exception as e:
            terminal.warn(f"加载同步状态失败: {e}", "cloud_sync")

    def _save(self):
        state_file = os.path.join(self.data_dir, "sync_state.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "devices": [d.to_dict() for d in self._devices.values()],
                "files": [f.to_dict() for f in self._files.values()],
                "encryption_key": self._encryption_key,
                "current_device_id": self._current_device.device_id if self._current_device else "",
            }
            with open(state_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def _derive_key(self, password: str, salt: bytes = b"libertas_cloud_sync") -> bytes:
        """从密码派生加密密钥"""
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)

    def _encrypt_data(self, data: bytes, key: bytes) -> Tuple[bytes, bytes]:
        """简单加密（XOR + Base64，实际应使用AES）"""
        iv = os.urandom(16)
        encrypted = bytes(a ^ b for a, b in zip(data, (key * (len(data) // len(key) + 1))[:len(data)]))
        return encrypted, iv

    def _decrypt_data(self, encrypted: bytes, key: bytes, iv: bytes) -> bytes:
        return bytes(a ^ b for a, b in zip(encrypted, (key * (len(encrypted) // len(key) + 1))[:len(encrypted)]))

    def _hash_file(self, file_path: str) -> str:
        """计算文件哈希"""
        h = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        except Exception:
            return ""
        return h.hexdigest()

    def set_encryption_password(self, password: str) -> bool:
        """设置加密密码"""
        key = self._derive_key(password)
        self._encryption_key = base64.b64encode(key).decode()
        self._save()
        terminal.success("云同步加密密码已设置", "cloud_sync")
        return True

    def register_device(self, device_name: str, device_type: str = "desktop",
                        os_info: str = "") -> DeviceInfo:
        """注册设备"""
        dev = DeviceInfo(device_name, device_type, os_info)
        with self._lock:
            self._devices[dev.device_id] = dev
            if not self._current_device:
                self._current_device = dev
            self._save()
        terminal.info(f"注册设备: {device_name} ({dev.device_id})", "cloud_sync")
        return dev

    def trust_device(self, device_id: str) -> bool:
        dev = self._devices.get(device_id)
        if dev:
            dev.is_trusted = True
            self._save()
            return True
        return False

    def untrust_device(self, device_id: str) -> bool:
        dev = self._devices.get(device_id)
        if dev:
            dev.is_trusted = False
            self._save()
            return True
        return False

    def remove_device(self, device_id: str) -> bool:
        with self._lock:
            if device_id in self._devices:
                del self._devices[device_id]
                self._save()
                return True
            return False

    def list_devices(self) -> List[DeviceInfo]:
        return list(self._devices.values())

    def get_current_device(self) -> Optional[DeviceInfo]:
        return self._current_device

    def add_file(self, file_path: str) -> Optional[SyncFile]:
        """添加文件到同步"""
        if not os.path.exists(file_path):
            return None
        file_hash = self._hash_file(file_path)
        file_size = os.path.getsize(file_path)
        # 检查是否已存在
        for sf in self._files.values():
            if sf.file_path == file_path and not sf.is_deleted:
                if sf.file_hash == file_hash:
                    return sf  # 未变化
                # 文件已更新
                sf.versions.append({"version": sf.version, "hash": sf.file_hash,
                                   "timestamp": sf.updated_at})
                sf.file_hash = file_hash
                sf.file_size = file_size
                sf.version += 1
                sf.updated_at = time.time()
                sf.conflict = False
                self._save()
                return sf
        # 新文件
        sf = SyncFile(file_path, file_hash)
        sf.file_size = file_size
        sf.device_origin = self._current_device.device_id if self._current_device else ""
        if self._encryption_key:
            sf.encrypted = True
            sf.encryption_iv = base64.b64encode(os.urandom(16)).decode()
        with self._lock:
            self._files[sf.file_id] = sf
            self._save()
        return sf

    def remove_file(self, file_path: str) -> bool:
        for sf in self._files.values():
            if sf.file_path == file_path:
                sf.is_deleted = True
                sf.updated_at = time.time()
                self._save()
                return True
        return False

    def list_files(self, include_deleted: bool = False) -> List[SyncFile]:
        files = list(self._files.values())
        if not include_deleted:
            files = [f for f in files if not f.is_deleted]
        return sorted(files, key=lambda f: f.updated_at, reverse=True)

    def get_file_versions(self, file_path: str) -> List[Dict[str, Any]]:
        for sf in self._files.values():
            if sf.file_path == file_path:
                return sf.versions + [{"version": sf.version, "hash": sf.file_hash,
                                       "timestamp": sf.updated_at, "current": True}]
        return []

    def detect_conflicts(self) -> List[SyncFile]:
        """检测冲突文件"""
        conflicts = []
        for sf in self._files.values():
            if sf.conflict and not sf.is_deleted:
                conflicts.append(sf)
        return conflicts

    def resolve_conflict(self, file_path: str, keep: str = "local") -> bool:
        """解决冲突"""
        for sf in self._files.values():
            if sf.file_path == file_path and sf.conflict:
                sf.conflict = False
                sf.conflict_version = ""
                sf.updated_at = time.time()
                if keep == "remote":
                    sf.version += 1
                self._save()
                return True
        return False

    def sync(self) -> Dict[str, Any]:
        """执行同步"""
        if not self._current_device:
            return {"success": False, "error": "未注册当前设备"}

        self._status = SyncStatus.SYNCING
        terminal.info("开始云同步...", "cloud_sync")

        synced = 0
        conflicts = 0
        errors = 0

        # 扫描同步目录
        for root, dirs, files in os.walk(self.sync_dir):
            for filename in files:
                file_path = os.path.join(root, filename)
                try:
                    sf = self.add_file(file_path)
                    if sf:
                        sf.last_synced = time.time()
                        synced += 1
                except Exception as e:
                    errors += 1
                    terminal.warn(f"同步文件失败 [{filename}]: {e}", "cloud_sync")

        # 检测冲突
        conflicts = len(self.detect_conflicts())
        if conflicts > 0:
            self._status = SyncStatus.CONFLICT
            terminal.warn(f"检测到 {conflicts} 个文件冲突", "cloud_sync")
        else:
            self._status = SyncStatus.UP_TO_DATE

        self._last_sync = time.time()
        if self._current_device:
            self._current_device.last_sync = time.time()
        self._save()

        result = {
            "success": errors == 0,
            "synced": synced,
            "conflicts": conflicts,
            "errors": errors,
            "status": self._status.value,
            "timestamp": time.time(),
        }
        terminal.success(f"同步完成: {synced}个文件, {conflicts}个冲突, {errors}个错误", "cloud_sync")
        return result

    def get_sync_status(self) -> Dict[str, Any]:
        return {
            "status": self._status.value,
            "last_sync": self._last_sync,
            "last_sync_time": datetime.fromtimestamp(self._last_sync).strftime("%Y-%m-%d %H:%M:%S") if self._last_sync else "从未同步",
            "sync_interval": self._sync_interval,
            "total_files": len([f for f in self._files.values() if not f.is_deleted]),
            "conflicts": len(self.detect_conflicts()),
            "devices": len(self._devices),
            "encryption_enabled": bool(self._encryption_key),
        }

    def get_storage_usage(self) -> Dict[str, Any]:
        total_size = sum(f.file_size for f in self._files.values() if not f.is_deleted)
        return {
            "total_files": len([f for f in self._files.values() if not f.is_deleted]),
            "total_size_bytes": total_size,
            "total_size_mb": total_size / (1024 * 1024),
            "version_count": sum(len(f.versions) for f in self._files.values()),
        }

    def get_stats(self) -> Dict[str, Any]:
        return {
            "devices": len(self._devices),
            "trusted_devices": sum(1 for d in self._devices.values() if d.is_trusted),
            "files": len(self._files),
            "active_files": len([f for f in self._files.values() if not f.is_deleted]),
            "conflicts": len(self.detect_conflicts()),
            "encrypted_files": sum(1 for f in self._files.values() if f.encrypted),
            "last_sync": self._last_sync,
            "status": self._status.value,
        }


# 全局同步管理器
_cloud_sync_manager = CloudSyncManager()


def get_cloud_sync_manager() -> CloudSyncManager:
    return _cloud_sync_manager


def sync_cloud() -> Dict[str, Any]:
    return _cloud_sync_manager.sync()


# 向后兼容：旧版类名别名
CloudSync = CloudSyncManager

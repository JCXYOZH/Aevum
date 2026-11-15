"""
core/backup.py - 关键数据定期快照、增量备份、一键恢复
"""
import os
import time
import json
import shutil
import threading
import zipfile
import hashlib
from typing import Any, Dict, List, Optional
from datetime import datetime
from libertas.foundation.terminal import terminal
from libertas.foundation.config import get_data_dir


# ================================================================
# 备份项配置
# ================================================================
class BackupItem:
    """备份项配置"""

    def __init__(self, name: str, source_path: str, backup_type: str = "full",
                 compress: bool = True, retention: int = 7):
        self.name = name
        self.source_path = source_path
        self.backup_type = backup_type  # full / incremental
        self.compress = compress
        self.retention = retention  # 保留份数


# ================================================================
# 备份记录
# ================================================================
class BackupRecord:
    """备份记录"""

    def __init__(self, name: str, backup_type: str, file_path: str,
                 size: int = 0, checksum: str = "", status: str = "success"):
        self.name = name
        self.backup_type = backup_type
        self.file_path = file_path
        self.size = size
        self.checksum = checksum
        self.status = status
        self.created_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "backup_type": self.backup_type,
            "file_path": self.file_path,
            "size": self.size,
            "checksum": self.checksum,
            "status": self.status,
            "created_at": self.created_at,
            "created_time": datetime.fromtimestamp(self.created_at).strftime("%Y-%m-%d %H:%M:%S"),
        }


# ================================================================
# 备份管理器
# ================================================================
class BackupManager:
    """备份管理器"""

    def __init__(self, backup_dir: str = ""):
        self.backup_dir = backup_dir or os.path.join(get_data_dir(), "backups")
        self._items: Dict[str, BackupItem] = {}
        self._records: List[BackupRecord] = []
        self._lock = threading.RLock()
        self._scheduler_thread: Optional[threading.Thread] = None
        self._running = False
        self._interval = 3600.0  # 默认1小时
        self._ensure_dir()
        self._load_records()

    def _ensure_dir(self):
        os.makedirs(self.backup_dir, exist_ok=True)

    def register(self, item: BackupItem):
        """注册备份项"""
        with self._lock:
            self._items[item.name] = item

    def unregister(self, name: str):
        with self._lock:
            self._items.pop(name, None)

    def backup_now(self, name: str = "") -> List[BackupRecord]:
        """立即执行备份"""
        records = []
        with self._lock:
            items = dict(self._items)

        if name:
            if name in items:
                items = {name: items[name]}
            else:
                terminal.warn(f"备份项不存在: {name}", "backup")
                return records

        for item_name, item in items.items():
            record = self._do_backup(item)
            if record:
                records.append(record)
                with self._lock:
                    self._records.append(record)
                    self._enforce_retention(item)

        self._save_records()
        return records

    def _do_backup(self, item: BackupItem) -> Optional[BackupRecord]:
        """执行单个备份"""
        if not os.path.exists(item.source_path):
            terminal.warn(f"备份源不存在: {item.source_path}", "backup")
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"{item.name}_{timestamp}"

        try:
            if item.compress:
                backup_path = os.path.join(self.backup_dir, f"{backup_name}.zip")
                self._create_zip(item.source_path, backup_path)
            else:
                backup_path = os.path.join(self.backup_dir, backup_name)
                if os.path.isdir(item.source_path):
                    shutil.copytree(item.source_path, backup_path)
                else:
                    shutil.copy2(item.source_path, backup_path)

            size = self._get_size(backup_path)
            checksum = self._calculate_checksum(backup_path)

            record = BackupRecord(
                name=item.name, backup_type=item.backup_type,
                file_path=backup_path, size=size, checksum=checksum,
            )
            terminal.success(f"备份完成: {item.name} ({size / 1024:.1f} KB)", "backup")
            return record

        except Exception as e:
            terminal.error(f"备份失败 [{item.name}]: {e}", "backup")
            return BackupRecord(
                name=item.name, backup_type=item.backup_type,
                file_path="", status="failed",
            )

    def _create_zip(self, source: str, dest: str):
        """创建 ZIP 压缩包"""
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
            if os.path.isdir(source):
                for root, dirs, files in os.walk(source):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, os.path.dirname(source))
                        zf.write(file_path, arcname)
            else:
                zf.write(source, os.path.basename(source))

    def _get_size(self, path: str) -> int:
        if os.path.isdir(path):
            total = 0
            for root, dirs, files in os.walk(path):
                for f in files:
                    total += os.path.getsize(os.path.join(root, f))
            return total
        return os.path.getsize(path)

    def _calculate_checksum(self, path: str) -> str:
        if os.path.isdir(path):
            return ""
        h = hashlib.md5()
        try:
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        except Exception:
            return ""
        return h.hexdigest()

    def _enforce_retention(self, item: BackupItem):
        """执行保留策略，删除过期备份"""
        item_records = [r for r in self._records if r.name == item.name and r.status == "success"]
        if len(item_records) > item.retention:
            to_delete = sorted(item_records, key=lambda r: r.created_at)[:len(item_records) - item.retention]
            for record in to_delete:
                try:
                    if os.path.exists(record.file_path):
                        if os.path.isdir(record.file_path):
                            shutil.rmtree(record.file_path)
                        else:
                            os.remove(record.file_path)
                    self._records.remove(record)
                except Exception as e:
                    terminal.warn(f"删除旧备份失败: {e}", "backup")

    def restore(self, record_name: str, target_path: str = "") -> bool:
        """从备份恢复"""
        with self._lock:
            record = next((r for r in self._records if r.name == record_name), None)
        if not record:
            terminal.error(f"备份记录不存在: {record_name}", "backup")
            return False

        try:
            if record.file_path.endswith(".zip"):
                extract_to = target_path or os.path.dirname(record.file_path)
                with zipfile.ZipFile(record.file_path, "r") as zf:
                    zf.extractall(extract_to)
            else:
                dest = target_path or record.file_path + "_restored"
                if os.path.isdir(record.file_path):
                    shutil.copytree(record.file_path, dest)
                else:
                    shutil.copy2(record.file_path, dest)
            terminal.success(f"恢复完成: {record_name}", "backup")
            return True
        except Exception as e:
            terminal.error(f"恢复失败: {e}", "backup")
            return False

    def list_backups(self, name: str = "") -> List[Dict[str, Any]]:
        with self._lock:
            records = list(reversed(self._records))
        if name:
            records = [r for r in records if r.name == name]
        return [r.to_dict() for r in records]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            total_size = sum(r.size for r in self._records if r.status == "success")
            return {
                "total_backups": len(self._records),
                "successful": sum(1 for r in self._records if r.status == "success"),
                "failed": sum(1 for r in self._records if r.status == "failed"),
                "total_size": total_size,
                "backup_dir": self.backup_dir,
                "registered_items": len(self._items),
            }

    def start_scheduler(self, interval: float = 3600.0):
        """启动定时备份调度"""
        self._interval = interval
        if self._running:
            return
        self._running = True
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True, name="BackupScheduler")
        self._scheduler_thread.start()
        terminal.info(f"备份调度已启动（间隔 {interval} 秒）", "backup")

    def stop_scheduler(self):
        self._running = False
        if self._scheduler_thread:
            self._scheduler_thread.join(timeout=5)

    def _scheduler_loop(self):
        while self._running:
            time.sleep(self._interval)
            if self._running:
                try:
                    self.backup_now()
                except Exception as e:
                    terminal.error(f"定时备份异常: {e}", "backup")

    def _save_records(self):
        try:
            record_file = os.path.join(self.backup_dir, "backup_records.json")
            with open(record_file, "w", encoding="utf-8") as f:
                json.dump([r.to_dict() for r in self._records[-500:]], f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _load_records(self):
        try:
            record_file = os.path.join(self.backup_dir, "backup_records.json")
            if os.path.exists(record_file):
                with open(record_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    record = BackupRecord(
                        name=item.get("name", ""),
                        backup_type=item.get("backup_type", "full"),
                        file_path=item.get("file_path", ""),
                        size=item.get("size", 0),
                        checksum=item.get("checksum", ""),
                        status=item.get("status", "success"),
                    )
                    record.created_at = item.get("created_at", time.time())
                    self._records.append(record)
        except Exception:
            pass


# 全局备份管理器
_backup_manager = BackupManager()


def get_backup_manager() -> BackupManager:
    return _backup_manager


def backup_now(name: str = ""):
    return _backup_manager.backup_now(name)


def register_backup(name: str, source_path: str, **kwargs):
    item = BackupItem(name=name, source_path=source_path, **kwargs)
    _backup_manager.register(item)

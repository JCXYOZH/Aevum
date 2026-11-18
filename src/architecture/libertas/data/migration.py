"""
core/migration.py - 版本化数据迁移框架

升级时自动执行迁移脚本，支持版本追踪、回滚、迁移记录。
"""
import os
import time
import json
import threading
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime
from libertas.foundation.terminal import terminal
from libertas.foundation.config import get_data_dir


# ================================================================
# 迁移记录
# ================================================================
class MigrationRecord:
    """迁移记录"""

    def __init__(self, version: str, name: str = "", status: str = "pending",
                 applied_at: float = 0.0, duration_ms: float = 0.0, error: str = ""):
        self.version = version
        self.name = name
        self.status = status  # pending / success / failed / rolled_back
        self.applied_at = applied_at
        self.duration_ms = duration_ms
        self.error = error

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "name": self.name,
            "status": self.status,
            "applied_at": self.applied_at,
            "applied_time": datetime.fromtimestamp(self.applied_at).strftime("%Y-%m-%d %H:%M:%S") if self.applied_at else "",
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


# ================================================================
# 迁移脚本
# ================================================================
class MigrationScript:
    """迁移脚本"""

    def __init__(self, version: str, name: str,
                 up: Callable[[], bool], down: Optional[Callable[[], bool]] = None,
                 description: str = ""):
        self.version = version
        self.name = name
        self.up = up
        self.down = down
        self.description = description


# ================================================================
# 迁移管理器
# ================================================================
class MigrationManager:
    """迁移管理器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or get_data_dir()
        self._scripts: Dict[str, MigrationScript] = {}
        self._records: Dict[str, MigrationRecord] = {}
        self._lock = threading.RLock()
        self._record_file = os.path.join(self.data_dir, "migrations.json")
        self._load_records()

    def register(self, script: MigrationScript):
        """注册迁移脚本"""
        with self._lock:
            self._scripts[script.version] = script
            if script.version not in self._records:
                self._records[script.version] = MigrationRecord(
                    version=script.version, name=script.name,
                )

    def register_script(self, version: str, name: str,
                        up: Callable[[], bool],
                        down: Optional[Callable[[], bool]] = None,
                        description: str = ""):
        """便捷注册迁移脚本"""
        script = MigrationScript(version, name, up, down, description)
        self.register(script)

    def get_pending(self) -> List[MigrationScript]:
        """获取待执行的迁移脚本"""
        with self._lock:
            pending = []
            for version, script in sorted(self._scripts.items()):
                record = self._records.get(version)
                if not record or record.status in ("pending", "failed", "rolled_back"):
                    pending.append(script)
            return pending

    def get_applied(self) -> List[MigrationRecord]:
        """获取已执行的迁移记录"""
        with self._lock:
            return [r for r in self._records.values() if r.status == "success"]

    def migrate(self, target_version: str = "") -> Dict[str, Any]:
        """执行迁移"""
        pending = self.get_pending()
        if target_version:
            pending = [s for s in pending if s.version <= target_version]

        if not pending:
            terminal.info("没有待执行的迁移", "migration")
            return {"executed": 0, "failed": 0, "skipped": 0}

        executed = 0
        failed = 0
        terminal.section(f"数据迁移（{len(pending)} 个待执行）")

        for i, script in enumerate(pending, 1):
            terminal.step(i, f"迁移 {script.version}: {script.name}")
            start = time.time()
            try:
                success = script.up()
                duration = (time.time() - start) * 1000
                if success:
                    with self._lock:
                        record = self._records.get(script.version)
                        if record:
                            record.status = "success"
                            record.applied_at = time.time()
                            record.duration_ms = duration
                    terminal.success(f"迁移完成: {script.version} ({duration:.0f}ms)", "migration")
                    executed += 1
                else:
                    raise Exception("迁移脚本返回 False")
            except Exception as e:
                duration = (time.time() - start) * 1000
                with self._lock:
                    record = self._records.get(script.version)
                    if record:
                        record.status = "failed"
                        record.applied_at = time.time()
                        record.duration_ms = duration
                        record.error = str(e)
                terminal.error(f"迁移失败: {script.version} - {e}", "migration")
                failed += 1
                break  # 迁移失败后停止

        self._save_records()
        result = {"executed": executed, "failed": failed, "skipped": len(pending) - executed - failed}
        terminal.success(f"迁移完成: 成功 {executed}, 失败 {failed}", "migration")
        return result

    def rollback(self, version: str) -> bool:
        """回滚到指定版本"""
        with self._lock:
            script = self._scripts.get(version)
            record = self._records.get(version)

        if not script:
            terminal.error(f"迁移脚本不存在: {version}", "migration")
            return False
        if not script.down:
            terminal.error(f"迁移脚本不支持回滚: {version}", "migration")
            return False
        if not record or record.status != "success":
            terminal.warn(f"迁移未成功执行，无需回滚: {version}", "migration")
            return False

        try:
            success = script.down()
            if success:
                with self._lock:
                    record.status = "rolled_back"
                terminal.success(f"回滚完成: {version}", "migration")
                self._save_records()
                return True
            raise Exception("回滚脚本返回 False")
        except Exception as e:
            terminal.error(f"回滚失败: {version} - {e}", "migration")
            return False

    def get_status(self) -> Dict[str, Any]:
        """获取迁移状态"""
        with self._lock:
            total = len(self._scripts)
            applied = sum(1 for r in self._records.values() if r.status == "success")
            pending = sum(1 for r in self._records.values() if r.status == "pending")
            failed = sum(1 for r in self._records.values() if r.status == "failed")
            return {
                "total": total,
                "applied": applied,
                "pending": pending,
                "failed": failed,
                "current_version": self._get_current_version(),
                "records": [r.to_dict() for r in sorted(self._records.values(), key=lambda x: x.version)],
            }

    def _get_current_version(self) -> str:
        applied = [r for r in self._records.values() if r.status == "success"]
        if not applied:
            return "0.0.0"
        return max(r.version for r in applied)

    def _load_records(self):
        try:
            if os.path.exists(self._record_file):
                with open(self._record_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data:
                    record = MigrationRecord(
                        version=item.get("version", ""),
                        name=item.get("name", ""),
                        status=item.get("status", "pending"),
                        applied_at=item.get("applied_at", 0.0),
                        duration_ms=item.get("duration_ms", 0.0),
                        error=item.get("error", ""),
                    )
                    self._records[record.version] = record
        except Exception:
            pass

    def _save_records(self):
        try:
            os.makedirs(os.path.dirname(self._record_file), exist_ok=True)
            with open(self._record_file, "w", encoding="utf-8") as f:
                json.dump([r.to_dict() for r in self._records.values()], f, ensure_ascii=False, indent=2)
        except Exception as e:
            terminal.warn(f"迁移记录保存失败: {e}", "migration")


# 全局迁移管理器
_migration_manager = MigrationManager()


def get_migration_manager() -> MigrationManager:
    return _migration_manager


def register_migration(version: str, name: str, up: Callable[[], bool],
                       down: Optional[Callable[[], bool]] = None, **kwargs):
    _migration_manager.register_script(version, name, up, down, **kwargs)


def run_migrations(target_version: str = "") -> Dict[str, Any]:
    return _migration_manager.migrate(target_version)


def get_migration_status() -> Dict[str, Any]:
    return _migration_manager.get_status()

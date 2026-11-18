"""
版本管理与自动更新
- 本地版本快照（备份当前代码）
- 版本回退（恢复到之前的快照）
- 检查更新（对比本地和远程版本）
- 自动备份关键文件
"""
import os
import json
import time
import shutil
import hashlib
import zipfile
import sqlite3
import threading
from typing import Dict, List, Optional
from datetime import datetime


CURRENT_VERSION = "1.0.0"


class VersionManager:
    def __init__(self, project_root: str = "", db_path: str = ""):
        self.project_root = project_root or os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if not db_path:
            home = os.path.expanduser("~")
            db_dir = os.path.join(home, "LibertasData", "Versions")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "versions.db")
        self.db_path = db_path
        self.backup_dir = os.path.join(os.path.expanduser("~"), "LibertasData", "Versions", "backups")
        os.makedirs(self.backup_dir, exist_ok=True)
        # 用可重入锁：rollback() 持锁期间会调用同样加锁的 create_snapshot()
        # （回退前自动备份），普通 Lock 会永久自锁，并锁死整个版本管理。
        self._lock = threading.RLock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS versions (
                    id TEXT PRIMARY KEY,
                    version TEXT NOT NULL,
                    label TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    backup_path TEXT,
                    file_count INTEGER DEFAULT 0,
                    total_size INTEGER DEFAULT 0,
                    created_at REAL NOT NULL,
                    is_current INTEGER DEFAULT 0
                )
            """)

    def _unique_version_id(self) -> str:
        """生成唯一版本号。

        原来直接用秒级时间戳 strftime('%Y%m%d_%H%M%S')：同一秒内创建两个快照
        （例如 rollback 的"回退前自动备份"紧跟在一次手动快照之后）会撞主键，
        抛 UNIQUE constraint failed: versions.id，导致回退直接失败。
        """
        base = datetime.now().strftime("%Y%m%d_%H%M%S")
        vid, n = base, 0
        with self._get_conn() as conn:
            while conn.execute("SELECT 1 FROM versions WHERE id=?", (vid,)).fetchone():
                n += 1
                vid = "%s_%d" % (base, n)
        return vid

    def _hash_file(self, filepath: str) -> str:
        h = hashlib.sha256()
        try:
            with open(filepath, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    h.update(chunk)
        except Exception:
            return ""
        return h.hexdigest()

    def _collect_files(self) -> List[str]:
        files = []
        skip_dirs = {"__pycache__", ".git", "node_modules", "LibertasData", "LibertasWorkspace",
                     ".venv", "venv", "dist", "build", ".idea", ".vscode", "SecLists",
                     "seclists", "wordlists", "Wordlists", "backups", ".pytest_cache",
                     "mypy_cache", ".mypy_cache", ".tox", ".eggs", "*.egg-info"}
        skip_exts = {".pyc", ".pyo", ".db", ".db-wal", ".db-shm", ".log", ".zip",
                     ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".pkg",
                     ".exe", ".dll", ".so", ".dylib", ".a", ".o", ".bin", ".dat",
                     ".mp4", ".mp3", ".avi", ".mkv", ".mov", ".wav", ".flv", ".wmv",
                     ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp",
                     ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
                     ".enc", ".lock"}
        for root, dirs, filenames in os.walk(self.project_root):
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.endswith('.egg-info')]
            for fn in filenames:
                if any(fn.endswith(ext) for ext in skip_exts):
                    continue
                fpath = os.path.join(root, fn)
                try:
                    if os.path.getsize(fpath) > 5_000_000:
                        continue
                except OSError:
                    continue
                files.append(fpath)
        return files

    def create_snapshot(self, label: str = "", description: str = "") -> Dict:
        vid = self._unique_version_id()
        backup_path = os.path.join(self.backup_dir, f"snapshot_{vid}.zip")
        files = self._collect_files()
        total_size = 0
        with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fpath in files:
                arcname = os.path.relpath(fpath, self.project_root)
                zf.write(fpath, arcname)
                total_size += os.path.getsize(fpath)
        with self._lock, self._get_conn() as conn:
            conn.execute("UPDATE versions SET is_current=0 WHERE is_current=1")
            conn.execute(
                "INSERT INTO versions (id, version, label, description, backup_path, file_count, total_size, created_at, is_current) VALUES (?,?,?,?,?,?,?,?,1)",
                (vid, CURRENT_VERSION, label, description, backup_path, len(files), total_size, time.time())
            )
        return {"success": True, "version_id": vid, "file_count": len(files),
                "size_mb": round(total_size / 1048576, 2), "backup_path": backup_path}

    def list_versions(self) -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM versions ORDER BY created_at DESC").fetchall()
            result = []
            for r in rows:
                result.append({
                    "id": r["id"], "version": r["version"], "label": r["label"],
                    "description": r["description"], "file_count": r["file_count"],
                    "size_mb": round(r["total_size"] / 1048576, 2),
                    "created_at": datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d %H:%M"),
                    "is_current": bool(r["is_current"]),
                    "backup_exists": os.path.isfile(r["backup_path"]),
                })
            return result

    def rollback(self, version_id: str) -> Dict:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM versions WHERE id=?", (version_id,)).fetchone()
            if not row:
                return {"success": False, "error": "版本不存在"}
            backup_path = row["backup_path"]
            if not os.path.isfile(backup_path):
                return {"success": False, "error": "备份文件不存在"}
            pre_rollback = self.create_snapshot(label="回退前自动备份",
                                                description=f"回退到 {version_id} 前的自动快照")
            try:
                with zipfile.ZipFile(backup_path, "r") as zf:
                    zf.extractall(self.project_root)
                conn.execute("UPDATE versions SET is_current=0")
                conn.execute("UPDATE versions SET is_current=1 WHERE id=?", (version_id,))
                return {"success": True, "message": f"已回退到版本 {version_id}，重启后生效",
                        "auto_backup": pre_rollback.get("version_id")}
            except Exception as e:
                return {"success": False, "error": f"回退失败: {e}"}

    def delete_version(self, version_id: str) -> Dict:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT backup_path, is_current FROM versions WHERE id=?", (version_id,)).fetchone()
            if not row:
                return {"success": False, "error": "版本不存在"}
            if row["is_current"]:
                return {"success": False, "error": "不能删除当前版本"}
            if row["backup_path"] and os.path.isfile(row["backup_path"]):
                os.unlink(row["backup_path"])
            conn.execute("DELETE FROM versions WHERE id=?", (version_id,))
            return {"success": True}

    def check_update(self, update_url: str = "") -> Dict:
        """检查本地文件变更（对比当前代码和最近快照）"""
        try:
            current_files = self._collect_files()
            current_hashes = {}
            for fpath in current_files:
                h = self._hash_file(fpath)
                if h:
                    current_hashes[os.path.relpath(fpath, self.project_root)] = h
            # 获取最近的快照
            with self._lock, self._get_conn() as conn:
                row = conn.execute(
                    "SELECT * FROM versions ORDER BY created_at DESC LIMIT 1"
                ).fetchone()
            if not row:
                return {
                    "success": True,
                    "current_version": CURRENT_VERSION,
                    "latest_version": CURRENT_VERSION,
                    "update_available": False,
                    "message": "暂无快照，建议创建第一个快照作为基线",
                    "check_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "changes": {"added": [], "modified": [], "deleted": []},
                }
            # 对比快照中的文件
            changed = {"added": [], "modified": [], "deleted": []}
            snapshot_files = set()
            try:
                with zipfile.ZipFile(row["backup_path"], "r") as zf:
                    for name in zf.namelist():
                        snapshot_files.add(name)
                        if name in current_hashes:
                            # 对比文件内容hash
                            old_content = zf.read(name)
                            old_hash = hashlib.sha256(old_content).hexdigest()
                            if old_hash != current_hashes[name]:
                                stat = os.stat(os.path.join(self.project_root, name)) if os.path.isfile(os.path.join(self.project_root, name)) else None
                                changed["modified"].append({
                                    "file": name,
                                    "size": stat.st_size if stat else 0,
                                    "old_size": len(old_content),
                                })
                        else:
                            changed["deleted"].append({"file": name})
            except Exception:
                pass
            for name in current_hashes:
                if name not in snapshot_files:
                    stat = os.stat(os.path.join(self.project_root, name))
                    changed["added"].append({"file": name, "size": stat.st_size})
            total_changes = len(changed["added"]) + len(changed["modified"]) + len(changed["deleted"])
            has_changes = total_changes > 0
            return {
                "success": True,
                "current_version": CURRENT_VERSION,
                "latest_version": CURRENT_VERSION,
                "update_available": has_changes,
                "message": f"自快照 [{row['id']}] 以来有 {total_changes} 个文件变更" if has_changes else "与最近快照一致，无变更",
                "check_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "changes": changed,
                "snapshot_id": row["id"],
                "snapshot_label": row["label"],
                "snapshot_time": datetime.fromtimestamp(row["created_at"]).strftime("%Y-%m-%d %H:%M"),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_changelog(self) -> List[Dict]:
        """获取版本变更历史（基于快照标签和描述）"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM versions ORDER BY created_at DESC").fetchall()
            return [{
                "id": r["id"], "version": r["version"], "label": r["label"],
                "description": r["description"], "file_count": r["file_count"],
                "size_mb": round(r["total_size"] / 1048576, 2),
                "created_at": datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d %H:%M"),
                "is_current": bool(r["is_current"]),
            } for r in rows]

    def get_current_version(self) -> Dict:
        return {"version": CURRENT_VERSION, "project_root": self.project_root,
                "snapshot_count": len(self.get_changelog())}

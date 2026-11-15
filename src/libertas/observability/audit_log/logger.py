"""
审计日志中心

集中记录所有用户操作，支持筛选、搜索、导出、完整性校验。
使用 SQLite + FTS5 全文索引，支持百万级日志。
"""
import os
import json
import time
import sqlite3
import hashlib
import threading
import queue
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .models import AuditEntry
from .query import AuditQueryMixin


class AuditLogger(AuditQueryMixin):
    """审计日志中心：写入、完整性、清理与生命周期。"""

    SEVERITY_LEVELS = {'debug': 0, 'info': 1, 'warning': 2, 'error': 3, 'critical': 4}
    CATEGORIES = ['system', 'auth', 'user', 'config', 'security', 'tool', 'model', 'data', 'workflow']

    def __init__(self, data_dir: str = "", max_entries: int = 1000000,
                 retention_days: int = 90, async_write: bool = True):
        self.data_dir = data_dir or get_data_dir()
        self.db_path = os.path.join(self.data_dir, "audit_log.db")
        self.max_entries = max_entries
        self.retention_days = retention_days
        self.async_write = async_write
        self._lock = threading.RLock()
        self._write_queue: "queue.Queue[Optional[AuditEntry]]" = queue.Queue(maxsize=10000)
        self._writer_thread: Optional[threading.Thread] = None
        self._running = False
        self._last_hash = ""
        self._stats_cache: Dict[str, Any] = {}
        self._stats_last_update = 0.0
        self._ensure_dir()
        self._init_db()
        self._load_last_hash()
        if self.async_write:
            self._start_writer()
        terminal.info(f"审计日志中心已初始化 (DB: {self.db_path})", "audit")

    def _ensure_dir(self):
        os.makedirs(self.data_dir, exist_ok=True)

    def _init_db(self):
        """初始化数据库表和索引"""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id TEXT PRIMARY KEY,
                    timestamp REAL NOT NULL,
                    time TEXT NOT NULL,
                    action TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'system',
                    user TEXT DEFAULT '',
                    details TEXT DEFAULT '',
                    severity TEXT DEFAULT 'info',
                    ip TEXT DEFAULT '',
                    user_agent TEXT DEFAULT '',
                    session_id TEXT DEFAULT '',
                    resource TEXT DEFAULT '',
                    result TEXT DEFAULT '',
                    duration_ms REAL DEFAULT 0,
                    prev_hash TEXT DEFAULT '',
                    hash TEXT DEFAULT ''
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_logs(timestamp)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_category ON audit_logs(category)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_severity ON audit_logs(severity)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_user ON audit_logs(user)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_action ON audit_logs(action)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_cat_sev ON audit_logs(category, severity)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_time_cat ON audit_logs(timestamp, category)")
    
            # FTS5 全文索引
            try:
                conn.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS audit_fts USING fts5(
                        id, action, details, user, resource,
                        content='audit_logs', content_rowid='rowid'
                    )
                """)
                # 触发器同步 FTS
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS audit_ai AFTER INSERT ON audit_logs BEGIN
                        INSERT INTO audit_fts(rowid, id, action, details, user, resource)
                        VALUES (new.rowid, new.id, new.action, new.details, new.user, new.resource);
                    END
                """)
            except sqlite3.OperationalError:
                pass  # FTS5 不可用时降级
    
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                )
            """)
            conn.commit()
        finally:
            conn.close()

    def _load_last_hash(self):
        """加载最后一条日志的哈希"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.execute(
                "SELECT hash FROM audit_logs ORDER BY timestamp DESC LIMIT 1"
            )
            row = cursor.fetchone()
            if row:
                self._last_hash = row[0]
            conn.close()
        except Exception:
            self._last_hash = ""

    def _start_writer(self):
        """启动异步写入线程"""
        if self._running:
            return
        self._running = True
        self._writer_thread = threading.Thread(
            target=self._writer_loop, daemon=True, name="AuditWriter"
        )
        self._writer_thread.start()

    def _writer_loop(self):
        """异步写入循环"""
        batch = []
        last_flush = time.time()
        while self._running:
            try:
                entry = self._write_queue.get(timeout=0.5)
                if entry is None:
                    break
                batch.append(entry)
                if len(batch) >= 100 or (time.time() - last_flush) > 1.0:
                    self._flush_batch(batch)
                    batch = []
                    last_flush = time.time()
            except queue.Empty:
                if batch:
                    self._flush_batch(batch)
                    batch = []
                    last_flush = time.time()
            except Exception as e:
                terminal.error(f"审计日志写入异常: {e}", "audit")
        if batch:
            self._flush_batch(batch)

    def _flush_batch(self, batch: List[AuditEntry]):
        """批量写入日志"""
        if not batch:
            return
        try:
            conn = sqlite3.connect(self.db_path)
            for entry in batch:
                with self._lock:
                    entry.prev_hash = self._last_hash
                    entry.hash = entry.compute_hash(self._last_hash)
                    self._last_hash = entry.hash
                conn.execute(
                    """INSERT OR REPLACE INTO audit_logs
                       (id, timestamp, time, action, category, user, details,
                        severity, ip, user_agent, session_id, resource, result,
                        duration_ms, prev_hash, hash)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    entry.to_row(),
                )
            conn.commit()
            conn.close()
        except Exception as e:
            terminal.error(f"审计日志批量写入失败: {e}", "audit")

    def _write_entry(self, entry: AuditEntry):
        """写入单条日志（同步或异步）"""
        if self.async_write:
            try:
                self._write_queue.put(entry, block=False)
            except queue.Full:
                self._flush_batch([entry])
        else:
            self._flush_batch([entry])

    def log(self, action: str, category: str = "system", user: str = "",
            details: str = "", severity: str = "info", ip: str = "",
            user_agent: str = "", session_id: str = "", resource: str = "",
            result: str = "", duration_ms: float = 0.0) -> str:
        """记录审计日志"""
        entry = AuditEntry(
            action=action, category=category, user=user, details=details,
            severity=severity, ip=ip, user_agent=user_agent, session_id=session_id,
            resource=resource, result=result, duration_ms=duration_ms,
        )
        self._write_entry(entry)
        return entry.id

    def log_auth(self, user: str, action: str = "login", success: bool = True,
                 ip: str = "", details: str = ""):
        """记录认证相关日志"""
        self.log(
            action=f"auth_{action}", category="auth", user=user,
            details=details, severity="info" if success else "warning",
            ip=ip, result="success" if success else "failed",
        )

    def log_security(self, action: str, severity: str = "warning",
                     user: str = "", details: str = "", ip: str = "",
                     resource: str = ""):
        """记录安全相关日志"""
        self.log(
            action=action, category="security", user=user, details=details,
            severity=severity, ip=ip, resource=resource,
        )

    def log_tool(self, tool: str, user: str = "", params: str = "",
                 success: bool = True, duration_ms: float = 0.0,
                 error: str = ""):
        """记录工具执行日志"""
        self.log(
            action=f"tool_{tool}", category="tool", user=user,
            details=f"params={params}; error={error}" if error else f"params={params}",
            severity="info" if success else "error",
            result="success" if success else "failed",
            duration_ms=duration_ms,
        )

    def log_config(self, action: str, user: str = "", key: str = "",
                   old_value: str = "", new_value: str = ""):
        """记录配置变更日志"""
        self.log(
            action=f"config_{action}", category="config", user=user,
            details=f"key={key}; old={old_value}; new={new_value}",
            severity="info", resource=key,
        )

    def fulltext_search(self, query: str, limit: int = 100) -> List[Dict[str, Any]]:
        """全文搜索（FTS5）"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.execute(
                """SELECT a.id, a.timestamp, a.time, a.action, a.category,
                          a.user, a.details, a.severity
                   FROM audit_fts f
                   JOIN audit_logs a ON f.id = a.id
                   WHERE audit_fts MATCH ?
                   ORDER BY a.timestamp DESC
                   LIMIT ?""",
                (query, limit),
            )
            columns = [d[0] for d in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]
            conn.close()
            return results
        except Exception:
            return self.query(search=query, limit=limit)

    def get_categories(self) -> List[str]:
        """获取所有分类"""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("SELECT DISTINCT category FROM audit_logs ORDER BY category")
            return [row[0] for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_severities(self) -> List[str]:
        """获取所有严重级别"""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("SELECT DISTINCT severity FROM audit_logs ORDER BY severity")
            return [row[0] for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_timeline(self, days: int = 7) -> List[Dict[str, Any]]:
        """获取按天统计的时间线"""
        conn = sqlite3.connect(self.db_path)
        try:
            start = (datetime.now() - timedelta(days=days)).timestamp()
            cursor = conn.execute(
                """SELECT DATE(time, 'unixepoch', 'localtime') as day,
                          COUNT(*) as total,
                          SUM(CASE WHEN severity='error' THEN 1 ELSE 0 END) as errors,
                          SUM(CASE WHEN severity='warning' THEN 1 ELSE 0 END) as warnings
                   FROM audit_logs
                   WHERE timestamp >= ?
                   GROUP BY day
                   ORDER BY day""",
                (start,),
            )
            return [
                {"day": row[0], "total": row[1], "errors": row[2], "warnings": row[3]}
                for row in cursor.fetchall()
            ]
        finally:
            conn.close()

    def verify_integrity(self) -> Dict[str, Any]:
        """验证哈希链完整性"""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute(
                "SELECT id, timestamp, action, category, user, details, severity, ip, prev_hash, hash "
                "FROM audit_logs ORDER BY timestamp ASC"
            )
            total = 0
            valid = 0
            broken = []
            prev_hash = ""
            for row in cursor.fetchall():
                total += 1
                entry = AuditEntry(
                    action=row[2], category=row[3], user=row[4],
                    details=row[5], severity=row[6], ip=row[7],
                )
                entry.id = row[0]
                entry.timestamp = row[1]
                expected_hash = entry.compute_hash(prev_hash)
                if expected_hash == row[9] and row[8] == prev_hash:
                    valid += 1
                else:
                    broken.append({"id": row[0], "expected": expected_hash, "actual": row[9]})
                prev_hash = row[9]
    
            return {
                "total": total,
                "valid": valid,
                "broken": len(broken),
                "broken_entries": broken[:10],
                "integrity": valid == total,
            }
        finally:
            conn.close()

    def cleanup_old_logs(self) -> int:
        """清理过期日志"""
        cutoff = (datetime.now() - timedelta(days=self.retention_days)).timestamp()
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("DELETE FROM audit_logs WHERE timestamp < ?", (cutoff,))
            deleted = cursor.rowcount
            conn.commit()
            if deleted > 0:
                terminal.info(f"清理过期审计日志: {deleted} 条", "audit")
            return deleted
        finally:
            conn.close()

    def enforce_max_entries(self) -> int:
        """强制最大条目数限制"""
        conn = sqlite3.connect(self.db_path)
        try:
            count = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
            if count <= self.max_entries:
                return 0
            to_delete = count - self.max_entries
            conn.execute(
                "DELETE FROM audit_logs WHERE id IN "
                "(SELECT id FROM audit_logs ORDER BY timestamp ASC LIMIT ?)",
                (to_delete,),
            )
            conn.commit()
            terminal.info(f"清理超出上限的审计日志: {to_delete} 条", "audit")
            return to_delete
        finally:
            conn.close()

    def clear(self):
        """清空所有日志"""
        conn = sqlite3.connect(self.db_path)
        try:
            conn.execute("DELETE FROM audit_logs")
            conn.commit()
            self._last_hash = ""
            terminal.warn("审计日志已清空", "audit")
        finally:
            conn.close()

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        """获取单条日志详情"""
        conn = sqlite3.connect(self.db_path)
        try:
            cursor = conn.execute("SELECT * FROM audit_logs WHERE id = ?", (entry_id,))
            row = cursor.fetchone()
            if not row:
                return None
            columns = [d[0] for d in cursor.description]
            return dict(zip(columns, row))
        finally:
            conn.close()

    def flush(self):
        """等待异步写入完成"""
        if self.async_write and self._writer_thread:
            self._write_queue.join()

    def close(self):
        """关闭审计日志器"""
        self.flush()
        self._running = False
        if self._writer_thread:
            self._write_queue.put(None)
            self._writer_thread.join(timeout=5)
        self.cleanup_old_logs()
        self.enforce_max_entries()

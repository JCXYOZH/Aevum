"""
违规处理与内容过滤模块
- 内容过滤层：敏感词、正则模式、URL过滤
- 违规记录：初次警告、二次封禁
- 申诉通道：提交申诉，仲裁者审核
- 异常行为检测：频率异常、刷屏、垃圾信息
"""
import os
import re
import time
import json
import sqlite3
import threading
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from libertas.foundation.config import get_data_dir


DEFAULT_BLOCKED_WORDS = [
   "赌博", "色情", "毒品", "枪支", "诈骗",
]

SPAM_PATTERNS = [
    r"(.)\1{10,}",
    r"(https?://\S+){5,}",
    r"(\S{50,})",
]


class ContentFilter:
    def __init__(self, db_path: str = ""):
        if not db_path:
            db_dir = os.path.join(get_data_dir(), "Governance")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "violations.db")
        self.db_path = db_path
        self._lock = threading.Lock()
        self.blocked_words: List[str] = list(DEFAULT_BLOCKED_WORDS)
        self.blocked_patterns: List[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in SPAM_PATTERNS]
        self.custom_words: List[str] = []
        self._init_db()
        self._load_custom_words()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS violations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    peer_id TEXT NOT NULL,
                    peer_name TEXT DEFAULT '',
                    violation_type TEXT NOT NULL,
                    content TEXT DEFAULT '',
                    severity TEXT DEFAULT 'warning',
                    action TEXT DEFAULT 'warned',
                    timestamp REAL NOT NULL,
                    appealed INTEGER DEFAULT 0,
                    appeal_reason TEXT DEFAULT '',
                    appeal_status TEXT DEFAULT '',
                    appeal_reviewer TEXT DEFAULT '',
                    appeal_result TEXT DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS filter_words (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    word TEXT NOT NULL UNIQUE,
                    pattern TEXT DEFAULT 'exact',
                    added_by TEXT DEFAULT '',
                    added_at REAL NOT NULL,
                    enabled INTEGER DEFAULT 1
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rate_limits (
                    peer_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    timestamps TEXT DEFAULT '[]',
                    PRIMARY KEY (peer_id, action)
                )
            """)

    def _load_custom_words(self):
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT word, pattern FROM filter_words WHERE enabled=1").fetchall()
            for r in rows:
                if r["pattern"] == "regex":
                    try:
                        self.blocked_patterns.append(re.compile(r["word"], re.IGNORECASE))
                    except Exception:
                        pass
                else:
                    self.custom_words.append(r["word"])

    def add_blocked_word(self, word: str, pattern: str = "exact", added_by: str = "") -> bool:
        with self._lock, self._get_conn() as conn:
            try:
                conn.execute("INSERT INTO filter_words (word, pattern, added_by, added_at) VALUES (?,?,?,?)",
                             (word, pattern, added_by, time.time()))
                if pattern == "regex":
                    self.blocked_patterns.append(re.compile(word, re.IGNORECASE))
                else:
                    self.custom_words.append(word)
                return True
            except sqlite3.IntegrityError:
                return False

    def check_content(self, text: str) -> Tuple[bool, List[str]]:
        if not text:
            return True, []
        reasons = []
        lower = text.lower()
        for word in self.blocked_words + self.custom_words:
            if word.lower() in lower:
                reasons.append(f"敏感词: {word}")
        for pat in self.blocked_patterns:
            if pat.search(text):
                reasons.append(f"异常模式: {pat.pattern[:30]}")
        return (len(reasons) == 0), reasons

    def check_rate_limit(self, peer_id: str, action: str, max_count: int, window_seconds: int) -> Tuple[bool, str]:
        now = time.time()
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT timestamps FROM rate_limits WHERE peer_id=? AND action=?",
                               (peer_id, action)).fetchone()
            timestamps = json.loads(row["timestamps"]) if row else []
            timestamps = [t for t in timestamps if now - t < window_seconds]
            if len(timestamps) >= max_count:
                return False, f"频率超限: {len(timestamps)}/{max_count}次/{window_seconds}秒"
            timestamps.append(now)
            conn.execute("INSERT OR REPLACE INTO rate_limits (peer_id, action, timestamps) VALUES (?,?,?)",
                         (peer_id, action, json.dumps(timestamps)))
            return True, ""

    def record_violation(self, peer_id: str, peer_name: str, violation_type: str,
                         content: str = "", auto_action: bool = True) -> Dict:
        with self._lock, self._get_conn() as conn:
            prior = conn.execute(
                "SELECT COUNT(*) as c FROM violations WHERE peer_id=? AND appealed=0",
                (peer_id,)
            ).fetchone()["c"]
            if prior == 0:
                severity = "warning"
                action = "warned"
            else:
                severity = "ban"
                action = "banned"
            now = time.time()
            cur = conn.execute(
                "INSERT INTO violations (peer_id, peer_name, violation_type, content, severity, action, timestamp) VALUES (?,?,?,?,?,?,?)",
                (peer_id, peer_name, violation_type, content[:500], severity, action, now)
            )
            vid = cur.lastrowid
        return {
            "id": vid, "peer_id": peer_id, "severity": severity, "action": action,
            "violation_type": violation_type,
            "message": f"⚠️ 警告：您的内容违反规则（{violation_type}）" if severity == "warning"
                       else f"🚫 您已被封禁（二次违规：{violation_type}）。可提交申诉。",
            "is_banned": severity == "ban",
        }

    def is_banned(self, peer_id: str) -> bool:
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT severity FROM violations WHERE peer_id=? AND appealed=0 ORDER BY timestamp DESC LIMIT 1",
                (peer_id,)
            ).fetchone()
            return bool(row and row["severity"] == "ban")

    def submit_appeal(self, violation_id: int, reason: str) -> Dict:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM violations WHERE id=?", (violation_id,)).fetchone()
            if not row:
                return {"success": False, "error": "违规记录不存在"}
            if row["appealed"]:
                return {"success": False, "error": "已提交过申诉"}
            conn.execute("UPDATE violations SET appealed=1, appeal_reason=?, appeal_status='pending' WHERE id=?",
                         (reason, violation_id))
        return {"success": True, "message": "申诉已提交，等待仲裁者审核"}

    def review_appeal(self, violation_id: int, reviewer_id: str, approved: bool, result: str = "") -> Dict:
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM violations WHERE id=?", (violation_id,)).fetchone()
            if not row:
                return {"success": False, "error": "记录不存在"}
            if approved:
                conn.execute("UPDATE violations SET appeal_status='approved', appeal_reviewer=?, appeal_result=?, severity='warning', action='warned' WHERE id=?",
                             (reviewer_id, result, violation_id))
                return {"success": True, "message": "申诉通过，封禁已解除"}
            else:
                conn.execute("UPDATE violations SET appeal_status='rejected', appeal_reviewer=?, appeal_result=? WHERE id=?",
                             (reviewer_id, result, violation_id))
                return {"success": True, "message": "申诉已驳回"}

    def list_appeals(self, status: str = "pending") -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM violations WHERE appeal_status=? ORDER BY timestamp DESC", (status,)
            ).fetchall()
            return [dict(r) for r in rows]

    def list_violations(self, peer_id: str = "", limit: int = 50) -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            if peer_id:
                rows = conn.execute("SELECT * FROM violations WHERE peer_id=? ORDER BY timestamp DESC LIMIT ?",
                                    (peer_id, limit)).fetchall()
            else:
                rows = conn.execute("SELECT * FROM violations ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    def get_terms(self) -> str:
        return """【使用条款与违规处理流程】

1. 禁止发布违法、色情、暴力、诈骗、骚扰等不良内容
2. 禁止刷屏、垃圾信息、恶意链接
3. 尊重其他用户，禁止人身攻击和歧视言论
4. 保护隐私，禁止未经许可分享他人个人信息

违规处理：
- 初次违规：系统自动警告，记录在案
- 二次违规：自动封禁，可提交申诉
- 申诉通道：被封禁用户可提交申诉理由，由仲裁者审核
- 申诉通过：解除封禁；申诉驳回：维持封禁

内容过滤：
- 系统自动检测敏感词和异常模式
- 频率限制：防止刷屏和垃圾信息
- 审核员可手动添加过滤词

数据归属：
- 用户数据归用户所有
- 聊天记录加密存储在本地
- 云端仅存储加密后的密文
- 未经授权，任何人不得访问他人数据
"""

"""
聊天记录本地存储模块
- SQLite 存储局域网/广域网聊天记录
- 支持按房间、对端、时间检索
- 可接入 RAG 知识库供模型检索
"""
import os
import json
import sqlite3
import threading
import time
from typing import List, Dict, Optional
from datetime import datetime
from libertas.foundation.config import get_data_dir


class ChatStorage:
    def __init__(self, db_path: str = ""):
        if not db_path:
            db_dir = os.path.join(get_data_dir(), "ChatHistory")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "chat_history.db")
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    network TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    peer_id TEXT NOT NULL,
                    peer_name TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    msg_type TEXT NOT NULL DEFAULT 'text',
                    content TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    timestamp REAL NOT NULL,
                    time_str TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rooms (
                    network TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    room_name TEXT DEFAULT '',
                    password_hash TEXT DEFAULT '',
                    owner_id TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    last_active REAL NOT NULL,
                    PRIMARY KEY (network, room_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS peers (
                    network TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    peer_id TEXT NOT NULL,
                    peer_name TEXT NOT NULL,
                    role TEXT DEFAULT 'member',
                    pubkey TEXT DEFAULT '',
                    first_seen REAL NOT NULL,
                    last_seen REAL NOT NULL,
                    banned INTEGER DEFAULT 0,
                    PRIMARY KEY (network, room_id, peer_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_room ON messages(network, room_id, timestamp)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_msg_peer ON messages(network, room_id, peer_id, timestamp)")

    def store_message(self, network: str, room_id: str, peer_id: str, peer_name: str,
                      direction: str, content: str, msg_type: str = "text",
                      metadata: Optional[Dict] = None) -> int:
        now = time.time()
        time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO messages (network, room_id, peer_id, peer_name, direction, msg_type, content, metadata, timestamp, time_str) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (network, room_id, peer_id, peer_name, direction, msg_type, content, meta_json, now, time_str)
            )
            conn.execute(
                "UPDATE rooms SET last_active=? WHERE network=? AND room_id=?",
                (now, network, room_id)
            )
            return cur.lastrowid

    def store_room(self, network: str, room_id: str, room_name: str = "",
                   password_hash: str = "", owner_id: str = ""):
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO rooms (network, room_id, room_name, password_hash, owner_id, created_at, last_active) VALUES (?,?,?,?,?,?,?)",
                (network, room_id, room_name, password_hash, owner_id, now, now)
            )

    def upsert_peer(self, network: str, room_id: str, peer_id: str, peer_name: str,
                    role: str = "member", pubkey: str = ""):
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO peers (network, room_id, peer_id, peer_name, role, pubkey, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?) "
                "ON CONFLICT(network, room_id, peer_id) DO UPDATE SET peer_name=?, role=?, pubkey=?, last_seen=?",
                (network, room_id, peer_id, peer_name, role, pubkey, now, now, peer_name, role, pubkey, now)
            )

    def set_peer_role(self, network: str, room_id: str, peer_id: str, role: str) -> bool:
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE peers SET role=? WHERE network=? AND room_id=? AND peer_id=?",
                (role, network, room_id, peer_id)
            )
            return cur.rowcount > 0

    def ban_peer(self, network: str, room_id: str, peer_id: str, banned: bool = True) -> bool:
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE peers SET banned=? WHERE network=? AND room_id=? AND peer_id=?",
                (1 if banned else 0, network, room_id, peer_id)
            )
            return cur.rowcount > 0

    def is_banned(self, network: str, room_id: str, peer_id: str) -> bool:
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT banned FROM peers WHERE network=? AND room_id=? AND peer_id=?",
                (network, room_id, peer_id)
            ).fetchone()
            return bool(row and row["banned"])

    def get_peer_role(self, network: str, room_id: str, peer_id: str) -> str:
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT role FROM peers WHERE network=? AND room_id=? AND peer_id=?",
                (network, room_id, peer_id)
            ).fetchone()
            return row["role"] if row else "guest"

    def get_messages(self, network: str = "", room_id: str = "", limit: int = 100,
                     offset: int = 0, peer_id: str = "", keyword: str = "") -> List[Dict]:
        q = "SELECT * FROM messages WHERE 1=1"
        params = []
        if network:
            q += " AND network=?"
            params.append(network)
        if room_id:
            q += " AND room_id=?"
            params.append(room_id)
        if peer_id:
            q += " AND peer_id=?"
            params.append(peer_id)
        if keyword:
            q += " AND content LIKE ?"
            params.append(f"%{keyword}%")
        q += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]

    def get_rooms(self, network: str = "") -> List[Dict]:
        q = "SELECT * FROM rooms WHERE 1=1"
        params = []
        if network:
            q += " AND network=?"
            params.append(network)
        q += " ORDER BY last_active DESC"
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(q, params).fetchall()
            return [dict(r) for r in rows]

    def get_peers(self, network: str, room_id: str) -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM peers WHERE network=? AND room_id=? ORDER BY last_seen DESC",
                (network, room_id)
            ).fetchall()
            return [dict(r) for r in rows]

    def search_history(self, keyword: str, network: str = "", limit: int = 50) -> List[Dict]:
        return self.get_messages(network=network, keyword=keyword, limit=limit)

    def get_stats(self) -> Dict:
        with self._lock, self._get_conn() as conn:
            total = conn.execute("SELECT COUNT(*) as c FROM messages").fetchone()["c"]
            lan = conn.execute("SELECT COUNT(*) as c FROM messages WHERE network='lan'").fetchone()["c"]
            wan = conn.execute("SELECT COUNT(*) as c FROM messages WHERE network='wan'").fetchone()["c"]
            rooms = conn.execute("SELECT COUNT(*) as c FROM rooms").fetchone()["c"]
            return {"total": total, "lan": lan, "wan": wan, "rooms": rooms}

"""
治理模块
- 角色与权限：5种角色，9项权限，角色带过期日期
- 提案与投票：社区发起提案，达到共识度即可通过
- 分叉机制：共识达成后可导出完整规则+代码快照，形成独立平台
- 全局统计：通过 MQTT 广播聚合在线用户数
"""
import os
import json
import time
import uuid
import sqlite3
import threading
import shutil
import zipfile
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from pathlib import Path
from libertas.foundation.config import get_data_dir
from .constants import *


class Governance:
    def __init__(self, db_path: str = "", project_root: str = ""):
        if not db_path:
            db_dir = os.path.join(get_data_dir(), "Governance")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "governance.db")
        self.db_path = db_path
        self.project_root = project_root or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self._lock = threading.Lock()
        self._init_db()
        self.global_peers: Dict[str, Dict] = {}
        self._global_lock = threading.Lock()

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS role_assignments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scope TEXT NOT NULL DEFAULT 'global',
                    room_id TEXT DEFAULT '',
                    peer_id TEXT NOT NULL,
                    peer_name TEXT DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'member',
                    granted_by TEXT DEFAULT '',
                    granted_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    active INTEGER DEFAULT 1,
                    UNIQUE(scope, room_id, peer_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS proposals (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    proposal_type TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    author_name TEXT DEFAULT '',
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL,
                    status TEXT DEFAULT 'active',
                    votes_for TEXT DEFAULT '[]',
                    votes_against TEXT DEFAULT '[]',
                    votes_abstain TEXT DEFAULT '[]',
                    result TEXT DEFAULT '',
                    room_id TEXT DEFAULT ''
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS forks (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT DEFAULT '',
                    author_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    snapshot_path TEXT DEFAULT '',
                    consensus REAL DEFAULT 0,
                    voter_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'pending'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS seen_peers (
                    peer_id TEXT PRIMARY KEY,
                    nickname TEXT DEFAULT '',
                    role TEXT DEFAULT 'guest',
                    room_id TEXT DEFAULT '',
                    version TEXT DEFAULT '',
                    first_seen REAL NOT NULL,
                    last_seen REAL NOT NULL
                )
            """)

    def assign_role(self, peer_id: str, peer_name: str, role: str,
                    scope: str = "global", room_id: str = "", granted_by: str = "",
                    days: int = DEFAULT_ROLE_EXPIRY_DAYS) -> Dict:
        if role not in ROLE_DEFAULT_PERMS:
            return {"success": False, "error": f"未知角色: {role}"}
        now = time.time()
        expires = now + days * 86400
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO role_assignments (scope, room_id, peer_id, peer_name, role, granted_by, granted_at, expires_at, active) VALUES (?,?,?,?,?,?,?,?,1) "
                "ON CONFLICT(scope, room_id, peer_id) DO UPDATE SET role=?, granted_by=?, granted_at=?, expires_at=?, active=1, peer_name=?",
                (scope, room_id, peer_id, peer_name, role, granted_by, now, expires,
                 role, granted_by, now, expires, peer_name)
            )
        return {
            "success": True, "peer_id": peer_id, "role": role,
            "role_label": ROLE_PERMISSIONS[role]["label"],
            "expires_at": datetime.fromtimestamp(expires).strftime("%Y-%m-%d"),
            "days_remaining": days,
        }

    def get_role(self, peer_id: str, scope: str = "global", room_id: str = "") -> Dict:
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT * FROM role_assignments WHERE peer_id=? AND scope=? AND (room_id=? OR room_id='') AND active=1 ORDER BY expires_at DESC LIMIT 1",
                (peer_id, scope, room_id)
            ).fetchone()
        if not row:
            return {
                "role": "guest", "role_label": ROLE_PERMISSIONS["guest"]["label"],
                "permissions": ROLE_DEFAULT_PERMS["guest"],
                "expires_at": None, "days_remaining": None, "expired": False,
            }
        now = time.time()
        expired = row["expires_at"] < now
        role = row["role"]
        if expired:
            role = "guest"
        return {
            "role": role,
            "role_label": ROLE_PERMISSIONS[role]["label"],
            "permissions": ROLE_DEFAULT_PERMS[role],
            "permission_labels": ROLE_PERMISSIONS[role]["permissions"],
            "granted_at": datetime.fromtimestamp(row["granted_at"]).strftime("%Y-%m-%d"),
            "expires_at": datetime.fromtimestamp(row["expires_at"]).strftime("%Y-%m-%d"),
            "days_remaining": max(0, int((row["expires_at"] - now) / 86400)),
            "expired": expired,
            "needs_review": expired or (row["expires_at"] - now) < 30 * 86400,
        }

    def has_permission(self, peer_id: str, permission: str, scope: str = "global", room_id: str = "") -> bool:
        role_info = self.get_role(peer_id, scope, room_id)
        return role_info["permissions"].get(permission, False)

    def expire_old_roles(self) -> int:
        now = time.time()
        with self._lock, self._get_conn() as conn:
            cur = conn.execute(
                "UPDATE role_assignments SET active=0 WHERE expires_at < ? AND active=1",
                (now,)
            )
            return cur.rowcount

    def create_proposal(self, title: str, description: str, proposal_type: str,
                        author_id: str, author_name: str = "", room_id: str = "",
                        duration_days: int = 0, author_contribution: int = 0,
                        is_activated: bool = False) -> Dict:
        ptype_info = PROPOSAL_TYPES.get(proposal_type, PROPOSAL_TYPES["governance"])

        # 身份验证：必须是已激活用户
        if not is_activated:
            return {"success": False, "error": "发起提案需要完成身份认证和激活", "code": "not_activated"}

        # 贡献分要求
        min_contrib = ptype_info.get("min_contribution", 0)
        if author_contribution < min_contrib:
            return {"success": False, "error": f"发起{ptype_info['label']}需要贡献分至少{min_contrib}，当前{author_contribution}", "code": "low_contribution"}

        # 冷却期检查
        cooldown = ptype_info.get("cooldown_days", PROPOSAL_COOLDOWN_DAYS)
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT created_at FROM proposals WHERE author_id=? AND proposal_type=? ORDER BY created_at DESC LIMIT 1",
                (author_id, proposal_type)
            ).fetchone()
            if row:
                days_since = (time.time() - row["created_at"]) / 86400
                if days_since < cooldown:
                    wait_days = int(cooldown - days_since) + 1
                    return {"success": False, "error": f"冷却期内：{ptype_info['label']}每{cooldown}天只能发起一次，还需等待{wait_days}天", "code": "cooldown"}

        if not title or len(title) < 5:
            return {"success": False, "error": "提案标题至少5个字符", "code": "title_too_short"}
        if not description or len(description) < 20:
            return {"success": False, "error": "提案描述至少20个字符，请详细说明", "code": "desc_too_short"}

        pid = uuid.uuid4().hex[:12]
        now = time.time()
        if duration_days <= 0:
            duration_days = ptype_info["duration_days"]
        expires = now + duration_days * 86400
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO proposals (id, title, description, proposal_type, author_id, author_name, created_at, expires_at, room_id) VALUES (?,?,?,?,?,?,?,?,?)",
                (pid, title, description, proposal_type, author_id, author_name, now, expires, room_id)
            )
        return {"success": True, "proposal_id": pid,
                "expires_at": datetime.fromtimestamp(expires).strftime("%Y-%m-%d"),
                "threshold": ptype_info["threshold"], "min_voters": ptype_info["min_voters"],
                "warning": WARNINGS["proposal"]}

    def vote(self, proposal_id: str, peer_id: str, vote: str, voter_weight: int = 1) -> Dict:
        if vote not in ("for", "against", "abstain"):
            return {"success": False, "error": "无效投票"}
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM proposals WHERE id=?", (proposal_id,)).fetchone()
            if not row:
                return {"success": False, "error": "提案不存在"}
            if row["status"] != "active":
                return {"success": False, "error": "提案已结束"}
            if time.time() > row["expires_at"]:
                self._finalize_proposal(conn, row)
                return {"success": False, "error": "提案已过期"}
            ptype_info = PROPOSAL_TYPES.get(row["proposal_type"], PROPOSAL_TYPES["governance"])
            votes_for = json.loads(row["votes_for"])
            votes_against = json.loads(row["votes_against"])
            votes_abstain = json.loads(row["votes_abstain"])
            for vlist in (votes_for, votes_against, votes_abstain):
                if peer_id in vlist:
                    vlist.remove(peer_id)
            if vote == "for":
                votes_for.append(peer_id)
            elif vote == "against":
                votes_against.append(peer_id)
            else:
                votes_abstain.append(peer_id)
            conn.execute(
                "UPDATE proposals SET votes_for=?, votes_against=?, votes_abstain=? WHERE id=?",
                (json.dumps(votes_for), json.dumps(votes_against), json.dumps(votes_abstain), proposal_id)
            )
            total_voters = len(votes_for) + len(votes_against)
            for_weight = len(votes_for) * voter_weight
            against_weight = len(votes_against) * voter_weight
            total_weight = for_weight + against_weight
            consensus = for_weight / total_weight if total_weight > 0 else 0
            if total_voters >= ptype_info["min_voters"] and consensus >= ptype_info["threshold"]:
                self._finalize_proposal(conn, row, passed=True, votes_for=votes_for,
                                        votes_against=votes_against, votes_abstain=votes_abstain)
                return {"success": True, "status": "passed", "votes_for": len(votes_for),
                        "votes_against": len(votes_against), "consensus": round(consensus, 2)}
        return {"success": True, "status": "active", "votes_for": len(votes_for),
                "votes_against": len(votes_against), "consensus": round(consensus, 2),
                "threshold": ptype_info["threshold"], "min_voters": ptype_info["min_voters"]}

    def _finalize_proposal(self, conn, row, passed=None, votes_for=None, votes_against=None, votes_abstain=None):
        if votes_for is None:
            votes_for = json.loads(row["votes_for"])
            votes_against = json.loads(row["votes_against"])
            votes_abstain = json.loads(row["votes_abstain"])
        total = len(votes_for) + len(votes_against)
        if passed is None:
            passed = total > 0 and len(votes_for) / total >= CONSENSUS_THRESHOLD and total >= 3
        result = f"{'通过' if passed else '未通过'}: 赞成{len(votes_for)} 反对{len(votes_against)} 弃权{len(votes_abstain)}"
        conn.execute(
            "UPDATE proposals SET status=?, result=? WHERE id=?",
            ("passed" if passed else "rejected", result, row["id"])
        )

    def list_proposals(self, status: str = "active", room_id: str = "") -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            if room_id:
                rows = conn.execute(
                    "SELECT * FROM proposals WHERE status=? AND (room_id=? OR room_id='') ORDER BY created_at DESC",
                    (status, room_id)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM proposals WHERE status=? ORDER BY created_at DESC", (status,)
                ).fetchall()
        result = []
        now = time.time()
        for r in rows:
            vf = json.loads(r["votes_for"])
            va = json.loads(r["votes_against"])
            vab = json.loads(r["votes_abstain"])
            total = len(vf) + len(va)
            consensus = len(vf) / total if total > 0 else 0
            ptype_info = PROPOSAL_TYPES.get(r["proposal_type"], PROPOSAL_TYPES["governance"])
            result.append({
                "id": r["id"], "title": r["title"], "description": r["description"],
                "type": r["proposal_type"], "type_label": ptype_info["label"],
                "author": r["author_name"],
                "created_at": datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d"),
                "expires_at": datetime.fromtimestamp(r["expires_at"]).strftime("%Y-%m-%d"),
                "days_remaining": max(0, int((r["expires_at"] - now) / 86400)),
                "votes_for": len(vf), "votes_against": len(va), "votes_abstain": len(vab),
                "consensus": round(consensus, 2), "threshold": ptype_info["threshold"],
                "min_voters": ptype_info["min_voters"], "status": r["status"], "result": r["result"],
            })
        return result

    def create_fork(self, name: str, description: str, author_id: str,
                    voter_ids: List[str], votes_for: List[str],
                    author_contribution: int = 0, is_activated: bool = False,
                    community_size: int = 0) -> Dict:
        # 身份验证
        if not is_activated:
            return {"success": False, "error": "分叉需要完成身份认证和激活", "code": "not_activated"}

        # 贡献分要求
        if author_contribution < FORK_MIN_CONTRIBUTION:
            return {"success": False, "error": f"发起分叉需要贡献分至少{FORK_MIN_CONTRIBUTION}，当前{author_contribution}", "code": "low_contribution"}

        # 社区人数要求
        if community_size < FORK_MIN_COMMUNITY:
            return {"success": False, "error": f"分叉需要社区至少{FORK_MIN_COMMUNITY}人参与，当前{community_size}人", "code": "community_too_small"}

        # 冷却期检查
        with self._lock, self._get_conn() as conn:
            row = conn.execute(
                "SELECT created_at FROM forks WHERE author_id=? ORDER BY created_at DESC LIMIT 1",
                (author_id,)
            ).fetchone()
            if row:
                days_since = (time.time() - row["created_at"]) / 86400
                if days_since < FORK_COOLDOWN_DAYS:
                    wait_days = int(FORK_COOLDOWN_DAYS - days_since) + 1
                    return {"success": False, "error": f"分叉冷却期：{FORK_COOLDOWN_DAYS}天内只能发起一次，还需等待{wait_days}天", "code": "cooldown"}

        total_voters = len(set(voter_ids))
        for_count = len(set(votes_for))
        consensus = for_count / total_voters if total_voters > 0 else 0

        if total_voters < FORK_MIN_COMMUNITY:
            return {"success": False, "error": f"投票人数不足：需要至少{FORK_MIN_COMMUNITY}人投票，当前{total_voters}人", "code": "not_enough_voters"}
        if consensus < FORK_THRESHOLD:
            return {"success": False, "error": f"共识度不足: {consensus:.0%} < {FORK_THRESHOLD:.0%}（需要80%以上赞成）", "code": "low_consensus"}

        if not name or len(name) < 3:
            return {"success": False, "error": "分叉名称至少3个字符", "code": "name_too_short"}
        if not description or len(description) < 30:
            return {"success": False, "error": "分叉描述至少30个字符，请详细说明新平台的方向和规则", "code": "desc_too_short"}

        fid = uuid.uuid4().hex[:12]
        now = time.time()
        snapshot_dir = os.path.join(get_data_dir(), "Forks", fid)
        os.makedirs(snapshot_dir, exist_ok=True)
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-")[:50]
        snapshot_path = os.path.join(snapshot_dir, f"{safe_name}_snapshot.zip")
        try:
            self._create_snapshot(snapshot_path, name, description)
        except Exception as e:
            return {"success": False, "error": f"快照创建失败: {e}"}
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO forks (id, name, description, author_id, created_at, snapshot_path, consensus, voter_count, status) VALUES (?,?,?,?,?,?,?,?,?)",
                (fid, name, description, author_id, now, snapshot_path, consensus, total_voters, "completed")
            )
        return {
            "success": True, "fork_id": fid, "name": name,
            "consensus": consensus, "voters": total_voters,
            "snapshot_path": snapshot_path,
            "snapshot_filename": f"{safe_name}_snapshot.zip",
            "slogan": SLOGAN,
            "warning": WARNINGS["fork"],
            "message": f"您立起了一面旗帜，上面写着：\"{SLOGAN}\"\n\n快照已生成，可在分叉列表中下载。代码包包含完整的平台源码、规则配置和清单文件。",
        }

    def _create_snapshot(self, zip_path: str, name: str, description: str):
        manifest = {
            "name": name,
            "description": description,
            "forked_at": datetime.now().isoformat(),
            "slogan": SLOGAN,
            "rules_version": "1.0",
            "files_included": [],
            "roles": {k: v["label"] for k, v in ROLE_PERMISSIONS.items()},
            "permissions": ROLE_DEFAULT_PERMS,
            "consensus_threshold": CONSENSUS_THRESHOLD,
            "fork_threshold": FORK_THRESHOLD,
            "role_expiry_days": DEFAULT_ROLE_EXPIRY_DAYS,
        }
        data_dir = get_data_dir()
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for dirpath, dirnames, filenames in os.walk(self.project_root):
                if "__pycache__" in dirpath or ".git" in dirpath:
                    continue
                for fn in filenames:
                    if fn.endswith((".pyc", ".pyo", ".db", ".db-wal", ".db-shm")):
                        continue
                    fp = os.path.join(dirpath, fn)
                    arcname = os.path.relpath(fp, os.path.dirname(self.project_root))
                    try:
                        zf.write(fp, arcname)
                        manifest["files_included"].append(arcname)
                    except Exception:
                        pass
            for subdir in ("ChatHistory", "Governance", "RAG"):
                src = os.path.join(data_dir, subdir)
                if os.path.isdir(src):
                    for dirpath, dirnames, filenames in os.walk(src):
                        for fn in filenames:
                            if fn.endswith((".db-wal", ".db-shm")):
                                continue
                            fp = os.path.join(dirpath, fn)
                            arcname = os.path.join("data", subdir, os.path.relpath(fp, src))
                            try:
                                zf.write(fp, arcname)
                            except Exception:
                                pass
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    def list_forks(self) -> List[Dict]:
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM forks ORDER BY created_at DESC").fetchall()
        return [{
            "id": r["id"], "name": r["name"], "description": r["description"],
            "created_at": datetime.fromtimestamp(r["created_at"]).strftime("%Y-%m-%d %H:%M"),
            "consensus": r["consensus"], "voters": r["voter_count"],
            "snapshot_path": r["snapshot_path"], "status": r["status"],
        } for r in rows]

    def update_global_presence(self, peer_id: str, info: Dict):
        now = time.time()
        with self._global_lock:
            info["last_seen"] = now
            self.global_peers[peer_id] = info
            self._cleanup_global_peers()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO seen_peers (peer_id, nickname, role, room_id, version, first_seen, last_seen) "
                "VALUES (?,?,?,?,?,COALESCE((SELECT first_seen FROM seen_peers WHERE peer_id=?),?),?)",
                (peer_id, info.get("nickname", ""), info.get("role", "guest"),
                 info.get("room_id", ""), info.get("version", ""), peer_id, now, now)
            )

    def _cleanup_global_peers(self):
        now = time.time()
        for pid in list(self.global_peers.keys()):
            if now - self.global_peers[pid].get("last_seen", 0) > 60:
                del self.global_peers[pid]

    def get_global_stats(self, registered_count: int = -1) -> Dict:
        with self._global_lock:
            self._cleanup_global_peers()
            peers = list(self.global_peers.values())
        online = len(peers)
        roles_count: Dict[str, int] = {}
        rooms = set()
        versions = set()
        for p in peers:
            r = p.get("role", "guest")
            roles_count[r] = roles_count.get(r, 0) + 1
            if p.get("room_id"):
                rooms.add(p["room_id"])
            if p.get("version"):
                versions.add(p["version"])
        total_registered = registered_count
        if total_registered < 0:
            # 回退：统计seen_peers中不同的peer_id
            with self._lock, self._get_conn() as conn:
                row = conn.execute("SELECT COUNT(DISTINCT peer_id) FROM seen_peers").fetchone()
                total_registered = row[0] if row else 0
        return {
            "online": online,
            "total_registered": total_registered,
            "rooms": len(rooms),
            "roles": roles_count,
            "versions": list(versions),
            "slogan": SLOGAN,
            "default_room": "my_era",
            "peers": [{"peer_id": p.get("peer_id",""), "nickname": p.get("nickname",""),
                       "role": p.get("role","guest"), "room_id": p.get("room_id",""),
                       "version": p.get("version","")} for p in peers],
        }

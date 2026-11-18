"""
身份认证与任务贡献系统

融合两个版本的优点：
- 使用SQLite持久化（吸收0.1.5，7张表）
- 保留身份档案（等级/经验/徽章/技能/连续天数）
- 吸收主账户/子用户系统、任务系统、联系人系统
- 吸收密码哈希（PBKDF2 + salt）、验证码验证
- 唯一主账户（每人一份），可创建子用户但仅主用户可使用工具
- 任务系统：发布任务需支付能力价值，完成任务获得贡献分
"""
import os
import json
import time
import uuid
import hmac
import hashlib
import secrets
import sqlite3
import threading
from enum import Enum
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir


# ============================================================

from .accounts import IdentityAccountMixin
from .crypto import hash_password, verify_password
from .models import Contribution, ContributionType, IdentityProfile


class IdentityManager(IdentityAccountMixin):
    """身份管理器：档案、子用户、任务、贡献、联系人、排行榜。"""

    def __init__(self, db_path: str = ""):
        if not db_path:
            db_dir = os.path.join(get_data_dir(), "Identity")
            os.makedirs(db_dir, exist_ok=True)
            db_path = os.path.join(db_dir, "identity.db")
        self.db_path = db_path
        # 用可重入锁：get_stats() 等持锁方法会调用同样加锁的 get_main_info()，
        # 普通 Lock 会在同一线程上永久自锁，并把整个身份系统锁死。
        self._lock = threading.RLock()
        self._init_db()

    def add_sub_user(self, name: str, role: str = "sub") -> Dict:
        """添加子用户"""
        sid = "SUB-" + uuid.uuid4().hex[:8].upper()
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO sub_users (id, name, role, created_at, last_active) VALUES (?, ?, ?, ?, ?)",
                (sid, name, role, now, now)
            )
        return {"success": True, "id": sid, "name": name, "role": role}

    def list_sub_users(self) -> List[Dict]:
        """列出子用户"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM sub_users ORDER BY created_at").fetchall()
            return [dict(row) for row in rows]

    def delete_sub_user(self, sid: str) -> bool:
        """删除子用户"""
        with self._lock, self._get_conn() as conn:
            cursor = conn.execute("DELETE FROM sub_users WHERE id=?", (sid,))
            return cursor.rowcount > 0

    def publish_task(self, title: str, description: str,
                     reward: int = 10, category: str = "general") -> Dict:
        """发布任务（需支付能力价值）"""
        main_info = self.get_main_info()
        if not main_info:
            return {"success": False, "error": "请先注册主账户"}
        if main_info["ability_value"] < reward:
            return {"success": False, "error": f"能力价值不足，需要{reward}，当前{main_info['ability_value']}"}
        task_id = "TASK-" + uuid.uuid4().hex[:8].upper()
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                INSERT INTO tasks (id, title, description, category, reward, status, created_at)
                VALUES (?, ?, ?, ?, ?, 'open', ?)
            """, (task_id, title, description, category, reward, now))
            conn.execute("UPDATE main_account SET ability_value=ability_value-?, tasks_published=tasks_published+1 WHERE id=1",
                        (reward,))
        return {"success": True, "task_id": task_id, "reward": reward}

    def list_tasks(self, status: str = "open") -> List[Dict]:
        """列出任务"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status=? ORDER BY created_at DESC", (status,)
            ).fetchall()
            return [dict(row) for row in rows]

    def accept_task(self, task_id: str) -> Dict:
        """接受任务"""
        now = time.time()
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id=? AND status='open'", (task_id,)).fetchone()
            if not row:
                return {"success": False, "error": "任务不存在或已被接受"}
            verification_code = secrets.token_hex(4).upper()
            conn.execute("""
                UPDATE tasks SET status='in_progress', assignee_id='main', assigned_at=?, verification_code=? WHERE id=?
            """, (now, verification_code, task_id))
            return {"success": True, "task_id": task_id, "verification_code": verification_code}

    def complete_task(self, task_id: str, verification_code: str) -> Dict:
        """完成任务（验证码验证）"""
        now = time.time()
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM tasks WHERE id=? AND status='in_progress'", (task_id,)).fetchone()
            if not row:
                return {"success": False, "error": "任务不存在或未被接受"}
            if row["verification_code"] != verification_code:
                return {"success": False, "error": "验证码错误"}
            reward = row["reward"]
            conn.execute("""
                UPDATE tasks SET status='completed', completed_at=? WHERE id=?
            """, (now, task_id))
            # 主账户获得贡献分和能力价值
            conn.execute("""
                UPDATE main_account SET contribution_score=contribution_score+?,
                    ability_value=ability_value+?, tasks_completed=tasks_completed+1 WHERE id=1
            """, (reward, reward))
            # 记录贡献
            contrib_id = "C-" + uuid.uuid4().hex[:8].upper()
            conn.execute("""
                INSERT INTO contributions (id, identity_id, contribution_type, task_title,
                    task_description, description, category, score, points, completed_at, metadata)
                VALUES (?, 'main', 'task', ?, ?, ?, ?, ?, ?, ?, '{}')
            """, (contrib_id, row["title"], row["description"],
                  f"完成任务: {row['title']}", row["category"], reward, reward, now))
            return {"success": True, "task_id": task_id, "reward": reward, "contribution_score": reward}

    def add_contribution(self, identity_id: str, contribution_type: str,
                         description: str = "", points: int = 0,
                         **kwargs) -> Optional[Contribution]:
        """添加贡献（自动加经验、更新连续天数、检查徽章）"""
        contrib = Contribution(identity_id, contribution_type, description, points)
        now = time.time()
        try:
            with self._lock, self._get_conn() as conn:
                conn.execute("""
                    INSERT INTO contributions (id, identity_id, contribution_type, description,
                        points, completed_at, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (contrib.contribution_id, identity_id, contribution_type,
                      description, points, now, json.dumps(kwargs)))
                # 更新主账户的贡献分和经验
                conn.execute("""
                    UPDATE main_account SET contribution_score=contribution_score+? WHERE id=1
                """, (points,))
                # 更新连续天数
                self._update_streak(conn)
                # 检查贡献徽章
                self._check_contribution_badges(conn)
            return contrib
        except Exception:
            return None

    def _update_streak(self, conn):
        """更新连续天数"""
        row = conn.execute("SELECT last_active, streak FROM main_account WHERE id=1").fetchone()
        if not row:
            return
        now = time.time()
        last_active = row["last_active"] or 0
        if last_active:
            last_date = datetime.fromtimestamp(last_active).date()
            today = datetime.fromtimestamp(now).date()
            if (today - last_date).days == 1:
                conn.execute("UPDATE main_account SET streak=streak+1, last_active=? WHERE id=1", (now,))
            elif (today - last_date).days > 1:
                conn.execute("UPDATE main_account SET streak=1, last_active=? WHERE id=1", (now,))
        else:
            conn.execute("UPDATE main_account SET streak=1, last_active=? WHERE id=1", (now,))

    def _check_contribution_badges(self, conn):
        """检查贡献徽章"""
        row = conn.execute("SELECT contribution_score, badges FROM main_account WHERE id=1").fetchone()
        if not row:
            return
        badges = json.loads(row["badges"])
        score = row["contribution_score"]
        contribution_badges = {
            10: "初出茅庐", 50: "小有成就", 100: "贡献者",
            500: "核心贡献者", 1000: "传奇贡献者"
        }
        for threshold, badge in contribution_badges.items():
            if score >= threshold and badge not in badges:
                badges.append(badge)
        conn.execute("UPDATE main_account SET badges=? WHERE id=1", (json.dumps(badges),))

    def get_contributions(self, identity_id: str = "",
                          limit: int = 50) -> List[Dict]:
        """获取贡献记录"""
        with self._lock, self._get_conn() as conn:
            if identity_id:
                rows = conn.execute(
                    "SELECT * FROM contributions WHERE identity_id=? ORDER BY completed_at DESC LIMIT ?",
                    (identity_id, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM contributions ORDER BY completed_at DESC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(row) for row in rows]

    def add_contact(self, name: str, identity_id: str = "",
                    public_key: str = "", note: str = "") -> Dict:
        """添加联系人"""
        cid = "CONT-" + uuid.uuid4().hex[:8].upper()
        now = time.time()
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                INSERT INTO contacts (id, name, identity_id, public_key, note, added_at, trusted)
                VALUES (?, ?, ?, ?, ?, ?, 0)
            """, (cid, name, identity_id, public_key, note, now))
        return {"success": True, "id": cid, "name": name}

    def list_contacts(self) -> List[Dict]:
        """列出联系人"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM contacts ORDER BY added_at").fetchall()
            return [dict(row) for row in rows]

    def delete_contact(self, cid: str) -> bool:
        """删除联系人"""
        with self._lock, self._get_conn() as conn:
            cursor = conn.execute("DELETE FROM contacts WHERE id=?", (cid,))
            return cursor.rowcount > 0

    def trust_contact(self, cid: str, trusted: bool = True) -> bool:
        """信任/取消信任联系人"""
        with self._lock, self._get_conn() as conn:
            cursor = conn.execute("UPDATE contacts SET trusted=? WHERE id=?",
                                 (1 if trusted else 0, cid))
            return cursor.rowcount > 0

    def create_identity(self, username: str, display_name: str = "",
                        **kwargs) -> Optional[IdentityProfile]:
        """创建身份档案"""
        profile = IdentityProfile(username=username, display_name=display_name, **kwargs)
        try:
            with self._lock, self._get_conn() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO identity_profiles (identity_id, username, display_name,
                        level, exp, contribution_score, badges, skills, streak,
                        created_at, last_active, settings)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (profile.identity_id, profile.username, profile.display_name,
                      profile.level, profile.exp, profile.contribution_score,
                      json.dumps(profile.badges), json.dumps(profile.skills),
                      profile.streak, profile.created_at, profile.last_active,
                      json.dumps(profile.settings)))
            return profile
        except Exception:
            return None

    def get_identity(self, identity_id: str) -> Optional[IdentityProfile]:
        """获取身份档案"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM identity_profiles WHERE identity_id=?", (identity_id,)).fetchone()
            if not row:
                return None
            return IdentityProfile(
                username=row["username"], display_name=row["display_name"],
                identity_id=row["identity_id"], level=row["level"], exp=row["exp"],
                contribution_score=row["contribution_score"],
                badges=json.loads(row["badges"]), skills=json.loads(row["skills"]),
                streak=row["streak"], last_active=row["last_active"],
                created_at=row["created_at"], settings=json.loads(row["settings"])
            )

    def get_by_username(self, username: str) -> Optional[IdentityProfile]:
        """按用户名获取身份档案"""
        with self._lock, self._get_conn() as conn:
            row = conn.execute("SELECT * FROM identity_profiles WHERE username=?", (username,)).fetchone()
            if not row:
                return None
            return IdentityProfile(
                username=row["username"], display_name=row["display_name"],
                identity_id=row["identity_id"], level=row["level"], exp=row["exp"],
                contribution_score=row["contribution_score"],
                badges=json.loads(row["badges"]), skills=json.loads(row["skills"]),
                streak=row["streak"], last_active=row["last_active"],
                created_at=row["created_at"], settings=json.loads(row["settings"])
            )

    def update_identity(self, identity_id: str, **kwargs) -> bool:
        """更新身份档案"""
        allowed_fields = {"display_name", "level", "exp", "contribution_score",
                          "badges", "skills", "streak", "settings"}
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields}
        if not updates:
            return False
        set_clause = ", ".join(f"{k}=?" for k in updates.keys())
        values = list(updates.values())
        if "badges" in updates:
            idx = list(updates.keys()).index("badges")
            values[idx] = json.dumps(updates["badges"])
        if "skills" in updates:
            idx = list(updates.keys()).index("skills")
            values[idx] = json.dumps(updates["skills"])
        if "settings" in updates:
            idx = list(updates.keys()).index("settings")
            values[idx] = json.dumps(updates["settings"])
        values.append(identity_id)
        try:
            with self._lock, self._get_conn() as conn:
                conn.execute(f"UPDATE identity_profiles SET {set_clause} WHERE identity_id=?", values)
            return True
        except Exception:
            return False

    def get_leaderboard(self, metric: str = "contribution_score",
                        limit: int = 10) -> List[Dict]:
        """排行榜"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                f"SELECT identity_id, username, display_name, {metric}, level, badges "
                f"FROM identity_profiles ORDER BY {metric} DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def get_skill_breakdown(self, identity_id: str) -> Dict[str, Any]:
        """技能分解"""
        profile = self.get_identity(identity_id)
        if not profile:
            return {}
        total = sum(profile.skills.values())
        return {
            "skills": profile.skills,
            "total_points": total,
            "top_skill": max(profile.skills, key=profile.skills.get) if profile.skills else None,
            "skill_count": len(profile.skills),
        }

    def list_identities(self, limit: int = 50) -> List[IdentityProfile]:
        """列出身份档案"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute(
                "SELECT * FROM identity_profiles ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [IdentityProfile(
                username=row["username"], display_name=row["display_name"],
                identity_id=row["identity_id"], level=row["level"], exp=row["exp"],
                contribution_score=row["contribution_score"],
                badges=json.loads(row["badges"]), skills=json.loads(row["skills"]),
                streak=row["streak"], last_active=row["last_active"],
                created_at=row["created_at"], settings=json.loads(row["settings"])
            ) for row in rows]

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        with self._lock, self._get_conn() as conn:
            main_count = conn.execute("SELECT COUNT(*) as c FROM main_account").fetchone()["c"]
            sub_count = conn.execute("SELECT COUNT(*) as c FROM sub_users").fetchone()["c"]
            task_count = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()["c"]
            contrib_count = conn.execute("SELECT COUNT(*) as c FROM contributions").fetchone()["c"]
            contact_count = conn.execute("SELECT COUNT(*) as c FROM contacts").fetchone()["c"]
            profile_count = conn.execute("SELECT COUNT(*) as c FROM identity_profiles").fetchone()["c"]
            main_info = self.get_main_info()
            return {
                "main_account_exists": main_count > 0,
                "sub_users": sub_count,
                "total_tasks": task_count,
                "total_contributions": contrib_count,
                "total_contacts": contact_count,
                "total_profiles": profile_count,
                "main_info": main_info,
            }

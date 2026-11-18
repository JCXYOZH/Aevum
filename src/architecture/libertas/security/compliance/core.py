"""
合规与服从控制系统（优化版）

融合两个版本的功能：
1. 规则守护系统（内容安全检查 + 违规记录）
2. 服从控制引擎（AI拒绝检测 + 强制服从）

职责：
- 规则管理（添加/删除/启用/禁用规则）
- 文本检查（模式匹配/阈值/速率）
- 违规记录和处理
- AI拒绝检测（中英文拒绝模式 + 推脱回避模式）
- 强制执行指令生成（3级递增）
- 系统提示词增强（前缀/后缀/强制模式）
- 输出后处理（清理拒绝前缀）
- 合规报告生成
- SQLite 持久化（compliance.db，rules + violations 两张表）
"""
import os
import re
import time
import json
import secrets
import sqlite3
import threading
from typing import Dict, List, Any, Optional, Tuple, Callable
from enum import Enum
from collections import defaultdict

from .constants import REFUSAL_PATTERNS_ZH, REFUSAL_PATTERNS_EN, EVASION_PATTERNS
from .models import GuardianRule, Violation
from .policy import CompliancePolicyMixin
from libertas.foundation.config import get_data_dir


class ComplianceSystem(CompliancePolicyMixin):
    """合规与服从控制系统：规则、违规记录、报告与持久化。"""

    MAX_RETRY_ROUNDS = 3

    def __init__(self, db_path: str = ""):
        if not db_path:
            db_path = self._default_db_path()
        self.db_path = db_path
        self._lock = threading.Lock()
        self._rules_cache: Dict[str, GuardianRule] = {}
        self._violation_callbacks: List[Callable[[Violation], None]] = []
        self._rate_counters: Dict[str, List[float]] = {}
        self.stats = defaultdict(int)
    
        # 编译拒绝模式
        self._refusal_re_zh = [re.compile(p, re.IGNORECASE) for p in REFUSAL_PATTERNS_ZH]
        self._refusal_re_en = [re.compile(p, re.IGNORECASE) for p in REFUSAL_PATTERNS_EN]
        self._evasion_re = [re.compile(p, re.IGNORECASE) for p in EVASION_PATTERNS]
        self._round_templates = self._build_enforcement_templates()
    
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()
        self._load_rules_from_db()
        self._init_default_rules()

    @staticmethod
    def _default_db_path() -> str:
        """默认数据库路径跟随 LIBERTAS_DATA_DIR，避免数据根搬家后分裂。"""
        return os.path.join(get_data_dir(), "compliance.db")

    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接"""
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self):
        """初始化数据库表结构"""
        with self._lock, self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS rules (
                    rule_id TEXT PRIMARY KEY,
                    name TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    category TEXT DEFAULT 'general',
                    pattern TEXT DEFAULT '',
                    level TEXT DEFAULT 'warning',
                    threshold REAL DEFAULT 0,
                    cooldown_seconds INTEGER DEFAULT 60,
                    enabled INTEGER DEFAULT 1,
                    created_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS violations (
                    violation_id TEXT PRIMARY KEY,
                    rule_name TEXT DEFAULT '',
                    level TEXT DEFAULT 'warning',
                    content TEXT DEFAULT '',
                    context TEXT DEFAULT '',
                    resolved INTEGER DEFAULT 0,
                    resolution TEXT DEFAULT '',
                    created_at REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_violations_level ON violations(level)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_violations_resolved ON violations(resolved)")

    def _load_rules_from_db(self):
        """从数据库加载规则到缓存"""
        with self._lock, self._get_conn() as conn:
            rows = conn.execute("SELECT * FROM rules").fetchall()
            for row in rows:
                rule = GuardianRule(
                    rule_id=row["rule_id"],
                    name=row["name"],
                    description=row["description"],
                    category=row["category"],
                    pattern=row["pattern"],
                    level=row["level"],
                    threshold=row["threshold"],
                    cooldown_seconds=row["cooldown_seconds"],
                    enabled=bool(row["enabled"]),
                )
                self._rules_cache[rule.rule_id] = rule

    def _init_default_rules(self):
        """初始化默认规则（如果数据库为空）"""
        if self._rules_cache:
            return
        default_rules = [
            GuardianRule(
                name="敏感词检测",
                description="检测文本中的敏感词汇",
                category="content",
                pattern=r"(敏感词1|敏感词2)",
                level="warning",
            ),
            GuardianRule(
                name="过度请求检测",
                description="检测请求频率过高",
                category="rate",
                level="high",
                threshold=100,
                cooldown_seconds=60,
            ),
        ]
        for rule in default_rules:
            self.add_rule(rule)

    def add_rule(self, rule: GuardianRule) -> str:
        """添加规则"""
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO rules (rule_id, name, description, category, pattern, level, threshold, cooldown_seconds, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (rule.rule_id, rule.name, rule.description, rule.category,
                 rule.pattern, rule.level, rule.threshold,
                 rule.cooldown_seconds, 1 if rule.enabled else 0, time.time())
            )
        self._rules_cache[rule.rule_id] = rule
        return rule.rule_id

    def remove_rule(self, rule_id: str) -> bool:
        """删除规则"""
        with self._lock, self._get_conn() as conn:
            conn.execute("DELETE FROM rules WHERE rule_id=?", (rule_id,))
        return self._rules_cache.pop(rule_id, None) is not None

    def enable_rule(self, rule_id: str) -> bool:
        """启用规则"""
        rule = self._rules_cache.get(rule_id)
        if not rule:
            return False
        rule.enabled = True
        with self._lock, self._get_conn() as conn:
            conn.execute("UPDATE rules SET enabled=1 WHERE rule_id=?", (rule_id,))
        return True

    def disable_rule(self, rule_id: str) -> bool:
        """禁用规则"""
        rule = self._rules_cache.get(rule_id)
        if not rule:
            return False
        rule.enabled = False
        with self._lock, self._get_conn() as conn:
            conn.execute("UPDATE rules SET enabled=0 WHERE rule_id=?", (rule_id,))
        return True

    def get_rule(self, rule_id: str) -> Optional[GuardianRule]:
        """获取规则"""
        return self._rules_cache.get(rule_id)

    def list_rules(self, category: str = "", enabled_only: bool = False) -> List[GuardianRule]:
        """列出规则"""
        rules = list(self._rules_cache.values())
        if category:
            rules = [r for r in rules if r.category == category]
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        return sorted(rules, key=lambda r: r.name)

    def check_threshold(self, metric: str, value: float,
                        context: str = "") -> Tuple[bool, List[Violation]]:
        """检查阈值"""
        violations = []
        for rule in self._rules_cache.values():
            if not rule.enabled or rule.threshold <= 0:
                continue
            if rule.name.lower() in metric.lower() or metric.lower() in rule.name.lower():
                if rule.check_threshold(value) and rule.can_trigger():
                    rule.trigger()
                    violation = Violation(
                        rule_name=rule.name,
                        level=rule.level,
                        content=f"{metric}: {value} >= {rule.threshold}",
                        context=context,
                    )
                    violations.append(violation)
                    self._record_violation(violation)
                    self.stats['threshold_violations'] += 1
        return len(violations) == 0, violations

    def check_rate(self, key: str, value: float = 1.0,
                   window_seconds: int = 60, max_rate: float = 100.0,
                   context: str = "") -> Tuple[bool, float]:
        """检查速率限制，返回(是否允许, 当前速率)"""
        now = time.time()
        if key not in self._rate_counters:
            self._rate_counters[key] = []
        # 清理过期记录
        self._rate_counters[key] = [t for t in self._rate_counters[key] if now - t < window_seconds]
        # 添加当前记录
        for _ in range(int(value)):
            self._rate_counters[key].append(now)
        current_rate = len(self._rate_counters[key])
        allowed = current_rate <= max_rate
        if not allowed:
            self.stats['rate_limited'] += 1
        return allowed, current_rate

    def _record_violation(self, violation: Violation):
        """记录违规到数据库"""
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "INSERT INTO violations (violation_id, rule_name, level, content, context, resolved, resolution, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (violation.violation_id, violation.rule_name, violation.level,
                 violation.content, violation.context, 1 if violation.resolved else 0,
                 violation.resolution, violation.created_at)
            )
        # 触发回调
        for callback in self._violation_callbacks:
            try:
                callback(violation)
            except Exception:
                pass

    def on_violation(self, callback: Callable[[Violation], None]):
        """注册违规回调"""
        self._violation_callbacks.append(callback)

    def get_violations(self, level: str = "", resolved: Optional[bool] = None,
                       limit: int = 50) -> List[Violation]:
        """获取违规记录"""
        with self._lock, self._get_conn() as conn:
            query = "SELECT * FROM violations WHERE 1=1"
            params = []
            if level:
                query += " AND level=?"
                params.append(level)
            if resolved is not None:
                query += " AND resolved=?"
                params.append(1 if resolved else 0)
            query += " ORDER BY created_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(query, params).fetchall()
            return [
                Violation(
                    violation_id=row["violation_id"],
                    rule_name=row["rule_name"],
                    level=row["level"],
                    content=row["content"],
                    context=row["context"],
                    resolved=bool(row["resolved"]),
                    resolution=row["resolution"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]

    def resolve_violation(self, violation_id: str, resolution: str = "") -> bool:
        """解决违规"""
        with self._lock, self._get_conn() as conn:
            conn.execute(
                "UPDATE violations SET resolved=1, resolution=? WHERE violation_id=?",
                (resolution, violation_id)
            )
        return True

    def generate_compliance_report(self, days: int = 7) -> Dict[str, Any]:
        """生成合规报告"""
        since = time.time() - days * 86400
        with self._lock, self._get_conn() as conn:
            total_violations = conn.execute(
                "SELECT COUNT(*) as c FROM violations WHERE created_at >= ?", (since,)
            ).fetchone()["c"]
            resolved_violations = conn.execute(
                "SELECT COUNT(*) as c FROM violations WHERE created_at >= ? AND resolved=1", (since,)
            ).fetchone()["c"]
            level_counts = {}
            for row in conn.execute(
                "SELECT level, COUNT(*) as c FROM violations WHERE created_at >= ? GROUP BY level", (since,)
            ).fetchall():
                level_counts[row["level"]] = row["c"]
            rule_counts = {}
            for row in conn.execute(
                "SELECT rule_name, COUNT(*) as c FROM violations WHERE created_at >= ? GROUP BY rule_name ORDER BY c DESC LIMIT 10", (since,)
            ).fetchall():
                rule_counts[row["rule_name"]] = row["c"]
    
        return {
            "period_days": days,
            "total_violations": total_violations,
            "resolved_violations": resolved_violations,
            "unresolved_violations": total_violations - resolved_violations,
            "resolution_rate": round(resolved_violations / total_violations * 100, 1) if total_violations > 0 else 0,
            "level_counts": level_counts,
            "top_rules": rule_counts,
            "total_rules": len(self._rules_cache),
            "enabled_rules": len([r for r in self._rules_cache.values() if r.enabled]),
            "refusal_detected": self.stats.get('refusal_detected', 0),
            "evasion_detected": self.stats.get('evasion_detected', 0),
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            "total_rules": len(self._rules_cache),
            "enabled_rules": len([r for r in self._rules_cache.values() if r.enabled]),
            "refusal_detected": self.stats.get('refusal_detected', 0),
            "evasion_detected": self.stats.get('evasion_detected', 0),
            "text_violations": self.stats.get('text_violations', 0),
            "threshold_violations": self.stats.get('threshold_violations', 0),
            "rate_limited": self.stats.get('rate_limited', 0),
            "refusal_prefix_cleaned": self.stats.get('refusal_prefix_cleaned', 0),
            "db_path": self.db_path,
        }

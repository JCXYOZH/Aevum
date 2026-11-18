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


class AuditQueryMixin:
    """审计查询、统计、导出与异常报告。"""

    def query(self, category: str = "", severity: str = "", user: str = "",
              search: str = "", limit: int = 200, offset: int = 0,
              start_time: float = 0.0, end_time: float = 0.0,
              action: str = "", order: str = "desc") -> List[Dict[str, Any]]:
        """查询审计日志"""
        conn = sqlite3.connect(self.db_path)
        try:
            conditions = []
            params: List[Any] = []
    
            if category:
                conditions.append("category = ?")
                params.append(category)
            if severity:
                conditions.append("severity = ?")
                params.append(severity)
            if user:
                conditions.append("user LIKE ?")
                params.append(f"%{user}%")
            if action:
                conditions.append("action LIKE ?")
                params.append(f"%{action}%")
            if start_time > 0:
                conditions.append("timestamp >= ?")
                params.append(start_time)
            if end_time > 0:
                conditions.append("timestamp <= ?")
                params.append(end_time)
            if search:
                conditions.append("(action LIKE ? OR details LIKE ? OR user LIKE ? OR resource LIKE ?)")
                params.extend([f"%{search}%"] * 4)
    
            where = " AND ".join(conditions) if conditions else "1=1"
            order_dir = "DESC" if order.lower() == "desc" else "ASC"
            query = f"""
                SELECT id, timestamp, time, action, category, user, details,
                       severity, ip, resource, result, duration_ms
                FROM audit_logs
                WHERE {where}
                ORDER BY timestamp {order_dir}
                LIMIT ? OFFSET ?
            """
            params.extend([limit, offset])
            cursor = conn.execute(query, params)
            columns = [d[0] for d in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return results
        finally:
            conn.close()

    def get_stats(self, refresh: bool = False) -> Dict[str, Any]:
        """获取统计信息"""
        now = time.time()
        if not refresh and (now - self._stats_last_update) < 5.0 and self._stats_cache:
            return self._stats_cache
    
        conn = sqlite3.connect(self.db_path)
        try:
            total = conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0]
            today_start = datetime.now().replace(hour=0, minute=0, second=0).timestamp()
            today = conn.execute(
                "SELECT COUNT(*) FROM audit_logs WHERE timestamp >= ?", (today_start,)
            ).fetchone()[0]
    
            by_category = {}
            for row in conn.execute("SELECT category, COUNT(*) FROM audit_logs GROUP BY category"):
                by_category[row[0]] = row[1]
    
            by_severity = {}
            for row in conn.execute("SELECT severity, COUNT(*) FROM audit_logs GROUP BY severity"):
                by_severity[row[0]] = row[1]
    
            by_user = {}
            for row in conn.execute(
                "SELECT user, COUNT(*) as cnt FROM audit_logs "
                "WHERE user != '' GROUP BY user ORDER BY cnt DESC LIMIT 20"
            ):
                by_user[row[0]] = row[1]
    
            recent_errors = conn.execute(
                "SELECT COUNT(*) FROM audit_logs WHERE severity IN ('error','critical') "
                "AND timestamp >= ?", (now - 86400,)
            ).fetchone()[0]
    
            stats = {
                "total": total,
                "today": today,
                "by_category": by_category,
                "by_severity": by_severity,
                "top_users": by_user,
                "recent_errors_24h": recent_errors,
                "db_path": self.db_path,
                "retention_days": self.retention_days,
            }
            self._stats_cache = stats
            self._stats_last_update = now
            return stats
        finally:
            conn.close()

    def export_logs(self, fmt: str = "json", category: str = "",
                    severity: str = "", limit: int = 5000) -> str:
        """导出日志"""
        logs = self.query(category=category, severity=severity, limit=limit)
    
        if fmt == "csv":
            lines = ["time,category,severity,user,action,details,ip,result"]
            for r in logs:
                lines.append(
                    f'"{r["time"]}","{r["category"]}","{r["severity"]}",'
                    f'"{r["user"]}","{r["action"].replace(chr(34), chr(34)*2)}",'
                    f'"{r["details"].replace(chr(34), chr(34)*2)}",'
                    f'"{r["ip"]}","{r["result"]}"'
                )
            return "\n".join(lines)
    
        if fmt == "html":
            return self._export_html(logs)
    
        return json.dumps(logs, ensure_ascii=False, indent=2, default=str)

        def _export_html(self, logs: List[Dict[str, Any]]) -> str:
            """导出为 HTML 报告"""
            severity_colors = {
                "info": "#2196F3", "warning": "#FF9800",
                "error": "#F44336", "critical": "#9C27B0", "debug": "#9E9E9E",
            }
            rows_html = ""
            for r in logs:
                color = severity_colors.get(r["severity"], "#607D8B")
                rows_html += f"""
                <tr>
                    <td>{r['time']}</td>
                    <td><span style="background:{color};color:white;padding:2px 8px;border-radius:3px;">{r['severity']}</span></td>
                    <td>{r['category']}</td>
                    <td>{r['user']}</td>
                    <td>{r['action']}</td>
                    <td>{r['details'][:200]}</td>
                </tr>"""
    
            return f"""<!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>审计日志报告</title>
    <style>
    body{{font-family:Arial,sans-serif;margin:20px;}}
    table{{border-collapse:collapse;width:100%;}}
    th,td{{border:1px solid #ddd;padding:8px;text-align:left;}}
    th{{background:#f5f5f5;}}
    tr:nth-child(even){{background:#fafafa;}}
    </style></head>
    <body><h2>审计日志报告 ({len(logs)} 条)</h2>
    <table><thead><tr>
    <th>时间</th><th>级别</th><th>分类</th><th>用户</th><th>操作</th><th>详情</th>
    </tr></thead><tbody>{rows_html}</tbody></table>
    </body></html>"""

    def get_user_activity(self, user: str, days: int = 30) -> Dict[str, Any]:
        """获取用户活动统计"""
        start = (datetime.now() - timedelta(days=days)).timestamp()
        conn = sqlite3.connect(self.db_path)
        try:
            total = conn.execute(
                "SELECT COUNT(*) FROM audit_logs WHERE user = ? AND timestamp >= ?",
                (user, start),
            ).fetchone()[0]
            by_category = {}
            for row in conn.execute(
                "SELECT category, COUNT(*) FROM audit_logs WHERE user = ? AND timestamp >= ? GROUP BY category",
                (user, start),
            ):
                by_category[row[0]] = row[1]
            by_action = {}
            for row in conn.execute(
                "SELECT action, COUNT(*) as cnt FROM audit_logs WHERE user = ? AND timestamp >= ? "
                "GROUP BY action ORDER BY cnt DESC LIMIT 10",
                (user, start),
            ):
                by_action[row[0]] = row[1]
            first_activity = conn.execute(
                "SELECT MIN(timestamp) FROM audit_logs WHERE user = ?", (user,)
            ).fetchone()[0]
            last_activity = conn.execute(
                "SELECT MAX(timestamp) FROM audit_logs WHERE user = ?", (user,)
            ).fetchone()[0]
    
            return {
                "user": user,
                "days": days,
                "total_actions": total,
                "by_category": by_category,
                "top_actions": by_action,
                "first_activity": datetime.fromtimestamp(first_activity).strftime("%Y-%m-%d %H:%M:%S") if first_activity else "",
                "last_activity": datetime.fromtimestamp(last_activity).strftime("%Y-%m-%d %H:%M:%S") if last_activity else "",
            }
        finally:
            conn.close()

    def get_anomaly_report(self) -> Dict[str, Any]:
        """异常活动报告"""
        now = time.time()
        conn = sqlite3.connect(self.db_path)
        try:
            # 24小时内的错误/严重日志
            critical = conn.execute(
                "SELECT * FROM audit_logs WHERE severity IN ('error','critical') "
                "AND timestamp >= ? ORDER BY timestamp DESC LIMIT 50",
                (now - 86400,),
            ).fetchall()
            columns = [d[0] for d in conn.execute("SELECT * FROM audit_logs LIMIT 1").description]
            critical_list = [dict(zip(columns, row)) for row in critical]
    
            # 高频用户（可能的暴力破解）
            high_freq = conn.execute(
                "SELECT user, COUNT(*) as cnt, COUNT(DISTINCT ip) as ips "
                "FROM audit_logs WHERE timestamp >= ? AND user != '' "
                "GROUP BY user HAVING cnt > 50 ORDER BY cnt DESC LIMIT 10",
                (now - 3600,),
            ).fetchall()
    
            # 异常 IP（多个用户登录）
            suspicious_ips = conn.execute(
                "SELECT ip, COUNT(DISTINCT user) as users, COUNT(*) as cnt "
                "FROM audit_logs WHERE timestamp >= ? AND ip != '' "
                "GROUP BY ip HAVING users > 3 ORDER BY users DESC LIMIT 10",
                (now - 86400,),
            ).fetchall()
    
            return {
                "critical_events_24h": len(critical_list),
                "critical_events": critical_list,
                "high_frequency_users": [
                    {"user": r[0], "count": r[1], "distinct_ips": r[2]} for r in high_freq
                ],
                "suspicious_ips": [
                    {"ip": r[0], "distinct_users": r[1], "count": r[2]} for r in suspicious_ips
                ],
            }
        finally:
            conn.close()

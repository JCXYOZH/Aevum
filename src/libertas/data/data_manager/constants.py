"""
统一数据目录管理器

融合两个版本的优点：
- 保留当前版本的丰富功能（配额、临时文件、缓存清理、健康检查）
- 吸收0.1.5版本的简洁接口（dir/db/file/workspace）和业务命名
- 修复 DirectoryQuota 重复定义问题
- 标准目录结构、路径解析、磁盘空间、文件生命周期、数据迁移
"""
import os
import sys
import time
import shutil
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from libertas.foundation.config import get_data_dir, config


STANDARD_DIRS = {
    # 核心数据
    "root": "",
    "auth": "Auth",
    "chat": "ChatHistory",
    "memory": "MemorySystem",
    "memory_global": "MemorySystem_Global",
    "users": "Users",
    "settings": "Settings",
    # 功能模块
    "cloud": "CloudSync",
    "governance": "Governance",
    "httppro": "HttpPro",
    "queue": "Queue",
    "versions": "Versions",
    "notifications": "Notifications",
    "notes": "QuickNotes",
    "feedback": "Feedback",
    "community": "Community",
    "audit": "Audit",
    "snapshots": "Snapshots",
    "migrations": "Migrations",
    "reports": "Reports",
    "sessions": "Sessions",
    "certs": "Certs",
    # 系统目录
    "logs": "Logs",
    "cache": "Cache",
    "config": "Config",
    "data": "Data",
    "backups": "Backups",
    "exports": "Exports",
    "tmp": "Tmp",
    "uploads": "Uploads",
    "models": "Models",
    "plugins": "Plugins",
    "media": "Media",
}

STANDARD_DBS = {
    "auth": "auth.db",
    "chat": "chat_history.db",
    "cloud": "sync.db",
    "governance": "governance.db",
    "violations": "violations.db",
    "httppro": "httppro.db",
    "queue": "tasks.db",
    "versions": "versions.db",
    "feedback": "feedback.db",
    "community": "community.db",
    "audit": "audit.db",
    "snapshots": "snapshots.db",
    "notifications": "notifications.db",
    "notes": "notes.db",
    "sessions": "sessions.db",
}

WORKSPACE_DIRS = {
    "shared": "SharedFiles",
    "wan": "WANFiles",
    "wordlists": "Wordlists",
    "generated": "Generated",
}

LAZY_DIRS = {"users", "memory", "memory_global"}

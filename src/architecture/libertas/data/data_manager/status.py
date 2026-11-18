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

from .formatting import _format_size


class DataDirectoryStatusMixin:
    """目录健康、统计与周期清理。"""

    def health_check(self) -> Dict[str, Any]:
        """健康检查"""
        issues = []
        # 检查数据目录是否可写
        try:
            test_file = os.path.join(self.base_dir, ".health_check")
            with open(test_file, 'w', encoding='utf-8') as f:
                f.write("ok")
            os.remove(test_file)
        except Exception as e:
            issues.append(f"数据目录不可写: {e}")
        # 检查磁盘空间
        disk = self.get_disk_usage()
        if "percent" in disk and disk["percent"] > 90:
            issues.append(f"磁盘空间不足: {disk['percent']:.1f}%")
        # 检查配额
        for name, quota in self._quotas.items():
            if name not in self._dirs:
                continue
            path = self._dirs[name]
            if not os.path.exists(path):
                continue
            size, count = self.get_dir_size(path)
            if quota.max_size_mb > 0 and size > quota.max_size_mb * 1024 * 1024 * 0.9:
                issues.append(f"目录 {name} 配额使用超过90%")
        return {
            "healthy": len(issues) == 0,
            "issues": issues,
            "disk_usage": disk,
            "checked_at": datetime.now().isoformat(),
        }

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        total_size = 0
        total_files = 0
        dir_stats = []
        for name, path in self._dirs.items():
            if os.path.exists(path):
                size, count = self.get_dir_size(path)
                total_size += size
                total_files += count
                dir_stats.append({
                    "name": name,
                    "size": size,
                    "size_human": _format_size(size),
                    "file_count": count,
                })
        return {
            "base_dir": self.base_dir,
            "workspace_dir": self.workspace_dir,
            "total_dirs": len(self._dirs),
            "total_dbs": len(self._db_paths),
            "total_size": total_size,
            "total_size_human": _format_size(total_size),
            "total_files": total_files,
            "quotas": len(self._quotas),
            "tmp_files": len(self._tmp_files),
            "dir_stats": sorted(dir_stats, key=lambda x: x["size"], reverse=True),
            "disk_usage": self.get_disk_usage(),
        }

    def periodic_cleanup(self):
        """定期清理（临时文件、缓存、配额）"""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        self._last_cleanup = now
        try:
            self.cleanup_expired_tmp()
            self.cleanup_cache()
            self.enforce_quotas()
        except Exception:
            pass

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

from .constants import STANDARD_DIRS, STANDARD_DBS, WORKSPACE_DIRS, LAZY_DIRS
from .formatting import _format_size
from .models import DirectoryQuota
from .status import DataDirectoryStatusMixin


class DataDirectoryManager(DataDirectoryStatusMixin):
    """统一数据目录管理器：标准目录、路径解析、配额、临时文件、迁移。"""

    def __init__(self, base_dir: str = ""):
        self.base_dir = base_dir or get_data_dir()
        self.workspace_dir = os.path.join(os.path.expanduser("~"), "LibertasWorkspace")
        self._dirs: Dict[str, str] = {}
        self._db_paths: Dict[str, str] = {}
        self._quotas: Dict[str, DirectoryQuota] = {}
        self._lock = threading.RLock()
        self._tmp_files: Dict[str, float] = {}  # path -> expiry
        self._cleanup_interval = 300.0
        self._last_cleanup = 0.0
        self._init_standard_dirs()
        self._init_standard_dbs()
        self._init_default_quotas()

    def _init_standard_dirs(self):
        """初始化标准目录结构"""
        for name, rel_path in STANDARD_DIRS.items():
            if rel_path:
                self._dirs[name] = os.path.join(self.base_dir, rel_path)
            else:
                self._dirs[name] = self.base_dir
        # 工作区目录
        for name, rel_path in WORKSPACE_DIRS.items():
            self._dirs[name] = os.path.join(self.workspace_dir, rel_path)
        # 启动时创建非懒加载目录
        for name, path in self._dirs.items():
            if name not in LAZY_DIRS:
                os.makedirs(path, exist_ok=True)

    def _init_standard_dbs(self):
        """初始化标准数据库路径映射"""
        for name, filename in STANDARD_DBS.items():
            dir_name = name if name in self._dirs else "data"
            self._db_paths[name] = os.path.join(self._dirs.get(dir_name, self.base_dir), filename)

    def _init_default_quotas(self):
        """初始化默认配额"""
        default_quotas = {
            "tmp": DirectoryQuota("tmp", max_size_mb=500, max_files=1000, auto_clean=True),
            "cache": DirectoryQuota("cache", max_size_mb=1024, max_files=5000, auto_clean=True),
            "logs": DirectoryQuota("logs", max_size_mb=2048, max_files=100, auto_clean=True),
            "uploads": DirectoryQuota("uploads", max_size_mb=2048, max_files=500, auto_clean=True),
            "exports": DirectoryQuota("exports", max_size_mb=1024, max_files=200, auto_clean=True),
            "backups": DirectoryQuota("backups", max_size_mb=5120, max_files=50, auto_clean=True),
        }
        self._quotas.update(default_quotas)

    def dir(self, name: str) -> str:
        """获取目录路径（吸收0.1.5）
    
        Args:
            name: 目录名称（如 'auth', 'chat', 'memory'）
    
        Returns:
            目录绝对路径，目录会自动创建
        """
        if name in self._dirs:
            path = self._dirs[name]
        else:
            path = os.path.join(self.base_dir, name)
            self._dirs[name] = path
        os.makedirs(path, exist_ok=True)
        return path

    def db(self, name: str) -> str:
        """获取数据库文件路径（吸收0.1.5）
    
        Args:
            name: 数据库名称（如 'auth', 'chat', 'governance'）
    
        Returns:
            数据库文件绝对路径，父目录会自动创建
        """
        if name in self._db_paths:
            path = self._db_paths[name]
        else:
            path = os.path.join(self.dir(name), name + ".db")
            self._db_paths[name] = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def file(self, dir_name: str, filename: str) -> str:
        """获取文件路径（吸收0.1.5）
    
        Args:
            dir_name: 目录名称
            filename: 文件名
    
        Returns:
            文件绝对路径
        """
        return os.path.join(self.dir(dir_name), filename)

    def workspace(self, name: str = "") -> str:
        """获取工作区路径（吸收0.1.5）
    
        Args:
            name: 工作区子目录名称（如 'shared', 'wan', 'wordlists'）
    
        Returns:
            工作区绝对路径，目录会自动创建
        """
        if name:
            if name in self._dirs:
                path = self._dirs[name]
            else:
                path = os.path.join(self.workspace_dir, name)
                self._dirs[name] = path
            os.makedirs(path, exist_ok=True)
            return path
        os.makedirs(self.workspace_dir, exist_ok=True)
        return self.workspace_dir

    def get_path(self, name: str, *subpaths: str) -> str:
        """获取数据目录下的路径（兼容当前版本接口）
    
        Args:
            name: 子目录名
            *subpaths: 后续子路径
    
        Returns:
            完整路径，目录会自动创建
        """
        base = self.dir(name)
        if subpaths:
            base = os.path.join(base, *subpaths)
            # 只有当路径看起来像目录时才创建
            _, ext = os.path.splitext(base)
            if not ext or os.path.isdir(base):
                os.makedirs(base, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(base), exist_ok=True)
        return base

    def resolve_path(self, path: str) -> str:
        """解析路径（支持 ~、相对路径）
    
        Args:
            path: 相对或绝对路径
    
        Returns:
            绝对路径
        """
        if not path:
            return path
        path = os.path.expanduser(path)
        if os.path.isabs(path):
            return os.path.abspath(path)
        # 兼容旧配置：把 ./LibertasData/ 重定向到数据目录
        norm = path.replace("\\", "/")
        for prefix in ("./LibertasData/", "../LibertasData/", "LibertasData/"):
            if norm.startswith(prefix):
                return os.path.join(self.base_dir, norm[len(prefix):])
        return os.path.abspath(os.path.join(self.base_dir, path))

    def ensure_dir(self, path: str) -> str:
        """确保目录存在"""
        os.makedirs(path, exist_ok=True)
        return path

    def ensure_file_dir(self, filepath: str) -> str:
        """确保文件的父目录存在"""
        parent = os.path.dirname(filepath)
        if parent:
            os.makedirs(parent, exist_ok=True)
        return filepath

    def register_dir(self, name: str, path: str, quota: Optional[DirectoryQuota] = None):
        """注册自定义目录"""
        with self._lock:
            self._dirs[name] = os.path.abspath(path)
            if quota:
                self._quotas[name] = quota
            os.makedirs(self._dirs[name], exist_ok=True)

    def set_quota(self, name: str, max_size_mb: int = 0, max_files: int = 0, auto_clean: bool = True):
        """设置目录配额"""
        with self._lock:
            self._quotas[name] = DirectoryQuota(name, max_size_mb, max_files, auto_clean)

    def get_dir_size(self, path: str) -> Tuple[int, int]:
        """获取目录大小和文件数
    
        Returns:
            (总字节数, 文件数)
        """
        total_size = 0
        file_count = 0
        try:
            for root, dirs, files in os.walk(path):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        total_size += os.path.getsize(fp)
                        file_count += 1
                    except (OSError, PermissionError):
                        pass
        except (OSError, PermissionError):
            pass
        return total_size, file_count

    def get_disk_usage(self) -> Dict[str, Any]:
        """获取磁盘使用情况"""
        try:
            usage = shutil.disk_usage(self.base_dir)
            return {
                "total": usage.total,
                "used": usage.used,
                "free": usage.free,
                "percent": (usage.used / usage.total * 100) if usage.total > 0 else 0,
                "total_human": _format_size(usage.total),
                "used_human": _format_size(usage.used),
                "free_human": _format_size(usage.free),
            }
        except Exception as e:
            return {"error": str(e)}

    def get_all_dir_sizes(self) -> List[Dict[str, Any]]:
        """获取所有已注册目录的大小"""
        result = []
        for name, path in self._dirs.items():
            if os.path.exists(path):
                size, count = self.get_dir_size(path)
                quota = self._quotas.get(name)
                result.append({
                    "name": name,
                    "path": path,
                    "size": size,
                    "size_human": _format_size(size),
                    "file_count": count,
                    "quota_mb": quota.max_size_mb if quota else 0,
                    "quota_used_percent": (size / (quota.max_size_mb * 1024 * 1024) * 100) if quota and quota.max_size_mb > 0 else 0,
                })
        return result

    def enforce_quotas(self) -> List[Dict[str, Any]]:
        """强制执行所有目录配额"""
        results = []
        for name, quota in self._quotas.items():
            if name not in self._dirs:
                continue
            path = self._dirs[name]
            if not os.path.exists(path):
                continue
            size, count = self.get_dir_size(path)
            max_bytes = quota.max_size_mb * 1024 * 1024
            need_clean = False
            bytes_to_free = 0
            if quota.max_size_mb > 0 and size > max_bytes:
                need_clean = True
                bytes_to_free = size - max_bytes
            if quota.max_files > 0 and count > quota.max_files:
                need_clean = True
            if need_clean and quota.auto_clean:
                freed = self._clean_dir_to_size(path, bytes_to_free)
                results.append({
                    "name": name,
                    "cleaned": True,
                    "freed_bytes": freed,
                    "freed_human": _format_size(freed),
                })
            elif need_clean:
                results.append({
                    "name": name,
                    "cleaned": False,
                    "reason": "auto_clean disabled",
                    "over_size": size > max_bytes if max_bytes > 0 else False,
                    "over_files": count > quota.max_files if quota.max_files > 0 else False,
                })
        return results

    def _clean_dir_to_size(self, path: str, bytes_to_free: int) -> int:
        """清理目录到指定大小（按修改时间从旧到新删除）"""
        if bytes_to_free <= 0:
            return 0
        files = []
        try:
            for root, dirs, fnames in os.walk(path):
                for f in fnames:
                    fp = os.path.join(root, f)
                    try:
                        mtime = os.path.getmtime(fp)
                        size = os.path.getsize(fp)
                        files.append((mtime, fp, size))
                    except (OSError, PermissionError):
                        pass
        except (OSError, PermissionError):
            return 0
        # 按修改时间从旧到新排序
        files.sort(key=lambda x: x[0])
        freed = 0
        for mtime, fp, size in files:
            if freed >= bytes_to_free:
                break
            try:
                os.remove(fp)
                freed += size
            except (OSError, PermissionError):
                pass
        return freed

    def create_tmp_file(self, prefix: str = "tmp", suffix: str = "",
                         expiry_seconds: float = 3600.0) -> str:
        """创建临时文件"""
        tmp_dir = self.dir("tmp")
        timestamp = int(time.time() * 1000)
        filename = f"{prefix}_{timestamp}_{os.getpid()}{suffix}"
        filepath = os.path.join(tmp_dir, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("")
        self._tmp_files[filepath] = time.time() + expiry_seconds
        return filepath

    def create_tmp_dir(self, prefix: str = "tmp", expiry_seconds: float = 3600.0) -> str:
        """创建临时目录"""
        tmp_dir = self.dir("tmp")
        timestamp = int(time.time() * 1000)
        dirname = f"{prefix}_{timestamp}_{os.getpid()}"
        dirpath = os.path.join(tmp_dir, dirname)
        os.makedirs(dirpath, exist_ok=True)
        self._tmp_files[dirpath] = time.time() + expiry_seconds
        return dirpath

    def cleanup_expired_tmp(self) -> int:
        """清理过期临时文件/目录"""
        now = time.time()
        cleaned = 0
        expired = [p for p, exp in self._tmp_files.items() if exp < now]
        for path in expired:
            try:
                if os.path.isfile(path):
                    os.remove(path)
                elif os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                cleaned += 1
                del self._tmp_files[path]
            except (OSError, PermissionError):
                pass
        return cleaned

    def cleanup_cache(self, max_age_hours: float = 24.0) -> int:
        """清理过期缓存文件"""
        cache_dir = self.dir("cache")
        if not os.path.exists(cache_dir):
            return 0
        cutoff = time.time() - (max_age_hours * 3600)
        cleaned = 0
        try:
            for root, dirs, files in os.walk(cache_dir):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        if os.path.getmtime(fp) < cutoff:
                            os.remove(fp)
                            cleaned += 1
                    except (OSError, PermissionError):
                        pass
        except (OSError, PermissionError):
            pass
        return cleaned

    def migrate_old_data(self) -> int:
        """迁移旧位置的数据到新目录结构"""
        migrated = 0
        # 检测项目根目录、上级目录、当前工作目录下的旧数据
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        candidates = [
            os.path.join(project_root, "LibertasData"),
            os.path.join(os.path.dirname(project_root), "LibertasData"),
            os.path.join(os.getcwd(), "LibertasData"),
        ]
        for old_dir in candidates:
            old_dir = os.path.abspath(old_dir)
            if old_dir == self.base_dir or not os.path.isdir(old_dir):
                continue
            for root, dirs, files in os.walk(old_dir):
                rel = os.path.relpath(root, old_dir)
                dst_dir = os.path.join(self.base_dir, rel) if rel != "." else self.base_dir
                os.makedirs(dst_dir, exist_ok=True)
                for fn in files:
                    src = os.path.join(root, fn)
                    dst = os.path.join(dst_dir, fn)
                    if not os.path.exists(dst):
                        try:
                            shutil.copy2(src, dst)
                            migrated += 1
                        except Exception:
                            pass
            try:
                shutil.rmtree(old_dir, ignore_errors=True)
            except Exception:
                pass
        return migrated

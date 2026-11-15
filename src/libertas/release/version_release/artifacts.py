"""版本发布与分发系统：发布多平台安装包，通过WAN广播，用户检查更新并安装。

注意：版本发布只分发编译后的安装包（.exe/.app/.bin），不分发源代码。
源代码只能通过治理分叉（Fork）流程经社区投票后获取。
"""
import os
import sys
import glob
import json
import time
import shutil
import hashlib
import zipfile
import platform
import threading
import subprocess
import logging
from typing import Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode

logger = logging.getLogger(__name__)

from .constants import PLATFORM_EXT, PLATFORM_LABELS, current_platform
from .models import BuildCancelled


class ReleaseArtifactMixin:
    """更新压缩包与产物收尾。"""

    def _build_update_zip(self, plat: str, version: str, pkg_dir: str,
                          progress_cb=None) -> Dict:
        """构建自包含更新包（zip），安装时解压覆盖程序目录
    
        这不是源代码下载——包内文件是编译/优化后的运行时文件，
        且安装过程是自动的，用户不会接触到源码。
        """
        def _cb(pct, step):
            if progress_cb:
                try:
                    progress_cb(pct, step)
                except Exception:
                    pass
        skip_dirs = {"__pycache__", ".git", "node_modules", "dist", "build",
                     ".venv", "venv", "releases", "*.egg-info",
                     ".vscode", ".idea", "LibertasData", "SecLists",
                     "workflows", "snapshots", "feedback"}
        skip_exts = {".pyc", ".pyo", ".log", ".db", ".sqlite", ".db-journal",
                     ".spec", ".DS_Store"}
        skip_files = {".DS_Store", "generate_icon.py", "libertas.spec",
                      "build_linux.sh", "build_macos.sh", "build_windows.bat",
                      "1.txt", "butian_scraper_fixed.py", "|"}
    
        name = f"libertas_{version}_{plat}_update.zip"
        zip_path = os.path.join(pkg_dir, name)
    
        # 生成清理后的 config.yaml（移除个人密钥和本地路径）
        clean_config = self._sanitize_config(
            os.path.join(self.project_root, "config.yaml"), pkg_dir)
    
        _cb(25, "正在收集项目文件...")
        # 先统计文件数用于进度
        all_files = []
        for root, dirs, files in os.walk(self.project_root):
            dirs[:] = [d for d in dirs if d not in skip_dirs and not d.endswith(".egg-info")]
            for fn in files:
                if fn in skip_files:
                    continue
                if any(fn.endswith(ext) for ext in skip_exts):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, self.project_root)
                if rel.startswith("LibertasData") or "/LibertasData/" in rel:
                    continue
                all_files.append((full, rel))
    
        file_count = 0
        total_size = 0
        total_files = len(all_files)
        _cb(35, f"正在压缩 {total_files} 个文件...")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for full, rel in all_files:
                # 用清理后的 config.yaml 替换原文件
                if rel == "config.yaml" and clean_config and os.path.isfile(clean_config):
                    zf.write(clean_config, rel)
                else:
                    zf.write(full, rel)
                file_count += 1
                total_size += os.path.getsize(full)
                if file_count % 20 == 0 or file_count == total_files:
                    pct = 35 + int(file_count / max(total_files, 1) * 55)
                    _cb(pct, f"压缩中... {file_count}/{total_files}")
    
        _cb(92, "正在计算校验和...")
        return self._finalize_package(zip_path, plat, version, "update_zip",
                                       file_count=file_count)

    def _finalize_package(self, pkg_path: str, plat: str, version: str,
                           build_type: str, file_count: int = 0) -> Dict:
        """整理构建产物信息"""
        size = os.path.getsize(pkg_path)
        pkg_hash = self._hash_file(pkg_path)
        return {
            "success": True,
            "platform": plat,
            "filename": os.path.basename(pkg_path),
            "path": pkg_path,
            "size": size,
            "hash": pkg_hash,
            "build_type": build_type,
            "file_count": file_count,
            "version": version,
        }

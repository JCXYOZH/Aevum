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


class ReleaseInstallMixin:
    """安装、备份与二进制/更新包安装。"""

    def install_release(self, version: str, backup_first: bool = True) -> Dict:
        """安装指定版本的更新包
    
        自动检测当前平台，下载/定位安装包，备份当前版本，执行安装。
        安装包是编译后的二进制或自包含更新包，不是源代码。
        """
        release = None
        for r in self._local_index.get("releases", []):
            if r["version"] == version:
                release = r
                break
        if not release:
            return {"success": False, "error": "版本不存在"}
    
        plat = current_platform()
        pkg_info = release.get("packages", {}).get(plat)
        if not pkg_info:
            return {"success": False,
                    "error": f"版本 {version} 没有 {plat} 平台的安装包，"
                             f"可用平台: {', '.join(release.get('platforms', []))}"}
    
        # 查找本地安装包
        pkg_path = os.path.join(self.releases_dir,
                                f"libertas_{version}_{plat}",
                                pkg_info["filename"])
        if not os.path.isfile(pkg_path):
            # 也检查 releases_dir 根目录
            alt = os.path.join(self.releases_dir, pkg_info["filename"])
            if os.path.isfile(alt):
                pkg_path = alt
            else:
                # 远程版本：通过WAN请求安装包
                if release.get("remote") and self._wan and self._wan._running:
                    return {"success": False, "error": "安装包尚未下载，请先等待WAN传输或联系发布者",
                            "need_download": True}
                return {"success": False, "error": f"安装包文件不存在: {pkg_info['filename']}"}
    
        # 校验hash
        actual_hash = self._hash_file(pkg_path)
        if pkg_info.get("hash") and actual_hash != pkg_info["hash"]:
            return {"success": False, "error": "安装包校验失败，文件可能已损坏，请重新获取"}
    
        # 备份当前版本
        if backup_first:
            backup_result = self._backup_current()
            if not backup_result.get("success"):
                return {"success": False, "error": f"备份失败: {backup_result.get('error','')}"}
    
        # 执行安装
        build_type = pkg_info.get("build_type", "update_zip")
        if build_type == "pyinstaller":
            result = self._install_binary(pkg_path, plat)
        else:
            result = self._install_update_zip(pkg_path)
    
        if result.get("success"):
            self._local_index["installed_version"] = version
            self._local_index["installed_at"] = time.time()
            self._save_index()
            pub = release.get("publisher", "未知")
            result["message"] = f"版本 {version}（发布者: {pub}）安装成功，重启后生效"
            result["restart_required"] = True
            result["publisher"] = pub
        return result

    def _backup_current(self) -> Dict:
        """备份当前程序目录到快照"""
        try:
            backup_dir = os.path.join(self.data_dir, "backups")
            os.makedirs(backup_dir, exist_ok=True)
            current_ver = self._local_index.get("installed_version", "1.0.0")
            backup_name = f"libertas_{current_ver}_{int(time.time())}.zip"
            backup_path = os.path.join(backup_dir, backup_name)
    
            skip_dirs = {"__pycache__", ".git", "node_modules", "dist", "build",
                         ".venv", "venv", "releases", "backups", "LibertasData"}
            with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(self.project_root):
                    dirs[:] = [d for d in dirs if d not in skip_dirs]
                    for fn in files:
                        if fn.endswith((".pyc", ".pyo", ".log", ".db")):
                            continue
                        full = os.path.join(root, fn)
                        rel = os.path.relpath(full, self.project_root)
                        zf.write(full, rel)
            return {"success": True, "backup_path": backup_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _install_binary(self, pkg_path: str, plat: str) -> Dict:
        """安装编译后的二进制包"""
        try:
            install_dir = os.path.join(self.data_dir, "bin")
            os.makedirs(install_dir, exist_ok=True)
    
            if plat == "macos" and pkg_path.endswith(".zip"):
                # 解压 .app
                with zipfile.ZipFile(pkg_path, "r") as zf:
                    zf.extractall(install_dir)
            elif plat == "macos" and pkg_path.endswith(".dmg"):
                # DMG 需要用户手动安装，复制到下载目录并提示
                dest = os.path.join(install_dir, os.path.basename(pkg_path))
                shutil.copy2(pkg_path, dest)
                return {"success": True, "message": f"DMG已复制到 {dest}，请手动打开安装"}
            else:
                # Windows .exe 或 Linux .bin：复制到 bin 目录
                dest = os.path.join(install_dir, os.path.basename(pkg_path))
                shutil.copy2(pkg_path, dest)
                os.chmod(dest, 0o755)
    
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": f"二进制安装失败: {e}"}

    def _install_update_zip(self, pkg_path: str) -> Dict:
        """安装自包含更新包：解压覆盖程序目录"""
        try:
            # 先解压到临时目录
            import tempfile
            with tempfile.TemporaryDirectory() as tmpdir:
                with zipfile.ZipFile(pkg_path, "r") as zf:
                    zf.extractall(tmpdir)
                # 覆盖文件
                for root, dirs, files in os.walk(tmpdir):
                    for fn in files:
                        src = os.path.join(root, fn)
                        rel = os.path.relpath(src, tmpdir)
                        dst = os.path.join(self.project_root, rel)
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.copy2(src, dst)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": f"更新包安装失败: {e}"}

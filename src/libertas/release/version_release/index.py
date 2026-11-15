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


class ReleaseIndexMixin:
    """发布索引加载、保存、哈希与版本一致性。"""

    def check_version_consistency(self, version: str) -> Dict:
        """检查版本号是否与 __init__.py 和 pyproject.toml 一致"""
        errors = []
        # 检查 __init__.py
        init_path = os.path.join(self.project_root, "libertas", "__init__.py")
        if os.path.isfile(init_path):
            try:
                with open(init_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("__version__"):
                            init_ver = line.split("=")[1].strip().strip('"').strip("'")
                            if init_ver != version:
                                errors.append(f"libertas/__init__.py 版本为 {init_ver}，与发布版本 {version} 不一致")
                            break
            except Exception:
                pass
        # 检查 pyproject.toml
        pyproject_path = os.path.join(self.project_root, "pyproject.toml")
        if os.path.isfile(pyproject_path):
            try:
                with open(pyproject_path, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip().startswith("version"):
                            pp_ver = line.split("=")[1].strip().strip('"').strip("'")
                            if pp_ver != version:
                                errors.append(f"pyproject.toml 版本为 {pp_ver}，与发布版本 {version} 不一致")
                            break
            except Exception:
                pass
        if errors:
            return {"consistent": False, "errors": errors,
                    "suggestion": "请先更新 libertas/__init__.py 和 pyproject.toml 中的版本号"}
        return {"consistent": True, "version": version}

    def _load_index(self) -> Dict:
        if os.path.isfile(self.index_file):
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {"releases": [], "installed_version": "1.0.0", "installed_at": time.time()}

    def _save_index(self):
        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(self._local_index, f, ensure_ascii=False, indent=2)

    def _hash_file(self, filepath: str) -> str:
        h = hashlib.sha256()
        try:
            with open(filepath, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
        except Exception:
            return ""
        return h.hexdigest()

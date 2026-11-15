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


class ReleaseBuildMixin:
    """平台构建编排、入口/图标定位与配置净化。"""

    def build_all_platforms(self, version: str, platforms: List[str] = None,
                            custom_icon: str = None,
                            progress_cb=None,
                            dep_depth: str = "standard",
                            custom_toml: str = "") -> Dict:
        """为多个平台构建安装包（可在一个平台上构建所有平台的zip包）
    
        Args:
            version: 版本号
            platforms: 目标平台列表
            custom_icon: 自定义图标路径（PNG），随安装包一起打包
            progress_cb: 进度回调 fn(percent:int, step:str, platform:str)
        """
        def _cb(pct, step, plat=""):
            if progress_cb:
                try:
                    progress_cb(pct, step, plat)
                except Exception:
                    pass
    
        if platforms is None:
            platforms = ["windows", "macos", "linux"]
        _cb(2, "检查版本号一致性...")
        vc = self.check_version_consistency(version)
        if not vc["consistent"]:
            return {"success": False, "error": "版本号不一致", "details": vc["errors"]}
        _cb(8, "准备应用图标...")
        icon_result = self.ensure_icons(custom_icon)
        if not icon_result.get("success"):
            return {"success": False, "error": icon_result.get("error", "图标准备失败")}
    
        results = []
        packages = {}
        n = len(platforms)
        for i, plat in enumerate(platforms):
            base_pct = 10 + int(i / n * 80)
            next_pct = 10 + int((i + 1) / n * 80)
            _cb(base_pct, f"开始构建 {PLATFORM_LABELS.get(plat, plat)}", plat)
            r = self.build_package(plat, version, custom_icon=custom_icon,
                                   progress_cb=lambda pct, step, p=plat, b=base_pct, nx=next_pct:
                                       _cb(b + int(pct / 100 * (nx - b)), step, p),
                                   dep_depth=dep_depth, custom_toml=custom_toml)
            results.append({"platform": plat, "success": r.get("success", False),
                            "error": r.get("error", ""), "build_type": r.get("build_type", ""),
                            "filename": r.get("filename", ""), "size": r.get("size", 0)})
            status = "[OK]" if r.get("success") else "[FAIL]"
            _cb(next_pct, f"{status} {PLATFORM_LABELS.get(plat, plat)} 构建完成", plat)
            if r.get("success"):
                packages[plat] = {
                    "filename": r["filename"],
                    "size": r["size"],
                    "hash": r["hash"],
                    "build_type": r.get("build_type", "update_zip"),
                }
        _cb(92, "计算文件校验和...")
        return {"success": bool(packages), "packages": packages, "results": results,
                "icon": icon_result.get("message", "")}

    def _find_entry_point(self) -> Optional[str]:
        """查找项目入口文件"""
        candidates = ["main.py", "app.py", "run.py", "start.py", "__main__.py"]
        for c in candidates:
            p = os.path.join(self.project_root, c)
            if os.path.isfile(p):
                return p
        # 查找libertas包的入口
        for root, dirs, files in os.walk(os.path.join(self.project_root, "libertas")):
            for f in files:
                if f == "__main__.py":
                    return os.path.join(root, f)
        return None

    def _find_icon(self, plat: str = None) -> Optional[str]:
        """查找应用图标（按平台优先选择正确格式）"""
        icon_dir = os.path.join(self.project_root, "assets")
        if not os.path.isdir(icon_dir):
            icon_dir = os.path.join(self.project_root, "icons")
        if not os.path.isdir(icon_dir):
            return None
        # 按平台选择优先格式
        if plat == "windows":
            preferred = ("icon.ico", "icon.png", "icon.icns")
        elif plat == "macos":
            preferred = ("icon.icns", "icon.png", "icon.ico")
        else:
            preferred = ("icon.png", "icon.ico", "icon.icns")
        for name in preferred:
            p = os.path.join(icon_dir, name)
            if os.path.isfile(p):
                return p
        # 回退：找第一个图标文件
        for f in sorted(os.listdir(icon_dir)):
            if f.lower().endswith((".ico", ".icns", ".png")):
                return os.path.join(icon_dir, f)
        return None

    def _sanitize_config(self, config_path: str, dest_dir: str) -> Optional[str]:
        """创建清理后的 config.yaml 副本用于打包（移除 API 密钥、本地路径等个人配置）"""
        if not os.path.isfile(config_path):
            return None
        try:
            import yaml
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            # 清除 API 密钥
            if "cloud" in cfg and isinstance(cfg["cloud"], dict):
                cfg["cloud"]["api_key"] = ""
            if "vectorization" in cfg and isinstance(cfg["vectorization"], dict):
                if "cloud_api" in cfg["vectorization"] and isinstance(cfg["vectorization"]["cloud_api"], dict):
                    cfg["vectorization"]["cloud_api"]["api_key"] = ""
            # 清除 SSH 密钥路径等本地绝对路径
            if "ssh" in cfg and isinstance(cfg["ssh"], dict):
                cfg["ssh"]["ssh_key_path"] = ""
                cfg["ssh"]["bastion_host"] = ""
                cfg["ssh"]["bastion_user"] = ""
            # 重置模型路径为相对/默认值
            if "vectorization" in cfg and isinstance(cfg["vectorization"], dict):
                if "semantic" in cfg["vectorization"] and isinstance(cfg["vectorization"]["semantic"], dict):
                    model_name = cfg["vectorization"]["semantic"].get("model_name", "")
                    if "/" in model_name:
                        cfg["vectorization"]["semantic"]["model_name"] = os.path.basename(model_name)
            # 写入临时文件
            os.makedirs(dest_dir, exist_ok=True)
            clean_path = os.path.join(dest_dir, "config.yaml")
            with open(clean_path, "w", encoding="utf-8") as f:
                yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
            return clean_path
        except Exception as e:
            logger.warning(f"清理 config.yaml 失败，使用原文件: {e}")
            return config_path

    def build_package(self, plat: str, version: str,
                      custom_icon: str = None, progress_cb=None,
                      dep_depth: str = "standard",
                      custom_toml: str = "") -> Dict:
        """为指定平台构建安装包
    
        优先使用 PyInstaller 构建独立可执行文件；
        如果 PyInstaller 不可用，则构建一个自包含的更新包（zip），
        安装时解压到程序目录。
        """
        def _cb(pct, step):
            if progress_cb:
                try:
                    progress_cb(pct, step)
                except Exception:
                    pass
    
        if plat not in PLATFORM_LABELS:
            return {"success": False, "error": f"不支持的平台: {plat}"}
    
        _cb(5, "准备构建目录...")
        pkg_dir = os.path.join(self.releases_dir, f"libertas_{version}_{plat}")
        os.makedirs(pkg_dir, exist_ok=True)
    
        # 尝试 PyInstaller
        pyinstaller = shutil.which("pyinstaller")
        entry = self._find_entry_point()
    
        if pyinstaller and entry:
            _cb(10, "自动识别依赖...")
            hidden_deps, collect_deps, exclude_deps = self.get_build_dependencies(dep_depth, custom_toml)
            _excl_note = f"，排除{len(exclude_deps)}个" if exclude_deps else ""
            _cb(15, f"使用 PyInstaller 编译（{len(hidden_deps)}个隐藏导入，"
                    f"{len(collect_deps)}个完整收集{_excl_note}）...")
            return self._build_with_pyinstaller(pyinstaller, entry, plat, version,
                                                 pkg_dir, custom_icon, progress_cb=_cb,
                                                 hidden_imports=hidden_deps,
                                                 collect_all=collect_deps,
                                                 excludes=exclude_deps)
        else:
            _cb(15, "PyInstaller 不可用，构建自包含更新包...")
            return self._build_update_zip(plat, version, pkg_dir, progress_cb=_cb)

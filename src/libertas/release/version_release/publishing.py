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


class ReleasePublishMixin:
    """发布、接收、版本列表、更新检查与安装检测。"""

    def publish(self, version: str, description: str = "", publisher: str = "",
                platforms: Optional[List[str]] = None,
                release_key: str = "", username: str = "",
                role: str = "member",
                custom_icon: str = None) -> Dict:
        """发布新版本：验证密钥 → 检查版本号 → 构建多平台安装包 → 广播到WAN
    
        release_key: 发布者的发布密钥（必须）
        username: 发布者用户名
        role: 发布者角色（决定权限）
        platforms: 要构建的平台列表
        custom_icon: 自定义图标路径（随安装包打包）
        """
        if not version.strip():
            return {"success": False, "error": "版本号不能为空"}
    
        # ── 权限检查 ──
        perms = self.get_role_permissions(role)
        if not perms.get("publish", False):
            return {"success": False, "error": f"角色「{role}」无权发布版本"}
    
        # ── 密钥验证 ──
        if release_key and username:
            from libertas.release.release_key import get_release_key_manager
            km = get_release_key_manager()
            vr = km.verify_key(username, release_key)
            if not vr["valid"]:
                return {"success": False, "error": f"发布密钥验证失败: {vr['error']}"}
        elif not release_key:
            return {"success": False, "error": "发布版本必须提供发布密钥"}
    
        # ── 版本号一致性检查 ──
        vc = self.check_version_consistency(version)
        if not vc["consistent"]:
            return {"success": False, "error": "版本号不一致", "details": vc["errors"],
                    "suggestion": vc.get("suggestion", "")}
    
        for r in self._local_index.get("releases", []):
            if r["version"] == version:
                return {"success": False, "error": f"版本 {version} 已发布过"}
    
        if platforms is None:
            platforms = [current_platform()]
    
        # 确保图标存在（支持自定义）
        icon_r = self.ensure_icons(custom_icon)
        if not icon_r.get("success"):
            return {"success": False, "error": icon_r.get("error", "图标准备失败")}
    
        # 构建各平台安装包
        packages = {}
        build_results = []
        for plat in platforms:
            result = self.build_package(plat, version, custom_icon=custom_icon)
            build_results.append({"platform": plat, "success": result.get("success", False),
                                  "error": result.get("error", ""),
                                  "build_type": result.get("build_type", "")})
            if result.get("success"):
                packages[plat] = {
                    "filename": result["filename"],
                    "size": result["size"],
                    "hash": result["hash"],
                    "build_type": result.get("build_type", "update_zip"),
                }
    
        if not packages:
            return {"success": False, "error": "所有平台构建均失败",
                    "build_results": build_results}
    
        release = {
            "version": version,
            "description": description,
            "publisher": publisher or username,
            "packages": packages,
            "platforms": list(packages.keys()),
            "published_at": time.time(),
            "time_str": time.strftime("%Y-%m-%d %H:%M:%S"),
            "votes": {},
            "vote_summary": {"agree": 0, "neutral": 0, "reject": 0},
            "status": "published",
        }
        with self._lock:
            self._local_index.setdefault("releases", []).insert(0, release)
            self._save_index()
    
        # 记录密钥使用
        if release_key and username:
            try:
                from libertas.release.release_key import get_release_key_manager
                get_release_key_manager().record_publish(
                    username, release_key, version, ",".join(packages.keys()))
            except Exception:
                pass
    
        # 广播到WAN（仅元信息，不含安装包二进制）
        if self._wan and self._wan._running:
            try:
                payload = {
                    "type": "version_release",
                    "version": version,
                    "description": description,
                    "publisher": publisher or username or getattr(self._wan, "nickname", ""),
                    "platforms": list(packages.keys()),
                    "packages": packages,
                    "published_at": release["published_at"],
                    "time_str": release["time_str"],
                }
                self._wan.client.publish(
                    f"{self._wan.topic_base}/release",
                    json.dumps(payload, ensure_ascii=False))
            except Exception:
                pass
    
        return {"success": True, "release": release,
                "build_results": build_results,
                "message": f"版本 {version} 已发布，支持平台: {', '.join(packages.keys())}"}

    def receive_release(self, payload: Dict):
        """接收WAN中的版本发布通知（仅元信息）"""
        version = payload.get("version", "")
        if not version:
            return
        with self._lock:
            existing = [r for r in self._local_index.get("releases", [])
                        if r["version"] == version]
            if not existing:
                self._local_index.setdefault("releases", []).insert(0, {
                    "version": version,
                    "description": payload.get("description", ""),
                    "publisher": payload.get("publisher", "未知"),
                    "packages": payload.get("packages", {}),
                    "platforms": payload.get("platforms", []),
                    "published_at": payload.get("published_at", time.time()),
                    "time_str": payload.get("time_str", ""),
                    "remote": True,
                    "votes": {},
                    "vote_summary": {"agree": 0, "neutral": 0, "reject": 0},
                    "status": "announced",
                })
                self._save_index()

    def list_releases(self, include_remote: bool = True) -> List[Dict]:
        releases = self._local_index.get("releases", [])
        if not include_remote:
            releases = [r for r in releases if not r.get("remote")]
        return releases

    def get_latest(self) -> Optional[Dict]:
        releases = self._local_index.get("releases", [])
        return releases[0] if releases else None

    def check_update(self) -> Dict:
        installed = self._local_index.get("installed_version", "1.0.0")
        latest = self.get_latest()
        if not latest:
            return {"success": True, "has_update": False, "message": "已是最新版本"}
        if latest["version"] != installed:
            plat = current_platform()
            has_pkg = plat in latest.get("packages", {})
            return {"success": True, "has_update": True, "latest": latest,
                    "installed": installed, "platform": plat,
                    "has_package": has_pkg,
                    "message": f"发现新版本 {latest['version']}（当前 {installed}）"}
        return {"success": True, "has_update": False, "message": "已是最新版本"}

    def get_installed(self) -> Dict:
        return {
            "version": self._local_index.get("installed_version", "1.0.0"),
            "installed_at": self._local_index.get("installed_at", 0),
            "time_str": time.strftime(
                "%Y-%m-%d %H:%M:%S",
                time.localtime(self._local_index.get("installed_at", time.time()))),
            "platform": current_platform(),
        }

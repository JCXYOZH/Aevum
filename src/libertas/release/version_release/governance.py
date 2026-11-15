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


class ReleaseGovernanceMixin:
    """发布角色权限、投票与撤回。"""

    ROLE_PERMISSIONS = {
        "guest":       {"view": True,  "install": False, "publish": False,
                        "withdraw": False, "vote": False,  "reject": False},
        "member":      {"view": True,  "install": True,  "publish": False,
                        "withdraw": False, "vote": True,   "reject": False},
        "contributor": {"view": True,  "install": True,  "publish": False,
                        "withdraw": False, "vote": True,   "reject": False},
        "maintainer":  {"view": True,  "install": True,  "publish": True,
                        "withdraw": True,  "vote": True,   "reject": False},
        "reviewer":    {"view": True,  "install": True,  "publish": False,
                        "withdraw": False, "vote": True,   "reject": True},
        "moderator":   {"view": True,  "install": True,  "publish": False,
                        "withdraw": True,  "vote": True,   "reject": True},
        "arbitrator":  {"view": True,  "install": True,  "publish": False,
                        "withdraw": True,  "vote": True,   "reject": True},
        "admin":       {"view": True,  "install": True,  "publish": True,
                        "withdraw": True,  "vote": True,   "reject": True},
        "owner":       {"view": True,  "install": True,  "publish": True,
                        "withdraw": True,  "vote": True,   "reject": True},
        "auditor":     {"view": True,  "install": True,  "publish": False,
                        "withdraw": False, "vote": True,   "reject": True},
    }

    def get_role_permissions(self, role: str) -> Dict[str, bool]:
        return self.ROLE_PERMISSIONS.get(role, self.ROLE_PERMISSIONS["guest"]).copy()

    def can_publish(self, role: str) -> bool:
        return self.get_role_permissions(role)["publish"]

    def can_install(self, role: str) -> bool:
        return self.get_role_permissions(role)["install"]

    def can_vote(self, role: str) -> bool:
        return self.get_role_permissions(role)["vote"]

    def can_withdraw(self, role: str) -> bool:
        return self.get_role_permissions(role)["withdraw"]

    def can_reject(self, role: str) -> bool:
        return self.get_role_permissions(role)["reject"]

    def vote_release(self, version: str, voter: str, vote: str,
                     role: str = "member") -> Dict:
        if not self.can_vote(role):
            return {"success": False, "error": f"角色 {role} 无投票权限"}
        if vote not in ("agree", "neutral", "reject"):
            return {"success": False, "error": "投票必须是 agree/neutral/reject"}
        if not self.can_reject(role) and vote == "reject":
            return {"success": False, "error": f"角色 {role} 无拒绝权限"}
        with self._lock:
            for r in self._local_index.get("releases", []):
                if r["version"] == version:
                    r.setdefault("votes", {})
                    r["votes"][voter] = {"vote": vote, "role": role, "time": time.time()}
                    agrees = sum(1 for v in r["votes"].values() if v["vote"] == "agree")
                    neutrals = sum(1 for v in r["votes"].values() if v["vote"] == "neutral")
                    rejects = sum(1 for v in r["votes"].values() if v["vote"] == "reject")
                    r["vote_summary"] = {"agree": agrees, "neutral": neutrals,
                                         "reject": rejects}
                    self._save_index()
                    return {"success": True, "version": version, "vote": vote,
                            "summary": r["vote_summary"]}
        return {"success": False, "error": "版本不存在"}

    def withdraw_release(self, version: str, role: str = "member") -> Dict:
        if not self.can_withdraw(role):
            return {"success": False, "error": f"角色 {role} 无撤回权限"}
        with self._lock:
            releases = self._local_index.get("releases", [])
            for i, r in enumerate(releases):
                if r["version"] == version:
                    removed = releases.pop(i)
                    self._save_index()
                    # 删除本地安装包
                    for plat in removed.get("packages", {}):
                        pkg_dir = os.path.join(self.releases_dir,
                                               f"libertas_{version}_{plat}")
                        if os.path.isdir(pkg_dir):
                            shutil.rmtree(pkg_dir, ignore_errors=True)
                    return {"success": True, "message": f"版本 {version} 已撤回"}
        return {"success": False, "error": "版本不存在"}

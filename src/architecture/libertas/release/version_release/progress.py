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


class ReleaseProgressMixin:
    """构建进度、取消与异步启动。"""

    def _set_progress(self, percent, step, platform=""):
        if self._cancel_build:
            raise BuildCancelled("构建已取消")
        self._build_progress["percent"] = percent
        self._build_progress["step"] = step
        if platform:
            self._build_progress["platform"] = platform
        self._build_progress["logs"].append(
            f"[{percent}%] {step}" + (f" ({platform})" if platform else ""))
        if len(self._build_progress["logs"]) > 200:
            self._build_progress["logs"] = self._build_progress["logs"][-200:]

    def get_build_progress(self) -> Dict:
        return dict(self._build_progress)

    def cancel_build(self) -> Dict:
        """取消正在进行的构建"""
        if not self._build_progress.get("running"):
            return {"success": False, "error": "没有正在进行的构建"}
        self._cancel_build = True
        # 杀掉正在运行的子进程（PyInstaller/iconutil/pkgbuild等）
        proc = self._build_subprocess
        if proc and proc.poll() is None:
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
            except Exception:
                pass
        self._set_progress_cancelled()
        return {"success": True, "message": "构建取消请求已发送"}

    def _set_progress_cancelled(self):
        """标记构建为已取消"""
        self._build_progress["running"] = False
        self._build_progress["cancelled"] = True
        self._build_progress["percent"] = self._build_progress.get("percent", 0)
        self._build_progress["step"] = "已取消"
        self._build_progress["finished_at"] = time.time()
        self._build_progress["result"] = {"success": False, "cancelled": True,
                                           "error": "构建已被用户取消"}

    def start_build_async(self, version: str, platforms: List[str] = None,
                          custom_icon: str = None, publish_after: bool = False,
                          description: str = "", release_key: str = "",
                          username: str = "", role: str = "member",
                          dep_depth: str = "standard",
                          custom_toml: str = "") -> Dict:
        """启动异步构建（后台线程），立即返回。通过 get_build_progress() 轮询进度。"""
        if self._build_progress.get("running"):
            return {"success": False, "error": "已有构建任务正在进行，请等待完成"}
        self._cancel_build = False
        self._build_subprocess = None
        self._build_progress = {
            "running": True, "percent": 0, "step": "初始化...", "platform": "",
            "logs": [], "result": None, "cancelled": False,
            "started_at": time.time(), "finished_at": 0,
        }
    
        def _run():
            try:
                result = self.build_all_platforms(
                    version, platforms, custom_icon=custom_icon,
                    progress_cb=self._set_progress,
                    dep_depth=dep_depth, custom_toml=custom_toml)
                if self._cancel_build:
                    self._set_progress_cancelled()
                    return
                if publish_after and result.get("success"):
                    self._set_progress(92, "构建完成，正在发布到广域网...")
                    pub = self.publish(version, description,
                                       release_key=release_key,
                                       username=username, role=role,
                                       platforms=platforms,
                                       custom_icon=custom_icon)
                    result["publish"] = pub
                    if pub.get("success"):
                        self._set_progress(100, "发布完成")
                    else:
                        self._set_progress(100, f"发布失败: {pub.get('error','')}")
                else:
                    self._set_progress(100, "构建完成")
                self._build_progress["result"] = result
            except BuildCancelled:
                self._set_progress_cancelled()
            except Exception as e:
                self._build_progress["result"] = {"success": False, "error": str(e)}
                self._set_progress(100, f"构建异常: {e}")
            finally:
                self._build_progress["running"] = False
                self._build_progress["finished_at"] = time.time()
                self._build_subprocess = None
    
        self._build_thread = threading.Thread(target=_run, daemon=True)
        self._build_thread.start()
        return {"success": True, "message": "构建已启动"}

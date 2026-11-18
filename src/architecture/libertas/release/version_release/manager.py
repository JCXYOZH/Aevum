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

from .artifacts import ReleaseArtifactMixin
from .build import ReleaseBuildMixin
from .constants import PLATFORM_EXT, PLATFORM_LABELS, current_platform
from .deps import ReleaseDependencyMixin
from .governance import ReleaseGovernanceMixin
from .icons import ReleaseIconMixin
from .index import ReleaseIndexMixin
from .installers_linux import ReleaseLinuxInstallerMixin
from .installers_macos import ReleaseMacInstallerMixin
from .installers_windows import ReleaseWindowsInstallerMixin
from .installation import ReleaseInstallMixin
from .models import BuildCancelled
from .progress import ReleaseProgressMixin
from .publishing import ReleasePublishMixin
from .pyinstaller import ReleasePyInstallerMixin


class VersionReleaseManager(ReleaseIndexMixin, ReleaseProgressMixin, ReleaseIconMixin, ReleaseDependencyMixin, ReleaseBuildMixin, ReleasePyInstallerMixin, ReleaseMacInstallerMixin, ReleaseWindowsInstallerMixin, ReleaseLinuxInstallerMixin, ReleaseArtifactMixin, ReleasePublishMixin, ReleaseInstallMixin, ReleaseGovernanceMixin):
    """版本发布与分发管理器。"""

    def __init__(self, data_dir: str = "", project_root: str = ""):
        self.data_dir = data_dir or get_data_dir()
        self.releases_dir = os.path.join(self.data_dir, "releases")
        self.index_file = os.path.join(self.data_dir, "release_index.json")
        self.project_root = project_root or os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        os.makedirs(self.releases_dir, exist_ok=True)
        self._lock = threading.Lock()
        self._wan = None
        self._local_index = self._load_index()
        # 异步构建进度
        self._build_progress = {
            "running": False, "percent": 0, "step": "", "platform": "",
            "logs": [], "result": None, "started_at": 0, "finished_at": 0,
        }
        self._build_thread = None
        self._cancel_build = False
        self._build_subprocess = None

    def set_wan(self, wan):
        self._wan = wan

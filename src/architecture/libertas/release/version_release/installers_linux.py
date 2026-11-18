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


class ReleaseLinuxInstallerMixin:
    """Linux AppImage 与 deb 包生成。"""

    def _create_linux_appimage(self, bin_path: str, version: str,
                                pkg_dir: str, icon_path: str = None,
                                progress_cb=None) -> Optional[str]:
        """创建 Linux AppImage。

        在 Linux 上且有 appimagetool 时直接创建；
        在其他平台上生成 AppDir 结构和构建脚本。
        """
        appdir = os.path.join(pkg_dir, "Libertas.AppDir")
        if os.path.isdir(appdir):
            shutil.rmtree(appdir, ignore_errors=True)
        os.makedirs(appdir, exist_ok=True)

        # AppDir 结构
        bin_dest = os.path.join(appdir, "usr", "bin")
        os.makedirs(bin_dest, exist_ok=True)
        shutil.copy2(bin_path, os.path.join(bin_dest, "Libertas"))
        os.chmod(os.path.join(bin_dest, "Libertas"), 0o755)

        # 图标
        icon_dest = os.path.join(appdir, "Libertas.png")
        png_icon = icon_path or self._find_icon("linux")
        if png_icon and os.path.isfile(png_icon):
            from PIL import Image
            img = Image.open(png_icon)
            if img.size != (256, 256):
                img = img.resize((256, 256), Image.LANCZOS)
            img.save(icon_dest, "PNG")
        else:
            # 生成一个简单的占位图标
            from PIL import Image, ImageDraw
            img = Image.new("RGBA", (256, 256), (106, 76, 147, 255))
            img.save(icon_dest, "PNG")

        # .desktop 文件
        desktop = os.path.join(appdir, "Libertas.desktop")
        with open(desktop, "w", encoding="utf-8") as f:
            f.write("""[Desktop Entry]
Type=Application
Name=Libertas
Comment=AI Security Workstation
Exec=Libertas
Icon=Libertas
Categories=Development;Security;Network;
Terminal=false
StartupWMClass=Libertas
""")

        # AppRun
        apprun = os.path.join(appdir, "AppRun")
        with open(apprun, "w", encoding="utf-8") as f:
            f.write("""#!/bin/bash
SELF=$(readlink -f "$0")
HERE=$(dirname "$SELF")
exec "$HERE/usr/bin/Libertas" "$@"
""")
        os.chmod(apprun, 0o755)

        # 复制 config.yaml
        clean_cfg = self._sanitize_config(
            os.path.join(self.project_root, "config.yaml"), pkg_dir)
        if clean_cfg and os.path.isfile(clean_cfg):
            cfg_dest = os.path.join(appdir, "usr", "bin", "config.yaml")
            shutil.copy2(clean_cfg, cfg_dest)

        # 复制 assets
        assets_src = os.path.join(self.project_root, "assets")
        assets_dst = os.path.join(appdir, "usr", "bin", "assets")
        if os.path.isdir(assets_src):
            shutil.copytree(assets_src, assets_dst)

        # 尝试生成 AppImage（仅 Linux + appimagetool）
        appimage_path = os.path.join(pkg_dir, f"Libertas-{version}-x86_64.AppImage")
        appimagetool = shutil.which("appimagetool")
        if appimagetool and sys.platform.startswith("linux"):
            try:
                _cb = progress_cb or (lambda *a, **k: None)
                _cb(90, "正在创建 AppImage...")
                env = os.environ.copy()
                env["ARCH"] = "x86_64"
                r = subprocess.run(
                    [appimagetool, appdir, appimage_path],
                    cwd=pkg_dir, capture_output=True,
                    timeout=300, env=env)
                if r.returncode == 0 and os.path.isfile(appimage_path):
                    os.chmod(appimage_path, 0o755)
                    return appimage_path
            except Exception:
                pass

        # 非 Linux 或无 appimagetool：生成构建脚本
        build_sh = os.path.join(pkg_dir, "build_appimage.sh")
        with open(build_sh, "w", encoding="utf-8") as f:
            f.write("""#!/bin/bash
# Libertas AppImage 构建脚本
# 在 Linux 上运行: bash build_appimage.sh
set -e
cd "$(dirname "$0")"
if ! command -v appimagetool &>/dev/null; then
    echo "正在下载 appimagetool..."
    wget -c https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage -O appimagetool
    chmod +x appimagetool
fi
ARCH=x86_64 ./appimagetool Libertas.AppDir Libertas-{version}-x86_64.AppImage
echo "完成: Libertas-{version}-x86_64.AppImage"
""".replace("{version}", version))
        os.chmod(build_sh, 0o755)

        # 也尝试生成 .deb（在 Linux 上）
        if sys.platform.startswith("linux"):
            deb_path = self._create_linux_deb(bin_path, version, pkg_dir, icon_path)
            if deb_path:
                return deb_path

        return None

    def _create_linux_deb(self, bin_path: str, version: str,
                           pkg_dir: str, icon_path: str = None) -> Optional[str]:
        """创建 .deb 包（在 Linux 上）。"""
        try:
            deb_root = os.path.join(pkg_dir, "deb_pkg")
            if os.path.isdir(deb_root):
                shutil.rmtree(deb_root, ignore_errors=True)
            # Debian 包结构
            dirs = [
                "DEBIAN",
                "usr/bin",
                "usr/share/applications",
                "usr/share/icons/hicolor/256x256/apps",
                "usr/share/doc/libertas",
                "opt/libertas/assets",
            ]
            for d in dirs:
                os.makedirs(os.path.join(deb_root, d), exist_ok=True)

            # 控制文件
            with open(os.path.join(deb_root, "DEBIAN", "control"), "w", encoding="utf-8") as f:
                f.write(f"""Package: libertas
Version: {version}
Section: net
Priority: optional
Architecture: amd64
Maintainer: Libertas Community <community@libertas.local>
Description: AI Security Workstation
 Libertas is an AI-powered security workstation with
 network scanning, knowledge base, and collaboration.
Depends: libxcb-cursor0, libxkbcommon-x11-0, libfontconfig1, libgl1
""")

            # 二进制
            shutil.copy2(bin_path, os.path.join(deb_root, "opt", "libertas", "Libertas"))
            os.chmod(os.path.join(deb_root, "opt", "libertas", "Libertas"), 0o755)

            # 启动脚本
            with open(os.path.join(deb_root, "usr", "bin", "libertas"), "w", encoding="utf-8") as f:
                f.write("#!/bin/bash\nexec /opt/libertas/Libertas \"$@\"\n")
            os.chmod(os.path.join(deb_root, "usr", "bin", "libertas"), 0o755)

            # .desktop
            with open(os.path.join(deb_root, "usr", "share", "applications", "libertas.desktop"), "w", encoding="utf-8") as f:
                f.write("""[Desktop Entry]
Type=Application
Name=Libertas
Comment=AI Security Workstation
Exec=libertas
Icon=libertas
Categories=Development;Security;
Terminal=false
""")

            # 图标
            png_icon = icon_path or self._find_icon("linux")
            if png_icon and os.path.isfile(png_icon):
                from PIL import Image
                img = Image.open(png_icon)
                if img.size != (256, 256):
                    img = img.resize((256, 256), Image.LANCZOS)
                img.save(os.path.join(deb_root, "usr", "share", "icons",
                                      "hicolor", "256x256", "apps", "libertas.png"), "PNG")

            # config.yaml
            clean_cfg = self._sanitize_config(
                os.path.join(self.project_root, "config.yaml"), pkg_dir)
            if clean_cfg and os.path.isfile(clean_cfg):
                shutil.copy2(clean_cfg, os.path.join(deb_root, "opt", "libertas", "config.yaml"))

            # assets
            assets_src = os.path.join(self.project_root, "assets")
            if os.path.isdir(assets_src):
                assets_dst = os.path.join(deb_root, "opt", "libertas", "assets")
                if os.path.isdir(assets_dst):
                    shutil.rmtree(assets_dst)
                shutil.copytree(assets_src, assets_dst)

            # 构建 .deb
            deb_path = os.path.join(pkg_dir, f"libertas_{version}_amd64.deb")
            r = subprocess.run(
                ["dpkg-deb", "--build", deb_root, deb_path],
                capture_output=True, timeout=120)
            if r.returncode == 0 and os.path.isfile(deb_path):
                return deb_path
        except Exception:
            pass
        return None

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


class ReleaseMacInstallerMixin:
    """macOS 签名修正、pkg 安装包与 DMG 背景。"""

    def _fix_and_sign_macos_app(self, app_path: str):
        """非破坏性修复 Qt framework 路径并 ad-hoc 签名。
        不移动、不删除任何 framework 内的文件，只添加必要的符号链接。"""
        # 0. 修复 Info.plist，确保图标和 bundle 信息正确
        self._fix_info_plist(app_path)
    
        # 1. 为 QtWebEngineProcess 添加标准路径符号链接（不移动原文件）
        fw = os.path.join(
            app_path, "Contents", "Frameworks", "PySide6", "Qt", "lib",
            "QtWebEngineCore.framework"
        )
        if os.path.isdir(fw):
            versions = os.path.join(fw, "Versions")
            a_dir = os.path.join(versions, "A")
            a_helpers = os.path.join(a_dir, "Helpers")
            # PyInstaller 把 Helpers 放在 Versions/Resources/Helpers
            res_helpers = os.path.join(versions, "Resources", "Helpers")
    
            # 如果标准路径不存在但 PyInstaller 路径存在，创建符号链接
            if not os.path.exists(a_helpers) and os.path.isdir(res_helpers):
                os.symlink("../Resources/Helpers", a_helpers)
    
            # 确保根目录 Helpers 符号链接存在
            root_helpers = os.path.join(fw, "Helpers")
            if not os.path.exists(root_helpers):
                target = os.path.join(a_helpers)
                if os.path.exists(target):
                    os.symlink("Versions/Current/Helpers", root_helpers)
    
            # 先签名 QtWebEngineProcess.app（最内层）
            proc = os.path.join(res_helpers, "QtWebEngineProcess.app")
            if not os.path.isdir(proc):
                proc = os.path.join(a_helpers, "QtWebEngineProcess.app")
            if os.path.isdir(proc):
                subprocess.run(
                    ["codesign", "--force", "--sign", "-", "--no-strict", proc],
                    capture_output=True, timeout=60
                )
    
            # 签名 QtWebEngineCore framework
            subprocess.run(
                ["codesign", "--force", "--sign", "-", "--no-strict", fw],
                capture_output=True, timeout=60
            )
    
        # 2. 签名所有其他 .framework（按路径深度从内到外）
        frameworks_dir = os.path.join(app_path, "Contents", "Frameworks")
        if os.path.isdir(frameworks_dir):
            fw_list = []
            for root, dirs, files in os.walk(frameworks_dir):
                for d in dirs:
                    if d.endswith(".framework"):
                        fw_list.append(os.path.join(root, d))
            # 按路径深度排序，先签内层
            fw_list.sort(key=lambda p: p.count(os.sep), reverse=True)
            for fw_path in fw_list:
                if "QtWebEngineCore.framework" in fw_path:
                    continue  # 已签
                subprocess.run(
                    ["codesign", "--force", "--sign", "-", "--no-strict", fw_path],
                    capture_output=True, timeout=60
                )
    
        # 3. 签名所有 .app 子组件（如 Helper apps）
        for root, dirs, files in os.walk(os.path.join(app_path, "Contents")):
            for d in list(dirs):
                if d.endswith(".app") and root != os.path.dirname(app_path):
                    sub_app = os.path.join(root, d)
                    subprocess.run(
                        ["codesign", "--force", "--sign", "-", "--no-strict", sub_app],
                        capture_output=True, timeout=60
                    )
    
        # 4. 签名主 app bundle
        subprocess.run(
            ["codesign", "--force", "--sign", "-", "--no-strict", app_path],
            capture_output=True, timeout=120
        )
    
        # 5. 清除隔离属性
        subprocess.run(
            ["xattr", "-cr", app_path],
            capture_output=True, timeout=30
        )

        def _create_pkg_installer(self, app_path: str, pkg_path: str,
                                   name: str, version: str) -> bool:
            """创建标准 macOS .pkg 安装向导（欢迎 → 许可 → 选择磁盘 → 安装 → 完成）"""
            import tempfile
    
            staging = tempfile.mkdtemp(prefix="libertas_pkg_")
            try:
                res_dir = os.path.join(staging, "resources")
                os.makedirs(res_dir, exist_ok=True)
    
                # 欢迎页（HTML，原生支持 UTF-8）
                welcome_html = f"""<!DOCTYPE html>
    <html lang="zh-CN">
    <head><meta charset="utf-8"><style>
    body {{ font-family: -apple-system, "PingFang SC", sans-serif; padding: 20px 40px; color: #333; }}
    h1 {{ font-size: 22px; color: #4a2c7a; }}
    p {{ font-size: 14px; line-height: 1.8; }}
    </style></head>
    <body>
    <h1>欢迎使用 Libertas {version}</h1>
    <p>本安装向导将引导您完成 Libertas 的安装，过程大约需要 1-2 分钟。</p>
    <p>Libertas 是一个集成 AI 对话、网络安全工具箱、知识库与广域网协作的桌面应用。</p>
    <p>点击「继续」开始安装。</p>
    </body></html>"""
                with open(os.path.join(res_dir, "welcome.html"), "w", encoding="utf-8") as f:
                    f.write(welcome_html)
    
                # 许可协议（MPL 2.0）
                license_html = """<!DOCTYPE html>
    <html lang="zh-CN">
    <head><meta charset="utf-8"><style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; padding: 20px 40px; color: #333; }
    h1 { font-size: 20px; color: #4a2c7a; }
    h2 { font-size: 15px; margin-top: 18px; }
    p, li { font-size: 13px; line-height: 1.8; }
    </style></head>
    <body>
    <h1>Mozilla Public License 2.0 (MPL 2.0)</h1>
    <p>版权所有 (c) 2026 Libertas</p>
    <h2>您可以自由地：</h2>
    <ul>
    <li><b>使用</b> — 商业和非商业用途均可</li>
    <li><b>复制</b> — 任意分发</li>
    <li><b>修改</b> — 修改源代码</li>
    <li><b>合并与发布</b> — 与其他代码组合分发</li>
    </ul>
    <h2>必须遵守：</h2>
    <ul>
    <li><b>开源修改</b> — 对本项目源文件的修改必须以 MPL 2.0 开源</li>
    <li><b>保留许可声明</b> — 不得删除版权和许可声明</li>
    <li><b>标注修改</b> — 标注您做了哪些修改</li>
    </ul>
    <h2>不要求：</h2>
    <ul>
    <li>不要求整个作品开源（可以与专有代码组合）</li>
    <li>不要求您的修改回馈上游（但鼓励）</li>
    </ul>
    <h2>免责声明</h2>
    <p>本软件按「现状」提供，不附带任何担保。使用者需自行承担使用风险。</p>
    <p>本软件集成的网络安全工具仅可用于合法的安全测试与学习目的。</p>
    <p>完整许可证文本：<a href="https://mozilla.org/MPL/2.0/">https://mozilla.org/MPL/2.0/</a></p>
    </body></html>"""
                with open(os.path.join(res_dir, "license.html"), "w", encoding="utf-8") as f:
                    f.write(license_html)
    
                # 1. 创建 postinstall 脚本（安装后清除隔离属性）
                scripts_dir = os.path.join(staging, "scripts")
                os.makedirs(scripts_dir, exist_ok=True)
                postinstall = os.path.join(scripts_dir, "postinstall")
                with open(postinstall, "w", encoding="utf-8") as f:
                    f.write("""#!/bin/bash
    # 安装后清除隔离属性，刷新 Launch Services 和图标缓存
    APP_PATH="/Applications/Libertas.app"
    if [ -d "$APP_PATH" ]; then
        xattr -cr "$APP_PATH" 2>/dev/null
        # 重新注册应用
        /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_PATH" 2>/dev/null
        # 刷新图标缓存
        touch "$APP_PATH" 2>/dev/null
        # 清除 macOS 图标服务缓存
        rm -rf /Library/Caches/com.apple.iconservices.store 2>/dev/null
        rm -rf ~/Library/Caches/com.apple.iconservices.store 2>/dev/null
        # 重启 Dock 和 Finder 使新图标立即生效
        killall Dock 2>/dev/null
        killall Finder 2>/dev/null
        killall iconservicesd 2>/dev/null
    fi
    exit 0
    """)
                os.chmod(postinstall, 0o755)
    
                # 2. 创建干净的打包根目录（只包含 Libertas.app）
                pkg_root = os.path.join(staging, "root")
                os.makedirs(pkg_root, exist_ok=True)
                dest_app = os.path.join(pkg_root, "Libertas.app")
                if os.path.exists(dest_app):
                    shutil.rmtree(dest_app)
                shutil.copytree(app_path, dest_app, symlinks=True)
    
                # 3. pkgbuild 创建组件包
                component_pkg = os.path.join(staging, "component.pkg")
                r = subprocess.run(
                    ["pkgbuild", "--root", pkg_root,
                     "--scripts", scripts_dir,
                     "--identifier", "com.libertas.app",
                     "--version", version,
                     "--install-location", "/Applications",
                     component_pkg],
                    capture_output=True, timeout=120
                )
                if not os.path.isfile(component_pkg):
                    return False
    
                # 4. Distribution 定义
                dist_xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <installer-gui-script minSpecVersion="2">
        <title>Libertas {version}</title>
        <organization>com.libertas</organization>
        <welcome file="welcome.html"/>
        <license file="license.html"/>
        <options customize="never" require-scripts="true" rootVolumeOnly="true"/>
        <choices-outline>
            <line choice="default">
                <line choice="com.libertas.app"/>
            </line>
        </choices-outline>
        <choice id="default"/>
        <choice id="com.libertas.app" visible="false">
            <pkg-ref id="com.libertas.app"/>
        </choice>
        <pkg-ref id="com.libertas.app" version="{version}" onConclusion="none">component.pkg</pkg-ref>
    </installer-gui-script>"""
                dist_path = os.path.join(staging, "Distribution")
                with open(dist_path, "w", encoding="utf-8") as f:
                    f.write(dist_xml)
    
                # 5. productbuild 打包成产品安装档案
                r = subprocess.run(
                    ["productbuild",
                     "--distribution", dist_path,
                     "--resources", res_dir,
                     "--package-path", staging,
                     pkg_path],
                    capture_output=True, timeout=300
                )
                if r.returncode != 0:
                    # 回退：简单 productbuild
                    r2 = subprocess.run(
                        ["productbuild", "--package", component_pkg,
                         "--resources", res_dir, pkg_path],
                        capture_output=True, timeout=300
                    )
                    if r2.returncode != 0:
                        return False
    
                return os.path.isfile(pkg_path)
            finally:
                shutil.rmtree(staging, ignore_errors=True)

    def _make_dmg_background(self, path: str, name: str, version: str):
        """生成 DMG 安装背景图：左侧 app 位置 + 右侧 Applications + 中间箭头"""
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            return
    
        W, H = 540, 300
        img = Image.new("RGBA", (W, H), (245, 245, 248, 255))
        d = ImageDraw.Draw(img)
    
        # 顶部标题
        try:
            font_title = ImageFont.truetype(
                "/System/Library/Fonts/Helvetica.ttc", 22)
            font_sub = ImageFont.truetype(
                "/System/Library/Fonts/Helvetica.ttc", 13)
        except Exception:
            font_title = ImageFont.load_default()
            font_sub = ImageFont.load_default()
    
        title = f"Libertas {version}"
        bbox = d.textbbox((0, 0), title, font=font_title)
        tw = bbox[2] - bbox[0]
        d.text(((W - tw) / 2, 24), title, fill=(50, 50, 60), font=font_title)
    
        sub = "Drag to Applications to install"
        bbox2 = d.textbbox((0, 0), sub, font=font_sub)
        sw = bbox2[2] - bbox2[0]
        d.text(((W - sw) / 2, 56), sub, fill=(140, 140, 150), font=font_sub)
    
        # 中间箭头
        ax, ay = W // 2, 175
        d.line([(ax - 40, ay), (ax + 40, ay)], fill=(180, 180, 190), width=3)
        d.polygon([(ax + 40, ay), (ax + 28, ay - 8), (ax + 28, ay + 8)],
                  fill=(180, 180, 190))
    
        img.save(path, "PNG")

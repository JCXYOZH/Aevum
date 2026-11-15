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


class ReleasePyInstallerMixin:
    """PyInstaller 构建与 macOS Info.plist 修正。"""

    def _build_with_pyinstaller(self, pyinstaller: str, entry: str,
                                 plat: str, version: str, pkg_dir: str,
                                 custom_icon: str = None, progress_cb=None,
                                 hidden_imports: List[str] = None,
                                 collect_all: List[str] = None,
                                 excludes: List[str] = None) -> Dict:
        """使用 PyInstaller 构建独立可执行文件
    
        excludes: --exclude-module 清单。为空时行为与历史版本完全一致。
        """
        def _cb(pct, step):
            if progress_cb:
                try:
                    progress_cb(pct, step)
                except Exception:
                    pass
        dist_dir = os.path.join(pkg_dir, "dist")
        build_dir = os.path.join(pkg_dir, "build")
        app_name = "Libertas"
        name = f"Libertas_{version}_{plat}"
        icon = custom_icon if custom_icon and os.path.isfile(custom_icon) else self._find_icon(plat)
    
        cmd = [
            pyinstaller,
            "--noconfirm",
            "--clean",
            "--name", app_name,
            "--distpath", dist_dir,
            "--workpath", build_dir,
            "--specpath", pkg_dir,
        ]
    
        # 平台特定选项
        if plat == "windows":
            # onedir模式：启动快（不用每次解压3.6GB），产物是文件夹
            cmd.append("--windowed")
            if icon and icon.endswith(".ico"):
                cmd.extend(["--icon", icon])
        elif plat == "macos":
            cmd.append("--windowed")
            cmd.extend(["--osx-bundle-identifier", "com.libertas.app"])
            if icon and icon.endswith(".icns"):
                cmd.extend(["--icon", icon])
        elif plat == "linux":
            cmd.append("--onefile")
    
        # 收集数据文件（templates/static 在 interfaces 下，plugins 在 libertas 下）
        data_dirs = [
            ("interfaces/templates", "libertas/interfaces/templates"),
            ("interfaces/static", "libertas/interfaces/static"),
            ("plugins", "libertas/plugins"),
        ]
        for src_rel, dst_rel in data_dirs:
            src = os.path.join(self.project_root, "libertas", src_rel)
            if os.path.isdir(src):
                cmd.extend(["--add-data", f"{src}{os.pathsep}{dst_rel}"])
    
        # config/ 目录（dork_templates.yaml、protected_terms.txt 等运行时数据）
        config_dir = os.path.join(self.project_root, "config")
        if os.path.isdir(config_dir):
            cmd.extend(["--add-data", f"{config_dir}{os.pathsep}config"])
    
        # assets/ 目录（应用图标等）
        assets_dir = os.path.join(self.project_root, "assets")
        if os.path.isdir(assets_dir):
            cmd.extend(["--add-data", f"{assets_dir}{os.pathsep}assets"])
    
        # 打包默认 config.yaml 到 bundle 根目录（清理个人配置）
        config_src = os.path.join(self.project_root, "config.yaml")
        clean_config = self._sanitize_config(config_src, pkg_dir)
        if clean_config:
            cmd.extend(["--add-data", f"{clean_config}{os.pathsep}."])
    
        # 依赖：使用自动识别的 + 必需的兜底
        # 排除清单：minimal 档裁剪用；为空则以下逻辑与历史版本完全一致
        _excludes = list(excludes or [])
        _excl_lower = {str(e).lower() for e in _excludes}
    
        def _keep(name: str) -> bool:
            """被排除的包不得再以任何形式加回命令行。
    
            复用 _is_excluded 的方向性规则：排除子模块不影响父包，
            否则排除 PIL._tkinter_finder 会连带丢掉 PIL（16 处顶层硬 import）。
            """
            return not self._is_excluded(name, _excl_lower)
    
        # collect-all 包（含数据文件/动态加载的包）
        default_collect = {"snownlp", "pypinyin", "jieba", "certifi", "charset_normalizer"}
        if plat == "macos":
            default_collect.add("PySide6")
        collect_set = {p for p in (set(collect_all or []) | default_collect) if _keep(p)}
        for pkg in sorted(collect_set):
            cmd.extend(["--collect-all", pkg])
    
        # 隐藏导入：自动识别 + 必需的兜底
        default_hidden = {
            "PySide6", "PySide6.QtCore", "PySide6.QtWidgets",
            "PySide6.QtGui", "PySide6.QtWebEngineWidgets",
            "PySide6.QtWebChannel", "PySide6.QtNetwork",
            "flask", "requests", "yaml", "paho.mqtt.client",
            "snownlp", "pypinyin", "jieba", "cryptography",
            "paramiko", "bcrypt", "jwt", "PIL", "numpy",
        }
        hidden_set = {m for m in (set(hidden_imports or []) | default_hidden) if _keep(m)}
        for mod in sorted(hidden_set):
            cmd.extend(["--hidden-import", mod])
    
        # 真正的减法：PyInstaller 只有 --exclude-module 能阻止模块进包。
        # 上面的 hidden/collect 是「提醒分析器别漏」，取消它们并不等于排除。
        for mod in sorted(set(_excludes)):
            cmd.extend(["--exclude-module", mod])
    
        cmd.append(entry)
    
        _cb(25, "PyInstaller 正在分析依赖...")
        try:
            # 清理旧 spec 文件避免冲突
            for old_spec in glob.glob(os.path.join(pkg_dir, "*.spec")):
                try:
                    os.remove(old_spec)
                except Exception:
                    pass
            _cb(30, "PyInstaller 正在编译打包（这可能需要几分钟）...")
            proc = subprocess.Popen(
                cmd, cwd=self.project_root,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding='utf-8', errors='replace')
            self._build_subprocess = proc
            stdout, stderr = proc.communicate(timeout=3600)
            self._build_subprocess = None
    
            class _Result:
                pass
            result = _Result()
            result.returncode = proc.returncode
            result.stdout = stdout
            result.stderr = stderr
            _cb(70, "PyInstaller 编译完成，正在收集产物...")
            if result.returncode != 0:
                # PyInstaller 失败，回退到 zip
                return self._build_update_zip(plat, version, pkg_dir)
        except Exception:
            # 超时或异常时，强制终止PyInstaller子进程，避免后台继续运行占用文件句柄
            _proc = self._build_subprocess
            if _proc and _proc.poll() is None:
                try:
                    _proc.kill()
                    _proc.wait(timeout=3)
                except Exception:
                    pass
            self._build_subprocess = None
            return self._build_update_zip(plat, version, pkg_dir)
    
        # 查找构建产物
        _cb(78, "正在打包安装文件...")
        if plat == "macos":
            app_path = os.path.join(dist_dir, f"{app_name}.app")
            if not os.path.isdir(app_path):
                return self._build_update_zip(plat, version, pkg_dir, progress_cb=_cb)
    
            # 生成标准名称的 ICNS 并同步 plist，避免 Finder 找不到 bundle 图标。
            try:
                res_dir = os.path.join(app_path, "Contents", "Resources")
                os.makedirs(res_dir, exist_ok=True)
                dst_icns = os.path.join(res_dir, "icon.icns")
                raster_icon = (
                    custom_icon
                    if custom_icon and os.path.isfile(custom_icon)
                    and os.path.splitext(custom_icon)[1].lower() in (".png", ".jpg", ".jpeg", ".webp")
                    else os.path.join(self.project_root, "assets", "icon.png")
                )
                generated_icns = os.path.join(res_dir, "icon-generated.icns")
                generated = False
                if os.path.isfile(raster_icon):
                    from PIL import Image
                    with Image.open(raster_icon) as image:
                        generated = self._make_icns(image, generated_icns)
                if generated and os.path.isfile(generated_icns):
                    os.replace(generated_icns, dst_icns)
                else:
                    if os.path.isfile(generated_icns):
                        os.remove(generated_icns)
                    src_icns = (
                        custom_icon
                        if custom_icon and custom_icon.lower().endswith(".icns")
                        else os.path.join(self.project_root, "assets", "icon.icns")
                    )
                    if os.path.isfile(src_icns):
                        shutil.copy2(src_icns, dst_icns)
                if os.path.isfile(dst_icns):
                    shutil.copy2(dst_icns, os.path.join(res_dir, "icon-windowed.icns"))
            except Exception:
                pass
            self._fix_info_plist(app_path)
    
            # 修复 QtWebEngineCore framework 结构并签名
            if shutil.which("codesign"):
                _cb(80, "正在签名应用...")
                try:
                    self._fix_and_sign_macos_app(app_path)
                except Exception:
                    pass
    
            # 清理旧安装包
            dmg_path = os.path.join(pkg_dir, f"{name}.dmg")
            pkg_path = os.path.join(pkg_dir, f"{name}.pkg")
            old_zip = os.path.join(pkg_dir, f"{name}.zip")
            for old in (dmg_path, pkg_path, old_zip):
                if os.path.isfile(old):
                    os.remove(old)
    
            # 主要产物：.pkg 安装向导
            _cb(88, "正在创建 .pkg 安装包...")
            pkg_ok = False
            if shutil.which("pkgbuild") and shutil.which("productbuild"):
                try:
                    pkg_ok = self._create_pkg_installer(
                        app_path, pkg_path, name, version)
                except Exception:
                    pkg_ok = False
    
            if pkg_ok and os.path.isfile(pkg_path):
                # .pkg 成功，清理临时构建目录（保留 dist 供直接使用）
                _cb(96, "正在清理临时文件...")
                shutil.rmtree(build_dir, ignore_errors=True)
                for spec in glob.glob(os.path.join(pkg_dir, "*.spec")):
                    try:
                        os.remove(spec)
                    except Exception:
                        pass
                _cb(100, "构建完成")
                return self._finalize_package(pkg_path, plat, version, "pyinstaller")
    
            # 回退：DMG
            if shutil.which("hdiutil"):
                try:
                    _cb(88, "正在创建 DMG...")
                    import tempfile
                    dmg_stage = tempfile.mkdtemp(prefix="libertas_dmg_")
                    try:
                        shutil.copytree(app_path,
                            os.path.join(dmg_stage, "Libertas.app"),
                            symlinks=True)
                        subprocess.run(
                            ["hdiutil", "create", "-volname", f"Libertas {version}",
                             "-srcfolder", dmg_stage, "-ov",
                             "-format", "UDZO", dmg_path],
                            capture_output=True, timeout=600
                        )
                    finally:
                        shutil.rmtree(dmg_stage, ignore_errors=True)
                    if os.path.isfile(dmg_path):
                        shutil.rmtree(build_dir, ignore_errors=True)
                        _cb(100, "构建完成")
                        return self._finalize_package(dmg_path, plat, version, "pyinstaller")
                except Exception:
                    if os.path.isfile(dmg_path):
                        os.remove(dmg_path)
    
            # 最后回退：zip .app（保留 dist 供直接使用）
            _cb(88, "正在压缩 .app 为 ZIP...")
            zip_path = os.path.join(pkg_dir, f"{name}.zip")
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for root, dirs, files in os.walk(app_path):
                    for f in files:
                        full = os.path.join(root, f)
                        arc = os.path.relpath(full, dist_dir)
                        zf.write(full, arc)
            _cb(100, "构建完成")
            return self._finalize_package(zip_path, plat, version, "pyinstaller")
        else:
            # Windows / Linux：找到 PyInstaller 产物并创建正经安装包
            # onedir模式：先找子文件夹，再找里面的exe
            exe_path = None
            app_dir = None
            for f in os.listdir(dist_dir):
                full = os.path.join(dist_dir, f)
                if os.path.isdir(full):
                    # onedir模式：文件夹里有exe
                    for sub in os.listdir(full):
                        if sub.endswith(".exe") and os.path.isfile(os.path.join(full, sub)):
                            exe_path = os.path.join(full, sub)
                            app_dir = full
                            break
                elif os.path.isfile(full) and (f.endswith(".exe") or os.access(full, os.X_OK)):
                    # onefile模式：直接是exe
                    exe_path = full
                    app_dir = dist_dir
                if exe_path:
                    break
            if not exe_path:
                # 没找到可执行文件，回退到zip
                return self._build_update_zip(plat, version, pkg_dir, progress_cb=_cb)
            full = exe_path
            # 找到可执行文件，创建安装包
            if plat == "windows":
                _cb(85, "正在创建 Windows 安装包...")
                installer = self._create_windows_installer(
                    full, version, pkg_dir,
                    icon_path=custom_icon if custom_icon and os.path.isfile(custom_icon) else None,
                    progress_cb=_cb)
                if installer and os.path.isfile(installer):
                    _cb(96, "正在清理临时文件...")
                    shutil.rmtree(build_dir, ignore_errors=True)
                    # 清理onedir模式的临时stage目录
                    stage_dir = os.path.join(pkg_dir, "_app_stage")
                    if os.path.isdir(stage_dir):
                        shutil.rmtree(stage_dir, ignore_errors=True)
                    for spec in glob.glob(os.path.join(pkg_dir, "*.spec")):
                        try: os.remove(spec)
                        except Exception: pass
                    _cb(100, "构建完成")
                    return self._finalize_package(installer, plat, version, "inno_setup")
                # ISCC 不可用，回退到便携 exe
                _cb(92, "Inno Setup 不可用，输出便携版...")
                return self._finalize_package(full, plat, version, "portable_exe")
            elif plat == "linux":
                _cb(85, "正在创建 Linux 安装包...")
                installer = self._create_linux_appimage(
                    full, version, pkg_dir,
                    icon_path=custom_icon if custom_icon and os.path.isfile(custom_icon) else None,
                    progress_cb=_cb)
                if installer and os.path.isfile(installer):
                    _cb(96, "正在清理临时文件...")
                    shutil.rmtree(build_dir, ignore_errors=True)
                    for spec in glob.glob(os.path.join(pkg_dir, "*.spec")):
                        try: os.remove(spec)
                        except Exception: pass
                    _cb(100, "构建完成")
                    btype = "appimage" if installer.endswith(".AppImage") else "deb"
                    return self._finalize_package(installer, plat, version, btype)
                # appimagetool 不可用，回退到便携二进制
                _cb(92, "appimagetool 不可用，输出便携版...")
                return self._finalize_package(full, plat, version, "portable_bin")
            else:
                _cb(92, "正在计算校验和...")
                return self._finalize_package(full, plat, version, "pyinstaller")
    
        return self._build_update_zip(plat, version, pkg_dir, progress_cb=_cb)

    def _fix_info_plist(self, app_path: str):
        """修复 Info.plist，确保图标正确显示、bundle 类型正确。"""
        plist_path = os.path.join(app_path, "Contents", "Info.plist")
        if not os.path.isfile(plist_path):
            return
        try:
            import plistlib
            with open(plist_path, "rb") as f:
                plist = plistlib.load(f)
    
            # 确保 bundle 类型为 APPL
            plist["CFBundlePackageType"] = "APPL"
            plist["CFBundleSignature"] = "????"
    
            # 图标配置：CFBundleIconFile 不带扩展名（独立 .icns 文件方式）
            icon_file = "icon"
            plist["CFBundleIconFile"] = icon_file
            # 不设置 CFBundleIconName：该键用于 Asset Catalog，
            # 在 PyInstaller 独立 .icns 包中会导致 macOS 忽略 .icns 文件、
            # 显示带透明边框的默认图标。
            plist.pop("CFBundleIconName", None)
    
            # 显示名称
            plist["CFBundleName"] = "Libertas"
            plist["CFBundleDisplayName"] = "Libertas"
    
            # 高分辨率支持（Retina）
            plist["NSHighResolutionCapable"] = True
    
            # 最低系统版本
            if "LSMinimumSystemVersion" not in plist:
                plist["LSMinimumSystemVersion"] = "10.13"
    
            # 确保图标文件存在
            resources = os.path.join(app_path, "Contents", "Resources")
            icns_name = icon_file + ".icns"
            icns_src = os.path.join(resources, icns_name)
            if not os.path.isfile(icns_src):
                # PyInstaller 可能命名为 icon-windowed.icns
                alt = os.path.join(resources, "icon-windowed.icns")
                if os.path.isfile(alt):
                    shutil.copy2(alt, icns_src)
                else:
                    # 从项目 assets 复制
                    project_icon = os.path.join(
                        self.project_root, "assets", "icon.icns")
                    if os.path.isfile(project_icon):
                        shutil.copy2(project_icon, icns_src)
    
            with open(plist_path, "wb") as f:
                plistlib.dump(plist, f)
        except Exception:
            pass

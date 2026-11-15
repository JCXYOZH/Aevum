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


class ReleaseWindowsInstallerMixin:
    """Windows 安装包生成。"""

    def _create_windows_installer(self, exe_path: str, version: str,
                                   pkg_dir: str, icon_path: str = None,
                                   progress_cb=None) -> Optional[str]:
        """创建 Windows Inno Setup 安装包。

        在 Windows 上且安装了 Inno Setup (ISCC) 时直接编译；
        在其他平台上生成 .iss 脚本和构建说明，放到产物目录。
        支持 onedir 模式（exe 在子文件夹里，打包整个文件夹）。
        """
        name = f"Libertas_{version}_windows"
        setup_exe = os.path.join(pkg_dir, f"{name}_Setup.exe")
        iss_path = os.path.join(pkg_dir, f"{name}.iss")

        # 选择图标
        ico = icon_path or self._find_icon("windows") or ""
        if ico and not ico.lower().endswith(".ico"):
            ico = ""

        # 判断是 onedir 还是 onefile
        # onedir: exe 在 dist/Libertas/Libertas.exe，app_dir 是 dist/Libertas
        # onefile: exe 在 dist/Libertas.exe，app_dir 是 dist
        app_dir = os.path.dirname(exe_path)
        exe_name = os.path.basename(exe_path)
        # 如果 app_dir 的名字和 exe 去掉扩展名的名字一样，说明是 onedir 模式
        is_onedir = os.path.basename(app_dir).lower() == exe_name.replace(".exe", "").lower()

        # onedir 模式：把整个 app_dir 复制到 pkg_dir 的临时子目录
        if is_onedir:
            stage_dir = os.path.join(pkg_dir, "_app_stage")
            if os.path.isdir(stage_dir):
                shutil.rmtree(stage_dir, ignore_errors=True)
            shutil.copytree(app_dir, stage_dir)
            files_source = "_app_stage\\*"
        else:
            files_source = exe_name

        iss_content = f"""#define MyAppName "Libertas"
#define MyAppVersion "{version}"
#define MyAppPublisher "Libertas Community"
#define MyAppExeName "Libertas.exe"
#define MyAppURL "https://github.com/libertas/libertas"

[Setup]
AppId=LIBERTAS-2024-0001
AppName={{#MyAppName}}
AppVersion={{#MyAppVersion}}
AppPublisher={{#MyAppPublisher}}
AppPublisherURL={{#MyAppURL}}
DefaultDirName={{autopf}}\\{{#MyAppName}}
DefaultGroupName={{#MyAppName}}
AllowNoIcons=yes
LicenseFile=LICENSE
OutputDir=.
OutputBaseFilename={name}_Setup
SetupIconFile={ico if ico else 'icon.ico'}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
UninstallDisplayIcon={{app}}\\{{#MyAppExeName}}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{{cm:CreateDesktopIcon}}"; GroupDescription: "{{cm:AdditionalIcons}}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{{cm:CreateQuickLaunchIcon}}"; GroupDescription: "{{cm:AdditionalIcons}}"; Flags: unchecked

[Files]
Source: "{files_source}"; DestDir: "{{app}}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "config.yaml"; DestDir: "{{app}}"; Flags: ignoreversion onlyifdoesntexist
Source: "assets\\*"; DestDir: "{{app}}\\assets"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: DirExists(ExpandConstant('{{src}}\\assets'))

[Icons]
Name: "{{group}}\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"
Name: "{{group}}\\{{cm:UninstallProgram,{{#MyAppName}}}}"; Filename: "{{uninstallexe}}"
Name: "{{autodesktop}}\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"; Tasks: desktopicon
Name: "{{userappdata}}\\Microsoft\\Internet Explorer\\Quick Launch\\{{#MyAppName}}"; Filename: "{{app}}\\{{#MyAppExeName}}"; Tasks: quicklaunchicon

[Run]
Filename: "{{app}}\\{{#MyAppExeName}}"; Description: "{{cm:LaunchProgram,{{#MyAppName}}}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{{app}}"
"""
        # 写入 .iss 脚本
        with open(iss_path, "w", encoding="utf-8-sig") as f:
            f.write(iss_content)

        # 复制 LICENSE 和 config.yaml 到 pkg_dir（如果存在）
        for fname in ("LICENSE",):
            src = os.path.join(self.project_root, fname)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(pkg_dir, fname))
        clean_cfg = self._sanitize_config(
            os.path.join(self.project_root, "config.yaml"), pkg_dir)
        if clean_cfg and os.path.isfile(clean_cfg):
            dest_cfg = os.path.join(pkg_dir, "config.yaml")
            if os.path.abspath(clean_cfg) != os.path.abspath(dest_cfg):
                shutil.copy2(clean_cfg, dest_cfg)

        # 复制 assets 目录（图标等）
        assets_src = os.path.join(self.project_root, "assets")
        assets_dst = os.path.join(pkg_dir, "assets")
        if os.path.isdir(assets_src):
            if os.path.isdir(assets_dst):
                shutil.rmtree(assets_dst, ignore_errors=True)
            shutil.copytree(assets_src, assets_dst)

        # 复制 icon.ico 到 pkg_dir 根目录（供 SetupIconFile 使用）
        if ico and os.path.isfile(ico):
            shutil.copy2(ico, os.path.join(pkg_dir, "icon.ico"))

        # onedir模式：exe 在 _app_stage 里，不需要单独复制
        # onefile模式：复制 exe 到 pkg_dir（ISCC 需要 exe 和 .iss 在同一目录）
        if not is_onedir:
            exe_dst = os.path.join(pkg_dir, os.path.basename(exe_path))
            if os.path.abspath(exe_path) != os.path.abspath(exe_dst):
                shutil.copy2(exe_path, exe_dst)

        # 尝试编译（仅 Windows + ISCC）
        # 不依赖系统PATH，自动搜索常见安装路径
        iscc = shutil.which("iscc") or shutil.which("ISCC")
        if not iscc and sys.platform == "win32":
            import glob as _glob
            _candidates = []
            for _drive in 'CDEFGHIJKLMNOPQRSTUVWXYZ':
                _candidates += _glob.glob(f'{_drive}:\\*Inno Setup*\\ISCC.exe')
                _candidates += _glob.glob(f'{_drive}:\\Program Files*\\*Inno Setup*\\ISCC.exe')
            if _candidates:
                iscc = _candidates[0]
                # 临时加入当前进程PATH
                os.environ["PATH"] = os.path.dirname(iscc) + os.pathsep + os.environ.get("PATH", "")

        if iscc and os.path.isfile(iscc):
            try:
                if progress_cb:
                    progress_cb(88, "正在编译 Inno Setup 安装包...")
                result = subprocess.run(
                    [iscc, iss_path],
                    cwd=pkg_dir,
                    capture_output=True, text=True, timeout=3600,
                    encoding='utf-8', errors='replace'
                )
                if result.returncode == 0 and os.path.isfile(setup_exe):
                    # 编译成功，清理临时stage目录
                    stage_dir = os.path.join(pkg_dir, "_app_stage")
                    if os.path.isdir(stage_dir):
                        shutil.rmtree(stage_dir, ignore_errors=True)
                    return setup_exe
                else:
                    # 编译失败，打印错误信息
                    print(f"[ISCC] 编译失败 returncode={result.returncode}")
                    if result.stdout:
                        print(f"[ISCC] stdout: {result.stdout[-500:]}")
                    if result.stderr:
                        print(f"[ISCC] stderr: {result.stderr[-500:]}")
            except subprocess.TimeoutExpired:
                print("[ISCC] 编译超时（1小时）")
            except Exception as e:
                print(f"[ISCC] 编译异常: {e}")

        # ISCC 不可用或编译失败，生成说明文件
        readme = os.path.join(pkg_dir, "BUILD_WINDOWS.txt")
        with open(readme, "w", encoding="utf-8") as f:
            f.write(f"""Libertas {version} Windows 构建说明
=====================================

已生成:
- {exe_name}: 可执行文件（{'onedir模式' if is_onedir else 'onefile模式'}）
- {name}.iss: Inno Setup 安装脚本

如需生成安装包，请安装 Inno Setup 后运行:
    iscc {name}.iss

安装包将生成: {name}_Setup.exe
""")
        return readme

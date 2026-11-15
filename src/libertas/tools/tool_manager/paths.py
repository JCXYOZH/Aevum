"""
工具管理器

管理工具的生命周期：发现、注册、初始化、启用、调用、禁用、卸载。
支持依赖管理、配置、状态监控、分组、导入导出。
"""
import os
import json
import time
import uuid
import importlib
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.utils.text_decode import decode_output, describe_exception

from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus


class ToolPathMixin:
    """工具路径解析、常见目录与可执行扩展名。"""

    def _resolve_tool_path(self, tool_name: str) -> str:
        """解析工具的可执行文件路径（跨平台通用）
    
        查找顺序：
        1. config.yaml中配置的<tool_name>_path
        2. 系统PATH
        3. 常见安装目录（跨平台）
        """
        import shutil as _shutil
    
        # 1. 从config.yaml中查找<tool_name>_path配置
        try:
            from libertas.core.config import get_config
            config = get_config()
            path_key = f"{tool_name}_path"
            configured_path = config.get(path_key)
            if configured_path and os.path.isfile(configured_path):
                return configured_path
        except Exception:
            pass
    
        # 2. 系统PATH（已经在调用前检查过，这里作为兜底）
        system_path = _shutil.which(tool_name)
        if system_path:
            return system_path
    
        # 3. 常见安装目录（跨平台，不写死具体路径）
        search_dirs = self._get_common_tool_dirs()
        exe_exts = self._get_executable_extensions()
    
        for search_dir in search_dirs:
            if not os.path.isdir(search_dir):
                continue
            # 直接在目录中查找
            for ext in exe_exts:
                candidate = os.path.join(search_dir, tool_name + ext)
                if os.path.isfile(candidate):
                    return candidate
            # 递归查找一层子目录
            try:
                for item in os.listdir(search_dir):
                    item_path = os.path.join(search_dir, item)
                    if os.path.isdir(item_path):
                        for ext in exe_exts:
                            candidate = os.path.join(item_path, tool_name + ext)
                            if os.path.isfile(candidate):
                                return candidate
            except Exception:
                pass
    
        return None

    def _get_common_tool_dirs(self) -> list:
        """获取常见的工具安装目录（跨平台），包含pip和go工具目录"""
        import sys as _sys
        dirs = []
    
        if _sys.platform == 'win32':
            # Windows常见安装目录
            base_dirs = [
                os.environ.get('PROGRAMFILES', r'C:\Program Files'),
                os.environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'),
                os.environ.get('LOCALAPPDATA', r'C:\Users\Administrator\AppData\Local'),
            ]
            for env_name in ('AEVUM_TOOLS_DIR', 'AEVUM_SECURITY_DIR', 'AEVUM_CYBERSECURITY_DIR'):
                custom_dir = os.environ.get(env_name)
                if custom_dir:
                    base_dirs.append(custom_dir)
            # pip工具目录（检测多个可能的位置）
            pip_dirs_to_check = []
            # 1. 当前Python环境的Scripts目录
            try:
                import sys as _pip_sys
                pip_scripts = os.path.join(_pip_sys.prefix, 'Scripts')
                pip_dirs_to_check.append(pip_scripts)
            except Exception:
                pass
            # 2. 常见的虚拟环境位置
            common_venvs = [
                r'D:\venv\Scripts',
                r'D:\backend\venv\Scripts',
                r'C:\venv\Scripts',
                os.path.join(os.path.expanduser('~'), 'venv', 'Scripts'),
                os.path.join(os.path.expanduser('~'), '.venv', 'Scripts'),
            ]
            pip_dirs_to_check.extend(common_venvs)
            # 3. 用户级pip工具目录
            user_pip_scripts = os.path.join(os.environ.get('APPDATA', ''), 'Python', 'Scripts')
            pip_dirs_to_check.append(user_pip_scripts)
            # 添加存在的目录
            for d in pip_dirs_to_check:
                if os.path.isdir(d) and d not in base_dirs:
                    base_dirs.append(d)
            # go工具目录
            go_bin = os.path.join(os.path.expanduser('~'), 'go', 'bin')
            if os.path.isdir(go_bin) and go_bin not in base_dirs:
                base_dirs.append(go_bin)
        elif _sys.platform == 'darwin':
            # macOS常见安装目录
            base_dirs = [
                '/usr/local/bin',
                '/opt/homebrew/bin',
                '/Applications',
                os.path.expanduser('~/Applications'),
                os.path.expanduser('~/tools'),
                os.path.expanduser('~/security'),
            ]
            # pip工具目录
            local_bin = os.path.expanduser('~/.local/bin')
            if os.path.isdir(local_bin) and local_bin not in base_dirs:
                base_dirs.append(local_bin)
            # go工具目录
            go_bin = os.path.join(os.path.expanduser('~'), 'go', 'bin')
            if os.path.isdir(go_bin) and go_bin not in base_dirs:
                base_dirs.append(go_bin)
        else:
            # Linux（含Kali）常见安装目录
            base_dirs = [
                # 标准系统路径（Kali预装600+工具主要在这里）
                '/usr/local/sbin',
                '/usr/local/bin',
                '/usr/sbin',
                '/usr/bin',
                '/sbin',
                '/bin',
                # /opt目录（第三方工具）
                '/opt',
                '/opt/metasploit-framework',
                '/opt/burpsuite',
                '/opt/zaproxy',
                '/opt/wireshark',
                # 用户目录
                os.path.expanduser('~/tools'),
                os.path.expanduser('~/security'),
                os.path.expanduser('~/.local/bin'),
            ]
            # Kali特有的工具目录（/usr/share/下的工具）
            kali_share_dirs = [
                '/usr/share/exploitdb',
                '/usr/share/wordlists',
                '/usr/share/seclists',
                '/usr/share/metasploit-framework',
                '/usr/share/nmap',
                '/usr/share/sqlmap',
                '/usr/share/wireshark',
                '/usr/share/zaproxy',
                '/usr/share/dirbuster',
                '/usr/share/hydra',
                '/usr/share/john',
                '/usr/share/hashcat',
                '/usr/share/aircrack-ng',
                '/usr/share/recon-ng',
                '/usr/share/theharvester',
                '/usr/share/amass',
                '/usr/share/dirsearch',
                '/usr/share/nikto',
                '/usr/share/wpscan',
                '/usr/share/wfuzz',
                '/usr/share/ffuf',
                '/usr/share/gobuster',
                '/usr/share/subfinder',
                '/usr/share/assetfinder',
                '/usr/share/httpx',
                '/usr/share/nuclei',
                '/usr/share/naabu',
                '/usr/share/masscan',
                '/usr/share/ettercap',
                '/usr/share/bettercap',
                '/usr/share/mitmproxy',
                '/usr/share/snort',
                '/usr/share/suricata',
                '/usr/share/zeek',
                '/usr/share/tcpdump',
                '/usr/share/wireshark',
                '/usr/share/radare2',
                '/usr/share/gdb',
                '/usr/share/binwalk',
                '/usr/share/foremost',
                '/usr/share/scalpel',
                '/usr/share/testdisk',
                '/usr/share/photorec',
                '/usr/share/volatility',
                '/usr/share/autopsy',
                '/usr/share/sleuthkit',
                '/usr/share/bulk-extractor',
                '/usr/share/guymager',
                '/usr/share/caine',
            ]
            for d in kali_share_dirs:
                if os.path.isdir(d) and d not in base_dirs:
                    base_dirs.append(d)
            # go工具目录
            go_bin = os.path.join(os.path.expanduser('~'), 'go', 'bin')
            if os.path.isdir(go_bin) and go_bin not in base_dirs:
                base_dirs.append(go_bin)
    
        # 添加用户配置的发现路径
        for path in getattr(self, '_discovery_paths', []):
            if path not in base_dirs:
                base_dirs.append(path)
    
        return base_dirs

    def _get_executable_extensions(self) -> list:
        """获取可执行文件扩展名（跨平台）"""
        import sys as _sys
        if _sys.platform == 'win32':
            return ['.exe', '.bat', '.cmd', '.py', '']
        else:
            return ['', '.py', '.sh']

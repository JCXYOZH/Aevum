"""
网络安全工具安装管理器
- 检测工具是否已安装
- 提供各平台安装命令
- 执行安装（需用户授权）
- 安装验证
"""
import os
import shutil
import platform
import subprocess
import urllib.request
import urllib.error
import ssl
import time
from typing import Dict, List, Optional
from libertas.foundation.config import get_data_dir

from .constants import *
from .registry_data import TOOL_REGISTRY
from .wordlists_data import WORDLIST_REGISTRY


def scan_system_tools() -> Dict:
    """扫描系统环境，自动发现已安装的安全工具和字典。

    返回:
        {
            "installed_in_registry": [...],  # 注册表中已安装的工具
            "discovered_tools": [...],       # 系统中发现但不在注册表的工具
            "wordlist_dirs": [...],         # 发现的字典目录
            "wordlist_files": [...],        # 发现的字典文件
            "summary": {...}
        }
    """
    import glob as _glob

    # 1. 检查注册表中的工具
    registry_status = check_all_tools()
    installed_in_registry = [t for t in registry_status if t["installed"]]

    # 2. 扫描 PATH 中已知但不在注册表的工具
    discovered = []
    registry_names = set(TOOL_REGISTRY.keys())
    for cmd in sorted(KNOWN_SECURITY_CMDS):
        if cmd in registry_names:
            continue
        path = shutil.which(cmd)
        if path:
            version = ""
            try:
                result = subprocess.run(
                    [cmd, "--version"], capture_output=True, timeout=3
                )
                version = safe_decode(result.stdout or result.stderr).strip().split("\n")[0][:80]
            except Exception:
                try:
                    result = subprocess.run(
                        [cmd, "-version"], capture_output=True, timeout=3
                    )
                    version = safe_decode(result.stdout or result.stderr).strip().split("\n")[0][:80]
                except Exception:
                    version = "已安装"
            discovered.append({
                "name": cmd,
                "path": path,
                "version": version,
            })

    # 3. 扫描常见字典目录
    wordlist_dirs = []
    wordlist_files = []
    home = os.path.expanduser("~")
    for d in KNOWN_WORDLIST_DIRS:
        d = os.path.expanduser(d)
        if os.path.isdir(d):
            wordlist_dirs.append(d)
            # 统计目录中的字典文件
            for root, _dirs, files in os.walk(d):
                for f in files:
                    if f.endswith((".txt", ".lst", ".dic", ".wordlist", ".csv")):
                        fp = os.path.join(root, f)
                        try:
                            sz = os.path.getsize(fp)
                            wordlist_files.append({
                                "name": f,
                                "path": fp,
                                "relative": os.path.relpath(fp, d),
                                "size": sz,
                                "size_str": format_size(sz),
                                "dir": d,
                            })
                        except Exception:
                            pass
                if len(wordlist_files) > 2000:
                    break
            if len(wordlist_files) > 2000:
                break

    # 4. 也扫描 config.yaml 中配置的 seclists_path
    try:
        import yaml
        for cp in _get_config_paths():
            if os.path.isfile(cp):
                with open(cp, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                sp = cfg.get("字典", {}).get("seclists_path", "")
                if sp:
                    sp = os.path.expanduser(sp)
                    if not os.path.isabs(sp):
                        sp = os.path.join(os.path.dirname(cp), sp)
                    if os.path.isdir(sp) and sp not in wordlist_dirs:
                        wordlist_dirs.append(sp)
                break
    except Exception:
        pass

    return {
        "success": True,
        "installed_in_registry": installed_in_registry,
        "discovered_tools": discovered,
        "wordlist_dirs": wordlist_dirs,
        "wordlist_files": wordlist_files[:500],
        "wordlist_total_files": len(wordlist_files),
        "summary": {
            "registry_total": len(TOOL_REGISTRY),
            "registry_installed": len(installed_in_registry),
            "discovered": len(discovered),
            "wordlist_dirs": len(wordlist_dirs),
            "wordlist_files": len(wordlist_files),
        },
    }

def format_size(sz: int) -> str:
    """格式化文件大小"""
    for unit in ("B", "KB", "MB", "GB"):
        if sz < 1024:
            return f"{sz:.1f}{unit}" if unit != "B" else f"{sz}B"
        sz /= 1024
    return f"{sz:.1f}TB"

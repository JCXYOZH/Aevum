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


def run_install_command(cmd: str, timeout: int = 600, retries: int = 2) -> Dict:
    """
    执行安装命令，带重试和更好的错误处理
    """
    errors = []
    for attempt in range(retries):
        try:
            result = subprocess.run(cmd, shell=True, capture_output=True,
                                    timeout=timeout)
            if result.returncode == 0:
                return {"success": True, "output": safe_decode(result.stdout)[-500:], "cmd": cmd}
            errors.append(f"attempt {attempt+1}: {safe_decode(result.stderr)[-300:]}")
        except subprocess.TimeoutExpired:
            errors.append(f"attempt {attempt+1}: 超时({timeout}s)")
        except Exception as e:
            errors.append(f"attempt {attempt+1}: {e}")
        if attempt < retries - 1:
            time.sleep(3)
    return {"success": False, "error": " | ".join(errors), "cmd": cmd}

def _os_key() -> str:
    s = platform.system().lower()
    if s == "darwin":
        return "darwin"
    if s.startswith("win"):
        return "win32"
    return "linux"

def check_tool(name: str) -> Dict:
    info = TOOL_REGISTRY.get(name, {})
    path = shutil.which(name)
    # 也检查工具目录（GitHub下载的工具）
    bin_dir = get_tools_bin_dir()
    if not path and os.path.isdir(bin_dir):
        for ext in ("", ".exe", ".bat", ".cmd"):
            candidate = os.path.join(bin_dir, name + ext)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK if not ext else os.F_OK):
                path = candidate
                break
        # 也检查bin子目录（解压后的目录）
        if not path:
            for root, dirs, files in os.walk(bin_dir):
                for f in files:
                    if f == name or f == name + ".exe":
                        fp = os.path.join(root, f)
                        if os.access(fp, os.X_OK if not f.endswith(('.exe','.bat','.cmd')) else os.F_OK):
                            path = fp
                            break
                if path:
                    break
    installed = bool(path)
    version = ""
    if installed:
        verify_cmd = info.get("verify", f"{name} --version")
        try:
            result = subprocess.run(verify_cmd.split(), capture_output=True, timeout=5,
                                    env={**os.environ, "PATH": f"{bin_dir}:{os.environ.get('PATH','')}"})
            version = safe_decode(result.stdout or result.stderr).strip().split("\n")[0][:100]
        except Exception:
            version = "已安装"
    os_key = _os_key()
    install_cmd = info.get("install", {}).get(os_key, "请手动安装")
    return {
        "name": name,
        "display_name": info.get("name", name),
        "desc": info.get("desc", ""),
        "category": info.get("category", ""),
        "installed": installed,
        "path": path or "",
        "version": version,
        "install_cmd": install_cmd,
        "website": info.get("website", ""),
    }

def check_all_tools() -> List[Dict]:
    return [check_tool(name) for name in TOOL_REGISTRY]

def install_tool(name: str) -> Dict:
    info = TOOL_REGISTRY.get(name)
    if not info:
        return {"success": False, "error": f"未知工具: {name}"}
    os_key = _os_key()
    cmd = info.get("install", {}).get(os_key, "")

    # 系统自带工具
    if cmd in ("系统自带",):
        return {"success": True, "message": "此工具为系统自带，无需安装"}

    # 空命令：尝试GitHub release下载
    if not cmd:
        return _try_github_download(name, info)

    # "从 URL 下载" 类型：尝试GitHub release或直接下载
    if cmd.startswith("从 ") and ("下载" in cmd or "releases" in cmd):
        result = _try_github_download(name, info)
        if result.get("success"):
            return result
        # GitHub下载失败，返回手动安装提示
        return {"success": False, "error": f"自动下载失败，请手动安装: {cmd}",
                "website": info.get("website", "")}

    # 包管理器安装（brew/apt/pip/winget等）
    result = run_install_command(cmd, timeout=600, retries=2)
    if result["success"]:
        verify = check_tool(name)
        if verify["installed"]:
            return {"success": True, "message": "安装成功", "output": result.get("output", "")}
        # 命令成功但工具不在PATH，尝试GitHub下载
        gh_result = _try_github_download(name, info)
        if gh_result.get("success"):
            return {"success": True, "message": "安装成功（通过下载二进制）", "output": result.get("output", "")}
        return {"success": False, "message": "命令执行完成但未检测到工具，请检查PATH",
                "output": result.get("output", ""), "website": info.get("website", "")}
    else:
        # 包管理器失败，尝试GitHub下载
        gh_result = _try_github_download(name, info)
        if gh_result.get("success"):
            return {"success": True, "message": "包管理器失败，已通过GitHub下载安装"}
        return {"success": False, "error": result.get("error", "安装失败"),
                "cmd": cmd, "website": info.get("website", "")}

def _try_github_download(name: str, info: Dict) -> Dict:
    """尝试从GitHub releases下载工具二进制"""
    website = info.get("website", "")
    target_dir = get_tools_bin_dir()
    os.makedirs(target_dir, exist_ok=True)

    # 从website提取repo
    repo = ""
    if "github.com" in website:
        parts = website.rstrip("/").split("github.com/")[-1].split("/")
        if len(parts) >= 2:
            repo = f"{parts[0]}/{parts[1]}"

    if not repo:
        return {"success": False, "error": "无法确定GitHub仓库"}

    result = download_github_release(repo, target_dir)
    if result.get("success"):
        # 提示用户将bin目录加入PATH
        path_hint = f'请将 {target_dir} 加入PATH环境变量'
        result["message"] = result.get("message", "") + f"。{path_hint}"
        result["path_hint"] = target_dir
        # 验证
        verify = check_tool(name)
        result["installed"] = verify["installed"]
    return result

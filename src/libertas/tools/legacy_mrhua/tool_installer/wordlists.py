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
from .download import get_tools_wordlists_dir
from .registry_data import TOOL_REGISTRY
from .wordlists_data import WORDLIST_REGISTRY


def _get_config_paths() -> List[str]:
    """获取可能的 config.yaml 路径"""
    paths = []
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for p in [
        os.path.join(project_root, "..", "config.yaml"),
        os.path.join(get_data_dir(), "config.yaml"),
        os.path.join(os.getcwd(), "config.yaml"),
    ]:
        p = os.path.abspath(p)
        if p not in paths:
            paths.append(p)
    return paths

def list_wordlists() -> List[Dict]:
    result = []
    for key, info in WORDLIST_REGISTRY.items():
        target_dir = os.path.join(get_tools_wordlists_dir(), info.get("target_subdir", ""))
        url = info.get("url") or info.get("git", "")
        is_git = "git" in info
        installed = os.path.isdir(target_dir) if (is_git or key == "SecLists") else False
        if not installed and url and not is_git:
            fname = url.split("/")[-1].split("?")[0]
            installed = os.path.isfile(os.path.join(target_dir, fname))
        result.append({
            "id": key,
            "name": info["name"],
            "desc": info["desc"],
            "category": info["category"],
            "size": info["size"],
            "url": url,
            "is_git": is_git,
            "installed": installed,
            "target_dir": target_dir,
        })
    return result

def download_wordlist(wordlist_id: str) -> Dict:
    info = WORDLIST_REGISTRY.get(wordlist_id)
    if not info:
        return {"success": False, "error": f"未知字典: {wordlist_id}"}
    target_dir = os.path.join(get_tools_wordlists_dir(), info.get("target_subdir", ""))
    os.makedirs(target_dir, exist_ok=True)
    try:
        if "git" in info:
            repo_name = info["git"].rstrip("/").split("/")[-1].replace(".git", "")
            clone_path = os.path.join(target_dir, repo_name)
            if os.path.isdir(clone_path):
                r = run_install_command(f"git -C {clone_path} pull", timeout=120, retries=2)
                if not r["success"]:
                    return {"success": False, "error": f"git pull失败: {r['error']}"}
                return {"success": True, "path": clone_path, "message": f"字典仓库已更新: {clone_path}"}
            r = run_install_command(f"git clone --depth 1 {info['git']} {clone_path}", timeout=300, retries=2)
            if not r["success"]:
                return {"success": False, "error": f"git clone失败: {r['error']}"}
            return {"success": True, "path": clone_path, "message": f"字典仓库已克隆到 {clone_path}"}

        url = info.get("url", "")
        if not url:
            return {"success": False, "error": "字典条目缺少URL"}
        fname = url.split("/")[-1].split("?")[0] or f"{wordlist_id}.txt"
        target_path = os.path.join(target_dir, fname)
        result = robust_download(url, target_path, timeout=300, retries=3, verify_ssl=False)
        if not result["success"]:
            return result
        downloaded = os.path.getsize(target_path)
        if fname.endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(target_path, "r") as zf:
                zf.extractall(target_dir)
        elif fname.endswith((".tar.gz", ".tgz")):
            import tarfile
            with tarfile.open(target_path, "r:gz") as tf:
                tf.extractall(target_dir)
        return {"success": True, "path": target_path, "size": downloaded,
                "message": f"字典已下载到 {target_path}（{result.get('method', '')}）"}
    except Exception as e:
        return {"success": False, "error": str(e)}


KNOWN_WORDLIST_DIRS = [
    "/usr/share/wordlists",
    "/usr/share/seclists",
    "/usr/share/dirb/wordlists",
    "/usr/share/dirbuster/wordlists",
    "/usr/share/wfuzz/wordlist",
    "/usr/share/gobuster",
    "/usr/share/ffuf",
    "/usr/share/nmap/nselib/data",
    "/usr/share/set/src/fasttrack",
    "/usr/share/legion",
    "/usr/share/sparta",
    "/opt/SecLists",
    "/opt/wordlists",
    "~/SecLists",
    "~/wordlists",
    "./MrHuaData/SecLists",
    "./MrHuaData/wordlists",
    os.path.join(get_tools_wordlists_dir(), "SecLists"),
    get_tools_wordlists_dir(),
]

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


def get_tools_dir() -> str:
    """工具安装根目录：MrHuaData/tools/"""
    d = os.path.join(get_data_dir(), "tools")
    os.makedirs(d, exist_ok=True)
    return d

def get_tools_bin_dir() -> str:
    """二进制工具目录：MrHuaData/tools/bin/"""
    d = os.path.join(get_tools_dir(), "bin")
    os.makedirs(d, exist_ok=True)
    return d

def get_tools_wordlists_dir() -> str:
    """字典目录：MrHuaData/tools/wordlists/"""
    d = os.path.join(get_tools_dir(), "wordlists")
    os.makedirs(d, exist_ok=True)
    return d

def _get_proxies():
    """从环境变量获取代理设置"""
    proxies = {}
    for key in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        val = os.environ.get(key, "")
        if val:
            proxies[key.lower().replace("_proxy", "")] = val
    return proxies

def robust_download(url: str, target_path: str, timeout: int = 300, retries: int = 3,
                    verify_ssl: bool = True, progress_callback=None) -> Dict:
    """
    强制下载文件，多重保障：
    1. requests 库（带重试、代理、长超时）
    2. urllib（标准库兜底）
    3. curl 命令（系统级兜底）
    4. wget 命令（最终兜底）
    """
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    errors = []

    # 方法1: requests
    try:
        import requests
        session = requests.Session()
        # 设置代理
        proxies = _get_proxies()
        if proxies:
            session.proxies.update(proxies)
        # 禁用SSL警告
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:
            pass

        for attempt in range(retries):
            try:
                resp = session.get(url, stream=True, timeout=timeout, verify=verify_ssl,
                                   allow_redirects=True)
                resp.raise_for_status()
                total = int(resp.headers.get("content-length", 0))
                downloaded = 0
                with open(target_path, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=65536):
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            if progress_callback:
                                progress_callback(downloaded, total)
                return {"success": True, "path": target_path, "size": downloaded, "method": "requests"}
            except (requests.RequestException, ConnectionError, TimeoutError) as e:
                errors.append(f"requests attempt {attempt+1}: {e}")
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                continue
    except ImportError:
        errors.append("requests not available")

    # 方法2: urllib
    try:
        ctx = ssl.create_default_context()
        if not verify_ssl:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        proxy_handler = urllib.request.ProxyHandler(_get_proxies() or None)
        https_handler = urllib.request.HTTPSHandler(context=ctx)
        opener = urllib.request.build_opener(proxy_handler, https_handler)
        opener.addheaders = [("User-Agent", "Mozilla/5.0 MrHuaToolInstaller")]
        for attempt in range(retries):
            try:
                with opener.open(url, timeout=timeout) as resp:
                    with open(target_path, "wb") as f:
                        while True:
                            chunk = resp.read(65536)
                            if not chunk:
                                break
                            f.write(chunk)
                return {"success": True, "path": target_path, "method": "urllib"}
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                errors.append(f"urllib attempt {attempt+1}: {e}")
                if attempt < retries - 1:
                    time.sleep(2 ** attempt)
                continue
    except Exception as e:
        errors.append(f"urllib: {e}")

    # 方法3: curl
    if shutil.which("curl"):
        for attempt in range(retries):
            try:
                cmd = ["curl", "-fSL", "--connect-timeout", "30", "--max-time", str(timeout),
                       "--retry", "2", "-o", target_path]
                if not verify_ssl:
                    cmd.append("-k")
                # 代理
                for pk, pv in _get_proxies().items():
                    cmd.extend(["--proxy", pv])
                    break
                cmd.append(url)
                r = subprocess.run(cmd, capture_output=True, timeout=timeout + 30)
                if r.returncode == 0 and os.path.exists(target_path):
                    return {"success": True, "path": target_path, "method": "curl"}
                errors.append(f"curl attempt {attempt+1}: {safe_decode(r.stderr)[-200:]}")
            except Exception as e:
                errors.append(f"curl attempt {attempt+1}: {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)

    # 方法4: wget
    if shutil.which("wget"):
        try:
            cmd = ["wget", "-q", "--timeout=30", "--tries=2", "-O", target_path]
            if not verify_ssl:
                cmd.append("--no-check-certificate")
            cmd.append(url)
            r = subprocess.run(cmd, capture_output=True, timeout=timeout + 30)
            if r.returncode == 0 and os.path.exists(target_path):
                return {"success": True, "path": target_path, "method": "wget"}
            errors.append(f"wget: {safe_decode(r.stderr)[-200:]}")
        except Exception as e:
            errors.append(f"wget: {e}")

    return {"success": False, "error": "所有下载方式均失败: " + " | ".join(errors[-3:])}

def download_github_release(repo: str, target_dir: str, asset_pattern: str = "",
                            binary_name: str = "") -> Dict:
    """
    从GitHub Releases下载最新版本二进制文件
    repo: 如 "projectdiscovery/nuclei"
    asset_pattern: 资产名匹配模式（如 "linux_amd64"），为空则自动检测
    binary_name: 保存的文件名，为空则用资产原名
    """
    api_url = f"https://api.github.com/repos/{repo}/releases/latest"
    try:
        import requests
        resp = requests.get(api_url, timeout=30, verify=False, proxies={"http": None, "https": None})
        resp.raise_for_status()
        release = resp.json()
    except Exception:
        # urllib fallback
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(api_url, timeout=30, context=ctx) as r:
                import json
                release = json.loads(r.read())
        except Exception as e:
            return {"success": False, "error": f"获取release信息失败: {e}"}

    assets = release.get("assets", [])
    if not assets:
        return {"success": False, "error": "该仓库没有release资产"}

    # 自动检测系统
    sys_key = _os_key()
    arch = platform.machine().lower()
    arch_map = {"x86_64": "amd64", "amd64": "amd64", "arm64": "arm64", "aarch64": "arm64"}
    arch_str = arch_map.get(arch, "amd64")

    os_patterns = {
        "darwin": ["darwin", "macOS", "mac"],
        "linux": ["linux"],
        "win32": ["windows", "win"],
    }
    os_patterns_list = os_patterns.get(sys_key, [sys_key])

    # 查找匹配的资产
    selected = None
    for asset in assets:
        name = asset["name"].lower()
        if asset_pattern and asset_pattern.lower() not in name:
            continue
        if any(op in name for op in os_patterns_list) and arch_str in name:
            selected = asset
            break

    # 如果没匹配到，尝试只匹配系统
    if not selected:
        for asset in assets:
            name = asset["name"].lower()
            if any(op in name for op in os_patterns_list):
                selected = asset
                break

    # 还没匹配到，取第一个资产
    if not selected:
        selected = assets[0]

    download_url = selected["browser_download_url"]
    fname = binary_name or selected["name"]
    target_path = os.path.join(target_dir, fname)

    result = robust_download(download_url, target_path, timeout=300, verify_ssl=False)
    if result["success"]:
        # 解压
        if fname.endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(target_path, "r") as zf:
                zf.extractall(target_dir)
        elif fname.endswith((".tar.gz", ".tgz")):
            import tarfile
            with tarfile.open(target_path, "r:gz") as tf:
                tf.extractall(target_dir)
        # 添加执行权限
        for f in os.listdir(target_dir):
            fp = os.path.join(target_dir, f)
            if os.path.isfile(fp) and not f.endswith((".zip", ".gz", ".tgz", ".txt", ".md")):
                try:
                    os.chmod(fp, 0o755)
                except Exception:
                    pass
        result["message"] = f"已下载 {selected['name']} 到 {target_dir}"
        result["version"] = release.get("tag_name", "")
    return result

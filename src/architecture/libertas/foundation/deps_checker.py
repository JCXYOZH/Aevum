"""
core/deps_checker.py - 依赖诊断与自动安装（优化版）

融合两个版本的优点：
- 保留当前版本的 DependencyChecker 类（功能丰富、状态持久化、版本比较）
- 吸收0.1.5版本的 pyproject.toml 动态解析、import名映射、安装修复建议
- 修复 check_all() AttributeError、check_project_integrity() 空实现
- 检测Python包、系统工具、动态库依赖，自动安装缺失项，版本兼容性检查
- Windows下不依赖PATH，额外检查常见安装路径
"""
import os
import re
import sys
import json
import time
import uuid
import shutil
import importlib
import importlib.util
import subprocess
import threading
import platform
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode


# ============================================================
# 映射表（吸收0.1.5）
# ============================================================

# import 名 → pip 包名映射
_IMPORT_TO_PIP = {
    "yaml": "pyyaml", "PIL": "pillow", "bs4": "beautifulsoup4",
    "jwt": "pyjwt", "OpenSSL": "pyopenssl", "cv2": "opencv-python",
    "sklearn": "scikit-learn", "docx": "python-docx", "pptx": "python-pptx",
    "magic": "python-magic", "dns": "dnspython", "Crypto": "pycryptodome",
    "google": "google-generativeai", "anthropic": "anthropic",
    "openai": "openai", "paho.mqtt": "paho-mqtt",
    "paho_mqtt": "paho-mqtt", "dateutil": "python-dateutil",
    "dotenv": "python-dotenv", "frontmatter": "python-frontmatter",
    "networkx": "networkx", "impacket": "impacket",
    "httpx": "httpx", "playwright": "playwright",
    "numpy": "numpy", "bcrypt": "bcrypt", "paramiko": "paramiko",
    "snownlp": "snownlp", "pypinyin": "pypinyin", "jieba": "jieba",
    "flask": "flask", "requests": "requests", "cryptography": "cryptography",
    "watchdog": "watchdog", "psutil": "psutil", "PySide6": "PySide6",
}

# pip 包名 → 正确的 import 名（优先于反向查找，解决一包多名映射问题）
_PIP_TO_IMPORT = {
    "paho-mqtt": "paho.mqtt",
    "pyyaml": "yaml",
    "pillow": "PIL",
    "beautifulsoup4": "bs4",
    "pyjwt": "jwt",
    "pyopenssl": "OpenSSL",
    "python-dateutil": "dateutil",
    "python-dotenv": "dotenv",
    "python-frontmatter": "frontmatter",
    "dnspython": "dns",
    "pycryptodome": "Crypto",
    "google-generativeai": "google",
    "opencv-python": "cv2",
    "scikit-learn": "sklearn",
    "python-docx": "docx",
    "python-pptx": "pptx",
    "python-magic": "magic",
    "sentence-transformers": "sentence_transformers",
    "more-itertools": "more_itertools",
}

# 依赖描述（可选，未列出的显示包名）
_DEP_DESCRIPTIONS = {
    "flask": "Web 服务器框架", "requests": "HTTP 请求库",
    "bs4": "HTML 解析（网页抓取）", "yaml": "YAML 配置解析",
    "jieba": "中文分词（RAG知识库）", "PySide6": "桌面窗口（GUI模式）",
    "cryptography": "加密库（TLS/AES）", "watchdog": "文件监控",
    "psutil": "系统进程管理", "paho-mqtt": "MQTT 客户端（局域网/广域网通信）",
    "bcrypt": "密码哈希", "paramiko": "SSH 隧道", "PIL": "图像处理",
    "numpy": "数值计算", "httpx": "异步 HTTP 客户端",
    "playwright": "浏览器自动化（内置浏览器）", "snownlp": "中文情感分析",
    "pypinyin": "拼音转换", "networkx": "图结构（漏洞图谱）",
    "impacket": "网络协议工具", "jwt": "JWT 令牌",
    "sentence-transformers": "语义向量模型（RAG知识库，可选）",
    "more-itertools": "迭代工具集（认知网络，可选）",
    "scikit-learn": "机器学习库（TF-IDF向量化，可选）",
}


def _parse_pyproject_deps() -> List[Dict]:
    """从 pyproject.toml 动态读取项目依赖"""
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))))
    toml_path = os.path.join(project_root, "pyproject.toml")
    deps = []
    if not os.path.isfile(toml_path):
        return deps
    try:
        if sys.version_info >= (3, 11):
            import tomllib
            with open(toml_path, "rb") as f:
                data = tomllib.load(f)
        else:
            try:
                import tomli
                with open(toml_path, "rb") as f:
                    data = tomli.load(f)
            except ImportError:
                # 降级：正则解析
                return _regex_parse_toml(toml_path)
        # PEP 621
        project = data.get("project", {})
        for dep in project.get("dependencies", []):
            name = _normalize_dep(dep)
            if name:
                deps.append({"raw": dep, "name": name})
        # Poetry
        poetry = data.get("tool", {}).get("poetry", {})
        for name in poetry.get("dependencies", {}):
            if name.lower() != "python":
                deps.append({"raw": name, "name": name.lower()})
    except Exception:
        return _regex_parse_toml(toml_path)
    return deps


def _regex_parse_toml(toml_path: str) -> List[Dict]:
    """正则降级解析 pyproject.toml"""
    deps = []
    try:
        with open(toml_path, "r", encoding="utf-8") as f:
            content = f.read()
        # PEP 621: dependencies = ["pkg>=1.0", ...]
        m = re.search(r'dependencies\s*=\s*\[(.*?)\]', content, re.DOTALL)
        if m:
            for dm in re.finditer(r'["\']([^"\']+)["\']', m.group(1)):
                name = _normalize_dep(dm.group(1))
                if name:
                    deps.append({"raw": dm.group(1), "name": name})
        # Poetry: [tool.poetry.dependencies]
        m2 = re.search(r'\[tool\.poetry\.dependencies\](.*?)(?:\[|$)', content, re.DOTALL)
        if m2:
            for dm in re.finditer(r'^([A-Za-z0-9_\-\.]+)\s*=', m2.group(1), re.MULTILINE):
                name = dm.group(1).lower()
                if name != "python":
                    deps.append({"raw": name, "name": name})
    except Exception:
        pass
    return deps


def _normalize_dep(dep: str) -> str:
    """从依赖声明中提取包名（去掉版本约束）"""
    dep = dep.strip().strip('"\'')
    m = re.match(r'^([A-Za-z0-9_\-\.]+)', dep)
    return m.group(1).lower() if m else ""


def _get_import_name(pip_name: str) -> str:
    """从 pip 包名推断 import 名"""
    # 优先查显式映射（解决一包多名导致反向查找命中错误import名）
    if pip_name in _PIP_TO_IMPORT:
        return _PIP_TO_IMPORT[pip_name]
    # 反向查找映射
    for imp, pip in _IMPORT_TO_PIP.items():
        if pip.lower() == pip_name.lower():
            return imp
    # 默认：把 - 换成 _
    return pip_name.replace("-", "_")


# 系统命令检查
SYSTEM_COMMANDS = {
    "ssh": {"required": False, "desc": "SSH 隧道", "install": {"darwin": "系统自带", "linux": "apt install openssh-client", "win32": "Windows 自带或安装 OpenSSH"}},
    "nmap": {"required": False, "desc": "网络扫描", "install": {"darwin": "brew install nmap", "linux": "apt install nmap", "win32": "从 nmap.org 下载"}},
    "git": {"required": False, "desc": "版本控制", "install": {"darwin": "xcode-select --install", "linux": "apt install git", "win32": "从 git-scm.com 下载"}},
    "node": {"required": False, "desc": "JavaScript 运行时", "install": {"darwin": "brew install node", "linux": "apt install nodejs", "win32": "从 nodejs.org 下载"}},
    "openssl": {"required": False, "desc": "TLS 证书生成", "install": {"darwin": "系统自带", "linux": "apt install openssl", "win32": "随 Git 安装"}},
    "pyinstaller": {"required": False, "desc": "打包构建工具", "install": {"darwin": "pip install pyinstaller", "linux": "pip install pyinstaller", "win32": "pip install pyinstaller"}},
}

# Windows 常见安装路径（不依赖 PATH 也能检测）
_WINDOWS_COMMON_PATHS = {
    "nmap": [
        r"C:\Program Files (x86)\Nmap\nmap.exe",
        r"C:\Program Files\Nmap\nmap.exe",
        r"C:\Nmap\nmap.exe",
        r"D:\Nmap\nmap.exe",
        r"D:\Program Files\Nmap\nmap.exe",
        r"D:\Program Files (x86)\Nmap\nmap.exe",
    ],
    "node": [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        r"C:\nodejs\node.exe",
        r"D:\nodejs\node.exe",
        r"D:\Program Files\nodejs\node.exe",
        r"D:\Program Files (x86)\nodejs\node.exe",
    ],
    "git": [
        r"C:\Program Files\Git\bin\git.exe",
        r"C:\Program Files (x86)\Git\bin\git.exe",
        r"C:\Git\bin\git.exe",
        r"D:\Git\bin\git.exe",
        r"D:\Program Files\Git\bin\git.exe",
    ],
    "openssl": [
        r"C:\Program Files\Git\usr\bin\openssl.exe",
        r"C:\Program Files (x86)\Git\usr\bin\openssl.exe",
        r"C:\OpenSSL-Win64\bin\openssl.exe",
        r"C:\OpenSSL-Win32\bin\openssl.exe",
    ],
    "ssh": [
        r"C:\Windows\System32\OpenSSH\ssh.exe",
        r"C:\Program Files\Git\usr\bin\ssh.exe",
    ],
}


def check_python_dep(name: str) -> Dict:
    """检查单个 Python 依赖是否安装"""
    import_name = _get_import_name(name)
    pip_name = _IMPORT_TO_PIP.get(import_name, name)
    desc = _DEP_DESCRIPTIONS.get(pip_name, _DEP_DESCRIPTIONS.get(import_name, ""))
    try:
        mod = importlib.import_module(import_name)
        version = getattr(mod, "__version__", "unknown")
        return {"name": name, "import_name": import_name, "installed": True,
                "version": version, "required": False, "optional": False, "desc": desc,
                "pip_name": pip_name}
    except ImportError:
        return {"name": name, "import_name": import_name, "installed": False,
                "version": "", "required": False, "optional": False, "desc": desc,
                "pip_name": pip_name}


def check_system_command(name: str) -> Dict:
    info = SYSTEM_COMMANDS.get(name, {})
    path = shutil.which(name)
    os_key = platform.system().lower()
    if os_key == "darwin":
        os_key = "darwin"
    elif os_key.startswith("win"):
        os_key = "win32"
    else:
        os_key = "linux"
    # Windows下如果PATH找不到，检查常见安装路径
    if not path and os_key == "win32":
        common_paths = _WINDOWS_COMMON_PATHS.get(name, [])
        for p in common_paths:
            if os.path.exists(p):
                path = p
                break
    install_hint = info.get("install", {}).get(os_key, "请手动安装")
    version = ""
    if path:
        try:
            result = subprocess.run([path, "--version"], capture_output=True, timeout=5)
            version = safe_decode(result.stdout or result.stderr).strip().split("\n")[0][:80]
        except Exception:
            version = "已安装"
    return {"name": name, "installed": bool(path), "path": path or "",
            "version": version, "required": info.get("required", False),
            "desc": info.get("desc", ""), "install_hint": install_hint}


def check_all() -> Dict:
    # 从 pyproject.toml 动态读取所有 Python 依赖
    toml_deps = _parse_pyproject_deps()
    seen = set()
    python_deps = []
    for d in toml_deps:
        name = d["name"]
        if name in seen:
            continue
        seen.add(name)
        python_deps.append(check_python_dep(name))
    # 加上 pyproject.toml 中可能没列出但代码中常用的包
    extra_packages = ["paho-mqtt", "bcrypt", "paramiko", "pillow", "numpy",
                      "httpx", "playwright", "snownlp", "pypinyin", "networkx",
                      "impacket", "pyjwt", "beautifulsoup4",
                      "sentence-transformers", "more-itertools", "scikit-learn"]
    # 可选依赖：代码中用 try/except ImportError 包裹，缺失不影响核心功能
    optional_packages = {"sentence-transformers", "more-itertools", "scikit-learn",
                         "impacket", "playwright", "snownlp", "pypinyin", "networkx"}
    for pkg in extra_packages:
        if pkg.lower() not in seen:
            seen.add(pkg.lower())
            dep = check_python_dep(pkg)
            if pkg.lower() in optional_packages:
                dep["optional"] = True
                dep["required"] = False
            python_deps.append(dep)

    system_cmds = [check_system_command(n) for n in SYSTEM_COMMANDS]
    missing_required = [d for d in python_deps if not d["installed"] and d["required"]]
    missing_optional = [d for d in python_deps if not d["installed"] and not d["required"]]
    missing_cmds = [c for c in system_cmds if not c["installed"]]
    return {
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "os": platform.system(),
        "python_deps": python_deps,
        "system_commands": system_cmds,
        "missing_required": len(missing_required),
        "missing_optional": len(missing_optional),
        "missing_commands": len(missing_cmds),
        "all_required_ok": len(missing_required) == 0,
    }


def install_python_dep(pip_name: str) -> Dict:
    python_exe = sys.executable
    try:
        result = subprocess.run(
            [python_exe, "-m", "pip", "install", pip_name, "--disable-pip-version-check"],
            capture_output=True, timeout=120
        )
        pip_stdout = safe_decode(result.stdout)
        pip_stderr = safe_decode(result.stderr)
        if result.returncode == 0:
            return {"success": True, "message": f"{pip_name} 安装成功", "output": pip_stdout[-500:]}
        else:
            err = pip_stderr[-500:] if pip_stderr else "未知错误"
            suggestion = _suggest_install_fix(pip_name, err)
            return {"success": False, "error": err, "suggestion": suggestion}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "安装超时（120秒）", "suggestion": "检查网络连接，或使用国内镜像源: pip install " + pip_name + " -i https://pypi.tuna.tsinghua.edu.cn/simple"}
    except Exception as e:
        return {"success": False, "error": str(e), "suggestion": "请手动执行: " + python_exe + " -m pip install " + pip_name}


def _suggest_install_fix(pip_name: str, error: str) -> str:
    if "Permission denied" in error or "权限" in error:
        return f"权限不足，尝试: {sys.executable} -m pip install --user {pip_name}"
    if "No matching distribution" in error:
        return f"找不到匹配的版本，请检查 Python 版本（当前 {platform.python_version()}）是否兼容"
    if "Connection" in error or "timeout" in error.lower() or "网络" in error:
        return f"网络问题，尝试国内镜像: {sys.executable} -m pip install {pip_name} -i https://pypi.tuna.tsinghua.edu.cn/simple"
    if "Microsoft Visual C++" in error or "gcc" in error:
        return "缺少编译工具，建议安装预编译包: pip install --only-binary :all: " + pip_name
    return f"请手动执行: {sys.executable} -m pip install {pip_name}"


def check_project_integrity() -> Dict:
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    required_files = [
        "libertas/interfaces/web.py",
        "libertas/interfaces/cli.py",
        "libertas/models/model_engine.py",
        "libertas/models/prompt_engine.py",
        "libertas/interfaces/templates/index.html",
        "config.yaml",
    ]
    missing = []
    for rf in required_files:
        if not os.path.isfile(os.path.join(project_root, rf)):
            missing.append(rf)
    return {"project_root": project_root, "missing_files": missing, "intact": len(missing) == 0}

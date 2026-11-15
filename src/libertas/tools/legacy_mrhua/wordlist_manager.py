# tools/wordlist_manager.py
"""
字典管理器 - 统一管理 SecLists 和自定义字典
支持可配置路径、自动发现、大小限制、分类索引
"""
import os
import threading
from typing import Dict, List, Optional, Any


DEFAULT_WORDLIST_CONFIG = {
    "seclists_path": "./SecLists",
    "max_lines": 0,
    "wordlists": {
        "subdomains": {
            "file": "Discovery/DNS/subdomains-top1million-20000.txt",
            "fallback": "shubs-subdomains.txt",
            "max_lines": 0,
            "description": "子域名字典"
        },
        "directories": {
            "file": "Discovery/Web-Content/common.txt",
            "fallback": "Discovery/Web-Content/raft-medium-directories.txt",
            "max_lines": 0,
            "description": "Web目录字典"
        },
        "directories_small": {
            "file": "Discovery/Web-Content/quickhits.txt",
            "fallback": "Discovery/Web-Content/common.txt",
            "max_lines": 0,
            "description": "快速目录字典"
        },
        "directories_large": {
            "file": "Discovery/Web-Content/raft-large-directories.txt",
            "fallback": "Discovery/Web-Content/raft-medium-directories.txt",
            "max_lines": 0,
            "description": "大型目录字典"
        },
        "passwords": {
            "file": "Passwords/Common-Credentials/10k-most-common.txt",
            "fallback": "Passwords/darkc0de.txt",
            "max_lines": 0,
            "description": "常用密码字典"
        },
        "usernames": {
            "file": "Usernames/top-usernames-shortlist.txt",
            "fallback": "Usernames/names.txt",
            "max_lines": 0,
            "description": "用户名字典"
        },
        "xss": {
            "file": "Fuzzing/XSS/human-friendly/XSS-Cheat-Sheet-PortSwigger.txt",
            "fallback": "Fuzzing/XSS/human-friendly/XSS-BruteLogic.txt",
            "max_lines": 0,
            "description": "XSS Payload字典"
        },
        "sqli": {
            "file": "Fuzzing/Databases/SQLi/Generic-SQLi.txt",
            "fallback": "Fuzzing/Databases/SQLi/sqli.auth.bypass.txt",
            "max_lines": 0,
            "description": "SQL注入字典"
        },
        "lfi": {
            "file": "Fuzzing/LFI/LFI-Jhaddix.txt",
            "fallback": "Fuzzing/LFI/LFI-gracefulsecurity-linux.txt",
            "max_lines": 0,
            "description": "LFI字典"
        },
        "api_endpoints": {
            "file": "Discovery/Web-Content/common-api-endpoints-mazen160.txt",
            "fallback": "Discovery/Web-Content/common.txt",
            "max_lines": 0,
            "description": "API端点字典"
        }
    }
}


class WordlistManager:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, config: Dict[str, Any] = None):
        if hasattr(self, '_initialized') and self._initialized:
            if config:
                self._load_config(config)
            return
        self._cache: Dict[str, List[str]] = {}
        self._cache_lock = threading.Lock()
        self._config = dict(DEFAULT_WORDLIST_CONFIG)
        if config:
            self._load_config(config)
        self._seclists_available = self._check_seclists()
        self._initialized = True

    def _load_config(self, config: Dict[str, Any]):
        wl_config = config.get("字典", config.get("wordlists", {}))
        if isinstance(wl_config, dict):
            if "seclists_path" in wl_config:
                self._config["seclists_path"] = wl_config["seclists_path"]
            if "max_lines" in wl_config:
                self._config["max_lines"] = int(wl_config["max_lines"])
            if "wordlists" in wl_config and isinstance(wl_config["wordlists"], dict):
                self._config["wordlists"].update(wl_config["wordlists"])
        self._seclists_available = self._check_seclists()

    def _check_seclists(self) -> bool:
        path = self._config["seclists_path"]
        return os.path.isdir(path)

    def _resolve_path(self, rel_path: str) -> Optional[str]:
        base = self._config["seclists_path"]
        full = os.path.join(base, rel_path)
        if os.path.isfile(full):
            return full
        return None

    def _read_wordlist(self, file_path: str, max_lines: int = 0) -> List[str]:
        if max_lines <= 0:
            max_lines = self._config["max_lines"]
        words = []
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        words.append(line)
                        if max_lines > 0 and len(words) >= max_lines:
                            break
        except Exception:
            pass
        return words

    def get_wordlist(self, name: str, max_lines: int = 0,
                     use_cache: bool = True) -> List[str]:
        if use_cache and name in self._cache:
            cached = self._cache[name]
            if max_lines > 0:
                return cached[:max_lines]
            return list(cached)

        wl_def = self._config["wordlists"].get(name)
        if not wl_def:
            return []

        limit = max_lines or wl_def.get("max_lines", self._config["max_lines"])
        words = []

        primary = self._resolve_path(wl_def["file"])
        if primary:
            words = self._read_wordlist(primary, limit)

        if not words and "fallback" in wl_def:
            fb = self._resolve_path(wl_def["fallback"])
            if fb:
                words = self._read_wordlist(fb, limit)

        if use_cache:
            with self._cache_lock:
                self._cache[name] = words

        return list(words)

    def get_custom_wordlist(self, file_path: str, max_lines: int = 0) -> List[str]:
        if not os.path.isfile(file_path):
            return []
        limit = max_lines or self._config["max_lines"]
        return self._read_wordlist(file_path, limit)

    def list_wordlists(self) -> List[Dict[str, Any]]:
        result = []
        for name, wl in self._config["wordlists"].items():
            primary = self._resolve_path(wl["file"])
            fallback = self._resolve_path(wl.get("fallback", ""))
            result.append({
                "name": name,
                "description": wl.get("description", ""),
                "file": wl["file"],
                "available": bool(primary or fallback),
                "path": primary or fallback or "",
                "max_lines": wl.get("max_lines", self._config["max_lines"]),
            })
        return result

    def get_status(self) -> Dict[str, Any]:
        return {
            "seclists_path": os.path.abspath(self._config["seclists_path"]),
            "seclists_available": self._seclists_available,
            "default_max_lines": self._config["max_lines"],
            "wordlists": self.list_wordlists(),
            "cached": list(self._cache.keys()),
        }

    def clear_cache(self):
        with self._cache_lock:
            self._cache.clear()

    def set_seclists_path(self, path: str) -> bool:
        if os.path.isdir(path):
            self._config["seclists_path"] = path
            self._seclists_available = True
            self.clear_cache()
            return True
        return False

    def get_subdomains(self, max_lines: int = 0) -> List[str]:
        return self.get_wordlist("subdomains", max_lines)

    def get_directories(self, size: str = "medium", max_lines: int = 0) -> List[str]:
        if size == "small":
            return self.get_wordlist("directories_small", max_lines)
        elif size == "large":
            return self.get_wordlist("directories_large", max_lines)
        return self.get_wordlist("directories", max_lines)

    def get_passwords(self, max_lines: int = 0) -> List[str]:
        return self.get_wordlist("passwords", max_lines)

    def get_usernames(self, max_lines: int = 0) -> List[str]:
        return self.get_wordlist("usernames", max_lines)


_wordlist_manager: Optional[WordlistManager] = None


def get_wordlist_manager(config: Dict[str, Any] = None) -> WordlistManager:
    global _wordlist_manager
    if _wordlist_manager is None:
        _wordlist_manager = WordlistManager(config)
    elif config:
        _wordlist_manager._load_config(config)
    return _wordlist_manager

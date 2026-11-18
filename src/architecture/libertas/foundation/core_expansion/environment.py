"""职责模块：environment。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import os
from libertas.foundation.terminal import terminal
import threading

class EnvironmentManager:
    """环境变量管理器"""

    def __init__(self):
        self._cache: Dict[str, str] = {}
        self._lock = threading.RLock()

    def get(self, key: str, default: str = "") -> str:
        with self._lock:
            if key in self._cache:
                return self._cache[key]
            value = os.environ.get(key, default)
            self._cache[key] = value
            return value

    def set(self, key: str, value: str):
        with self._lock:
            os.environ[key] = value
            self._cache[key] = value

    def delete(self, key: str) -> bool:
        with self._lock:
            self._cache.pop(key, None)
            if key in os.environ:
                del os.environ[key]
                return True
        return False

    def has(self, key: str) -> bool:
        return key in os.environ

    def get_int(self, key: str, default: int = 0) -> int:
        try:
            return int(self.get(key, str(default)))
        except (ValueError, TypeError):
            return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.get(key, str(default)))
        except (ValueError, TypeError):
            return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        value = self.get(key, str(default)).lower()
        return value in ("true", "1", "yes", "on", "enabled")

    def get_list(self, key: str, separator: str = ",") -> List[str]:
        value = self.get(key, "")
        if not value:
            return []
        return [item.strip() for item in value.split(separator) if item.strip()]

    def load_dotenv(self, filepath: str = ".env") -> bool:
        if not os.path.exists(filepath):
            return False
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    self.set(key, value)
            return True
        except Exception:
            return False

    def clear_cache(self):
        with self._lock:
            self._cache.clear()

    def get_all(self) -> Dict[str, str]:
        return dict(os.environ)

_environment_manager = EnvironmentManager()

def get_environment_manager() -> EnvironmentManager:
    return _environment_manager

class ResourceManager:
    """资源管理器（上下文管理器）"""

    def __init__(self):
        self._resources: List[Tuple[Any, Optional[Callable]]] = []
        self._lock = threading.RLock()

    def register(self, resource: Any, cleanup_fn: Optional[Callable] = None):
        with self._lock:
            self._resources.append((resource, cleanup_fn))

    def cleanup(self):
        with self._lock:
            for resource, cleanup_fn in reversed(self._resources):
                try:
                    if cleanup_fn:
                        cleanup_fn(resource)
                    elif hasattr(resource, 'close'):
                        resource.close()
                    elif hasattr(resource, 'cleanup'):
                        resource.cleanup()
                except Exception as e:
                    terminal.warn(f"资源清理失败: {e}", "resource_manager")
            self._resources.clear()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()
        return False

    def __del__(self):
        try:
            self.cleanup()
        except Exception:
            pass

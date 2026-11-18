"""配置职责：api。"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yaml
except ImportError:
    yaml = None

from .core import Config
from .paths import get_data_dir

_config_instance = None

_config_watch_enabled = False

_last_modified = 0.0

_watch_thread = None

def _get_config() -> Config:
    """获取 Config 单例"""
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance

def set_default(key: str, value: Any):
    """设置默认值"""
    cfg = _get_config()
    if not cfg.has(key):
        cfg.set(key, value, source="default")

def get(key: str, default: Any = None, value_type: Type = None) -> Any:
    """获取配置值"""
    cfg = _get_config()
    value = cfg.get(key, default)
    if value_type and value is not None:
        try:
            if value_type == bool:
                if isinstance(value, str):
                    return value.lower() in ('true', '1', 'yes')
                return bool(value)
            return value_type(value)
        except (ValueError, TypeError):
            return default
    return value

def set(key: str, value: Any, source: str = "runtime", persist: bool = False):
    """设置配置值"""
    cfg = _get_config()
    cfg.set(key, value, source)
    if persist:
        cfg.save()
    _notify_change(key, value)

def delete(key: str) -> bool:
    """删除配置项"""
    return _get_config().delete(key)

def has(key: str) -> bool:
    """检查配置项是否存在"""
    return _get_config().has(key)

def get_source(key: str) -> str:
    """获取配置项来源"""
    return _get_config().get_source(key)

def get_all(prefix: str = "") -> Dict[str, Any]:
    """获取所有配置项"""
    return _get_config().get_all(prefix)

def keys(prefix: str = "") -> List[str]:
    """获取所有配置键"""
    return _get_config().keys(prefix)

def load_from_file(file_path: str) -> bool:
    """从文件加载配置"""
    cfg = _get_config()
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            if file_path.endswith('.json'):
                data = json.load(f)
            elif yaml:
                data = yaml.safe_load(f)
            else:
                return False
        cfg._merge_dict(data, priority_env=False)
        cfg._config_file_path = file_path
        return True
    except Exception:
        return False

def save_to_file(file_path: str) -> bool:
    """保存配置到文件"""
    return _get_config().save(file_path)

def reload() -> bool:
    """重新加载配置"""
    return _get_config().reload()

def watch_for_changes(interval: float = 5.0):
    """监听配置文件变化"""
    global _config_watch_enabled, _watch_thread
    _config_watch_enabled = True
    _last_modified = 0.0

    def _watch():
        nonlocal _last_modified
        while _config_watch_enabled:
            time.sleep(interval)
            cfg = _get_config()
            path = cfg.get_config_file_path()
            if path and os.path.exists(path):
                mtime = os.path.getmtime(path)
                if mtime > _last_modified and _last_modified > 0:
                    cfg.reload()
                _last_modified = mtime

    _watch_thread = threading.Thread(target=_watch, daemon=True)
    _watch_thread.start()

def stop_watching():
    """停止监听配置文件变化"""
    global _config_watch_enabled
    _config_watch_enabled = False

def on_change(key_pattern: str, callback: Any):
    """注册配置变化回调"""
    _callbacks.append((key_pattern, callback))

def _notify_change(key: str, value: Any):
    """通知配置变化"""
    import fnmatch
    for pattern, callback in _callbacks:
        if fnmatch.fnmatch(key, pattern):
            try:
                callback(key, value)
            except Exception:
                pass

def validate(config_schema: Dict[str, Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """验证配置"""
    errors = []
    cfg = _get_config()
    for key, schema in config_schema.items():
        value = cfg.get(key)
        if schema.get("required") and value is None:
            errors.append(f"缺少必填配置: {key}")
        if value is not None and "type" in schema:
            expected_type = schema["type"]
            if expected_type == "int" and not isinstance(value, int):
                errors.append(f"配置 {key} 应为 int 类型")
            elif expected_type == "float" and not isinstance(value, (int, float)):
                errors.append(f"配置 {key} 应为 float 类型")
            elif expected_type == "bool" and not isinstance(value, bool):
                errors.append(f"配置 {key} 应为 bool 类型")
            elif expected_type == "string" and not isinstance(value, str):
                errors.append(f"配置 {key} 应为 string 类型")
    return len(errors) == 0, errors

def export_config(include_defaults: bool = True, mask_sensitive: bool = True) -> Dict[str, Any]:
    """导出配置"""
    cfg = _get_config()
    result = cfg.to_dict()
    if mask_sensitive:
        sensitive_keys = ['api_key', 'password', 'secret', 'token', 'license']
        def _mask(obj):
            if isinstance(obj, dict):
                return {k: ('***' if any(s in k.lower() for s in sensitive_keys) else _mask(v)) for k, v in obj.items()}
            return obj
        result = _mask(result)
    return result

def get_config_summary() -> Dict[str, Any]:
    """获取配置摘要"""
    cfg = _get_config()
    all_config = cfg.get_all()
    return {
        "total_keys": len(all_config),
        "config_file": cfg.get_config_file_path(),
        "project_root": cfg._project_root,
        "data_dir": get_data_dir(),
        "sources": {
            "env": sum(1 for v in cfg._sources.values() if v == "env"),
            "file": sum(1 for v in cfg._sources.values() if v == "file"),
            "default": sum(1 for v in cfg._sources.values() if v == "default"),
            "runtime": sum(1 for v in cfg._sources.values() if v == "runtime"),
        },
    }

config = _get_config()

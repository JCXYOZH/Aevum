"""配置入口。"""

from .paths import get_data_dir, get_config_dir, data_path, resolve_path
from .core import Config
from .api import _config_instance, _config_watch_enabled, _last_modified, _watch_thread, _get_config, set_default, get, set, delete, has, get_source, get_all, keys, load_from_file, save_to_file, reload, watch_for_changes, stop_watching, on_change, _notify_change, validate, export_config, get_config_summary, config

__all__ = [
    "get_data_dir",
    "get_config_dir",
    "data_path",
    "resolve_path",
    "Config",
    "_config_instance",
    "_config_watch_enabled",
    "_last_modified",
    "_watch_thread",
    "_get_config",
    "set_default",
    "get",
    "set",
    "delete",
    "has",
    "get_source",
    "get_all",
    "keys",
    "load_from_file",
    "save_to_file",
    "reload",
    "watch_for_changes",
    "stop_watching",
    "on_change",
    "_notify_change",
    "validate",
    "export_config",
    "get_config_summary",
    "config",
]

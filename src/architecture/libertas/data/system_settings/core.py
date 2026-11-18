"""
系统设置与偏好管理

全局设置、用户偏好、主题、语言、快捷键、界面配置、配置导入导出。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .defaults import SettingsDefaultsMixin
from .facade import SettingsFacadeMixin
from .models import SettingCategory, SettingDefinition, UserPreferences


class SystemSettingsManager(SettingsDefaultsMixin, SettingsFacadeMixin):
    """系统设置与偏好管理：定义、读取、写入、重置、变更通知。"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "settings")
        os.makedirs(self.data_dir, exist_ok=True)
        self._definitions: Dict[str, SettingDefinition] = {}
        self._global_settings: Dict[str, Any] = {}
        self._user_preferences: Dict[str, UserPreferences] = {}
        self._lock = threading.RLock()
        self._change_callbacks: List[Tuple[str, Callable]] = []
        self._init_default_definitions()
        self._load()

    def _load(self):
        settings_file = os.path.join(self.data_dir, "system_settings.json")
        try:
            if os.path.exists(settings_file):
                with open(settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._global_settings.update(data.get("global_settings", {}))
                for u_data in data.get("user_preferences", []):
                    prefs = UserPreferences(u_data.get("user_id", "default"))
                    prefs.settings = u_data.get("settings", {})
                    prefs.updated_at = u_data.get("updated_at", time.time())
                    self._user_preferences[prefs.user_id] = prefs
        except Exception as e:
            terminal.warn(f"加载系统设置失败: {e}", "settings")

    def _save(self):
        settings_file = os.path.join(self.data_dir, "system_settings.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "global_settings": self._global_settings,
                "user_preferences": [p.to_dict() for p in self._user_preferences.values()],
            }
            with open(settings_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def get(self, key: str, user_id: str = "", default: Any = None) -> Any:
        """获取设置值（用户偏好优先，其次全局设置，最后默认值）"""
        if user_id and user_id in self._user_preferences:
            if key in self._user_preferences[user_id].settings:
                return self._user_preferences[user_id].settings[key]
        if key in self._global_settings:
            return self._global_settings[key]
        if key in self._definitions:
            return self._definitions[key].default_value
        return default

    def set(self, key: str, value: Any, user_id: str = "") -> Tuple[bool, str]:
        """设置值（config键写入config.yaml，gov_key写入工具治理，其余存全局设置）"""
        definition = self._definitions.get(key)
        if definition:
            valid, error = definition.validate(value)
            if not valid:
                return False, error
    
        # 1. 如果是 config.yaml 键，写入 config
        if key in self._config_keys:
            ok = self._config_set(key, value)
            if ok:
                self._notify_change(key, value, user_id)
                return True, "设置成功"
        # 2. 如果是工具治理键，写入治理配置
        try:
            schema = self.get_schema()
            for cat_data in schema.values():
                for item_key, item_def in cat_data.get("items", {}).items():
                    if item_key == key and "gov_key" in item_def:
                        ok = self._gov_set(item_def["gov_key"], value)
                        if ok:
                            self._notify_change(key, value, user_id)
                            return True, "设置成功"
        except Exception:
            pass
        # 3. 存全局设置/用户偏好
        with self._lock:
            if user_id:
                if user_id not in self._user_preferences:
                    self._user_preferences[user_id] = UserPreferences(user_id)
                self._user_preferences[user_id].set(key, value)
            else:
                self._global_settings[key] = value
            self._save()
    
        # 触发回调
        self._notify_change(key, value, user_id)
        return True, "设置成功"

    def reset(self, key: str, user_id: str = "") -> bool:
        """重置为默认值"""
        definition = self._definitions.get(key)
        if not definition:
            return False
        return self.set(key, definition.default_value, user_id)[0]

    def reset_all(self, user_id: str = "") -> int:
        """重置所有设置"""
        count = 0
        for key in list(self._definitions.keys()):
            if self.reset(key, user_id):
                count += 1
        return count

    def get_definition(self, key: str) -> Optional[SettingDefinition]:
        return self._definitions.get(key)

    def list_definitions(self, category: str = "") -> List[SettingDefinition]:
        definitions = list(self._definitions.values())
        if category:
            definitions = [d for d in definitions if d.category == category]
        return sorted(definitions, key=lambda d: d.key)

    def list_categories(self) -> List[str]:
        return sorted(set(d.category for d in self._definitions.values()))

    def _get_config(self):
        """延迟导入 Config 单例"""
        try:
            from libertas.foundation.config import config
            return config
        except Exception:
            return None

    def _config_get(self, ui_key: str) -> Any:
        """从 config.yaml 读取值（运行时键从内存读取）"""
        if ui_key in self._runtime_keys:
            return self._runtime_values.get(ui_key, self._config_defaults.get(ui_key, ""))
        cfg = self._get_config()
        if cfg is None:
            return self._config_defaults.get(ui_key)
        cfg_key = self._config_keys.get(ui_key, "")
        if not cfg_key:
            return self._config_defaults.get(ui_key)
        val = cfg.get(cfg_key)
        if val is None:
            return self._config_defaults.get(ui_key)
        return val

    def _config_set(self, ui_key: str, value: Any) -> bool:
        """写入 config.yaml 并保存（运行时键只存内存）"""
        if ui_key in self._runtime_keys:
            self._runtime_values[ui_key] = value
            try:
                from libertas.foundation.config import config as _cfg
                cfg_key = self._config_keys.get(ui_key, "")
                if cfg_key:
                    _cfg.set(cfg_key, value)
            except Exception:
                pass
            return True
        cfg = self._get_config()
        if cfg is None:
            return False
        cfg_key = self._config_keys.get(ui_key, "")
        if not cfg_key:
            return False
        cfg.set(cfg_key, value)
        try:
            return cfg.save()
        except Exception:
            return False

    def _gov_get(self, gov_key: str) -> Any:
        """从工具治理配置读取值"""
        try:
            from libertas.tools.tool_governance import get_governance
            gov = get_governance()
            cfg = gov.get_config()
            keys = gov_key.split('.')
            val = cfg
            for k in keys:
                if isinstance(val, dict):
                    val = val.get(k)
                else:
                    return None
            return val
        except Exception:
            return None

    def _gov_set(self, gov_key: str, value: Any) -> bool:
        """写入工具治理配置"""
        try:
            from libertas.tools.tool_governance import get_governance
            gov = get_governance()
            # 支持点号路径，如 enabled_types.external
            keys = gov_key.split('.')
            with gov._lock:
                target = gov._config
                for k in keys[:-1]:
                    if k not in target or not isinstance(target[k], dict):
                        target[k] = {}
                    target = target[k]
                target[keys[-1]] = value
                gov._save_config()
            return True
        except Exception:
            return False

    def on_change(self, key_pattern: str, callback: Callable):
        """注册设置变更回调"""
        self._change_callbacks.append((key_pattern, callback))

    def _notify_change(self, key: str, value: Any, user_id: str):
        import fnmatch
        for pattern, callback in self._change_callbacks:
            if fnmatch.fnmatch(key, pattern):
                try:
                    callback(key, value, user_id)
                except Exception:
                    pass

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_definitions": len(self._definitions),
            "categories": len(self.list_categories()),
            "global_settings": len(self._global_settings),
            "user_preferences": len(self._user_preferences),
            "change_callbacks": len(self._change_callbacks),
            "by_category": {c: len([d for d in self._definitions.values() if d.category == c])
                           for c in self.list_categories()},
        }

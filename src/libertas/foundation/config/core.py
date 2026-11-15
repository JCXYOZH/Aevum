"""配置职责：core。"""

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

from .paths import data_path
from .paths import get_data_dir

class Config:
    """配置管理类（单例，线程安全）

    优先级：环境变量 > 配置文件 > 默认值
    存储结构：嵌套字典，支持点号分隔访问（如 'model.runtime_mode'）
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, '_initialized'):
            return
        self._initialized = True
        self._project_root = self._detect_project_root()
        self._config: Dict[str, Any] = {}
        self._config_file_path: Optional[str] = None
        self._sources: Dict[str, str] = {}
        self._load_from_env()
        self._load_from_file()
        self._set_defaults()

    def _detect_project_root(self) -> str:
        """检测项目根目录（config.yaml所在目录或libertas包的父目录）"""
        candidates = [
            os.getcwd(),
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        ]
        for d in candidates:
            if os.path.exists(os.path.join(d, 'config.yaml')):
                return os.path.abspath(d)
        return os.getcwd()

    def resolve_path(self, path: str) -> str:
        """将相对路径解析为绝对路径

        数据目录统一到数据目录：
        - ~/LibertasData/xxx 展开为绝对路径
        - ./LibertasData/xxx 和 ../LibertasData/xxx 自动重定向到数据目录
        - 其他相对路径相对于项目根目录解析
        """
        if not path:
            return path
        # 展开 ~
        path = os.path.expanduser(path)
        if os.path.isabs(path):
            return os.path.abspath(path)
        # 兼容旧配置：把 ./LibertasData/ 和 ../LibertasData/ 统一到数据目录
        norm = path.replace("\\", "/")
        for prefix in ("./LibertasData/", "../LibertasData/", "LibertasData/"):
            if norm.startswith(prefix):
                return data_path(norm[len(prefix):])
        if norm in ("./LibertasData", "../LibertasData", "LibertasData"):
            return get_data_dir()
        return os.path.abspath(os.path.join(self._project_root, path))

    def _load_from_env(self):
        """从环境变量加载（前缀 LIBERTAS_）"""
        prefix = "LIBERTAS_"
        for key, value in os.environ.items():
            if key.startswith(prefix):
                config_key = key[len(prefix):].lower()
                # 尝试转换为 int/float/bool
                if value.lower() in ('true', 'false'):
                    self._config[config_key] = value.lower() == 'true'
                else:
                    try:
                        self._config[config_key] = int(value)
                    except ValueError:
                        try:
                            self._config[config_key] = float(value)
                        except ValueError:
                            self._config[config_key] = value
                self._sources[config_key] = "env"

    def _load_from_file(self):
        """从配置文件加载（支持 yaml 和 json，取第一个找到的文件）

        搜索顺序：
        1. 当前工作目录
        2. 用户数据目录
        3. PyInstaller 打包目录（冻结应用）
        4. 项目根目录
        """
        candidates = []
        for filename in ['config.yaml', 'config.yml', 'config.json']:
            candidates.append(os.path.join(os.getcwd(), filename))
            candidates.append(os.path.join(get_data_dir(), filename))
            if getattr(sys, 'frozen', False):
                candidates.append(os.path.join(sys._MEIPASS, filename))
            root = os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__))))
            candidates.append(os.path.join(root, filename))

        loaded = False
        for path in candidates:
            if not os.path.isfile(path):
                continue
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    if path.endswith('.json'):
                        data = json.load(f)
                    else:
                        if yaml is None:
                            print(f"[WARN] 需要 PyYAML 来解析 {path}，请安装 pip install pyyaml")
                            continue
                        data = yaml.safe_load(f)
                self._merge_dict(data, priority_env=True)
                print(f"[OK] 从 {path} 加载配置")
                self._config_file_path = path
                loaded = True
                break
            except Exception as e:
                print(f"[WARN] 加载配置文件 {path} 失败: {e}")

        # 首次运行：把默认配置复制到用户数据目录
        if not loaded:
            self._copy_default_config()

    def _copy_default_config(self):
        """首次运行时，从 bundle 或项目目录复制默认 config.yaml 到数据目录"""
        src = None
        if getattr(sys, 'frozen', False):
            bundled = os.path.join(sys._MEIPASS, 'config.yaml')
            if os.path.isfile(bundled):
                src = bundled
        if not src:
            root = os.path.dirname(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__))))
            candidate = os.path.join(root, 'config.yaml')
            if os.path.isfile(candidate):
                src = candidate
        if src:
            dst = os.path.join(get_data_dir(), 'config.yaml')
            try:
                shutil.copy2(src, dst)
                print(f"[INFO] 已复制默认配置到 {dst}")
                with open(dst, 'r', encoding='utf-8') as f:
                    if yaml:
                        data = yaml.safe_load(f)
                        self._merge_dict(data, priority_env=True)
                        self._config_file_path = dst
                        print(f"[OK] 从 {dst} 加载配置")
            except Exception as e:
                print(f"[WARN] 复制默认配置失败: {e}")

    def _merge_dict(self, data: Dict, priority_env: bool = True, target: Dict = None):
        """递归合并配置，保留嵌套结构"""
        if target is None:
            target = self._config
        for key, value in data.items():
            if isinstance(value, dict):
                if key not in target or not isinstance(target[key], dict):
                    target[key] = {}
                self._merge_dict(value, priority_env, target[key])
            else:
                if key in target and priority_env and self._sources.get(key) == "env":
                    continue
                target[key] = value
                self._sources[key] = "file"

    def _set_defaults(self):
        """设置默认值（仅当未设置时）"""
        defaults = {
            "app": {
                "name": "Libertas",
                "version": "1.0.0",
                "debug": False,
                "log_level": "INFO",
            },
            "server": {
                "host": "0.0.0.0",
                "port": 8080,
                "workers": 4,
            },
            "database": {
                "path": os.path.join(get_data_dir(), "libertas.db"),
            },
            "cache": {
                "enabled": True,
                "ttl": 3600,
            },
            "security": {
                "encryption_enabled": True,
                "session_timeout": 86400,
            },
            "performance": {
                "max_workers": 8,
                "request_timeout": 30,
            },
            # 路径配置（0.1.5风格）
            "memory_global_dir": data_path("MemorySystem_Global"),
            "memory_private_dir": data_path("MemorySystem"),
            "feedback_storage_dir": data_path("feedback_data"),
            "community_storage_dir": data_path("user_data"),
            "experiment_config_path": data_path("ExperimentConfig.json"),
            "affinity_persist_path": data_path("AffinityState.json"),
            "user_db_path": data_path("users.db"),
            "user_base_dir": data_path("users"),
            "rag_dir": data_path("RAG"),
            # 模型配置
            "model_runtime_mode": "cloud",
            "model_path": "",
            "cloud_endpoint": "https://api.deepseek.com/v1/chat/completions",
            "cloud_api_key": "",
            "cloud_model_name": "deepseek-chat",
            "cloud_timeout": 30,
            # 安全工具路径
            "nmap_path": "nmap",
            "xray_path": "xray",
            "nuclei_path": "nuclei",
            "msf_path": "msfconsole",
            "enable_security": True,
            "xray_default_plugins": ["sqldet", "xss", "cmd-injection"],
            # Web配置
            "port": 8080,
            "web_host": "127.0.0.1",
            "debug": False,
            # 记忆系统参数
            "decay_factor": 0.92,
            "phase_threshold": 0.43,
            "density_threshold": 0.30,
        }
        for key, value in defaults.items():
            if key not in self._config:
                self._config[key] = value
                self._sources[key] = "default"
            elif isinstance(value, dict) and isinstance(self._config.get(key), dict):
                for sub_key, sub_value in value.items():
                    if sub_key not in self._config[key]:
                        self._config[key][sub_key] = sub_value

    def get(self, key: str, default=None) -> Any:
        """获取配置项，支持点号分隔（如 'model.runtime_mode'）"""
        keys = key.split('.')
        value = self._config
        for k in keys:
            if isinstance(value, dict) and k in value:
                value = value[k]
            else:
                return default
        return value

    def set(self, key: str, value: Any, source: str = "runtime"):
        """设置配置项，支持点号分隔"""
        keys = key.split('.')
        target = self._config
        for k in keys[:-1]:
            if k not in target or not isinstance(target[k], dict):
                target[k] = {}
            target = target[k]
        target[keys[-1]] = value
        self._sources[key] = source

    def delete(self, key: str) -> bool:
        """删除配置项"""
        keys = key.split('.')
        target = self._config
        for k in keys[:-1]:
            if isinstance(target, dict) and k in target:
                target = target[k]
            else:
                return False
        if isinstance(target, dict) and keys[-1] in target:
            del target[keys[-1]]
            self._sources.pop(key, None)
            return True
        return False

    def has(self, key: str) -> bool:
        """检查配置项是否存在"""
        return self.get(key) is not None

    def get_source(self, key: str) -> str:
        """获取配置项来源"""
        return self._sources.get(key, "unknown")

    def get_all(self, prefix: str = "") -> Dict[str, Any]:
        """获取所有配置项（扁平结构）"""
        result = {}
        self._flatten(self._config, "", result)
        if prefix:
            result = {k: v for k, v in result.items() if k.startswith(prefix)}
        return result

    def _flatten(self, data: Dict, prefix: str, result: Dict):
        """递归扁平化字典"""
        for key, value in data.items():
            full_key = f"{prefix}.{key}" if prefix else key
            if isinstance(value, dict):
                self._flatten(value, full_key, result)
            else:
                result[full_key] = value

    def keys(self, prefix: str = "") -> List[str]:
        """获取所有配置键"""
        return list(self.get_all(prefix).keys())

    def to_dict(self) -> Dict:
        """返回完整配置字典（只读副本）"""
        return copy.deepcopy(self._config)

    def save(self, path: str = None) -> bool:
        """保存配置到文件"""
        if yaml is None:
            return False
        path = path or self._config_file_path or os.path.join(get_data_dir(), 'config.yaml')
        try:
            with open(path, 'w', encoding='utf-8') as f:
                yaml.dump(self._config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
            self._config_file_path = path
            return True
        except Exception:
            try:
                path = os.path.join(get_data_dir(), 'config.yaml')
                with open(path, 'w', encoding='utf-8') as f:
                    yaml.dump(self._config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
                self._config_file_path = path
                return True
            except Exception:
                return False

    def get_section(self, section: str) -> Dict[str, Any]:
        """读取配置段，返回该段下的扁平键值。"""
        prefix = section.rstrip(".") + "."
        return {key[len(prefix):]: self.get(key) for key in self.keys(prefix)}

    def update_section(self, section: str, data: Dict[str, Any], persist: bool = True):
        """更新配置段"""
        if section not in self._config or not isinstance(self._config.get(section), dict):
            self._config[section] = {}
        self._config[section].update(data)
        if persist:
            self.save()

    def reload(self) -> bool:
        """重新加载配置"""
        self._config = {}
        self._sources = {}
        self._load_from_env()
        self._load_from_file()
        self._set_defaults()
        return True

    def get_config_file_path(self) -> Optional[str]:
        """获取配置文件路径"""
        return self._config_file_path

    def get_project_root(self) -> str:
        """获取项目根目录"""
        return self._project_root

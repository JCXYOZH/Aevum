"""应用配置适配。"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from libertas.foundation.config import config, get_data_dir


def _resolved(key: str, default: str) -> str:
    value = config.get(key, default)
    return config.resolve_path(value) if value else default


@dataclass(frozen=True)
class RuntimeSettings:
    """应用启动所需的已解析配置。"""

    project_root: str
    data_dir: str
    memory_dir: str
    memory_global_dir: str
    user_dir: str
    user_db_path: str
    log_dir: str
    config_file: Optional[str]
    model_runtime_mode: str
    cloud_endpoint: str
    cloud_api_key: str
    cloud_model_name: str
    cloud_timeout: int

    @classmethod
    def load(cls) -> "RuntimeSettings":
        data_dir = get_data_dir()
        api_key = os.environ.get("LIBERTAS_CLOUD_API_KEY", "") or config.get("cloud_api_key", "")
        return cls(
            project_root=config.get_project_root(),
            data_dir=data_dir,
            memory_dir=_resolved("memory_private_dir", os.path.join(data_dir, "MemorySystem")),
            memory_global_dir=_resolved(
                "memory_global_dir", os.path.join(data_dir, "MemorySystem_Global")
            ),
            user_dir=_resolved("user_base_dir", os.path.join(data_dir, "users")),
            user_db_path=_resolved("user_db_path", os.path.join(data_dir, "users.db")),
            log_dir=_resolved("log_dir", os.path.join(data_dir, "logs")),
            config_file=config.get_config_file_path(),
            model_runtime_mode=config.get("model_runtime_mode", "cloud"),
            cloud_endpoint=config.get("cloud_endpoint", ""),
            cloud_api_key=api_key,
            cloud_model_name=config.get("cloud_model_name", "deepseek-chat"),
            cloud_timeout=int(config.get("cloud_timeout", 30)),
        )

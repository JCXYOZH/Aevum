"""视觉模块运行数据目录。

默认把配置放在统一的 runtime 根下：

    runtime/vision/vision_config.json

可通过环境变量 ``LIBERTAS_VISION_DATA_DIR`` 指定其他目录。
"""

import os
from pathlib import Path


DEFAULT_ROOT_NAME = "runtime/vision"


def data_root() -> Path:
    """返回视觉模块运行数据根目录。"""
    return Path(os.environ.get("LIBERTAS_VISION_DATA_DIR", DEFAULT_ROOT_NAME)).expanduser()


DEFAULT_DATA_DIR = str(data_root())

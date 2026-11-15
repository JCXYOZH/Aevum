"""P2P 运行数据目录。

所有运行期生成物统一放在一个根目录下，默认相对于启动时的工作目录：

    runtime/p2p/
    ├── certs/    TLS 证书与私钥
    ├── state/    信誉、版本向量等节点状态
    └── dht/      DHT 内容存储

可通过环境变量 ``LIBERTAS_P2P_DATA_DIR`` 指定其他根目录。
"""

import os
from pathlib import Path


DEFAULT_ROOT_NAME = "runtime/p2p"


def data_root() -> Path:
    """返回 P2P 运行数据根目录。"""
    return Path(os.environ.get("LIBERTAS_P2P_DATA_DIR", DEFAULT_ROOT_NAME)).expanduser()


def cert_dir() -> Path:
    return data_root() / "certs"


def state_dir() -> Path:
    return data_root() / "state"


def dht_dir() -> Path:
    return data_root() / "dht"


DEFAULT_CERT_DIR = str(cert_dir())
DEFAULT_STATE_DIR = str(state_dir())
DEFAULT_DHT_DIR = str(dht_dir())

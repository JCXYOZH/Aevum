# tools/scanner.py
# 安全扫描器：基于 nmap、msfconsole、xray、nuclei 等工具执行安全扫描
# 同时集成原生Python工具（不依赖外部安装），支持结果自动存入记忆系统
import os
import re
import json
import time
import shutil
import subprocess
import tempfile
import logging
import platform
from typing import Dict, List, Optional, Any
from libertas.tools.tool_manager import ToolManager
from libertas.utils.text_decode import decode_output, describe_exception
from libertas.tools.legacy_mrhua import native_tools
import threading
# 可选依赖
try:
    import yaml
except ImportError:
    yaml = None

# 导入配置
from libertas.foundation.config import config

# 配置日志
logger = logging.getLogger(__name__)

"""JSON格式化、压缩、验证、路径查询、键值提取、差异比较、JSON转YAML/XML/CSV插件。"""

from .logic import json_tool
from .plugin import register

__all__ = ["register", "json_tool"]

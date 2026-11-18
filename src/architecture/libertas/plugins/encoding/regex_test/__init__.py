"""测试正则表达式匹配、替换、分割，提供常用正则模式库，显示所有匹配结果和分组插件。"""

from .logic import regex_test
from .plugin import register

__all__ = ["register", "regex_test"]

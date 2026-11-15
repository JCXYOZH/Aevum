"""兼容旧 tools.log_analyzer 导入路径，实现位于 tools_expansion_part2.log_analyzer。"""
from .tools_expansion_part2 import log_analyzer as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

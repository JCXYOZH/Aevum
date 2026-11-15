"""兼容旧 tools.compression_toolkit 导入路径，实现位于 tools_expansion_part2.compression_toolkit。"""
from .tools_expansion_part2 import compression_toolkit as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

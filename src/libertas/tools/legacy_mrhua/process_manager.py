"""兼容旧 tools.process_manager 导入路径，实现位于 tools_expansion_part2.process_manager。"""
from .tools_expansion_part2 import process_manager as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

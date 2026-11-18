"""兼容旧 tools.system_info_collector 导入路径，实现位于 tools_expansion_part2.system_info_collector。"""
from .tools_expansion_part2 import system_info_collector as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

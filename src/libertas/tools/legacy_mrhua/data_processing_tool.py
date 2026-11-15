"""兼容旧 tools.data_processing_tool 导入路径，实现位于 tools_expansion.data_processing_tool。"""
from .tools_expansion import data_processing_tool as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

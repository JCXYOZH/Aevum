"""兼容旧 tools.file_analysis_tool 导入路径，实现位于 tools_expansion.file_analysis_tool。"""
from .tools_expansion import file_analysis_tool as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

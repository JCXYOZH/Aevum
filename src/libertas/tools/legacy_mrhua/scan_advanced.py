"""兼容旧 tools.scan_advanced 导入路径，实现位于 native_tools.scan_advanced。"""
from .native_tools import scan_advanced as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

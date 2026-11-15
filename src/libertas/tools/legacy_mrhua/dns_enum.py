"""兼容旧 tools.dns_enum 导入路径，实现位于 native_tools.dns_enum。"""
from .native_tools import dns_enum as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

"""兼容旧 tools.crypto_toolkit 导入路径，实现位于 tools_expansion.crypto_toolkit。"""
from .tools_expansion import crypto_toolkit as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

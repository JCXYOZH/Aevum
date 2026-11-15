"""兼容旧 tools.network_recon_tool 导入路径，实现位于 tools_expansion.network_recon_tool。"""
from .tools_expansion import network_recon_tool as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

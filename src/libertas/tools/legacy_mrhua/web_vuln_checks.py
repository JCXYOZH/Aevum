"""兼容旧 tools.web_vuln_checks 导入路径，实现位于 native_tools.web_vuln_checks。"""
from .native_tools import web_vuln_checks as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

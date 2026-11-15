"""兼容旧 tools.http_crawl 导入路径，实现位于 native_tools.http_crawl。"""
from .native_tools import http_crawl as _impl
globals().update({k: v for k, v in vars(_impl).items() if not k.startswith('__')})

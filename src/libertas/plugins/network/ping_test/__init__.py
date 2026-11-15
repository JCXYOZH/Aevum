"""Ping目标主机，测试网络延迟和丢包率，支持TCP Ping、端口连通性测试、Traceroute插件。"""

from .logic import ping_test
from .plugin import register

__all__ = ["register", "ping_test"]

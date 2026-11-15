"""Ping目标主机，测试网络延迟和丢包率，支持TCP Ping、端口连通性测试、Traceroute注册入口。"""

from .logic import ping_test

def register(registry):
    registry.register_tool(
        "ping_test",
        ping_test,
        params={"target": "目标IP或域名", "count": "发送次数（默认4）",
                "mode": "模式(icmp/tcp/traceroute)", "port": "TCP Ping端口（默认80）"},
        category="网络工具",
        desc="网络测试，ICMP Ping/TCP Ping/端口连通性/Traceroute"
    )

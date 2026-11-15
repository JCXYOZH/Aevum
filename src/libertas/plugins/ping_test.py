"""插件: 增强版网络延迟测试
版本: 2.0.0
分类: 网络工具
描述: Ping目标主机，测试网络延迟和丢包率，支持TCP Ping、端口连通性测试、Traceroute
"""
import subprocess
import re
import platform
import socket
import time
from ..utils.text_decode import decode_output


def register(registry):
    registry.register_tool(
        "ping_test",
        ping_test,
        params={"target": "目标IP或域名", "count": "发送次数（默认4）",
                "mode": "模式(icmp/tcp/traceroute)", "port": "TCP Ping端口（默认80）"},
        category="网络工具",
        desc="增强版网络测试，ICMP Ping/TCP Ping/端口连通性/Traceroute"
    )


def _icmp_ping(target, count):
    """ICMP Ping"""
    try:
        count = min(max(int(count) if count else 4, 1), 20)
        param = "-n" if platform.system().lower() == "windows" else "-c"
        r = subprocess.run(["ping", param, str(count), target],
                           capture_output=True, timeout=30)
        output = decode_output(r.stdout)
        result = {"目标": target, "发送": count, "模式": "ICMP"}
        # 丢包率
        loss_match = re.search(r"(\d+(?:\.\d+)?)% packet loss", output)
        if not loss_match:
            loss_match = re.search(r"(\d+(?:\.\d+)?)% 丢失", output)
        result["丢包率"] = loss_match.group(1) + "%" if loss_match else "未知"
        # 延迟统计
        min_match = re.search(r"min[=/]\s*([\d.]+)", output, re.I)
        avg_match = re.search(r"avg[=/]\s*([\d.]+)", output, re.I)
        max_match = re.search(r"max[=/]\s*([\d.]+)", output, re.I)
        mdev_match = re.search(r"mdev[=/]\s*([\d.]+)", output, re.I)
        if min_match:
            result["最小延迟"] = min_match.group(1) + "ms"
        if avg_match:
            result["平均延迟"] = avg_match.group(1) + "ms"
        if max_match:
            result["最大延迟"] = max_match.group(1) + "ms"
        if mdev_match:
            result["延迟抖动"] = mdev_match.group(1) + "ms"
        # Windows格式
        if not avg_match:
            time_match = re.search(r"平均[=:]\s*([\d.]+)ms", output)
            if time_match:
                result["平均延迟"] = time_match.group(1) + "ms"
            min_match = re.search(r"最短[=:]\s*([\d.]+)ms", output)
            if min_match:
                result["最小延迟"] = min_match.group(1) + "ms"
            max_match = re.search(r"最长[=:]\s*([\d.]+)ms", output)
            if max_match:
                result["最大延迟"] = max_match.group(1) + "ms"
        # 延迟质量评估
        if "平均延迟" in result:
            avg_ms = float(result["平均延迟"].replace("ms", ""))
            if avg_ms < 20:
                result["延迟质量"] = "优秀（<20ms）"
            elif avg_ms < 50:
                result["延迟质量"] = "良好（20-50ms）"
            elif avg_ms < 100:
                result["延迟质量"] = "一般（50-100ms）"
            elif avg_ms < 200:
                result["延迟质量"] = "较差（100-200ms）"
            else:
                result["延迟质量"] = "很差（>200ms）"
        result["原始输出"] = output[:800]
        return result
    except Exception as e:
        return {"目标": target, "错误": str(e)}


def _tcp_ping(target, port, count):
    """TCP Ping（测试端口连通性和延迟）"""
    results = []
    try:
        # 解析域名
        try:
            ip = socket.gethostbyname(target)
        except socket.gaierror:
            ip = target
        for i in range(count):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(5)
                start = time.time()
                result = sock.connect_ex((ip, port))
                elapsed = round((time.time() - start) * 1000, 2)
                sock.close()
                if result == 0:
                    results.append({"seq": i + 1, "status": "open", "latency_ms": elapsed})
                else:
                    results.append({"seq": i + 1, "status": "closed/filtered", "latency_ms": elapsed})
            except Exception as e:
                results.append({"seq": i + 1, "status": "error", "error": str(e)[:50]})
        # 统计
        open_count = sum(1 for r in results if r["status"] == "open")
        latencies = [r["latency_ms"] for r in results if r["status"] == "open"]
        stats = {
            "目标": target,
            "IP": ip,
            "端口": port,
            "模式": "TCP",
            "发送": count,
            "成功": open_count,
            "失败": count - open_count,
            "成功率": f"{round(open_count/count*100, 1)}%" if count > 0 else "0%",
            "详细结果": results,
        }
        if latencies:
            stats["最小延迟"] = f"{min(latencies)}ms"
            stats["平均延迟"] = f"{round(sum(latencies)/len(latencies), 2)}ms"
            stats["最大延迟"] = f"{max(latencies)}ms"
        return stats
    except Exception as e:
        return {"目标": target, "端口": port, "错误": str(e)}


def _traceroute(target, max_hops=20):
    """简单Traceroute（Windows使用tracert，Linux使用traceroute）"""
    try:
        if platform.system().lower() == "windows":
            cmd = ["tracert", "-d", "-h", str(max_hops), "-w", "2000", target]
        else:
            cmd = ["traceroute", "-n", "-m", str(max_hops), "-w", "2", target]
        r = subprocess.run(cmd, capture_output=True, timeout=60)
        output = decode_output(r.stdout)
        # 解析跳数
        hops = []
        for line in output.split("\n"):
            line = line.strip()
            if not line:
                continue
            # 匹配跳数格式
            hop_match = re.match(r'^\s*(\d+)\s+(.+)', line)
            if hop_match:
                hop_num = int(hop_match.group(1))
                rest = hop_match.group(2)
                # 提取IP和延迟
                ip_match = re.search(r'(\d+\.\d+\.\d+\.\d+)', rest)
                time_matches = re.findall(r'([\d.]+)\s*ms', rest)
                hops.append({
                    "hop": hop_num,
                    "ip": ip_match.group(1) if ip_match else "未知",
                    "latencies": time_matches,
                    "raw": rest[:100],
                })
        return {
            "目标": target,
            "模式": "Traceroute",
            "最大跳数": max_hops,
            "实际跳数": len(hops),
            "跳数详情": hops,
            "原始输出": output[:1500],
        }
    except Exception as e:
        return {"目标": target, "错误": str(e)}


def ping_test(target: str = "", count: int = 4, mode: str = "icmp", port: int = 80) -> dict:
    """网络测试（增强版）"""
    if not target:
        return {"success": False, "error": "请输入目标IP或域名"}
    try:
        count = min(max(int(count) if count else 4, 1), 20)
        mode = mode.lower().strip()
        if mode == "icmp":
            result = _icmp_ping(target, count)
        elif mode == "tcp":
            result = _tcp_ping(target, port, count)
        elif mode == "traceroute":
            result = _traceroute(target, min(count, 30))
        else:
            return {"success": False, "error": f"未知模式: {mode}",
                    "支持的模式": ["icmp", "tcp", "traceroute"]}
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

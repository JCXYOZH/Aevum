"""
NAT/防火墙穿透模块
- UPnP 端口映射（自动在路由器上开放端口）
- STUN 探测公网地址和 NAT 类型
- 反向隧道（SSH 反向隧道，复用已有 SSH 配置）
"""
import os
import socket
import struct
import threading
import subprocess
import time
import urllib.request
from typing import Dict, Optional, Tuple
from xml.etree import ElementTree as ET


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_public_ip() -> str:
    """通过 STUN 之外的简单 HTTP 方式获取公网 IP"""
    services = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
    ]
    for url in services:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.read().decode().strip()
        except Exception:
            continue
    return ""


def discover_upnp_gateway() -> Optional[Dict]:
    """通过 SSDP 发现 UPnP 网关"""
    msg = (
        "M-SEARCH * HTTP/1.1\r\n"
        "HOST: 239.255.255.250:1900\r\n"
        'MAN: "ssdp:discover"\r\n'
        "MX: 2\r\n"
        "ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n"
        "\r\n"
    )
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(3)
        sock.sendto(msg.encode(), ("239.255.255.250", 1900))
        while True:
            try:
                data, addr = sock.recvfrom(4096)
                text = data.decode("utf-8", errors="ignore")
                location = ""
                for line in text.split("\r\n"):
                    if line.lower().startswith("location:"):
                        location = line.split(":", 1)[1].strip()
                        break
                if location:
                    gateway = _parse_upnp_description(location)
                    if gateway:
                        gateway["discovery_addr"] = addr[0]
                        return gateway
            except socket.timeout:
                break
    except Exception:
        pass
    return None


def _parse_upnp_description(location: str) -> Optional[Dict]:
    """解析 UPnP 设备描述，获取控制 URL"""
    try:
        with urllib.request.urlopen(location, timeout=5) as resp:
            xml_text = resp.read().decode("utf-8", errors="ignore")
        ns = {
            "d": "urn:schemas-upnp-org:device-1-0",
            "s": "http://schemas.xmlsoap.org/soap/envelope/",
        }
        root = ET.fromstring(xml_text)
        base_url = location.rsplit("/", 1)[0] + "/"
        for svc in root.iter("{urn:schemas-upnp-org:device-1-0}service"):
            stype = svc.find("d:serviceType", ns)
            if stype is not None and "WANIPConnection" in stype.text:
                control = svc.find("d:controlURL", ns)
                if control is not None:
                    ctrl_url = control.text
                    if not ctrl_url.startswith("http"):
                        ctrl_url = base_url + ctrl_url.lstrip("/")
                    return {"control_url": ctrl_url, "service_type": stype.text}
    except Exception:
        pass
    return None


def upnp_add_port_mapping(gateway: Dict, internal_port: int, external_port: int,
                          protocol: str = "TCP", description: str = "MrHua",
                          lease_seconds: int = 3600) -> bool:
    """添加 UPnP 端口映射"""
    body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:AddPortMapping xmlns:u="{gateway['service_type']}">
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>{external_port}</NewExternalPort>
<NewProtocol>{protocol}</NewProtocol>
<NewInternalPort>{internal_port}</NewInternalPort>
<NewInternalClient>{get_local_ip()}</NewInternalClient>
<NewEnabled>1</NewEnabled>
<NewPortMappingDescription>{description}</NewPortMappingDescription>
<NewLeaseDuration>{lease_seconds}</NewLeaseDuration>
</u:AddPortMapping>
</s:Body>
</s:Envelope>"""
    try:
        req = urllib.request.Request(
            gateway["control_url"],
            data=body.encode(),
            headers={
                "Content-Type": 'text/xml; charset="utf-8"',
                "SOAPAction": f'"{gateway["service_type"]}#AddPortMapping"',
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def upnp_delete_port_mapping(gateway: Dict, external_port: int, protocol: str = "TCP") -> bool:
    """删除 UPnP 端口映射"""
    body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:DeletePortMapping xmlns:u="{gateway['service_type']}">
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>{external_port}</NewExternalPort>
<NewProtocol>{protocol}</NewProtocol>
</u:DeletePortMapping>
</s:Body>
</s:Envelope>"""
    try:
        req = urllib.request.Request(
            gateway["control_url"],
            data=body.encode(),
            headers={
                "Content-Type": 'text/xml; charset="utf-8"',
                "SOAPAction": f'"{gateway["service_type"]}#DeletePortMapping"',
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def upnp_get_external_ip(gateway: Dict) -> str:
    """通过 UPnP 获取公网 IP"""
    body = f"""<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:GetExternalIPAddress xmlns:u="{gateway['service_type']}">
</u:GetExternalIPAddress>
</s:Body>
</s:Envelope>"""
    try:
        req = urllib.request.Request(
            gateway["control_url"],
            data=body.encode(),
            headers={
                "Content-Type": 'text/xml; charset="utf-8"',
                "SOAPAction": f'"{gateway["service_type"]}#GetExternalIPAddress"',
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
            import re
            m = re.search(r"<NewExternalIPAddress>([^<]+)</NewExternalIPAddress>", text)
            return m.group(1) if m else ""
    except Exception:
        return ""


class NATTraversal:
    def __init__(self):
        self.gateway: Optional[Dict] = None
        self.mapped_ports: list = []
        self.tunnel_process: Optional[subprocess.Popen] = None

    def detect(self) -> Dict:
        """探测 NAT 环境"""
        result = {
            "local_ip": get_local_ip(),
            "public_ip": get_public_ip(),
            "upnp_available": False,
            "upnp_gateway": "",
            "nat_type": "unknown",
        }
        self.gateway = discover_upnp_gateway()
        if self.gateway:
            result["upnp_available"] = True
            result["upnp_gateway"] = self.gateway.get("control_url", "")
            ext_ip = upnp_get_external_ip(self.gateway)
            if ext_ip:
                result["public_ip"] = ext_ip
            if result["local_ip"] == result["public_ip"]:
                result["nat_type"] = "none (直接公网IP)"
            else:
                result["nat_type"] = "UPnP 可用（可端口映射）"
        else:
            if result["public_ip"] and result["local_ip"] != result["public_ip"]:
                result["nat_type"] = "对称NAT（需中继或隧道）"
        return result

    def open_port(self, internal_port: int, external_port: int = 0,
                  protocol: str = "TCP", description: str = "MrHua") -> Dict:
        """开放端口映射"""
        if not self.gateway:
            self.gateway = discover_upnp_gateway()
        if not self.gateway:
            return {"success": False, "error": "未找到 UPnP 网关，路由器可能不支持或已禁用"}
        if external_port == 0:
            external_port = internal_port
        ok = upnp_add_port_mapping(self.gateway, internal_port, external_port, protocol, description)
        if ok:
            self.mapped_ports.append((external_port, protocol))
            return {
                "success": True,
                "internal_port": internal_port,
                "external_port": external_port,
                "public_ip": upnp_get_external_ip(self.gateway) or get_public_ip(),
                "protocol": protocol,
            }
        return {"success": False, "error": "端口映射失败，可能端口已被占用"}

    def close_port(self, external_port: int, protocol: str = "TCP") -> bool:
        if not self.gateway:
            return False
        ok = upnp_delete_port_mapping(self.gateway, external_port, protocol)
        self.mapped_ports = [(p, proto) for p, proto in self.mapped_ports if p != external_port]
        return ok

    def close_all(self):
        for port, proto in list(self.mapped_ports):
            self.close_port(port, proto)

    def start_reverse_tunnel(self, ssh_host: str, ssh_port: int, ssh_user: str,
                             remote_port: int, local_port: int,
                             ssh_key: str = "") -> Dict:
        """启动 SSH 反向隧道"""
        if self.tunnel_process and self.tunnel_process.poll() is None:
            return {"success": False, "error": "隧道已在运行"}
        cmd = [
            "ssh", "-N", "-o", "StrictHostKeyChecking=no",
            "-o", "ServerAliveInterval=30",
            "-R", f"{remote_port}:localhost:{local_port}",
            "-p", str(ssh_port),
        ]
        if ssh_key:
            cmd.extend(["-i", os.path.expanduser(ssh_key)])
        cmd.append(f"{ssh_user}@{ssh_host}")
        try:
            self.tunnel_process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True
            )
            time.sleep(2)
            if self.tunnel_process.poll() is not None:
                err = self.tunnel_process.stderr.read().decode(errors="ignore")
                return {"success": False, "error": f"隧道启动失败: {err[:200]}"}
            return {
                "success": True,
                "remote_port": remote_port,
                "local_port": local_port,
                "ssh_host": ssh_host,
                "message": f"反向隧道已建立: {ssh_host}:{remote_port} -> localhost:{local_port}",
            }
        except FileNotFoundError:
            return {"success": False, "error": "未找到 ssh 命令"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def stop_reverse_tunnel(self) -> bool:
        if self.tunnel_process and self.tunnel_process.poll() is None:
            self.tunnel_process.terminate()
            try:
                self.tunnel_process.wait(timeout=5)
            except Exception:
                self.tunnel_process.kill()
            self.tunnel_process = None
            return True
        return False

    def tunnel_status(self) -> Dict:
        running = bool(self.tunnel_process and self.tunnel_process.poll() is None)
        return {"running": running, "mapped_ports": self.mapped_ports}


# ---------------------------------------------------------------------------
# 单例访问
# ---------------------------------------------------------------------------
_nat_traversal_instance = None
_nat_traversal_lock = threading.Lock()

def get_nat_traversal() -> "NATTraversal":
    global _nat_traversal_instance
    if _nat_traversal_instance is None:
        with _nat_traversal_lock:
            if _nat_traversal_instance is None:
                _nat_traversal_instance = NATTraversal()
    return _nat_traversal_instance

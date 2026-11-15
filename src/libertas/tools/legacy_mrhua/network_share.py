"""
局域网对话与文件共享模块
- UDP 广播发现同一局域网内的 MrHua 用户
- HTTP 接口发送消息和文件
- 支持多平台（Windows/macOS/Linux）
"""
import os
import json
import time
import socket
import threading
import hashlib
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Callable
from datetime import datetime


def _get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _get_hostname() -> str:
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


class NetworkShare:
    DISCOVERY_PORT = 48888
    SHARE_PORT = 48889
    BROADCAST_ADDR = "255.255.255.255"
    DISCOVERY_INTERVAL = 15
    PEER_TIMEOUT = 45

    def __init__(self, nickname: str = "", share_dir: str = "", storage=None):
        self.nickname = nickname or _get_hostname()
        self.local_ip = _get_local_ip()
        self.peer_id = hashlib.md5(f"{self.local_ip}:{self.nickname}".encode()).hexdigest()[:12]
        self.peers: Dict[str, Dict] = {}
        self.messages: List[Dict] = []
        self.file_transfers: List[Dict] = []
        self._running = False
        self._discovery_thread: Optional[threading.Thread] = None
        self._listener_thread: Optional[threading.Thread] = None
        self._share_server_thread: Optional[threading.Thread] = None
        self._http_server = None
        self._on_peer_found: Optional[Callable] = None
        self._on_peer_lost: Optional[Callable] = None
        self._on_message: Optional[Callable] = None
        self._on_file_received: Optional[Callable] = None
        self._lock = threading.Lock()
        self.share_dir = share_dir or os.path.join(str(Path.home()), "MrHuaWorkspace", "SharedFiles")
        os.makedirs(self.share_dir, exist_ok=True)
        self.storage = storage
        self.room_id = "lan_default"

    def start(self):
        if self._running:
            return
        self._running = True
        self._discovery_thread = threading.Thread(target=self._discovery_loop, daemon=True)
        self._discovery_thread.start()
        self._listener_thread = threading.Thread(target=self._listen_loop, daemon=True)
        self._listener_thread.start()
        self._share_server_thread = threading.Thread(target=self._run_share_server, daemon=True)
        self._share_server_thread.start()
        self._announce()

    def stop(self):
        self._running = False
        if self._http_server:
            try:
                self._http_server.shutdown()
            except Exception:
                pass

    def set_nickname(self, name: str):
        self.nickname = name
        self.peer_id = hashlib.md5(f"{self.local_ip}:{self.nickname}".encode()).hexdigest()[:12]
        self._announce()

    def set_callbacks(self, on_peer_found=None, on_peer_lost=None, on_message=None, on_file_received=None):
        self._on_peer_found = on_peer_found
        self._on_peer_lost = on_peer_lost
        self._on_message = on_message
        self._on_file_received = on_file_received

    def _make_announce_packet(self) -> bytes:
        data = {
            "type": "announce",
            "peer_id": self.peer_id,
            "nickname": self.nickname,
            "ip": self.local_ip,
            "port": self.SHARE_PORT,
            "timestamp": time.time(),
        }
        return json.dumps(data, ensure_ascii=False).encode("utf-8")

    def _announce(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(self._make_announce_packet(), (self.BROADCAST_ADDR, self.DISCOVERY_PORT))
            sock.close()
        except Exception:
            pass

    def _discovery_loop(self):
        while self._running:
            self._announce()
            self._cleanup_peers()
            time.sleep(self.DISCOVERY_INTERVAL)

    def _listen_loop(self):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("0.0.0.0", self.DISCOVERY_PORT))
            sock.settimeout(2)
        except Exception:
            return
        while self._running:
            try:
                data, addr = sock.recvfrom(4096)
                info = json.loads(data.decode("utf-8"))
                if info.get("type") != "announce":
                    continue
                pid = info.get("peer_id", "")
                if pid == self.peer_id:
                    continue
                with self._lock:
                    is_new = pid not in self.peers
                    self.peers[pid] = {
                        "peer_id": pid,
                        "nickname": info.get("nickname", "unknown"),
                        "ip": info.get("ip", addr[0]),
                        "port": info.get("port", self.SHARE_PORT),
                        "last_seen": time.time(),
                    }
                if is_new and self._on_peer_found:
                    try:
                        self._on_peer_found(self.peers[pid])
                    except Exception:
                        pass
                self._send_unicast_announce(addr[0])
            except socket.timeout:
                continue
            except Exception:
                continue

    def _send_unicast_announce(self, ip: str):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(self._make_announce_packet(), (ip, self.DISCOVERY_PORT))
            sock.close()
        except Exception:
            pass

    def _cleanup_peers(self):
        now = time.time()
        lost = []
        with self._lock:
            for pid, peer in list(self.peers.items()):
                if now - peer["last_seen"] > self.PEER_TIMEOUT:
                    lost.append(peer)
                    del self.peers[pid]
        for peer in lost:
            if self._on_peer_lost:
                try:
                    self._on_peer_lost(peer)
                except Exception:
                    pass

    def get_peers(self) -> List[Dict]:
        with self._lock:
            return list(self.peers.values())

    def send_message(self, peer_id: str, text: str) -> bool:
        with self._lock:
            peer = self.peers.get(peer_id)
        if not peer:
            return False
        msg = {
            "type": "message",
            "from_id": self.peer_id,
            "from_name": self.nickname,
            "text": text,
            "timestamp": datetime.now().strftime("%H:%M:%S"),
        }
        try:
            import urllib.request
            url = f"http://{peer['ip']}:{peer['port']}/message"
            req = urllib.request.Request(url, data=json.dumps(msg, ensure_ascii=False).encode("utf-8"),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=5)
            with self._lock:
                self.messages.append({**msg, "to_id": peer_id, "to_name": peer["nickname"], "direction": "out"})
            if self.storage:
                try:
                    self.storage.store_message("lan", self.room_id, peer_id, peer["nickname"], "out", text)
                except Exception:
                    pass
            return True
        except Exception:
            return False

    def send_file(self, peer_id: str, file_path: str) -> bool:
        with self._lock:
            peer = self.peers.get(peer_id)
        if not peer or not os.path.isfile(file_path):
            return False
        try:
            from http.client import HTTPConnection
            import mimetypes
            filename = os.path.basename(file_path)
            boundary = uuid.uuid4().hex
            with open(file_path, "rb") as f:
                file_data = f.read()
            body = (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: {mimetypes.guess_type(filename)[0] or 'application/octet-stream'}\r\n\r\n"
            ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("utf-8")
            conn = HTTPConnection(peer["ip"], peer["port"], timeout=30)
            conn.request("POST", "/file", body=body,
                         headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
            resp = conn.getresponse()
            ok = resp.status == 200
            conn.close()
            if ok:
                with self._lock:
                    self.file_transfers.append({
                        "filename": filename, "size": len(file_data),
                        "to_name": peer["nickname"], "direction": "out",
                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                    })
            return ok
        except Exception:
            return False

    def get_messages(self) -> List[Dict]:
        with self._lock:
            return list(self.messages)

    def get_file_transfers(self) -> List[Dict]:
        with self._lock:
            return list(self.file_transfers)

    def get_shared_files(self) -> List[Dict]:
        files = []
        try:
            for f in os.listdir(self.share_dir):
                fp = os.path.join(self.share_dir, f)
                if os.path.isfile(fp):
                    stat = os.stat(fp)
                    files.append({
                        "name": f,
                        "size": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                    })
        except Exception:
            pass
        return files

    def _run_share_server(self):
        from http.server import HTTPServer, BaseHTTPRequestHandler
        share_self = self

        class ShareHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/ping":
                    self._json({"status": "ok", "peer_id": share_self.peer_id, "nickname": share_self.nickname})
                elif self.path == "/files":
                    self._json({"files": share_self.get_shared_files()})
                elif self.path.startswith("/download/"):
                    filename = self.path[len("/download/"):]
                    filepath = os.path.join(share_self.share_dir, filename)
                    if os.path.isfile(filepath) and os.path.abspath(filepath).startswith(os.path.abspath(share_self.share_dir)):
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                        self.end_headers()
                        with open(filepath, "rb") as f:
                            self.wfile.write(f.read())
                    else:
                        self.send_error(404)
                else:
                    self.send_error(404)

            def do_POST(self):
                if self.path == "/message":
                    length = int(self.headers.get("Content-Length", 0))
                    try:
                        data = json.loads(self.rfile.read(length).decode("utf-8"))
                        data["direction"] = "in"
                        with share_self._lock:
                            share_self.messages.append(data)
                        if share_self._on_message:
                            try:
                                share_self._on_message(data)
                            except Exception:
                                pass
                        if share_self.storage:
                            try:
                                share_self.storage.store_message("lan", share_self.room_id,
                                    data.get("from_id",""), data.get("from_name",""), "in", data.get("text",""))
                            except Exception:
                                pass
                        self._json({"status": "ok"})
                    except Exception as e:
                        self._json({"status": "error", "error": str(e)}, code=400)
                elif self.path == "/file":
                    try:
                        content_type = self.headers.get("Content-Type", "")
                        if "multipart/form-data" not in content_type:
                            self._json({"status": "error"}, code=400)
                            return
                        boundary = content_type.split("boundary=")[-1].encode()
                        length = int(self.headers.get("Content-Length", 0))
                        body = self.rfile.read(length)
                        parts = body.split(b"--" + boundary)
                        for part in parts:
                            if b'Content-Disposition' in part and b'filename=' in part:
                                header_end = part.find(b"\r\n\r\n")
                                if header_end == -1:
                                    continue
                                headers = part[:header_end].decode("utf-8", errors="ignore")
                                file_data = part[header_end + 4:]
                                if file_data.endswith(b"\r\n"):
                                    file_data = file_data[:-2]
                                import re
                                m = re.search(r'filename="([^"]+)"', headers)
                                if m:
                                    filename = m.group(1)
                                    safe_name = os.path.basename(filename)
                                    filepath = os.path.join(share_self.share_dir, safe_name)
                                    with open(filepath, "wb") as f:
                                        f.write(file_data)
                                    info = {
                                        "filename": safe_name, "size": len(file_data),
                                        "from_name": "unknown", "direction": "in",
                                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                                    }
                                    with share_self._lock:
                                        share_self.file_transfers.append(info)
                                    if share_self._on_file_received:
                                        try:
                                            share_self._on_file_received(info)
                                        except Exception:
                                            pass
                        self._json({"status": "ok"})
                    except Exception as e:
                        self._json({"status": "error", "error": str(e)}, code=400)
                else:
                    self.send_error(404)

            def _json(self, data, code=200):
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

        try:
            self._http_server = HTTPServer(("0.0.0.0", self.SHARE_PORT), ShareHandler)
            self._http_server.serve_forever()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 单例访问
# ---------------------------------------------------------------------------
_network_share_instance = None
_network_share_lock = threading.Lock()

def get_network_share() -> Optional["NetworkShare"]:
    global _network_share_instance
    if _network_share_instance is None:
        with _network_share_lock:
            if _network_share_instance is None:
                _network_share_instance = NetworkShare()
    return _network_share_instance

"""Monitor 的 HTTP 分发与静态文件响应。

只处理请求路由、静态资源、鉴权/回路/WAN 委派；数据投影在
``monitor_payloads.py``，对话生成在 ``monitor_chat.py``。
"""

from __future__ import annotations

import gzip
import json
import mimetypes
from email.utils import formatdate
from http import HTTPStatus
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    from .monitor_config import BUILD_ROOT, ROOT, WEB_ROOT
    from .monitor_payloads import (
        error_codes,
        health_payload,
        is_local_http_request,
        model_payload,
        trainer_payload,
    )
    from .api.capabilities import capabilities_payload
    from .api.governance import handle_get as governance_get, handle_post as governance_post
    from .api.visitor import community_overview, visitor_payload
    from .chat_api import ChatAPI
except ImportError:  # 以脚本方式运行
    from monitor_config import BUILD_ROOT, ROOT, WEB_ROOT
    from monitor_payloads import (
        error_codes,
        health_payload,
        is_local_http_request,
        model_payload,
        trainer_payload,
    )
    from api.capabilities import capabilities_payload
    from api.governance import handle_get as governance_get, handle_post as governance_post
    from api.visitor import community_overview, visitor_payload
    from chat_api import ChatAPI


class MonitorHTTPMixin:
    """处理监控服务的 HTTP 路由；由 ``MonitorHandler`` 组合。"""

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        return

    def _send_json(self, payload: dict, status: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, status: int = 200) -> None:
        try:
            stat = path.stat()
            data = path.read_bytes()
        except OSError:
            self._send_json({"ok": False, "message": "file not found"}, 404)
            return
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix.lower() in {".html", ".js", ".css", ".json", ".txt", ".md"}:
            ctype += "; charset=utf-8"
        etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        last_modified = formatdate(stat.st_mtime, usegmt=True)
        if status == HTTPStatus.OK and self._etag_matches(etag):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Last-Modified", last_modified)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        body = data
        content_encoding = None
        if path.suffix.lower() in {".html", ".js", ".css", ".json", ".txt", ".md"}:
            if "gzip" in self.headers.get("Accept-Encoding", "").lower():
                body = gzip.compress(data, compresslevel=6)
                content_encoding = "gzip"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", last_modified)
        if content_encoding:
            self.send_header("Content-Encoding", content_encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        self.wfile.write(body)

    def _etag_matches(self, etag: str) -> bool:
        header = self.headers.get("If-None-Match", "")
        if not header:
            return False
        for token in header.split(","):
            token = token.strip()
            if token == "*" or token.removeprefix("W/") == etag:
                return True
        return False

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        metrics_path = Path(self.server.metrics_path)

        auth_api = getattr(self.server, "auth_api", None)
        if auth_api is not None and (
            route.startswith("/api/auth/")
            or route == "/api/current_user"
            or route.startswith("/api/loop/")
        ):
            if auth_api.handle_get(self, route):
                return

        wan_api = getattr(self.server, "wan_api", None)
        if wan_api is not None and (
            route.startswith("/api/wan/") or route == "/api/nat/status"
        ):
            if wan_api.handle_get(self, route):
                return

        if route == "/api/visitor/bootstrap":
            user = auth_api.current_user(self) if auth_api is not None else None
            payload, cookie = visitor_payload(
                self, auth_api, wan_api, user=user, create_guest=True,
            )
            scope = str(payload.get("actor", {}).get("data_scope", ""))
            if wan_api is not None and scope:
                wan_api.set_data_scope(scope)
            self._send_json(
                payload,
                headers={"Set-Cookie": cookie} if cookie else None,
            )
            return
        if route == "/api/community/overview":
            self._send_json({"success": True, **community_overview(auth_api, wan_api)})
            return
        if route.startswith("/api/governance/") or route == "/api/community/stats":
            if governance_get(self, route, auth_api, wan_api):
                return

        if route in ("/", "/apps/community/web", "/apps/community/web/"):
            # 根入口与静态目录入口统一是展示页；3D 桌面只走 /desktop 或 desktop.html。
            self._send_file(WEB_ROOT / "index.html")
            return
        if route == "/desktop":
            self._send_file(WEB_ROOT / "desktop.html")
            return
        if route == "/legacy":
            self._send_file(WEB_ROOT / "index.html")
            return
        if route == "/mrhua":
            self.send_response(302)
            self.send_header("Location", "/apps/community/web/mrhua/index.html")
            self.end_headers()
            return
        if route == "/mrhua/":
            self._send_file(WEB_ROOT / "mrhua" / "index.html")
            return
        if route == "/api/health":
            self._send_json(health_payload(metrics_path, getattr(self.server, "ports", None)))
            return
        if route == "/api/capabilities":
            self._send_json(capabilities_payload())
            return
        if route == "/api/trainer":
            self._send_json(
                trainer_payload(
                    metrics_path,
                    BUILD_ROOT / "trainer.out.log",
                    BUILD_ROOT / "trainer.err.log",
                )
            )
            return
        if route == "/api/errors":
            payload = trainer_payload(
                metrics_path,
                BUILD_ROOT / "trainer.out.log",
                BUILD_ROOT / "trainer.err.log",
            )
            self._send_json(
                {
                    "errors": payload["errors"],
                    "known": error_codes(),
                    "source": "trainer logs + relay contract",
                }
            )
            return
        if route == "/api/apps":
            self._send_json(
                {
                    "apps": [
                        {"id": "overview", "title": "总览", "detail": "内核 / 中继 / 训练状态"},
                        {"id": "kernel", "title": "内核实况", "detail": "80×25 VGA 串口帧"},
                        {"id": "trainer", "title": "训练监控", "detail": "loss / epoch / device"},
                        {"id": "model", "title": "模型对话", "detail": "加载检查点并生成文本"},
                        {"id": "relay", "title": "中继交流", "detail": "房间与消息"},
                        {"id": "errors", "title": "错误看板", "detail": "0xRRFFTT 与日志"},
                        {"id": "exhibit", "title": "展示页", "detail": "原 AEVUM 长页"},
                    ]
                }
            )
            return
        if route == "/api/model":
            self._send_json(
                model_payload(
                    Path(getattr(self.server, "model_exe", BUILD_ROOT / "memoria_gen_cpu.exe")),
                    Path(getattr(self.server, "model_data", ROOT / "data" / "tinyshakespeare_3000.txt")),
                    Path(getattr(self.server, "model_exe_cuda", BUILD_ROOT / "memoria_gen.exe")),
                    public=not is_local_http_request(self),
                )
            )
            return

        # Static files are served from the copied community web directory.
        safe = unquote(route.lstrip("/"))
        if safe.startswith("api/"):
            self._send_json({"ok": False, "message": "unknown api"}, 404)
            return
        # 拆分后的页面从真实项目根加载 /engine 与 /apps/console/ui，而不是复制一份脚本。
        if safe.startswith(("apps/console/ui/", "apps/community/web/", "engine/")):
            target = (ROOT / safe).resolve()
            if ROOT.resolve() not in target.parents and target != ROOT.resolve():
                self._send_json({"ok": False, "message": "invalid path"}, 400)
                return
            if target.exists() and target.is_file():
                self._send_file(target)
                return
            self._send_json({"ok": False, "message": "file not found"}, 404)
            return
        target = (WEB_ROOT / safe).resolve()
        if WEB_ROOT.resolve() not in target.parents and target != WEB_ROOT.resolve():
            self._send_json({"ok": False, "message": "invalid path"}, 400)
            return
        if not target.exists() or not target.is_file():
            # Unknown routes fall back to the showcase page; desktop stays explicit.
            target = WEB_ROOT / "index.html"
        self._send_file(target)


    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        auth_api = getattr(self.server, "auth_api", None)
        wan_api = getattr(self.server, "wan_api", None)
        # 会话历史与取消标记必须跨请求保留，所以 ChatAPI 只创建一次，挂在 server 上。
        chat_api = getattr(self.server, "chat_api", None)
        if chat_api is None and auth_api is not None:
            chat_api = ChatAPI(
                auth_api,
                self._generate_for_chat,
                on_scope=wan_api.set_data_scope if wan_api is not None else None,
            )
            self.server.chat_api = chat_api
        elif chat_api is not None and wan_api is not None:
            chat_api.on_scope = wan_api.set_data_scope
        if auth_api is not None and (
            parsed.path.startswith("/api/auth/")
            or parsed.path.startswith("/api/loop/")
        ):
            if auth_api.handle_post(self, parsed.path):
                return
            self._send_json({"success": False, "message": "unknown auth api"}, 404)
            return
        if chat_api is not None and parsed.path.startswith("/api/chat/"):
            if chat_api.handle_post(self, parsed.path):
                return
            self._send_json({"success": False, "message": "unknown chat api"}, 404)
            return
        if wan_api is not None and parsed.path.startswith("/api/wan/"):
            if wan_api.handle_post(self, parsed.path):
                return
            self._send_json({"success": False, "message": "unknown wan api"}, 404)
            return
        if parsed.path.startswith("/api/governance/"):
            if governance_post(self, parsed.path, auth_api, wan_api):
                return
            self._send_json({"success": False, "message": "unknown governance api"}, 404)
            return
        if parsed.path == "/api/model/generate" and not is_local_http_request(self):
            self._send_json({"ok": False, "message": "模型生成只在本机开放"}, 403)
            return
        if parsed.path != "/api/model/generate":
            self._send_json({"ok": False, "message": "unknown api"}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 65536:
                raise ValueError("request body must be 1..65536 bytes")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (OSError, ValueError) as error:
            self._send_json({"ok": False, "message": f"bad json: {error}"}, 400)
            return

        payload, status = self._generate_text(body)
        self._send_json(payload, status)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        auth_api = getattr(self.server, "auth_api", None)
        if auth_api is not None and parsed.path.startswith("/api/auth/"):
            if auth_api.handle_delete(self, parsed.path):
                return
            self._send_json({"success": False, "message": "unknown auth api"}, 404)
            return
        self._send_json({"success": False, "message": "unknown api"}, 404)

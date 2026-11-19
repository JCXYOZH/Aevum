#!/usr/bin/env python3
"""Aevum World QML shell.

QML only owns the native window and one WebEngineView. The world itself stays
in the existing JS/WebGL engine; this process adds the local asset server and
the relay process so the shell can be packaged as one application.
"""

from __future__ import annotations

import argparse
import atexit
import json
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlencode, urlsplit

from PySide6.QtCore import Property, QObject, QUrl, Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtWebEngineQuick import QtWebEngineQuick


WEB_PORT = int(os.environ.get("AEVUM_WEB_PORT", "8799"))
RELAY_PORT = int(os.environ.get("AEVUM_RELAY_PORT", "8790"))
DEFAULT_RELAY = f"http://127.0.0.1:{RELAY_PORT}"


def bundle_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parents[3]


def web_root() -> Path:
    override = os.environ.get("AEVUM_WEB_ROOT")
    if override:
        return Path(override).resolve()
    base = bundle_root()
    if (base / "web" / "world.html").exists():
        return base / "web"
    return base / "interface" / "web"


def engine_root() -> Path:
    override = os.environ.get("AEVUM_ENGINE_ROOT")
    if override:
        return Path(override).resolve()
    base = bundle_root()
    if (base / "engine" / "assets").exists():
        return base / "engine"
    return base / "engine"


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


class AssetHandler(SimpleHTTPRequestHandler):
    web_dir = ""
    engine_dir = ""

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def translate_path(self, path: str) -> str:
        clean = unquote(urlsplit(path).path)
        if clean == "/":
            clean = "/world.html"
        if clean.startswith("/engine/"):
            root = self.engine_dir
            clean = clean[len("/engine"):]
        else:
            root = self.web_dir
        parts = [part for part in clean.split("/") if part and part not in (".", "..")]
        return os.path.join(root, *parts)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store" if self.path.endswith(".html") else "public, max-age=300")
        super().end_headers()


def ensure_assets_server() -> ThreadingHTTPServer | None:
    if port_open(WEB_PORT):
        return None
    mimetypes.add_type("application/octet-stream", ".vrm")
    mimetypes.add_type("model/gltf-binary", ".glb")
    mimetypes.add_type("text/javascript", ".js")
    AssetHandler.web_dir = str(web_root())
    AssetHandler.engine_dir = str(engine_root())
    server = ThreadingHTTPServer(("127.0.0.1", WEB_PORT), AssetHandler)
    thread = threading.Thread(target=server.serve_forever, name="aevum-assets", daemon=True)
    thread.start()
    return server


def ensure_relay() -> subprocess.Popen | None:
    if os.environ.get("AEVUM_NO_RELAY") == "1" or port_open(RELAY_PORT):
        return None
    base = bundle_root()
    packaged = base / "relay" / "memoria-relay.exe"
    relay_dir = base / "control" / "relay"
    if packaged.exists():
        command = [str(packaged), "--host", "127.0.0.1", "--port", str(RELAY_PORT)]
        cwd = packaged.parent
    elif (relay_dir / "relay").exists():
        python = os.environ.get("AEVUM_PYTHON", sys.executable)
        command = [python, "-X", "utf8", "-m", "relay", "--skip-selfcheck",
                   "--host", "127.0.0.1", "--port", str(RELAY_PORT)]
        cwd = relay_dir
    else:
        return None
    process = subprocess.Popen(command, cwd=str(cwd), stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, creationflags=0)
    for _ in range(100):
        if port_open(RELAY_PORT):
            break
        time.sleep(0.1)
    return process


class WorldConfig(QObject):
    def __init__(self, url: str, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._url = url

    @Property(str, constant=True)
    def url(self) -> str:
        return self._url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Aevum World QML shell")
    parser.add_argument("--name", default=os.environ.get("AEVUM_NAME", "旅人"))
    parser.add_argument("--room", default=os.environ.get("AEVUM_ROOM", "world-lobby"))
    parser.add_argument("--relay", default=os.environ.get("AEVUM_RELAY_URL", DEFAULT_RELAY))
    parser.add_argument("--url", default=os.environ.get("AEVUM_WORLD_URL", ""))
    return parser.parse_args()


def page_url() -> str:
    candidates = [
        f"http://127.0.0.1:{WEB_PORT}/world.html",
        f"http://127.0.0.1:{WEB_PORT}/interface/web/world.html",
    ]
    import urllib.request
    for candidate in candidates:
        try:
            request = urllib.request.Request(candidate, method="HEAD")
            with urllib.request.urlopen(request, timeout=1.0) as response:
                if response.status == 200:
                    return candidate
        except Exception:
            continue
    return candidates[0]


def main() -> int:
    args = parse_args()
    server = None
    relay = None
    if not args.url:
        server = ensure_assets_server()
        relay = ensure_relay()
        base = page_url()
    else:
        base = args.url

    if server is not None:
        atexit.register(server.shutdown)
    if relay is not None:
        atexit.register(relay.terminate)

    query = urlencode({"name": args.name, "room": args.room, "relay": args.relay,
                       "v": os.environ.get("AEVUM_WORLD_VERSION", "qml")})
    scene_url = base + ("&" if "?" in base else "?") + query

    QtWebEngineQuick.initialize()
    QGuiApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts, True)
    app = QGuiApplication(sys.argv)
    app.setApplicationName("Aevum World")

    engine = QQmlApplicationEngine()
    config = WorldConfig(scene_url)
    engine.rootContext().setContextProperty("worldConfig", config)
    engine._aevum_config = config

    here = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    engine.load(QUrl.fromLocalFile(str(here / "Main.qml")))
    if not engine.rootObjects():
        return 1
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())

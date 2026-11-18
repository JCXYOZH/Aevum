#!/usr/bin/env python3
"""Aevum QML shell entry.

Native QML chrome around one WebEngine view. The existing Aevum JS scene is
loaded unchanged; no second renderer and no per-app embedded HTML windows.
The Python side only provides narrow native probes: health, the C-kernel
serial bridge, and local photo saving.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time

from PySide6.QtCore import Property, QObject, QTimer, QUrl, Signal, Slot, Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QTcpSocket
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtWebEngineQuick import QtWebEngineQuick


class HealthProbe(QObject):
    changed = Signal()

    def __init__(self, base: str, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._base = base.rstrip("/")
        self._online = False
        self._bridge_ok = False
        self._relay_ok = False
        self._trainer_ok = False
        self._web_ok = False
        self._detail = "127.0.0.1 · QML 外壳"
        self._busy = False
        self._manager = QNetworkAccessManager(self)
        self._timer = QTimer(self)
        self._timer.setInterval(5000)
        self._timer.timeout.connect(self.refresh)

    def _get(self, name: str) -> bool:
        return bool(getattr(self, name))

    @Property(bool, notify=changed)
    def online(self) -> bool:
        return self._online

    @Property(bool, notify=changed)
    def bridgeOk(self) -> bool:
        return self._bridge_ok

    @Property(bool, notify=changed)
    def relayOk(self) -> bool:
        return self._relay_ok

    @Property(bool, notify=changed)
    def trainerOk(self) -> bool:
        return self._trainer_ok

    @Property(bool, notify=changed)
    def webOk(self) -> bool:
        return self._web_ok

    @Property(str, notify=changed)
    def detail(self) -> str:
        return self._detail

    def start(self) -> None:
        self._timer.start()
        self.refresh()

    @Slot()
    def refresh(self) -> None:
        if self._busy:
            return
        self._busy = True
        request = QNetworkRequest(QUrl(self._base + "/api/health"))
        request.setAttribute(QNetworkRequest.Attribute.CacheLoadControlAttribute, QNetworkRequest.CacheLoadControl.AlwaysNetwork)
        reply = self._manager.get(request)
        reply.finished.connect(lambda: self._finish(reply))

    def _finish(self, reply) -> None:
        try:
            payload = bytes(reply.readAll()).decode("utf-8", "replace")
            data = json.loads(payload) if payload else {}
            services = data.get("services") or {}
            trainer = data.get("trainer") or {}
            self._bridge_ok = bool((services.get("bridge") or {}).get("ok"))
            self._relay_ok = bool((services.get("relay") or {}).get("ok"))
            self._web_ok = bool((services.get("web") or {}).get("ok"))
            self._trainer_ok = bool(trainer.get("running"))
            self._online = True
            self._detail = "场景 / 回路 / 服务 · " + time.strftime("%H:%M:%S")
        except Exception:
            self._online = False
            self._bridge_ok = False
            self._relay_ok = False
            self._trainer_ok = False
            self._web_ok = False
            self._detail = "127.0.0.1:8799 · 未连接"
        finally:
            self._busy = False
            reply.deleteLater()
            self.changed.emit()


class KernelBridge(QObject):
    changed = Signal()

    SYNC0 = 0xA5
    SYNC1 = 0x5A
    HEADER = 4
    MAX_CELLS = 32

    def __init__(self, host: str = "127.0.0.1", port: int = 5555, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._host = host
        self._port = port
        self._state = "待接入"
        self._frame_count = 0
        self._last_cells = 0
        self._active = False
        self._buffer = bytearray()
        self._socket = QTcpSocket(self)
        self._socket.connected.connect(self._on_connected)
        self._socket.disconnected.connect(self._on_disconnected)
        self._socket.readyRead.connect(self._on_read)
        self._socket.errorOccurred.connect(self._on_error)
        self._timer = QTimer(self)
        self._timer.setInterval(2200)
        self._timer.timeout.connect(self._ensure_connection)

    @Property(str, notify=changed)
    def state(self) -> str:
        return self._state

    @Property(int, notify=changed)
    def frameCount(self) -> int:
        return self._frame_count

    @Property(int, notify=changed)
    def lastCells(self) -> int:
        return self._last_cells

    @Slot()
    def start(self) -> None:
        if self._active:
            return
        self._active = True
        self._timer.start()
        self._ensure_connection()

    @Slot()
    def stop(self) -> None:
        self._active = False
        self._timer.stop()
        self._socket.abort()
        self._state = "待接入"
        self.changed.emit()

    def _set_state(self, value: str) -> None:
        if self._state != value:
            self._state = value
            self.changed.emit()

    def _ensure_connection(self) -> None:
        if not self._active:
            return
        if self._socket.state() == QTcpSocket.SocketState.UnconnectedState:
            self._set_state("连接中")
            self._socket.connectToHost(self._host, self._port)

    def _on_connected(self) -> None:
        self._buffer.clear()
        self._set_state("已连接")
        # 让 C 内核立刻发一帧完整 VGA，和旧 WebSocket 桥的握手一致。
        try:
            self._socket.write(b"F")
            self._socket.flush()
        except Exception:
            pass

    def _on_disconnected(self) -> None:
        if self._active:
            self._set_state("待接入")
            self._timer.start()

    def _on_error(self, _error) -> None:
        if self._active:
            self._set_state("待接入")

    def _on_read(self) -> None:
        self._buffer.extend(bytes(self._socket.readAll()))
        while True:
            start = 0
            while start + 1 < len(self._buffer):
                if self._buffer[start] == self.SYNC0 and self._buffer[start + 1] == self.SYNC1:
                    break
                start += 1
            if start > 0:
                del self._buffer[:start]
            if len(self._buffer) < self.HEADER:
                break
            count = self._buffer[3]
            if count > self.MAX_CELLS:
                del self._buffer[:1]
                continue
            total = self.HEADER + count * 4 + 1
            if len(self._buffer) < total:
                break
            crc = 0
            for value in self._buffer[: total - 1]:
                crc ^= value
            if crc != self._buffer[total - 1]:
                del self._buffer[:1]
                continue
            cells = self._buffer[self.HEADER : total - 1]
            self._frame_count += 1
            self._last_cells = len(cells) // 4
            del self._buffer[:total]
        self.changed.emit()


class PhotoSaver(QObject):
    @Slot(str, result=str)
    def saveDataUrl(self, data_url: str) -> str:
        if not data_url.startswith("data:image/") or "," not in data_url:
            return ""
        try:
            payload = data_url.split(",", 1)[1]
            raw = base64.b64decode(payload)
            root = os.environ.get("LIBERTAS_DATA_DIR", r"D:\LibertasData\AevumData")
            directory = os.path.join(root, "photos")
            os.makedirs(directory, exist_ok=True)
            name = "aevum_" + time.strftime("%Y%m%d_%H%M%S") + ".png"
            path = os.path.join(directory, name)
            with open(path, "wb") as handle:
                handle.write(raw)
            return path
        except Exception:
            return ""


def main() -> int:
    QtWebEngineQuick.initialize()
    QGuiApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts, True)
    app = QGuiApplication(sys.argv)
    app.setApplicationName("Aevum QML Shell")

    engine = QQmlApplicationEngine()
    health = HealthProbe("http://127.0.0.1:8799")
    kernel = KernelBridge()
    photos = PhotoSaver()

    engine.rootContext().setContextProperty("healthProbe", health)
    engine.rootContext().setContextProperty("kernelBridge", kernel)
    engine.rootContext().setContextProperty("photoSaver", photos)
    engine._aevum_objects = (health, kernel, photos)

    here = os.path.dirname(os.path.abspath(__file__))
    engine.load(QUrl.fromLocalFile(os.path.join(here, "Main.qml")))
    if not engine.rootObjects():
        return 1

    health.start()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())

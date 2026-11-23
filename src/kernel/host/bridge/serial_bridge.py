#!/usr/bin/env python3
"""
AEVUM serial bridge: reads TCP-framed serial from QEMU, forwards to WebSocket.
Delta frame: A5 5A 01 COUNT [row col ch attr] * COUNT CRC
Status frame: A5 5A 03 19 + 19 * i32 LE + CRC
Joint command to kernel: b"J" + 3 * i16 LE (0.001 rad)
Release manual: b"R"
"""
import asyncio
import json
import os
import struct
import sys
import websockets

# 桌面安装包会通过环境变量指定端口；仓库里直接运行时保持旧默认值。
QEMU_SERIAL_HOST = os.environ.get("QEMU_SERIAL_HOST", "127.0.0.1")
QEMU_SERIAL_PORT = int(os.environ.get("QEMU_SERIAL_PORT", "5555"))
WS_HOST = os.environ.get("BRIDGE_WS_HOST", "127.0.0.1")
WS_PORT = int(os.environ.get("BRIDGE_WS_PORT", "8765"))

SYNC0 = 0xA5
SYNC1 = 0x5A
FRAME_TYPE_DELTA = 0x01
FRAME_TYPE_STATE = 0x02
FRAME_TYPE_STATUS = 0x03
FRAME_HDR = 4
MAX_CELLS = 32
STATE_VALS = 3
STATUS_FIELDS = (
    "q0", "q1", "q2",
    "dq0", "dq1", "dq2",
    "qt0", "qt1", "qt2",
    "tx", "ty",
    "err_mm", "w_manip", "sigma_min", "sigma_max",
    "null_share", "limit_margin", "mode", "null_on",
)
Q16_ONE = 65536.0
Q_LIMIT = 193986
Q_SANE_LIMIT = 210000


def status_is_sane(status):
    """Reject a CRC collision that starts inside a VGA delta payload."""
    for key in ("q0", "q1", "q2", "qt0", "qt1", "qt2"):
        if abs(status[key]) > Q_SANE_LIMIT:
            return False
    for key in ("dq0", "dq1", "dq2"):
        if abs(status[key]) > Q_SANE_LIMIT:
            return False
    if status["mode"] not in (0, 1):
        return False
    if status["null_on"] not in (0, 1):
        return False
    if status["null_share"] < 0 or status["null_share"] > Q16_ONE:
        return False
    if status["limit_margin"] < 0 or status["limit_margin"] > 200 * Q16_ONE:
        return False
    return True


class FrameParser:
    def __init__(self):
        self.buf = bytearray()
        self.frames_ok = 0
        self.frames_bad = 0

    def feed(self, data: bytes):
        self.buf.extend(data)
        out = []
        while True:
            # sync
            i = 0
            while i + 1 < len(self.buf):
                if self.buf[i] == SYNC0 and self.buf[i + 1] == SYNC1:
                    break
                i += 1
            if i > 0:
                del self.buf[:i]
            if len(self.buf) < FRAME_HDR:
                break
            ftype = self.buf[2]
            count = self.buf[3]
            if count > MAX_CELLS:
                del self.buf[:1]
                self.frames_bad += 1
                continue
            total = FRAME_HDR + count * 4 + 1
            if len(self.buf) < total:
                break
            crc = 0
            for b in self.buf[:total - 1]:
                crc ^= b
            if crc != self.buf[total - 1]:
                del self.buf[:1]
                self.frames_bad += 1
                continue
            if ftype == FRAME_TYPE_STATE:
                if count != STATE_VALS:
                    del self.buf[:1]
                    self.frames_bad += 1
                    continue
                q = struct.unpack_from("<iii", self.buf, FRAME_HDR)
                out.append({
                    "type": "state",
                    "q": [round(v / Q16_ONE, 6) for v in q],
                })
                del self.buf[:total]
                self.frames_ok += 1
                continue
            if ftype == FRAME_TYPE_STATUS:
                if count != len(STATUS_FIELDS):
                    del self.buf[:1]
                    self.frames_bad += 1
                    continue
                vals = struct.unpack_from("<%di" % count, self.buf, FRAME_HDR)
                status = dict(zip(STATUS_FIELDS, vals))
                if not status_is_sane(status):
                    del self.buf[:1]
                    self.frames_bad += 1
                    continue
                out.append({
                    "type": "status",
                    "q": [round(status["q%d" % i] / Q16_ONE, 6) for i in range(3)],
                    "values": status,
                })
                del self.buf[:total]
                self.frames_ok += 1
                continue
            cells = []
            p = FRAME_HDR
            for _ in range(count):
                row, col, ch, attr = struct.unpack_from("BBBB", self.buf, p)
                cells.append((row, col, ch, attr))
                p += 4
            out.append({"type": ftype, "cells": cells})
            del self.buf[:total]
            self.frames_ok += 1
        return out


async def serial_reader(parser, broadcast, link):
    while True:
        try:
            reader, writer = await asyncio.open_connection(QEMU_SERIAL_HOST, QEMU_SERIAL_PORT)
            break
        except OSError:
            # QEMU 先启动还是桥接先启动都可能；桥接先起时在这里等串口。
            await asyncio.sleep(0.4)
    link["writer"] = writer
    print(f"[bridge] connected to QEMU serial {QEMU_SERIAL_HOST}:{QEMU_SERIAL_PORT}")
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            for frame in parser.feed(data):
                await broadcast(frame)
    finally:
        link["writer"] = None
        writer.close()


async def main():
    parser = FrameParser()
    clients = set()
    state = {}
    last_status = {"frame": None}
    link = {"writer": None}

    async def send_status(ws, frame):
        await ws.send(json.dumps(frame))

    async def handler(ws):
        clients.add(ws)
        try:
            # 新窗口后连接时补一帧当前画面，否则只收到打开之后的差量。
            if state:
                await ws.send(json.dumps({"type": "frame", "cells": list(state.values())}))
            # 新订阅者补最近一次完整状态，避免等下一次 8 帧扫描。
            if last_status["frame"] is not None:
                await send_status(ws, last_status["frame"])
            # 让内核下一次扫描发送完整 VGA，补齐窗口连接前就已经存在的静态单元。
            if link["writer"]:
                try:
                    link["writer"].write(b"F")
                    await link["writer"].drain()
                except Exception:
                    pass
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                if msg.get("type") in ("joint", "manual"):
                    q = msg.get("q")
                    if not isinstance(q, list) or len(q) != 3:
                        continue
                    try:
                        raw_q = [int(round(float(v) * 1000.0)) for v in q]
                    except (TypeError, ValueError):
                        continue
                    raw_q = [max(-32768, min(32767, v)) for v in raw_q]
                    if link["writer"]:
                        try:
                            link["writer"].write(b"J" + struct.pack("<3h", *raw_q))
                            await link["writer"].drain()
                        except Exception:
                            pass
                elif msg.get("type") == "release":
                    if link["writer"]:
                        try:
                            link["writer"].write(b"R")
                            await link["writer"].drain()
                        except Exception:
                            pass
                elif msg.get("type") == "full_refresh":
                    if link["writer"]:
                        try:
                            link["writer"].write(b"F")
                            await link["writer"].drain()
                        except Exception:
                            pass
        finally:
            clients.discard(ws)

    async def broadcast(frame):
        if frame["type"] == "status":
            last_status["frame"] = frame
            dead = []
            for ws in list(clients):
                try:
                    await send_status(ws, frame)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)
            return

        if frame["type"] == "state":
            # 兼容仍只认 q 的旧客户端；正式前端使用 status。
            dead = []
            for ws in list(clients):
                try:
                    await ws.send(json.dumps(frame))
                except Exception:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)
            return

        for cell in frame["cells"]:
            state[(cell[0], cell[1])] = cell
        if not clients:
            return
        msg = {"type": "frame", "cells": frame["cells"]}
        dead = []
        for ws in list(clients):
            try:
                await ws.send(json.dumps(msg))
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)

    async with websockets.serve(handler, WS_HOST, WS_PORT):
        print(f"[bridge] websocket listening on ws://{WS_HOST}:{WS_PORT}")
        await serial_reader(parser, broadcast, link)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[bridge] bye")
        sys.exit(0)
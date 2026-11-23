#!/usr/bin/env python3
"""
AEVUM serial bridge: reads TCP-framed serial from QEMU, forwards to WebSocket.
Frame format: A5 5A 01 COUNT [row col ch attr] * COUNT CRC
State frame:  A5 5A 02 03 q0 q1 q2 (i32 LE, Q16.16 rad) CRC
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
FRAME_HDR = 4
MAX_CELLS = 32
STATE_VALS = 3
Q16_ONE = 65536.0


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
    last_q = {"q": None}
    link = {"writer": None}

    async def handler(ws):
        clients.add(ws)
        try:
            # 新窗口后连接时补一帧当前画面，否则只收到打开之后的差量。
            if state:
                await ws.send(json.dumps({"type": "frame", "cells": list(state.values())}))
            # 新的只读订阅者也补一次最近关节角，避免等下一次 8 帧扫描。
            if last_q["q"] is not None:
                await ws.send(json.dumps({"type": "state", "q": last_q["q"]}))
            # 让内核下一次扫描发送完整 VGA，补齐窗口连接前就已经存在的静态单元。
            if link["writer"]:
                try:
                    link["writer"].write(b"F")
                    await link["writer"].drain()
                except Exception:
                    pass
            async for _ in ws:
                pass
        finally:
            clients.discard(ws)

    async def broadcast(frame):
        if frame["type"] == "state":
            last_q["q"] = frame["q"]
            msg = {"type": "state", "q": frame["q"]}
            dead = []
            for ws in list(clients):
                try:
                    await ws.send(json.dumps(msg))
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
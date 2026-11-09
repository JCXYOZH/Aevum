#!/usr/bin/env python3
"""
AEVUM serial bridge: reads TCP-framed serial from QEMU, forwards to WebSocket.
Frame format: A5 5A 01 COUNT [row col ch attr] * COUNT CRC
"""
import asyncio
import struct
import sys
import websockets

QEMU_SERIAL_HOST = "127.0.0.1"
QEMU_SERIAL_PORT = 5555
WS_HOST          = "127.0.0.1"
WS_PORT          = 8765

SYNC0 = 0xA5
SYNC1 = 0x5A
FRAME_TYPE_DELTA = 0x01
FRAME_HDR = 4
MAX_CELLS = 32


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


async def serial_reader(parser, broadcast):
    reader, writer = await asyncio.open_connection(QEMU_SERIAL_HOST, QEMU_SERIAL_PORT)
    print(f"[bridge] connected to QEMU serial {QEMU_SERIAL_HOST}:{QEMU_SERIAL_PORT}")
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            for frame in parser.feed(data):
                await broadcast(frame)
    finally:
        writer.close()


async def main():
    parser = FrameParser()
    clients = set()

    async def handler(ws):
        clients.add(ws)
        try:
            async for _ in ws:
                pass
        finally:
            clients.discard(ws)

    async def broadcast(frame):
        if not clients:
            return
        msg = {"type": "frame", "cells": frame["cells"]}
        dead = []
        for ws in clients:
            try:
                await ws.send(__import__("json").dumps(msg))
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)

    async with websockets.serve(handler, WS_HOST, WS_PORT):
        print(f"[bridge] websocket listening on ws://{WS_HOST}:{WS_PORT}")
        await serial_reader(parser, broadcast)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[bridge] bye")
        sys.exit(0)
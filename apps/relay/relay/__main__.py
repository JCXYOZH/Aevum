# ============================================================
# relay/__main__.py — 进程入口（DAG 第 6 层，最上层）
#
# 用法：
#   python -m relay                          # 只监听本机
#   python -m relay --port 8790 --token xxx  # 带令牌
#   python -m relay --skip-selfcheck         # 跳过启动自检（只用于调试）
#
# 只监听回环 + nginx 反代是推荐形态：中继进程不直接暴露公网。
# ============================================================
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading

from relay.bootstrap import start
from relay.engine import DEFAULT_HOST, DEFAULT_PORT


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m relay",
        description="纯内存中继：会话即焚，文件只转发不落盘",
    )
    parser.add_argument("--host", default=os.environ.get("RELAY_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("RELAY_PORT", DEFAULT_PORT)))
    parser.add_argument("--session-ttl", type=int, default=int(os.environ.get("RELAY_SESSION_TTL", 600)))
    parser.add_argument("--max-turns", type=int, default=int(os.environ.get("RELAY_MAX_TURNS", 20)))
    parser.add_argument("--max-sessions", type=int, default=int(os.environ.get("RELAY_MAX_SESSIONS", 2000)))
    parser.add_argument("--transfer-ttl", type=int, default=int(os.environ.get("RELAY_TRANSFER_TTL", 120)))
    parser.add_argument("--max-transfers", type=int, default=int(os.environ.get("RELAY_MAX_TRANSFERS", 128)))
    parser.add_argument("--token", default=os.environ.get("RELAY_TOKEN", ""), help="访问令牌；留空仅限本机开发")
    parser.add_argument("--log-level", default=os.environ.get("RELAY_LOG_LEVEL", "INFO"))
    parser.add_argument("--skip-selfcheck", action="store_true", help="跳过层级/契约自检（不建议）")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        stream=sys.stderr,
        format="[%(asctime)s] [%(levelname)s] %(name)s: %(message)s",
    )

    logger = logging.getLogger("relay")
    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.token:
        logger.warning(
            "监听 %s 且没有设置令牌：任何能连上这个端口的人都能读写中继", args.host
        )

    try:
        engine = start(
            session_ttl=args.session_ttl,
            max_turns=args.max_turns,
            max_sessions=args.max_sessions,
            transfer_ttl=args.transfer_ttl,
            max_transfers=args.max_transfers,
            token=args.token,
            selfcheck=not args.skip_selfcheck,
        )
    except Exception as exc:  # 启动失败必须带码，不允许黑盒 traceback 收场
        code = getattr(exc, "code", None)
        if code is not None:
            print(getattr(exc, "render", lambda: str(exc))(), file=sys.stderr, flush=True)
            return 1
        logger.exception("启动失败，且没有映射到 0xRRFFTT；请检查解释器环境")
        return 2

    server = engine.start_http(args.host, args.port)
    print(
        f"memory-relay listening on http://{args.host}:{server.port} "
        f"token={'set' if args.token else 'none'} persisted=False",
        flush=True,
    )

    stop = threading.Event()

    def _handle(signum, _frame):
        logger.info("收到信号 %s，准备退出", signum)
        stop.set()

    for sig_name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _handle)
            except (ValueError, OSError):
                pass

    try:
        stop.wait()
    finally:
        engine.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

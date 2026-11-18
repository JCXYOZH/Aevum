"""Local monitor service for the Memoria desktop console.

It serves the static community page from apps/community/web, turns the trainer
JSONL telemetry into a small JSON API and exposes the relay error-code table.
Everything is standard library only so the desktop shell can start it with the
same Python used for the relay and the serial bridge.
"""

from __future__ import annotations

import argparse
import gzip
import json
import mimetypes
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from email.utils import formatdate
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

# auth_api 直接引用 libertas 源码包；入口在导入它之前先把 src 放进 sys.path。
_SRC_DIR = Path(__file__).resolve().parents[3] / "src"
if _SRC_DIR.is_dir() and str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

try:
    from .api.capabilities import capabilities_payload
    from .api.governance import handle_get as governance_get, handle_post as governance_post
    from .api.visitor import community_overview, scope_dir, visitor_payload
    from .auth_api import AuthAPI
    from .chat_api import ChatAPI
    from .wan_api import WANAPI
except ImportError:  # 直接以脚本方式运行 desktop_server.py
    from api.capabilities import capabilities_payload
    from api.governance import handle_get as governance_get, handle_post as governance_post
    from api.visitor import community_overview, scope_dir, visitor_payload
    from auth_api import AuthAPI
    from chat_api import ChatAPI
    from wan_api import WANAPI

try:
    from .monitor_config import (
        BUILD_ROOT,
        DATA_ROOT,
        ERROR_PATTERN,
        ERROR_TABLE,
        FROZEN,
        MODEL_EXE_CUDA_NAME,
        MODEL_EXE_NAME,
        ROOT,
        WEB_ROOT,
        WEB_SEARCH_TOOL_DEF,
        _torch_lib_path,
    )
    from .monitor_payloads import (
        cloud_model_summary,
        checkpoint_entries,
        display_path,
        down_sample,
        error_codes,
        error_lines,
        extract_generated,
        health_payload,
        is_local_http_request,
        model_payload,
        port_listening,
        port_open,
        read_json,
        read_metrics,
        read_model_config,
        read_text,
        root_path,
        trainer_payload,
    )
    from .monitor_http import MonitorHTTPMixin
    from .monitor_chat import MonitorChatMixin
except ImportError:  # 直接以脚本方式运行 desktop_server.py
    from monitor_config import (
        BUILD_ROOT,
        DATA_ROOT,
        ERROR_PATTERN,
        ERROR_TABLE,
        FROZEN,
        MODEL_EXE_CUDA_NAME,
        MODEL_EXE_NAME,
        ROOT,
        WEB_ROOT,
        WEB_SEARCH_TOOL_DEF,
        _torch_lib_path,
    )
    from monitor_payloads import (
        cloud_model_summary,
        checkpoint_entries,
        display_path,
        down_sample,
        error_codes,
        error_lines,
        extract_generated,
        health_payload,
        is_local_http_request,
        model_payload,
        port_listening,
        port_open,
        read_json,
        read_metrics,
        read_model_config,
        read_text,
        root_path,
        trainer_payload,
    )
    from monitor_http import MonitorHTTPMixin
    from monitor_chat import MonitorChatMixin







class MonitorHandler(MonitorHTTPMixin, MonitorChatMixin, BaseHTTPRequestHandler):
    """监控服务请求处理器的组合入口。"""




def main() -> None:
    parser = argparse.ArgumentParser(description="Memoria desktop monitor")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8781, help="Desktop monitor port")
    parser.add_argument("--relay-port", type=int, default=8790)
    parser.add_argument("--bridge-port", type=int, default=8765)
    parser.add_argument("--serial-port", type=int, default=5555)
    parser.add_argument(
        "--metrics",
        default=str(BUILD_ROOT / "training_metrics.jsonl"),
        help="Trainer JSONL telemetry path",
    )
    parser.add_argument(
        "--model-exe",
        default=str(BUILD_ROOT / MODEL_EXE_NAME),
        help="CPU-only generation executable (default)",
    )
    parser.add_argument(
        "--model-exe-cuda",
        default=str(BUILD_ROOT / MODEL_EXE_CUDA_NAME),
        help="CUDA-linked generation executable, used only when device=cuda",
    )
    parser.add_argument(
        "--model-data",
        default=str(DATA_ROOT / "tinyshakespeare_3000.txt"),
        help="Vocabulary-compatible text used by the loader",
    )
    args = parser.parse_args()

    metrics_path = Path(args.metrics)
    server = ThreadingHTTPServer((args.host, args.port), MonitorHandler)
    server.metrics_path = str(metrics_path)  # type: ignore[attr-defined]
    server.model_exe = str(Path(args.model_exe))  # type: ignore[attr-defined]
    server.model_exe_cuda = str(Path(args.model_exe_cuda))  # type: ignore[attr-defined]
    server.model_data = str(Path(args.model_data))  # type: ignore[attr-defined]
    server.ports = {  # type: ignore[attr-defined]
        "web": args.port,
        "relay": args.relay_port,
        "bridge": args.bridge_port,
        "serial": args.serial_port,
    }
    auth_api = AuthAPI()
    server.auth_api = auth_api  # type: ignore[attr-defined]
    try:
        server.wan_api = WANAPI()  # type: ignore[attr-defined]
    except Exception as error:
        print(f"WAN API unavailable: {error}", flush=True)

    print(f"Memoria desktop: http://{args.host}:{args.port}/", flush=True)
    print(f"Metrics: {metrics_path}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

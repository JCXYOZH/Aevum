"""Monitor 的只读数据投影。

把训练指标、检查点、模型状态、错误码和健康状态从 HTTP 处理类中拆出，
让 ``desktop_server.py`` 只负责请求分发与进程启动。
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

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
        _torch_lib_path,
    )
except ImportError:  # 以脚本方式运行
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
        _torch_lib_path,
    )


def port_open(host: str, port: int, timeout: float = 0.35) -> bool:
    """Return True only when the TCP port accepts a connection."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def port_listening(port: int) -> bool:
    """Return True when the port is in LISTEN state.

    QEMU's serial backend accepts one client at a time; once the bridge holds
    the serial connection, a fresh health probe is refused even though QEMU is
    healthy.  Checking the listen table avoids that false negative.
    """
    if os.name == "nt":
        netstat = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "netstat.exe"
        try:
            completed = subprocess.run(
                [str(netstat), "-ano", "-p", "tcp"],
                capture_output=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return False
        output = completed.stdout.decode("mbcs", errors="replace")
        for line in output.splitlines():
            fields = line.split()
            if len(fields) < 4 or "LISTEN" not in line.upper():
                continue
            if fields[1].rsplit(":", 1)[-1] == str(port):
                return True
        return False

    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            lines = Path(table).read_text(encoding="utf-8").splitlines()[1:]
        except OSError:
            continue
        for line in lines:
            fields = line.split()
            if len(fields) < 4:
                continue
            local, state = fields[1], fields[3]
            if state == "0A" and local.rsplit(":", 1)[-1].upper() == f"{port:04X}":
                return True
    return False


def read_text(path: Path, limit: int | None = None) -> str:
    """Read UTF-8 text defensively; logs can contain half-written lines."""
    if not path.exists():
        return ""
    try:
        raw = path.read_bytes()
    except OSError:
        return ""
    text = raw.decode("utf-8", errors="replace")
    if limit is not None and len(text) > limit:
        return text[-limit:]
    return text


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def display_path(path: Path) -> str:
    """Prefer a repository-relative path, but keep an external build path valid."""
    try:
        return str(path.resolve().relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def read_model_config(directory: Path) -> dict:
    """Read either the JSON export or the native key=value config."""
    json_path = directory / "config.json"
    if json_path.exists():
        return read_json(json_path)
    txt_path = directory / "memoria_config.txt"
    if not txt_path.exists():
        return {}
    config: dict = {}
    try:
        for line in txt_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()
    except OSError:
        return {}
    if "dim" in config and "hidden_size" not in config:
        config["hidden_size"] = config["dim"]
    return config


def checkpoint_entries() -> list[dict]:
    """List local model directories without loading any weights.

    A checkpoint is a directory holding the native Memoria weights or the
    BERT-shaped disguised file; the config may be config.json or the native
    memoria_config.txt. Model weights stay under build/, which is ignored by
    Git; the dashboard only reads metadata.
    """
    entries: list[dict] = []
    if not BUILD_ROOT.exists():
        return entries
    directories = set()
    for weights_name in ("memoria_model.pt", "pytorch_model.bin"):
        for weights in BUILD_ROOT.rglob(weights_name):
            directories.add(weights.parent)
    for directory in sorted(directories):
        native = directory / "memoria_model.pt"
        disguised = directory / "pytorch_model.bin"
        config = read_model_config(directory)
        entries.append(
            {
                "path": display_path(directory),
                "name": directory.name,
                "format": "memoria" if native.exists() else "disguised_bert",
                "vocab_size": config.get("vocab_size"),
                "dim": config.get("hidden_size"),
                "weights_bytes": (
                    native.stat().st_size if native.exists() else disguised.stat().st_size
                ),
            }
        )
    return entries


def is_local_http_request(handler) -> bool:
    """仅本机回环地址返回完整模型路径；公网/局域网请求只拿元信息。"""
    try:
        host = str(handler.headers.get("Host", "")).strip().lower()
    except Exception:
        return True
    host = host.split(":", 1)[0].strip("[]")
    return host in {"127.0.0.1", "localhost", "::1"}


def cloud_model_summary() -> dict:
    """只返回云端模型的公开状态；不返回密钥、完整接口地址或本机路径。"""
    try:
        from libertas.foundation.config import config as runtime_config
        cfg = runtime_config or {}
    except Exception:
        cfg = {}
    endpoint = str(cfg.get("cloud_endpoint") or "").strip()
    model_name = str(cfg.get("cloud_model_name") or "").strip()
    key = str(cfg.get("cloud_api_key") or "").strip() or os.environ.get("LIBERTAS_CLOUD_API_KEY", "").strip()
    vg = cfg.get("video_generation") or {}
    try:
        endpoint_host = urlparse(endpoint).netloc if endpoint else ""
    except Exception:
        endpoint_host = ""
    return {
        "mode": str(cfg.get("model_runtime_mode") or "local"),
        "model": model_name,
        "endpoint_host": endpoint_host,
        "configured": bool(endpoint and model_name and key),
        "has_key": bool(key),
        "video_tool": bool(
            isinstance(vg, dict)
            and vg.get("enabled")
            and vg.get("chat_tool", True)
            and vg.get("endpoint")
            and (vg.get("api_key") or key)
        ),
    }


def model_payload(exe: Path, default_data: Path, cuda_exe: Path, public: bool = False) -> dict:
    checkpoints = checkpoint_entries()
    if public:
        checkpoints = [
            {key: value for key, value in item.items() if key != "path"}
            for item in checkpoints
        ]
    preferred = next(
        (item.get("path", "") for item in checkpoints if "full" in item["name"].lower()),
        checkpoints[0].get("path", "") if checkpoints else "",
    )
    return {
        "ok": True,
        "exe": exe.name if public else str(exe),
        "available": exe.exists(),
        "cuda_exe": cuda_exe.name if public else str(cuda_exe),
        "cuda_available": cuda_exe.exists(),
        "checkpoints": checkpoints,
        "cloud": cloud_model_summary(),
        "defaults": {
            "checkpoint": preferred,
            "data": "" if public else (
                display_path(default_data)
                if default_data.exists()
                else "data/tinyshakespeare_3000.txt"
            ),
            "prompt": "What ",
            "max_new_tokens": 48,
            "temperature": 1.0,
            "device": "cpu",
        },
        "note": "公网只返回模型元信息，不返回服务器路径。" if public
        else "Weights live under build/ and are excluded from Git.",
    }


def root_path(value: str) -> Path:
    """Resolve a user-supplied path and keep it inside a known data root.

    A packaged build keeps static pages in resources/, but may point
    MEMORIA_BUILD_ROOT at an external weights directory and MEMORIA_DATA_ROOT
    at a separate corpus directory. All three roots are accepted without
    widening access to the whole filesystem.
    """
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = BUILD_ROOT / candidate
        if not candidate.exists():
            candidate = DATA_ROOT / value
        if not candidate.exists():
            candidate = ROOT / value
    resolved = candidate.resolve()
    allowed = [ROOT.resolve(), BUILD_ROOT.resolve(), DATA_ROOT.resolve()]
    if resolved == ROOT.resolve() or any(root in resolved.parents for root in allowed):
        return resolved
    raise ValueError("path must stay inside the project, model root or data root")


def extract_generated(stdout: str) -> str:
    for line in stdout.splitlines():
        if line.startswith("generated: "):
            return line[len("generated: ") :]
    return ""


def read_metrics(path: Path) -> tuple[list[dict], dict]:
    """Parse JSONL telemetry. A truncated last line is ignored."""
    events: list[dict] = []
    if not path.exists():
        return events, {}
    try:
        raw = path.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return events, {}
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict):
            events.append(item)
    return events, {"bytes": path.stat().st_size, "mtime": path.stat().st_mtime}


def down_sample(values: list[dict], limit: int = 320) -> list[dict]:
    if len(values) <= limit:
        return values
    step = max(1, len(values) // limit)
    return values[::step][-limit:]


def error_codes() -> dict[str, dict]:
    payload = read_json(ERROR_TABLE)
    if not payload:
        return {}
    table = {}
    for item in payload.get("codes", []):
        code = str(item.get("code", "")).lower()
        if code:
            table[code] = item
    return table


def error_lines(text: str, source: str, limit: int = 60) -> list[dict]:
    """Turn stderr/log text into structured rows without inventing entries."""
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for line in text.splitlines()[-240:]:
        stripped = line.strip()
        if not stripped:
            continue
        codes = ERROR_PATTERN.findall(stripped)
        noisy = re.search(
            r"error|failed|exception|traceback|throw|cannot|denied|refused",
            stripped,
            re.IGNORECASE,
        )
        if not codes and not noisy:
            continue
        key = (source, stripped)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "source": source,
                "line": stripped[:420],
                "codes": [c.lower() for c in codes],
            }
        )
    return rows[-limit:]


def trainer_payload(metrics_path: Path, out_log: Path, err_log: Path) -> dict:
    events, file_info = read_metrics(metrics_path)
    start = next((e for e in events if e.get("event") == "start"), {})
    done = next((e for e in reversed(events) if e.get("event") == "done"), None)
    epoch_events = [e for e in events if e.get("event") == "epoch"]
    step_events = [e for e in events if e.get("event") == "step"]
    latest = step_events[-1] if step_events else (epoch_events[-1] if epoch_events else {})
    last_time = max((int(e.get("time", 0)) for e in events), default=0)
    running = bool(start) and done is None
    if running and last_time and time.time() - last_time > 300:
        running = False
        stale = True
    else:
        stale = False

    out_tail = read_text(out_log, 24000)
    err_tail = read_text(err_log, 18000)
    auto_errors = error_lines(err_tail, "trainer.stderr")
    auto_errors += error_lines(out_tail, "trainer.stdout")
    code_table = error_codes()
    for row in auto_errors:
        row["known"] = [code_table.get(c, {}) for c in row["codes"] if code_table.get(c)]

    return {
        "available": bool(events),
        "running": running,
        "stale": stale,
        "path": str(metrics_path),
        "file": file_info,
        "start": start,
        "done": done,
        "latest": latest,
        "epochs": epoch_events,
        "points": down_sample(step_events),
        "logs": {
            "stdout": "\n".join(out_tail.splitlines()[-80:]),
            "stderr": "\n".join(err_tail.splitlines()[-50:]),
        },
        "errors": auto_errors[-40:],
        "summary": {
            "device": start.get("device", "unknown"),
            "params": start.get("params", 0),
            "vocab": start.get("vocab", 0),
            "dim": start.get("dim", 0),
            "seq_length": start.get("seq_length", 0),
            "batch": start.get("batch", 0),
            "epochs_total": start.get("epochs", 0),
            "epochs_seen": len(epoch_events),
            "first_loss": start.get("first_loss", step_events[0].get("loss") if step_events else None),
            "last_loss": latest.get("loss"),
        },
    }


def health_payload(metrics_path: Path, ports: dict[str, int] | None = None) -> dict:
    ports = ports or {"web": 8781, "relay": 8790, "bridge": 8765, "serial": 5555}
    trainer = trainer_payload(
        metrics_path,
        BUILD_ROOT / "trainer.out.log",
        BUILD_ROOT / "trainer.err.log",
    )
    return {
        "time": time.time(),
        "services": {
            # The monitor answering this request is the web surface; do not
            # probe a second static server that the launcher may not start.
            "web": {"ok": True, "port": ports["web"]},
            "relay": {"ok": port_open("127.0.0.1", ports["relay"]), "port": ports["relay"]},
            "bridge": {"ok": port_open("127.0.0.1", ports["bridge"]), "port": ports["bridge"]},
            "qemu": {"ok": port_listening(ports["serial"]), "port": ports["serial"]},
        },
        "trainer": {
            "available": trainer["available"],
            "running": trainer["running"],
            "stale": trainer["stale"],
            "latest": trainer["latest"],
            "done": trainer["done"],
        },
    }

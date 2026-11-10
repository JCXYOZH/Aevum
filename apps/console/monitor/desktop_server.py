"""Local monitor service for the Memoria desktop console.

It serves the static community page from apps/community/web, turns the trainer
JSONL telemetry into a small JSON API and exposes the relay error-code table.
Everything is standard library only so the desktop shell can start it with the
same Python used for the relay and the serial bridge.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import socket
import subprocess
import sys
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


def _default_root() -> Path:
    """Resolve the data root for both a source checkout and a frozen build.

    In a PyInstaller one-file build ``__file__`` points inside the temporary
    extraction directory, so it cannot be used to find the repository. The
    executable's parent is the resource directory in that case. The Electron
    shell also passes MEMORIA_ROOT explicitly, which wins over both defaults.
    """
    configured = os.environ.get("MEMORIA_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parents[1]
    return Path(__file__).resolve().parents[3]


ROOT = _default_root()
FROZEN = bool(getattr(sys, "frozen", False))
# The packaged app stores static pages next to the monitor executable; a
# source checkout keeps them under apps/community/web. Both are overridable
# so a portable build can point at a user-selected checkout.
WEB_ROOT = Path(
    os.environ.get(
        "MEMORIA_WEB_ROOT",
        str(ROOT / "web" if FROZEN else ROOT / "apps" / "community" / "web"),
    )
).resolve()
ERROR_TABLE = Path(
    os.environ.get(
        "MEMORIA_ERROR_TABLE",
        str(ROOT / "contracts" / "errors.json" if FROZEN else ROOT / "apps" / "relay" / "contracts" / "errors.json"),
    )
).resolve()
BUILD_ROOT = Path(
    os.environ.get("MEMORIA_BUILD_ROOT", str(ROOT / "build"))
).resolve()
# User datasets are separate from checkpoints: a server or a packaged install
# may keep a corpus on another volume. This directory is readable, never a
# second weight directory.
DATA_ROOT = Path(
    os.environ.get("MEMORIA_DATA_ROOT", str(ROOT / "data"))
).resolve()
ERROR_PATTERN = re.compile(r"0x[0-9A-Fa-f]{6}")
MODEL_EXE_NAME = "memoria_gen_cpu.exe" if os.name == "nt" else "memoria_gen_cpu"
MODEL_EXE_CUDA_NAME = "memoria_gen.exe" if os.name == "nt" else "memoria_gen"


def port_open(host: str, port: int, timeout: float = 0.35) -> bool:
    """Return True only when the TCP port accepts a connection."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
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


def checkpoint_entries() -> list[dict]:
    """List local model directories without loading any weights.

    A directory is a checkpoint when it has a config plus either the native
    Memoria weights or the BERT-shaped disguised file. Model weights stay under
    build/, which is ignored by Git; the dashboard only reads metadata.
    """
    entries: list[dict] = []
    if not BUILD_ROOT.exists():
        return entries
    for config_path in sorted(BUILD_ROOT.rglob("config.json")):
        directory = config_path.parent
        native = directory / "memoria_model.pt"
        disguised = directory / "pytorch_model.bin"
        if not native.exists() and not disguised.exists():
            continue
        config = read_json(config_path)
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


def model_payload(exe: Path, default_data: Path, cuda_exe: Path) -> dict:
    checkpoints = checkpoint_entries()
    preferred = next(
        (item["path"] for item in checkpoints if "full" in item["name"].lower()),
        checkpoints[0]["path"] if checkpoints else "",
    )
    return {
        "ok": True,
        "exe": str(exe),
        "available": exe.exists(),
        "cuda_exe": str(cuda_exe),
        "cuda_available": cuda_exe.exists(),
        "checkpoints": checkpoints,
        "defaults": {
            "checkpoint": preferred,
            "data": display_path(default_data)
            if default_data.exists()
            else "data/tinyshakespeare_3000.txt",
            "prompt": "What ",
            "max_new_tokens": 48,
            "temperature": 1.0,
            "device": "cpu",
        },
        "note": "Weights live under build/ and are excluded from Git.",
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
            "qemu": {"ok": port_open("127.0.0.1", ports["serial"]), "port": ports["serial"]},
        },
        "trainer": {
            "available": trainer["available"],
            "running": trainer["running"],
            "stale": trainer["stale"],
            "latest": trainer["latest"],
            "done": trainer["done"],
        },
    }


class MonitorHandler(BaseHTTPRequestHandler):
    server_version = "MemoriaDesktop/1.0"
    directory = str(WEB_ROOT)

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        return

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, status: int = 200) -> None:
        try:
            data = path.read_bytes()
        except OSError:
            self._send_json({"ok": False, "message": "file not found"}, 404)
            return
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix.lower() in {".html", ".js", ".css", ".json", ".txt", ".md"}:
            ctype += "; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        route = parsed.path
        metrics_path = Path(self.server.metrics_path)

        if route in {"/", "/desktop"}:
            self._send_file(WEB_ROOT / "desktop.html")
            return
        if route == "/legacy":
            self._send_file(WEB_ROOT / "index.html")
            return
        if route == "/api/health":
            self._send_json(health_payload(metrics_path, getattr(self.server, "ports", None)))
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
                )
            )
            return

        # Static files are served from the copied community web directory.
        safe = unquote(route.lstrip("/"))
        if safe.startswith("api/"):
            self._send_json({"ok": False, "message": "unknown api"}, 404)
            return
        target = WEB_ROOT / safe
        if not target.exists() or not target.is_file():
            # Unknown routes fall back to the desktop shell so the page is
            # forgiving when someone types a stale app name.
            target = WEB_ROOT / "desktop.html"
        self._send_file(target)


    def do_POST(self) -> None:
        parsed = urlparse(self.path)
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

        # The CPU build deliberately omits torch_cuda.dll. It is the default
        # because the desktop monitor often runs on a machine whose page file
        # cannot accommodate a second CUDA runtime. `cuda` is an explicit opt-in.
        try:
            checkpoint = root_path(str(body.get("checkpoint", "")))
            if not checkpoint.is_dir():
                raise ValueError("checkpoint directory not found")
            data = root_path(str(body.get("data", "")))
            if not data.is_file():
                raise ValueError("training data file not found")
            prompt = str(body.get("prompt", ""))
            if not prompt or len(prompt) > 2000:
                raise ValueError("prompt must be 1..2000 characters")
            max_new = int(body.get("max_new_tokens", 48))
            max_new = max(1, min(256, max_new))
            temperature = float(body.get("temperature", 1.0))
            temperature = max(0.1, min(2.0, temperature))
            device = str(body.get("device", "cpu"))
            if device not in {"cpu", "cuda"}:
                raise ValueError("device must be cpu or cuda")
        except (TypeError, ValueError) as error:
            self._send_json({"ok": False, "message": str(error)}, 400)
            return

        if device == "cuda":
            exe = Path(getattr(self.server, "model_exe_cuda", BUILD_ROOT / "memoria_gen.exe"))
        else:
            exe = Path(getattr(self.server, "model_exe", BUILD_ROOT / "memoria_gen_cpu.exe"))
        if not exe.exists():
            self._send_json(
                {
                    "ok": False,
                    "message": f"{exe.name} is missing; run scripts/build.ps1",
                },
                503,
            )
            return

        command = [
            str(exe),
            "--load",
            str(checkpoint),
            "--data",
            str(data),
            "--prompt",
            prompt,
            "--max-new-tokens",
            str(max_new),
            "--temperature",
            str(temperature),
            "--device",
            device,
        ]
        env = os.environ.copy()
        # A single worker keeps the generation child small; the desktop monitor
        # is usually started while the user's editor and browser are open.
        env["OMP_NUM_THREADS"] = "1"
        env["MKL_NUM_THREADS"] = "1"
        env["TORCH_NUM_THREADS"] = "1"
        env["OPENBLAS_NUM_THREADS"] = "1"
        torch_lib = Path(env["MEMORIA_TORCH_LIB"]).expanduser() if env.get("MEMORIA_TORCH_LIB") else BUILD_ROOT / "runtime"
        if not torch_lib.is_absolute():
            torch_lib = ROOT / torch_lib
        if torch_lib.is_dir():
            env["PATH"] = str(torch_lib) + os.pathsep + env.get("PATH", "")
        started = time.time()
        try:
            completed = subprocess.run(
                command,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=180,
                env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except subprocess.TimeoutExpired:
            self._send_json({"ok": False, "message": "generation timed out"}, 504)
            return
        except OSError as error:
            self._send_json({"ok": False, "message": f"cannot start exe: {error}"}, 500)
            return

        text = extract_generated(completed.stdout)
        try:
            shown_checkpoint = str(checkpoint.relative_to(ROOT)).replace("\\", "/")
        except ValueError:
            shown_checkpoint = str(checkpoint).replace("\\", "/")
        payload = {
            "ok": completed.returncode == 0 and bool(text),
            "text": text,
            "checkpoint": shown_checkpoint,
            "device": device,
            "duration_ms": int((time.time() - started) * 1000),
            "stdout": completed.stdout[-6000:],
            "stderr": completed.stderr[-6000:],
        }
        self._send_json(payload, 200 if payload["ok"] else 500)


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

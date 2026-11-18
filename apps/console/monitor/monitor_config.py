"""Monitor 运行路径、静态资源与模型可执行文件的配置边界。"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


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

WEB_SEARCH_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "搜索公开网页，返回标题、摘要和链接。需要最新信息或外部事实时调用。",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "max_results": {"type": "integer", "description": "返回条数，1-8，默认 6"},
            },
            "required": ["query"],
        },
    },
}


def _torch_lib_path(env: dict) -> Path | None:
    """Locate the torch runtime directory used by the native generator.

    A source checkout often has no ``build/runtime``; packaged desktop builds do.
    ``MEMORIA_TORCH_LIB`` always wins so an external runtime stays selectable.
    """
    configured = env.get("MEMORIA_TORCH_LIB", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        if candidate.is_dir():
            return candidate
    candidates = [BUILD_ROOT / "runtime"]
    candidates.extend(sorted((ROOT / "apps" / "desktop" / "dist-app").glob("*/resources/build/runtime")))
    candidates.append(Path("D:/venv/Lib/site-packages/torch/lib"))
    home = Path.home()
    candidates.append(home / "AppData" / "Local" / "Programs" / "Python" / "Python312" / "Lib" / "site-packages" / "torch" / "lib")
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None

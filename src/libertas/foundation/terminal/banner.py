"""终端横幅输出。"""

from typing import Dict, Optional

from .styles import Color, get_terminal_size
from .writer import _writer

BANNER_LIBERTAS = r"""
███╗   ███╗██████╗ ██╗  ██╗██╗   ██╗ █████╗ 
████╗ ████║██╔══██╗██║  ██║██║   ██║██╔══██╗
██╔████╔██║██████╔╝███████║██║   ██║███████║
██║╚██╔╝██║██╔══██╗██╔══██║██║   ██║██╔══██║
██║ ╚═╝ ██║██║  ██║██║  ██║╚██████╔╝██║  ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝
"""

def print_banner(version: str = "", build_time: str = "", mode: str = "",
                 extra_info: Optional[Dict[str, str]] = None):
    """打印 LIBERTAS 大字横幅 + 版本信息块"""
    cols, _ = get_terminal_size()
    banner_color = Color.BRIGHT_CYAN + Color.BOLD

    # 横幅
    for line in BANNER_LIBERTAS.split("\n"):
        if line.strip():
            _writer.submit(f"{banner_color}{line}{Color.RESET}")

    # 分隔线
    _writer.submit(f"{Color.GRAY}{'─' * min(cols, 70)}{Color.RESET}")

    # 信息块
    info_parts = []
    if version:
        info_parts.append(f"{Color.WHITE}版本{Color.RESET}: {Color.GREEN}{version}{Color.RESET}")
    if build_time:
        info_parts.append(f"{Color.WHITE}构建{Color.RESET}: {Color.YELLOW}{build_time}{Color.RESET}")
    if mode:
        info_parts.append(f"{Color.WHITE}模式{Color.RESET}: {Color.CYAN}{mode}{Color.RESET}")

    if info_parts:
        _writer.submit("  " + " | ".join(info_parts))

    if extra_info:
        for key, value in extra_info.items():
            _writer.submit(f"  {Color.WHITE}{key}{Color.RESET}: {value}")

    _writer.submit(f"{Color.GRAY}{'─' * min(cols, 70)}{Color.RESET}")
    _writer.submit("")

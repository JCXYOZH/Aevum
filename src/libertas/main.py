"""Libertas 命令行入口。"""

from __future__ import annotations

import sys
from typing import Iterable, Optional

from libertas.application.system import LibertasSystem
from libertas.foundation.terminal import terminal


def run_once(user_input: str, user_id: str = "anonymous") -> str:
    """单次调用入口，供 API、测试或脚本使用。"""
    with LibertasSystem() as system:
        return system.handle(user_input, user_id)


def main(argv: Optional[Iterable[str]] = None) -> int:
    del argv
    system = LibertasSystem()
    try:
        system.start()
        terminal.info("输入 /帮助 查看命令，输入 /退出 结束。", "main")
        while system.running:
            try:
                user_input = input("libertas> ")
            except EOFError:
                print()
                break
            if not user_input.strip():
                continue
            reply = system.handle(user_input)
            if reply:
                print(reply)
            if not system.running:
                break
    except KeyboardInterrupt:
        print()
    finally:
        system.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""多进程管理骨架。

只负责“启动 / 停止 / 状态轮询”，不承载任何业务逻辑。核心的具体入口由调用方
传入一个可在 spawn 子进程中导入的模块级函数；不要在这里 import 内核或架构。
"""

from __future__ import annotations

import multiprocessing as mp
from typing import Any, Callable

from .contract import CoreSpec, CoreStatus


class Supervisor:
    """三个核心运行时的进程表。"""

    def __init__(self, specs: tuple[CoreSpec, ...]) -> None:
        self._specs = {spec.name: spec for spec in specs}
        self._processes: dict[str, mp.Process] = {}
        self._status: dict[str, CoreStatus] = {
            name: CoreStatus(name=name) for name in self._specs
        }

    def start(
        self,
        name: str,
        target: Callable[..., Any],
        args: tuple[Any, ...] = (),
        kwargs: dict[str, Any] | None = None,
    ) -> CoreStatus:
        """启动一个核心；重复启动返回当前状态，不覆盖已有进程。"""
        if name not in self._specs:
            raise KeyError(f"unknown core: {name}")
        process = self._processes.get(name)
        if process is not None and process.is_alive():
            return self._status[name]

        context = mp.get_context("spawn")
        process = context.Process(
            target=target,
            args=args,
            kwargs=kwargs or {},
            name=f"aevum-{name}",
        )
        process.start()
        self._processes[name] = process
        self._status[name] = CoreStatus(
            name=name,
            state="running",
            pid=process.pid,
        )
        return self._status[name]

    def stop(self, name: str, timeout: float = 5.0) -> CoreStatus:
        """停止一个核心；超时后 terminate，最后 join。"""
        process = self._processes.pop(name, None)
        if process is None:
            return self._status.get(name, CoreStatus(name=name))
        if process.is_alive():
            process.terminate()
            process.join(timeout)
        status = self._status[name]
        status.state = "stopped"
        status.exitcode = process.exitcode
        return status

    def poll(self) -> dict[str, CoreStatus]:
        """刷新一次所有核心的存活状态。"""
        for name, process in self._processes.items():
            status = self._status[name]
            if process.is_alive():
                status.state = "running"
            else:
                status.state = "stopped"
                status.exitcode = process.exitcode
        return dict(self._status)

    def stop_all(self, timeout: float = 5.0) -> list[CoreStatus]:
        """按登记顺序停止全部核心。"""
        return [self.stop(name, timeout) for name in list(self._processes)]

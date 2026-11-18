# Fortuna

Fortuna 是 Aevum 的内核方向，当前为骨架与设计验证目录。入口从 `src/kernel/fortuna/__init__.py` 和 `boot/` 开始；具体能力按 `arch/`、`core/`、`memory/`、`scheduler/`、`vfs/`、`net/`、`sandbox/` 分布。

它不是当前 Web 主链路的运行依赖。阅读顺序：本页 → `design.md` → `src/kernel/fortuna/core`。

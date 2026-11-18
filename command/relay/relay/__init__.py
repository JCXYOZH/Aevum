"""relay — 纯内存中继包。

锚点定标：包内任何导入都写成 `from relay.x import ...`，不使用相对路径，
也不在任何地方改写 sys.path。目录搬家时只改 pyproject.toml / 启动脚本。
"""

__version__ = "0.1.0"

"""职责模块：singleton。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union

from .library import ToolLibrary

_tool_library: Optional[ToolLibrary] = None

def get_tool_library(auto_register_security_tools: bool = True,
                     **kwargs) -> ToolLibrary:
    global _tool_library
    if _tool_library is None:
        _tool_library = ToolLibrary(auto_register_security_tools=auto_register_security_tools, **kwargs)
    return _tool_library

def init_tool_library(auto_register_security_tools: bool = True,
                      **kwargs) -> ToolLibrary:
    global _tool_library
    _tool_library = ToolLibrary(auto_register_security_tools=auto_register_security_tools, **kwargs)
    return _tool_library

# core/tool_assembler.py
"""
工具命令组装引擎 v2 - 零件池·标签体系·动态命令树

三个核心概念：
  1. AtomPool（零件池）：每个命令行片段是独立零件，有全局唯一ID和语义标签，
     不总结不简写，可标记重复，不绑定任何工具。
  2. TagSystem（标签体系）：零件按语义作用分类，标签分层（角色.语义），
     支持互斥组，是组装的索引依据。
  3. CommandTree（动态命令树）：工具只声明阶段顺序和标签匹配规则，
     组装时遍历阶段树，从零件池按标签动态选取零件，无任何硬编码组装逻辑。
"""
import os
import re
import shutil
import tempfile
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, field

from .atoms import Atom, AtomPool, Tag
from .tree import CommandTree, SlotDef, ToolDef, Trie, TrieNode


def detect_os() -> str:
    import platform
    system = platform.system().lower()
    if system == "darwin":
        return "darwin"
    if system == "windows":
        return "windows"
    return "linux"


def build_system_trie(assembler: "ToolAssembler", os_name: str = None) -> Trie:
    if os_name is None:
        os_name = detect_os()
    trie = Trie()
    cmds = SYSTEM_COMMANDS.get(os_name, {})
    for cmd_name, cmd_info in cmds.items():
        cfg = {
            "path": cmd_name,
            "args": cmd_info.get("args", []),
            "category": cmd_info.get("category", "系统命令"),
            "description": cmd_info.get("description", ""),
        }
        if cmd_name not in assembler.tools:
            assembler.load_from_config({cmd_name: cfg})
        trie.insert(cmd_name, f"sys_{os_name}_{cmd_name}")
        for arg in cfg["args"]:
            if isinstance(arg, str) and arg.startswith("-"):
                trie.insert(arg, f"sys_{os_name}_{cmd_name}_{arg}")
    for atom in assembler.pool.all_atoms():
        trie.insert(atom.text, atom.id)
    return trie

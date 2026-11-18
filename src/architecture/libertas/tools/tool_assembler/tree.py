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


@dataclass
class SlotDef:
    name: str
    required: bool = False
    default: Any = None
    value_source: str = "user"
    value_type: str = Tag.VALUE_STRING
    description: str = ""


@dataclass
class CommandTree:
    phase_order: List[str] = field(default_factory=lambda: list(DEFAULT_PHASE_ORDER))
    phases: Dict[str, List[str]] = field(default_factory=dict)
    slot_atoms: Dict[str, str] = field(default_factory=dict)
    phase_positions: Dict[str, int] = field(default_factory=dict)

    def add_atom(self, phase: str, atom_id: str, position: int = 0):
        if phase not in self.phases:
            self.phases[phase] = []
        if atom_id not in self.phases[phase]:
            self.phases[phase].append(atom_id)
        if phase not in self.phase_positions:
            self.phase_positions[phase] = position

    def get_atoms(self, phase: str) -> List[str]:
        return self.phases.get(phase, [])

    def resolve_order(self) -> List[str]:
        present = [p for p in self.phase_order if p in self.phases]
        return sorted(present, key=lambda p: self.phase_positions.get(p, 999))


@dataclass
class ToolDef:
    name: str
    path: str
    category: str = "其他"
    description: str = ""
    parser: str = ""
    tree: CommandTree = field(default_factory=CommandTree)
    slots: Dict[str, SlotDef] = field(default_factory=dict)


class TrieNode:
    __slots__ = ("children", "is_end", "atom_ids", "atom_texts")
    def __init__(self):
        self.children: Dict[str, "TrieNode"] = {}
        self.is_end: bool = False
        self.atom_ids: List[str] = []
        self.atom_texts: List[str] = []


class Trie:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, text: str, atom_id: str = ""):
        node = self.root
        for ch in text:
            if ch not in node.children:
                node.children[ch] = TrieNode()
            node = node.children[ch]
        node.is_end = True
        if atom_id and atom_id not in node.atom_ids:
            node.atom_ids.append(atom_id)
        if text not in node.atom_texts:
            node.atom_texts.append(text)

    def search(self, text: str) -> bool:
        node = self._find_node(text)
        return node is not None and node.is_end

    def starts_with(self, prefix: str) -> bool:
        return self._find_node(prefix) is not None

    def _find_node(self, prefix: str) -> Optional[TrieNode]:
        node = self.root
        for ch in prefix:
            if ch not in node.children:
                return None
            node = node.children[ch]
        return node

    def autocomplete(self, prefix: str, limit: int = 20) -> List[str]:
        node = self._find_node(prefix)
        if node is None:
            return []
        results: List[str] = []
        self._collect(node, prefix, results, limit)
        return results

    def _collect(self, node: TrieNode, prefix: str, results: List[str], limit: int):
        if len(results) >= limit:
            return
        if node.is_end:
            for t in node.atom_texts:
                if t not in results:
                    results.append(t)
                    if len(results) >= limit:
                        return
        for ch, child in sorted(node.children.items()):
            self._collect(child, prefix + ch, results, limit)

    def match_atoms(self, prefix: str, limit: int = 20) -> List[Dict[str, str]]:
        node = self._find_node(prefix)
        if node is None:
            return []
        results: List[Dict[str, str]] = []
        self._collect_atoms(node, results, limit)
        return results

    def _collect_atoms(self, node: TrieNode, results: List[Dict[str, str]], limit: int):
        if len(results) >= limit:
            return
        if node.is_end:
            for i, text in enumerate(node.atom_texts):
                aid = node.atom_ids[i] if i < len(node.atom_ids) else ""
                if not any(r["text"] == text for r in results):
                    results.append({"text": text, "atom_id": aid})
                    if len(results) >= limit:
                        return
        for ch, child in sorted(node.children.items()):
            self._collect_atoms(child, results, limit)

    def all_completions(self) -> List[str]:
        results: List[str] = []
        self._collect(self.root, "", results, 10000)
        return results

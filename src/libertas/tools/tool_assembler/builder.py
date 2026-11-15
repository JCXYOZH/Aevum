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
from .tree import CommandTree, SlotDef, ToolDef


class ToolAssemblerBuilderMixin:
    """工具声明加载、原子注册、参数进入命令树。"""

    def _register_builtin_atoms(self):
        for text, semantic in Tag.KNOWN_MODIFIER_SEMANTICS.items():
            kind = "modifier"
            tags = {Tag.ROLE_MODIFIER, semantic}
            if semantic.startswith("扫描类型."):
                tags.add("属性.扫描类型")
            self.pool.register(Atom(
                id=f"MOD_{re.sub(r'[^a-zA-Z0-9]', '_', text)}",
                text=text, kind=kind, tags=tags,
                description=semantic
            ))
        for text, semantic in Tag.KNOWN_FLAG_SEMANTICS.items():
            self.pool.register(Atom(
                id=f"FLAG_{re.sub(r'[^a-zA-Z0-9]', '_', text)}",
                text=text, kind="flag",
                tags={Tag.ROLE_FLAG, semantic, Tag.ATTR_BOOL},
                description=semantic
            ))
        for text, (semantic, vtype) in Tag.KNOWN_OPTION_SEMANTICS.items():
            self.pool.register(Atom(
                id=f"OPT_{re.sub(r'[^a-zA-Z0-9]', '_', text)}",
                text=text, kind="option",
                tags={Tag.ROLE_OPTION, semantic, Tag.ATTR_NEEDS_VALUE},
                value_type=vtype,
                description=semantic
            ))

    def load_from_config(self, config_tools: Dict[str, Any]):
        for name, cfg in config_tools.items():
            if cfg is None:
                cfg = {}
            if not isinstance(cfg, dict):
                continue
            self.tools[name] = self._build_tool(name, cfg)

    def _build_tool(self, name: str, cfg: Dict) -> ToolDef:
        path = cfg.get("path", name)
        args = cfg.get("args", [])
        category = cfg.get("category", "其他")
        description = cfg.get("description", "")
        parser = cfg.get("parser", "")
    
        tool = ToolDef(name=name, path=path, category=category,
                       description=description, parser=parser)
    
        tool_id = self._register_tool_atom(name, path)
        tool.tree.add_atom("tool", tool_id)
    
        if args:
            self._parse_args_into_tree(name, args, cfg, tool)
        elif name in self.MINIMAL_TOOL_HINTS:
            cat, slot_names = self.MINIMAL_TOOL_HINTS[name]
            if tool.category == "其他":
                tool.category = cat
            self._build_minimal_tree(tool, slot_names, cfg)
    
        return tool

    def _register_tool_atom(self, name: str, path: str) -> str:
        existing = self.pool.find_by_text(path)
        for a in existing:
            if a.kind == "tool":
                return a.id
        atom_id = f"TOOL_{re.sub(r'[^a-zA-Z0-9]', '_', name).upper()}"
        self.pool.register(Atom(
            id=atom_id, text=path, kind="tool",
            tags={Tag.ROLE_TOOL},
            description=f"工具: {name}",
            source_tool=name
        ))
        return atom_id

    def _parse_args_into_tree(self, tool_name: str, args: List, cfg: Dict, tool: ToolDef):
        i = 0
        while i < len(args):
            arg = args[i]
            if not isinstance(arg, str):
                arg = str(arg)
    
            if arg.startswith("{") and arg.endswith("}") and "{" not in arg[1:]:
                slot_name = arg[1:-1]
                self._add_slot_atom(tool_name, arg, slot_name, tool, cfg,
                                    is_compound=False, position=i)
                i += 1
                continue
    
            if "{" in arg and "}" in arg:
                slot_names = re.findall(r'\{(\w+)\}', arg)
                primary_slot = slot_names[0] if slot_names else "value"
                self._add_slot_atom(tool_name, arg, primary_slot, tool, cfg,
                                    is_compound=True, all_slots=slot_names, position=i)
                i += 1
                continue
    
            if arg.startswith("-") and arg != "-":
                next_arg = args[i + 1] if i + 1 < len(args) else None
                next_is_value = (
                    next_arg is not None
                    and isinstance(next_arg, str)
                    and (not next_arg.startswith("-") or next_arg == "-")
                )
    
                if next_is_value:
                    if isinstance(next_arg, str) and next_arg.startswith("{") and next_arg.endswith("}") and "{" not in next_arg[1:]:
                        slot_name = next_arg[1:-1]
                        option_id = self._add_option_atom(tool_name, arg, tool, force_new=True, position=i)
                        self._add_value_atom(tool_name, slot_name, tool, cfg,
                                             parent_option_id=option_id, position=i+1)
                        i += 2
                        continue
                    elif isinstance(next_arg, str) and "{" in next_arg and "}" in next_arg:
                        slot_names = re.findall(r'\{(\w+)\}', next_arg)
                        primary_slot = slot_names[0] if slot_names else "value"
                        option_id = self._add_option_atom(tool_name, arg, tool, force_new=True, position=i)
                        self._add_compound_slot_atom(tool_name, next_arg, primary_slot, tool, cfg,
                                                     parent_option_id=option_id, all_slots=slot_names, position=i+1)
                        i += 2
                        continue
                    else:
                        option_id = self._add_option_atom(tool_name, arg, tool, force_new=True, position=i)
                        literal_id = self._add_literal_atom(tool_name, str(next_arg),
                                                            tool, parent_option_id=option_id, position=i+1)
                        i += 2
                        continue
                else:
                    flag_id = self._add_flag_atom(tool_name, arg, tool, position=i)
                    i += 1
                    continue
    
            if i == 0:
                subcmd_id = self._add_subcommand_atom(tool_name, arg, tool, position=i)
                i += 1
                continue
    
            prev_arg = args[i - 1] if i > 0 else None
            if isinstance(prev_arg, str) and prev_arg.startswith("-") and prev_arg != "-":
                prev_atoms = self.pool.find_by_text(prev_arg)
                is_option_parent = any(a.kind in ("option", "output") for a in prev_atoms)
                if is_option_parent:
                    i += 1
                    continue
    
            literal_id = self._add_literal_atom(tool_name, arg, tool, position=i)
            i += 1

    def _is_bool_flag(self, text: str) -> bool:
        if text in Tag.KNOWN_MODIFIER_SEMANTICS:
            return True
        if text in Tag.KNOWN_FLAG_SEMANTICS:
            return True
        return False

    def _add_slot_atom(self, tool_name: str, text: str, slot_name: str,
                       tool: ToolDef, cfg: Dict, is_compound: bool = False,
                       all_slots: List[str] = None, position: int = 0) -> str:
        vtype = Tag.SLOT_VALUE_TYPES.get(slot_name, Tag.VALUE_STRING)
        config_default = cfg.get(f"default_{slot_name}")
    
        if slot_name in ("target", "url", "domain"):
            kind = "target"
            role_tag = Tag.ROLE_TARGET
            phase = "target"
        elif slot_name in ("output_file", "output_dir"):
            kind = "target"
            role_tag = Tag.ROLE_OUTPUT
            phase = "output"
            vtype = Tag.VALUE_PATH
        else:
            kind = "target"
            role_tag = Tag.ROLE_VALUE
            phase = "option"
    
        tags = {role_tag, Tag.ATTR_PLACEHOLDER, vtype}
        if is_compound:
            tags.add(Tag.ATTR_COMPOUND)
    
        atom_id = f"{tool_name}_{slot_name}_{len(tool.tree.slot_atoms)}"
        atom = Atom(
            id=atom_id, text=text, kind=kind, tags=tags,
            value_type=vtype, slot_name=slot_name,
            description=f"参数: {slot_name}",
            source_tool=tool_name
        )
        self.pool.register(atom)
        tool.tree.add_atom(phase, atom_id, position)
        tool.tree.slot_atoms[slot_name] = atom_id
    
        required = config_default is None and slot_name not in ("output_file", "output_dir")
        default_val = config_default
        if slot_name in ("output_file", "output_dir") and config_default is None:
            default_val = "auto"
            required = False
    
        if slot_name not in tool.slots:
            tool.slots[slot_name] = SlotDef(
                name=slot_name,
                required=required,
                default=default_val,
                value_source="default" if default_val is not None else "user",
                value_type=vtype,
                description=slot_name
            )
    
        if is_compound and all_slots:
            for sn in all_slots:
                if sn == slot_name:
                    continue
                tool.tree.slot_atoms[sn] = atom_id
                if sn not in tool.slots:
                    svtype = Tag.SLOT_VALUE_TYPES.get(sn, Tag.VALUE_STRING)
                    sd = cfg.get(f"default_{sn}")
                    tool.slots[sn] = SlotDef(
                        name=sn,
                        required=sd is None and sn not in ("output_file", "output_dir"),
                        default=sd if sd is not None else ("auto" if sn in ("output_file", "output_dir") else None),
                        value_source="default" if sd is not None else "user",
                        value_type=svtype,
                        description=sn
                    )
        return atom_id

    def _add_option_atom(self, tool_name: str, text: str, tool: ToolDef,
                         force_new: bool = False, position: int = 0) -> str:
        if not force_new:
            existing = self.pool.find_by_text(text)
            for a in existing:
                if a.kind in ("option", "output"):
                    phase = "output" if a.kind == "output" else "option"
                    tool.tree.add_atom(phase, a.id, position)
                    return a.id
    
        semantic, vtype = Tag.KNOWN_OPTION_SEMANTICS.get(text, (f"选项.{text.lstrip('-')}", Tag.VALUE_STRING))
        output_prefixes = {"-oJ", "-oX", "-oG", "-oN", "-oA", "-o", "--output", "--outfile"}
        is_output = text in output_prefixes
        kind = "output" if is_output else "option"
        role_tag = Tag.ROLE_OUTPUT if is_output else Tag.ROLE_OPTION
        phase = "output" if is_output else "option"
    
        atom_id = f"OPT_{re.sub(r'[^a-zA-Z0-9]', '_', text)}_{tool_name}_{id(tool)}_{len(tool.tree.phases.get(phase, []))}"
        atom = Atom(
            id=atom_id, text=text, kind=kind,
            tags={role_tag, semantic, Tag.ATTR_NEEDS_VALUE},
            value_type=vtype,
            description=semantic,
            source_tool=tool_name,
            allow_duplicate=True
        )
        self.pool.register(atom)
        tool.tree.add_atom(phase, atom_id, position)
        return atom_id

    def _add_compound_slot_atom(self, tool_name: str, text: str, slot_name: str,
                                tool: ToolDef, cfg: Dict,
                                parent_option_id: str = "",
                                all_slots: List[str] = None,
                                position: int = 0) -> str:
        vtype = Tag.SLOT_VALUE_TYPES.get(slot_name, Tag.VALUE_STRING)
        all_slots = all_slots or [slot_name]
        tags = {Tag.ROLE_VALUE, Tag.ATTR_PLACEHOLDER, Tag.ATTR_COMPOUND, vtype}
        if slot_name in ("target", "url", "domain"):
            tags.add(Tag.ROLE_TARGET)
    
        atom_id = f"{tool_name}_{slot_name}_compound_{len(tool.tree.slot_atoms)}"
        atom = Atom(
            id=atom_id, text=text, kind="target", tags=tags,
            value_type=vtype, slot_name=slot_name,
            parent_option_id=parent_option_id,
            description=f"复合参数: {text}",
            source_tool=tool_name
        )
        self.pool.register(atom)
        phase = "target" if slot_name in ("target", "url", "domain") else "option"
        if parent_option_id:
            parent = self.pool.get(parent_option_id)
            if parent and parent.kind == "output":
                phase = "output"
        tool.tree.add_atom(phase, atom_id, position)
    
        for sn in all_slots:
            tool.tree.slot_atoms[sn] = atom_id
            if sn not in tool.slots:
                svtype = Tag.SLOT_VALUE_TYPES.get(sn, Tag.VALUE_STRING)
                config_default = cfg.get(f"default_{sn}")
                tool.slots[sn] = SlotDef(
                    name=sn,
                    required=config_default is None,
                    default=config_default,
                    value_source="default" if config_default is not None else "user",
                    value_type=svtype, description=sn
                )
        return atom_id

    def _add_value_atom(self, tool_name: str, slot_name: str, tool: ToolDef,
                        cfg: Dict, parent_option_id: str = "", position: int = 0) -> str:
        vtype = Tag.SLOT_VALUE_TYPES.get(slot_name, Tag.VALUE_STRING)
        config_default = cfg.get(f"default_{slot_name}")
    
        if slot_name in ("target", "url", "domain"):
            phase = "target"
            role_tag = Tag.ROLE_TARGET
        elif slot_name in ("output_file", "output_dir"):
            phase = "output"
            role_tag = Tag.ROLE_OUTPUT
        else:
            phase = "option"
            role_tag = Tag.ROLE_VALUE
    
        atom_id = f"{tool_name}_{slot_name}_val_{len(tool.tree.slot_atoms)}"
        atom = Atom(
            id=atom_id, text=f"{{{slot_name}}}", kind="target",
            tags={role_tag, Tag.ATTR_PLACEHOLDER, vtype},
            value_type=vtype, slot_name=slot_name,
            parent_option_id=parent_option_id,
            description=f"值: {slot_name}",
            source_tool=tool_name
        )
        self.pool.register(atom)
        tool.tree.add_atom(phase, atom_id, position)
        tool.tree.slot_atoms[slot_name] = atom_id
    
        required = config_default is None and slot_name not in ("output_file", "output_dir")
        default_val = config_default
        if slot_name in ("output_file", "output_dir") and config_default is None:
            default_val = "auto"
            required = False
    
        if slot_name not in tool.slots:
            tool.slots[slot_name] = SlotDef(
                name=slot_name, required=required, default=default_val,
                value_source="default" if default_val is not None else "user",
                value_type=vtype, description=slot_name
            )
        return atom_id

    def _add_flag_atom(self, tool_name: str, text: str, tool: ToolDef, position: int = 0) -> str:
        existing = self.pool.find_by_text(text)
        for a in existing:
            if a.kind in ("flag", "modifier"):
                phase = KIND_TO_PHASE.get(a.kind, "flag")
                tool.tree.add_atom(phase, a.id, position)
                return a.id
    
        if text in Tag.KNOWN_MODIFIER_SEMANTICS:
            semantic = Tag.KNOWN_MODIFIER_SEMANTICS[text]
            kind = "modifier"
            tags = {Tag.ROLE_MODIFIER, semantic}
        else:
            semantic = Tag.KNOWN_FLAG_SEMANTICS.get(text, f"标志.{text.lstrip('-')}")
            kind = "flag"
            tags = {Tag.ROLE_FLAG, semantic, Tag.ATTR_BOOL}
    
        atom_id = f"FLAG_{re.sub(r'[^a-zA-Z0-9]', '_', text)}_{tool_name}"
        atom = Atom(
            id=atom_id, text=text, kind=kind, tags=tags,
            description=semantic, source_tool=tool_name, allow_duplicate=True
        )
        self.pool.register(atom)
        tool.tree.add_atom(KIND_TO_PHASE.get(kind, "flag"), atom_id, position)
        return atom_id

    def _add_literal_atom(self, tool_name: str, text: str, tool: ToolDef,
                          parent_option_id: str = "", position: int = 0) -> str:
        atom_id = f"LIT_{tool_name}_{re.sub(r'[^a-zA-Z0-9]', '_', text)}_{len(tool.tree.phases.get('option', []))}"
        atom = Atom(
            id=atom_id, text=text, kind="target",
            tags={Tag.ROLE_VALUE, Tag.ATTR_FIXED},
            parent_option_id=parent_option_id,
            description=f"固定值: {text}",
            source_tool=tool_name
        )
        self.pool.register(atom)
        phase = "option"
        if parent_option_id:
            parent = self.pool.get(parent_option_id)
            if parent and parent.kind == "output":
                phase = "output"
        tool.tree.add_atom(phase, atom_id, position)
        return atom_id

    def _add_subcommand_atom(self, tool_name: str, text: str, tool: ToolDef, position: int = 0) -> str:
        atom_id = f"SUBCMD_{tool_name}_{re.sub(r'[^a-zA-Z0-9]', '_', text)}"
        atom = Atom(
            id=atom_id, text=text, kind="subcommand",
            tags={Tag.ROLE_SUBCOMMAND, f"子命令.{text}"},
            description=f"子命令: {text}",
            source_tool=tool_name
        )
        self.pool.register(atom)
        tool.tree.add_atom("subcommand", atom_id, position)
        return atom_id

    def _build_minimal_tree(self, tool: ToolDef, slot_names: List[str], cfg: Dict):
        for slot_name in slot_names:
            if slot_name in ("target", "url", "domain"):
                self._add_value_atom(tool.name, slot_name, tool, cfg)
            elif slot_name in ("ports", "port"):
                opt_id = self._add_option_atom(tool.name, "-p", tool)
                self._add_value_atom(tool.name, slot_name, tool, cfg, parent_option_id=opt_id)
            elif slot_name in ("wordlist", "passlist", "userlist"):
                opt_text = "-w" if slot_name == "wordlist" else ("-P" if slot_name == "passlist" else "-L")
                opt_id = self._add_option_atom(tool.name, opt_text, tool)
                self._add_value_atom(tool.name, slot_name, tool, cfg, parent_option_id=opt_id)
            elif slot_name == "username":
                opt_id = self._add_option_atom(tool.name, "-l", tool)
                self._add_value_atom(tool.name, slot_name, tool, cfg, parent_option_id=opt_id)
            elif slot_name == "service":
                self._add_value_atom(tool.name, slot_name, tool, cfg)
            else:
                self._add_value_atom(tool.name, slot_name, tool, cfg)

    def list_templates(self) -> List[Dict[str, Any]]:
        result = []
        for name, tool in self.tools.items():
            available = shutil.which(tool.path) is not None
            phase_info = {}
            for phase in tool.tree.phase_order:
                atoms = tool.tree.get_atoms(phase)
                phase_info[phase] = len(atoms)
            result.append({
                "name": name,
                "category": tool.category,
                "description": tool.description,
                "path": tool.path,
                "available": available,
                "phases": phase_info,
                "slots": [
                    {
                        "name": s.name,
                        "required": s.required,
                        "default": s.default,
                        "type": s.value_type,
                        "description": s.description,
                    }
                    for s in tool.slots.values()
                ],
            })
        return result

    def register_minimal_tool(self, name: str, path: str = None,
                              category: str = "自定义", description: str = "") -> ToolDef:
        if name in self.tools:
            return self.tools[name]
        cfg = {"path": path or name, "category": category, "description": description}
        if name in self.MINIMAL_TOOL_HINTS:
            cat, slot_names = self.MINIMAL_TOOL_HINTS[name]
            cfg["category"] = category if category != "自定义" else cat
            cfg["args"] = []
            for sn in slot_names:
                cfg["args"].append(f"{{{sn}}}")
        else:
            cfg["args"] = []
        tool = self._build_tool(name, cfg)
        self.tools[name] = tool
        return tool

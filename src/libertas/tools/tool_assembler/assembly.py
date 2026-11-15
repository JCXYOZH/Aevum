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
from .tree import CommandTree, SlotDef, ToolDef, Trie


class ToolAssemblerAssemblyMixin:
    """命令组装、参数提取、模板与调试输出。"""

    def assemble(self, tool_name: str, params: Dict[str, Any] = None,
                 auto_defaults: bool = True) -> Tuple[List[str], List[str]]:
        if tool_name not in self.tools:
            self.register_minimal_tool(tool_name)
        tool = self.tools[tool_name]
        params = params or {}
        warnings: List[str] = []
        cmd: List[str] = []
        selected_tags: Set[str] = set()
        selected_texts: Set[str] = set()
    
        for phase in tool.tree.resolve_order():
            atom_ids = tool.tree.get_atoms(phase)
            if not atom_ids:
                continue
    
            phase_parts: List[str] = []
            for atom_id in atom_ids:
                atom = self.pool.get(atom_id)
                if not atom:
                    continue
    
                if atom.kind == "tool":
                    phase_parts.append(atom.text)
                    continue
    
                if atom.kind == "subcommand":
                    phase_parts.append(atom.text)
                    continue
    
                if atom.kind in ("flag", "modifier"):
                    if not atom.allow_duplicate and atom.text in selected_texts:
                        continue
                    mutex_group = None
                    for t in atom.tags:
                        g = Tag.get_mutex_group(t)
                        if g:
                            mutex_group = g
                            break
                    if mutex_group and (mutex_group & selected_tags):
                        continue
                    phase_parts.append(atom.text)
                    selected_texts.add(atom.text)
                    selected_tags.update(atom.tags)
                    continue
    
                if atom.kind == "option":
                    paired = self._find_paired_value(tool, atom)
                    if paired is None:
                        continue
                    if paired.has_tag(Tag.ATTR_FIXED):
                        if not atom.allow_duplicate and atom.text in selected_texts:
                            continue
                        phase_parts.append(atom.text)
                        phase_parts.append(paired.text)
                        selected_texts.add(atom.text)
                        selected_tags.update(atom.tags)
                    elif paired.has_tag(Tag.ATTR_PLACEHOLDER):
                        slot_name = paired.slot_name
                        value = self._resolve_value(slot_name, params, tool, auto_defaults, warnings)
                        if value is not None:
                            if not atom.allow_duplicate and atom.text in selected_texts:
                                continue
                            phase_parts.append(atom.text)
                            if paired.has_tag(Tag.ATTR_COMPOUND):
                                text = paired.text
                                for sn in re.findall(r'\{(\w+)\}', text):
                                    sv = self._resolve_value(sn, params, tool, auto_defaults, warnings)
                                    if sv is not None:
                                        text = text.replace(f"{{{sn}}}", str(sv))
                                phase_parts.append(text)
                            else:
                                phase_parts.append(str(value))
                            selected_texts.add(atom.text)
                            selected_tags.update(atom.tags)
                    continue
    
                if atom.kind == "target" and not atom.has_tag(Tag.ATTR_FIXED):
                    if atom.parent_option_id:
                        continue
                    if atom.has_tag(Tag.ATTR_PLACEHOLDER):
                        slot_name = atom.slot_name
                        value = self._resolve_value(slot_name, params, tool, auto_defaults, warnings)
                        if value is not None:
                            if atom.has_tag(Tag.ATTR_COMPOUND):
                                text = atom.text
                                for sn in re.findall(r'\{(\w+)\}', text):
                                    sv = self._resolve_value(sn, params, tool, auto_defaults, warnings)
                                    if sv is not None:
                                        text = text.replace(f"{{{sn}}}", str(sv))
                                phase_parts.append(text)
                            else:
                                phase_parts.append(str(value))
                            selected_tags.update(atom.tags)
                    continue
    
                if atom.kind == "output":
                    if atom.has_tag(Tag.ATTR_NEEDS_VALUE):
                        paired = self._find_paired_value(tool, atom)
                        if paired is not None:
                            if paired.has_tag(Tag.ATTR_FIXED):
                                if atom.text not in selected_texts:
                                    phase_parts.append(atom.text)
                                    phase_parts.append(paired.text)
                                    selected_texts.add(atom.text)
                                continue
                            slot_name = paired.slot_name if paired.has_tag(Tag.ATTR_PLACEHOLDER) else self._find_slot_for_option(tool, atom)
                            if slot_name:
                                value = self._resolve_value(slot_name, params, tool, auto_defaults, warnings)
                                if value is not None:
                                    if atom.text not in selected_texts:
                                        phase_parts.append(atom.text)
                                        phase_parts.append(str(value))
                                        selected_texts.add(atom.text)
                                        selected_tags.update(atom.tags)
                            continue
                        slot_name = self._find_slot_for_option(tool, atom)
                        if slot_name:
                            value = self._resolve_value(slot_name, params, tool, auto_defaults, warnings)
                            if value is not None:
                                if atom.text not in selected_texts:
                                    phase_parts.append(atom.text)
                                    phase_parts.append(str(value))
                                    selected_texts.add(atom.text)
                                    selected_tags.update(atom.tags)
                        continue
                    if not atom.allow_duplicate and atom.text in selected_texts:
                        continue
                    phase_parts.append(atom.text)
                    selected_texts.add(atom.text)
                    continue
    
                if atom.kind == "target":
                    if not atom.has_tag(Tag.ROLE_TARGET):
                        continue
                    if atom.has_tag(Tag.ATTR_PLACEHOLDER):
                        slot_name = atom.slot_name
                        value = self._resolve_value(slot_name, params, tool, auto_defaults, warnings)
                        if value is None:
                            continue
                        if atom.has_tag(Tag.ATTR_COMPOUND):
                            text = atom.text
                            for sn in re.findall(r'\{(\w+)\}', text):
                                sv = self._resolve_value(sn, params, tool, auto_defaults, warnings)
                                if sv is not None:
                                    text = text.replace(f"{{{sn}}}", str(sv))
                            phase_parts.append(text)
                        else:
                            phase_parts.append(str(value))
                        selected_tags.update(atom.tags)
                    continue
    
            cmd.extend(phase_parts)
    
        cmd = self._dedupe(cmd)
        return cmd, warnings

    def _find_paired_value(self, tool: ToolDef, option_atom: Atom) -> Optional[Atom]:
        for phase in tool.tree.phase_order:
            for atom_id in tool.tree.get_atoms(phase):
                atom = self.pool.get(atom_id)
                if atom and atom.parent_option_id == option_atom.id:
                    return atom
        return None

    def _find_slot_for_option(self, tool: ToolDef, option_atom: Atom) -> Optional[str]:
        for slot_name, atom_id in tool.tree.slot_atoms.items():
            atom = self.pool.get(atom_id)
            if atom and atom.parent_option_id == option_atom.id:
                return slot_name
        for slot_name, slot_def in tool.slots.items():
            if slot_def.value_type == option_atom.value_type:
                return slot_name
        return None

    def _resolve_value(self, slot_name: str, params: Dict, tool: ToolDef,
                       auto_defaults: bool, warnings: List[str]) -> Optional[Any]:
        value = params.get(slot_name)
        if value is not None:
            return value
        slot_def = tool.slots.get(slot_name)
        if slot_def and slot_def.value_type == Tag.VALUE_URL and params.get("target"):
            target = params["target"]
            if target.startswith("http"):
                return target
            value = f"http://{target}"
            warnings.append(f"参数 {slot_name} 从 target 自动构造: {value}")
            return value
        if slot_def and slot_def.value_type == Tag.VALUE_DOMAIN and params.get("target"):
            return params["target"]
        if slot_def and auto_defaults and slot_def.default is not None:
            if slot_def.default == "auto":
                value = self._auto_value(slot_name, tool.name)
            else:
                value = slot_def.default
            if value is not None:
                warnings.append(f"参数 {slot_name} 使用默认值: {value}")
            return value
        if slot_def and slot_def.required:
            # 模型常常只说"扫一下这个 IP"，不会主动给端口范围。与其拼出一条
            # `-p {ports}` 的坏命令（必然失败），不如按常规默认跑，
            # 取值与原生 port_scan 的默认保持一致。
            if slot_name in ("ports", "port_range", "port") and params.get("target"):
                warnings.append(f"参数 {slot_name} 使用默认值: 1-1000")
                return "1-1000"
            warnings.append(f"缺少必填参数: {slot_name}")
        return None

    def _auto_value(self, slot_name: str, tool_name: str) -> str:
        if slot_name in ("output_file",):
            return os.path.join(tempfile.gettempdir(),
                                f"libertas_{tool_name}_{os.getpid()}.json")
        if slot_name in ("output_dir",):
            d = os.path.join(tempfile.gettempdir(), f"libertas_{tool_name}_{os.getpid()}")
            os.makedirs(d, exist_ok=True)
            return d
        return None

    def _dedupe(self, cmd: List[str]) -> List[str]:
        result = []
        prev = None
        for item in cmd:
            if item == prev:
                continue
            result.append(item)
            prev = item
        return result

    def extract_params_from_text(self, text: str) -> Dict[str, str]:
        params: Dict[str, str] = {}
    
        ip_match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text)
        if ip_match:
            params["target"] = ip_match.group()
    
        if "target" not in params:
            domain_match = re.search(
                r"\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b", text
            )
            if domain_match:
                candidate = domain_match.group()
                if not re.search(r"\.\w{1,4}$", candidate) or "/" in text[max(0, domain_match.start()-20):domain_match.start()]:
                    pass
                if not candidate.endswith((".txt", ".json", ".xml", ".csv", ".log", ".pcap",
                                          ".cap", ".doc", ".pdf", ".zip", ".tar", ".gz",
                                          ".png", ".jpg", ".jpeg", ".gif", ".py", ".js",
                                          ".html", ".css", ".conf", ".cfg", ".yaml", ".yml",
                                          ".db", ".sqlite", ".mdb", ".exe", ".dll", ".bin",
                                          ".dat", ".bak", ".tmp", ".old", ".swp")):
                    params["target"] = candidate
    
        url_match = re.search(r"https?://[^\s'\"<>，。、]+", text)
        if url_match:
            params["url"] = url_match.group()
            if "target" not in params:
                from urllib.parse import urlparse
                parsed = urlparse(url_match.group())
                params["target"] = parsed.hostname or ""
    
        port_match = re.search(r"(\d{1,5}(?:[,-]\d{1,5})+)\s*(?:端口?|port)?", text, re.IGNORECASE)
        if port_match:
            val = port_match.group(1)
            if not re.match(r"^\d{1,3}\.\d{1,3}\.", val):
                params["ports"] = val
        else:
            port_single = re.search(r"(?:端口?|port)[：:\s]*(\d{1,5})", text, re.IGNORECASE)
            if port_single:
                params["ports"] = port_single.group(1)
            else:
                cn_ports = re.findall(r"(\d{1,5})\s*(?:和|,|，|、)\s*", text)
                port_after = re.search(r"(\d{1,5})\s*(?:和|,|，|、)\s*(\d{1,5})", text)
                if port_after:
                    p1 = port_after.group(1)
                    p2 = port_after.group(2)
                    if 0 < int(p1) <= 65535 and 0 < int(p2) <= 65535:
                        params["ports"] = f"{p1},{p2}"
    
        user_match = re.search(r"(?:用户名|用户|user|账号)[：:\s]+(\S+?)[\s,，。、]|爆破\s+(\S+?)\s+的\s*(?:ssh|ftp|smb|rdp|mysql|mssql|postgres|redis|vnc|telnet|密码|口令)", text, re.IGNORECASE)
        if user_match:
            u = user_match.group(1) or user_match.group(2)
            if u and not re.match(r"^\d+\.\d+\.\d+\.\d+$", u) and "." not in u:
                params["username"] = u
    
        path_match = re.search(r"(?:字典|wordlist|文件|路径|file|path|密码字典|passlist)[是为：:\s]*(/[^\s,，。、]+|[a-zA-Z]:\\[^\s,，。、]+)", text, re.IGNORECASE)
        if path_match:
            params["wordlist"] = path_match.group(1)
    
        service_match = re.search(
            r"(?:服务|service|协议|爆破\s+\S+\s+的\s+|的\s+)(ssh|ftp|smb|rdp|mysql|mssql|postgres|redis|vnc|telnet|http|https)(?:\s|密码|，|,|。|$)",
            text, re.IGNORECASE)
        if service_match:
            params["service"] = service_match.group(1).lower()
    
        speed_match = re.search(r"(快速|高速|快点|fast|quick)", text, re.IGNORECASE)
        if speed_match:
            params["speed"] = "fast"
        elif re.search(r"(慢速|慢点|详细|slow)", text, re.IGNORECASE):
            params["speed"] = "slow"
    
        if re.search(r"(不ping|跳过主机|跳过发现|no.?ping)", text, re.IGNORECASE):
            params["no_ping"] = "true"
        if re.search(r"(版本|服务识别|version)", text, re.IGNORECASE):
            params["service_version"] = "true"
        if re.search(r"(静默|silent|安静)", text, re.IGNORECASE):
            params["silent"] = "true"
        if re.search(r"(仅开放|开放端口|open)", text, re.IGNORECASE):
            params["open_only"] = "true"
        if re.search(r"(json|JSON)", text):
            params["output_format"] = "json"
    
        return params

    def suggest_tool(self, text: str) -> List[str]:
        text_lower = text.lower()
        scores: Dict[str, int] = {}
        for tool, keywords in self.SUGGEST_KEYWORDS.items():
            for kw in keywords:
                if kw in text_lower:
                    scores[tool] = scores.get(tool, 0) + 1
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        available = set(self.tools.keys())
        return [name for name, score in ranked if score > 0 and name in available]

    def get_pool_stats(self) -> Dict[str, Any]:
        return self.pool.stats()

    def dump_tree(self, tool_name: str) -> Optional[Dict[str, Any]]:
        if tool_name not in self.tools:
            return None
        tool = self.tools[tool_name]
        result = {"name": tool_name, "phases": {}}
        for phase in tool.tree.phase_order:
            atoms = []
            for aid in tool.tree.get_atoms(phase):
                a = self.pool.get(aid)
                if a:
                    atoms.append({
                        "id": a.id,
                        "text": a.text,
                        "kind": a.kind,
                        "tags": sorted(a.tags),
                        "slot": a.slot_name,
                        "parent": a.parent_option_id,
                    })
            result["phases"][phase] = atoms
        return result

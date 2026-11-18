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


class Tag:
    ROLE_TOOL = "角色.工具"
    ROLE_SUBCOMMAND = "角色.子命令"
    ROLE_MODIFIER = "角色.修饰"
    ROLE_FLAG = "角色.标志"
    ROLE_OPTION = "角色.选项"
    ROLE_VALUE = "角色.值"
    ROLE_TARGET = "角色.目标"
    ROLE_OUTPUT = "角色.输出"

    ATTR_NEEDS_VALUE = "属性.需要值"
    ATTR_BOOL = "属性.布尔"
    ATTR_FIXED = "属性.固定值"
    ATTR_PLACEHOLDER = "属性.占位符"
    ATTR_COMPOUND = "属性.复合"

    VALUE_PORT = "值类型.端口"
    VALUE_TARGET = "值类型.目标"
    VALUE_URL = "值类型.URL"
    VALUE_PATH = "值类型.路径"
    VALUE_STRING = "值类型.字符串"
    VALUE_INT = "值类型.整数"
    VALUE_USERNAME = "值类型.用户名"
    VALUE_SERVICE = "值类型.服务"
    VALUE_MODULE = "值类型.模块"
    VALUE_FORMAT = "值类型.格式"
    VALUE_BSSID = "值类型.BSSID"
    VALUE_IFACE = "值类型.接口"
    VALUE_HASH = "值类型.哈希"
    VALUE_EXTENSIONS = "值类型.扩展名"
    VALUE_PCAP = "值类型.pcap"
    VALUE_DOMAIN = "值类型.域名"

    MUTEX_GROUPS = [
        {"修饰.速度.快速", "修饰.速度.慢速", "修饰.速度.正常"},
        {"扫描类型.TCP", "扫描类型.SYN", "扫描类型.UDP", "扫描类型.ACK"},
        {"输出格式.JSON", "输出格式.XML", "输出格式.grepable", "输出格式.标准", "输出格式.CSV"},
    ]

    KNOWN_FLAG_SEMANTICS = {
        "-Pn": "修饰.跳过发现",
        "-PN": "修饰.跳过发现",
        "-sV": "修饰.版本识别",
        "-O": "修饰.系统检测",
        "-A": "修饰.全面扫描",
        "-sC": "标志.默认脚本",
        "--open": "标志.仅开放",
        "-silent": "标志.静默",
        "--silent": "标志.静默",
        "-q": "标志.静默",
        "--quiet": "标志.静默",
        "-v": "标志.详细",
        "-vv": "标志.详细",
        "--verbose": "标志.详细",
        "-n": "标志.不解析",
        "-R": "标志.总是解析",
        "-6": "标志.IPv6",
        "--subs-only": "标志.仅子域名",
        "--batch": "标志.批处理",
        "--smart": "标志.智能模式",
        "--show": "标志.显示",
        "-json": "标志.JSON输出",
        "--json": "标志.JSON输出",
        "-j": "标志.JSON输出",
        "-f": "标志.分片",
        "-S": "标志.SYN扫描",
        "-h": "标志.帮助",
        "--help": "标志.帮助",
        "-nc": "标志.不颜色",
        "--no-color": "标志.不颜色",
        "-a": "标志.追加",
        "-r": "标志.递归",
        "-R": "标志.递归",
        "--recursive": "标志.递归",
        "-e": "标志.扩展",
        "-x": "标志.扩展",
    }

    KNOWN_MODIFIER_SEMANTICS = {
        "-T0": "修饰.速度.慢速",
        "-T1": "修饰.速度.慢速",
        "-T2": "修饰.速度.正常",
        "-T3": "修饰.速度.正常",
        "-T4": "修饰.速度.快速",
        "-T5": "修饰.速度.快速",
        "-sT": "扫描类型.TCP",
        "-sS": "扫描类型.SYN",
        "-sU": "扫描类型.UDP",
        "-sA": "扫描类型.ACK",
        "-sN": "扫描类型.NULL",
        "-sF": "扫描类型.FIN",
        "-sX": "扫描类型.XMAS",
    }

    KNOWN_OPTION_SEMANTICS = {
        "-p": ("选项.端口", VALUE_PORT),
        "--ports": ("选项.端口", VALUE_PORT),
        "--port": ("选项.端口", VALUE_PORT),
        "-w": ("选项.字典", VALUE_PATH),
        "--wordlist": ("选项.字典", VALUE_PATH),
        "-d": ("选项.域名", VALUE_DOMAIN),
        "--domain": ("选项.域名", VALUE_DOMAIN),
        "-u": ("选项.URL", VALUE_URL),
        "--url": ("选项.URL", VALUE_URL),
        "-target": ("选项.目标", VALUE_TARGET),
        "--target": ("选项.目标", VALUE_TARGET),
        "-t": ("选项.目标", VALUE_TARGET),
        "-l": ("选项.用户名", VALUE_USERNAME),
        "-L": ("选项.用户列表", VALUE_PATH),
        "-P": ("选项.密码字典", VALUE_PATH),
        "--password": ("选项.密码", VALUE_STRING),
        "-U": ("选项.用户名", VALUE_USERNAME),
        "--username": ("选项.用户名", VALUE_USERNAME),
        "-M": ("选项.模块", VALUE_MODULE),
        "--module": ("选项.模块", VALUE_MODULE),
        "-o": ("选项.输出文件", VALUE_PATH),
        "--output": ("选项.输出文件", VALUE_PATH),
        "-oJ": ("输出.JSON", VALUE_PATH),
        "-oX": ("输出.XML", VALUE_PATH),
        "-oG": ("输出.grepable", VALUE_PATH),
        "-oN": ("输出.标准", VALUE_PATH),
        "-oA": ("输出.全部格式", VALUE_PATH),
        "-of": ("选项.输出格式", VALUE_FORMAT),
        "--format": ("选项.格式", VALUE_FORMAT),
        "-iL": ("选项.输入列表", VALUE_PATH),
        "-i": ("选项.输入文件", VALUE_PATH),
        "--input": ("选项.输入文件", VALUE_PATH),
        "-c": ("选项.配置", VALUE_PATH),
        "--config": ("选项.配置", VALUE_PATH),
        "-f": ("选项.文件", VALUE_PATH),
        "--file": ("选项.文件", VALUE_PATH),
        "-b": ("选项.BSSID", VALUE_BSSID),
        "--bssid": ("选项.BSSID", VALUE_BSSID),
        "-e": ("选项.扩展名", VALUE_EXTENSIONS),
        "--extensions": ("选项.扩展名", VALUE_EXTENSIONS),
        "-x": ("选项.扩展名", VALUE_EXTENSIONS),
        "-s": ("选项.服务", VALUE_SERVICE),
        "--service": ("选项.服务", VALUE_SERVICE),
        "-m": ("选项.模式", VALUE_STRING),
        "--mode": ("选项.模式", VALUE_STRING),
        "-a": ("选项.算法", VALUE_INT),
        "-T": ("选项.格式", VALUE_FORMAT),
        "--type": ("选项.类型", VALUE_STRING),
        "--hash-type": ("选项.哈希类型", VALUE_HASH),
        "--interface": ("选项.接口", VALUE_IFACE),
        "-I": ("选项.接口", VALUE_IFACE),
        "--rate": ("选项.速率", VALUE_INT),
        "--rate-limit": ("选项.速率", VALUE_INT),
        "--threads": ("选项.线程", VALUE_INT),
        "--timeout": ("选项.超时", VALUE_INT),
        "--depth": ("选项.深度", VALUE_INT),
        "--proxy": ("选项.代理", VALUE_STRING),
        "--cookie": ("选项.Cookie", VALUE_STRING),
        "--user-agent": ("选项.UserAgent", VALUE_STRING),
        "--token": ("选项.Token", VALUE_STRING),
        "--key": ("选项.Key", VALUE_STRING),
        "--report": ("选项.报告", VALUE_PATH),
        "--outfile": ("选项.输出文件", VALUE_PATH),
        "--logfile": ("选项.日志文件", VALUE_PATH),
        "--output-dir": ("选项.输出目录", VALUE_PATH),
        "--wait": ("选项.等待", VALUE_INT),
        "-r": ("选项.pcap", VALUE_PCAP),
        "-F": ("选项.规则文件", VALUE_PATH),
        "--rules": ("选项.规则文件", VALUE_PATH),
        "--rule-file": ("选项.规则文件", VALUE_PATH),
        "--severity": ("选项.严重度", VALUE_STRING),
        "--cve": ("选项.CVE", VALUE_STRING),
    }

    SLOT_VALUE_TYPES = {
        "target": VALUE_TARGET,
        "target_file": VALUE_PATH,
        "domain_list": VALUE_PATH,
        "input_file": VALUE_PATH,
        "ports": VALUE_PORT,
        "port": VALUE_PORT,
        "url": VALUE_URL,
        "wordlist": VALUE_PATH,
        "passlist": VALUE_PATH,
        "userlist": VALUE_PATH,
        "output_file": VALUE_PATH,
        "output_dir": VALUE_PATH,
        "username": VALUE_USERNAME,
        "password": VALUE_STRING,
        "service": VALUE_SERVICE,
        "module": VALUE_MODULE,
        "hash_type": VALUE_HASH,
        "hash_file": VALUE_PATH,
        "format": VALUE_FORMAT,
        "rules_file": VALUE_PATH,
        "rule_file": VALUE_PATH,
        "pcap_file": VALUE_PCAP,
        "interface": VALUE_IFACE,
        "packet_count": VALUE_INT,
        "pattern": VALUE_STRING,
        "bssid": VALUE_BSSID,
        "cap_file": VALUE_PATH,
        "channel": VALUE_INT,
        "collection_file": VALUE_PATH,
        "environment_file": VALUE_PATH,
        "log_file": VALUE_PATH,
        "memory_file": VALUE_PATH,
        "image_file": VALUE_PATH,
        "manifest_file": VALUE_PATH,
        "record_type": VALUE_STRING,
        "sql_query": VALUE_STRING,
        "query": VALUE_STRING,
        "scanner": VALUE_STRING,
        "extensions": VALUE_EXTENSIONS,
        "depth": VALUE_INT,
        "servername": VALUE_DOMAIN,
        "token": VALUE_STRING,
        "offset": VALUE_INT,
    }

    @classmethod
    def get_mutex_group(cls, tag: str) -> Optional[Set[str]]:
        for group in cls.MUTEX_GROUPS:
            if tag in group:
                return group
        return None

@dataclass
class Atom:
    id: str
    text: str
    kind: str
    tags: Set[str] = field(default_factory=set)
    value_type: str = ""
    slot_name: str = ""
    paired_slot_id: str = ""
    parent_option_id: str = ""
    allow_duplicate: bool = False
    description: str = ""
    source_tool: str = ""

    def has_tag(self, tag: str) -> bool:
        return tag in self.tags

    def has_any_tag(self, tags: Set[str]) -> bool:
        return bool(self.tags & tags)

class AtomPool:
    def __init__(self):
        self.atoms: Dict[str, Atom] = {}
        self.tag_index: Dict[str, Set[str]] = {}
        self.text_index: Dict[str, Set[str]] = {}
        self._id_counter = 0

    def register(self, atom: Atom) -> str:
        if not atom.id:
            atom.id = self._generate_id(atom)
        if atom.id in self.atoms:
            return atom.id
        self.atoms[atom.id] = atom
        for tag in atom.tags:
            self.tag_index.setdefault(tag, set()).add(atom.id)
        self.text_index.setdefault(atom.text, set()).add(atom.id)
        return atom.id

    def _generate_id(self, atom: Atom) -> str:
        self._id_counter += 1
        semantic = ""
        for t in sorted(atom.tags):
            if "." in t:
                parts = t.split(".")
                semantic = parts[-1]
                break
        if not semantic:
            semantic = re.sub(r'[^a-zA-Z0-9]', '_', atom.text).strip('_').upper()
        return f"{semantic}_{self._id_counter:04d}"

    def get(self, atom_id: str) -> Optional[Atom]:
        return self.atoms.get(atom_id)

    def find_by_text(self, text: str) -> List[Atom]:
        ids = self.text_index.get(text, set())
        return [self.atoms[i] for i in ids if i in self.atoms]

    def find_by_tag(self, tag: str) -> List[Atom]:
        ids = self.tag_index.get(tag, set())
        return [self.atoms[i] for i in ids if i in self.atoms]

    def find_by_tags_all(self, tags: Set[str]) -> List[Atom]:
        if not tags:
            return []
        result_ids = None
        for tag in tags:
            ids = self.tag_index.get(tag, set())
            if result_ids is None:
                result_ids = set(ids)
            else:
                result_ids &= ids
        return [self.atoms[i] for i in (result_ids or set()) if i in self.atoms]

    def find_by_kind_and_tag(self, kind: str, tag: str) -> List[Atom]:
        return [a for a in self.find_by_tag(tag) if a.kind == kind]

    def all_atoms(self) -> List[Atom]:
        return list(self.atoms.values())

    def stats(self) -> Dict[str, int]:
        kind_counts: Dict[str, int] = {}
        for a in self.atoms.values():
            kind_counts[a.kind] = kind_counts.get(a.kind, 0) + 1
        return {"total": len(self.atoms), "by_kind": kind_counts}

"""
core/help_parser.py - 结构化解析器

解析命令帮助文本、man page、Markdown、HTML、CLI输出表格，
提取命令结构、参数、选项，生成补全脚本和校验规则。
"""
import re
import os
import json
import time
import threading
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 命令参数
# ================================================================
class CommandArgument:
    """命令参数"""

    def __init__(self, name: str = "", arg_type: str = "positional",  # positional / option / flag
                 short: str = "", long: str = "",
                 description: str = "", required: bool = False,
                 default: str = "", choices: Optional[List[str]] = None,
                 value_type: str = "string"):  # string / int / float / bool / path / url
        self.name = name
        self.arg_type = arg_type
        self.short = short
        self.long = long
        self.description = description
        self.required = required
        self.default = default
        self.choices = choices or []
        self.value_type = value_type

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "arg_type": self.arg_type,
            "short": self.short, "long": self.long,
            "description": self.description, "required": self.required,
            "default": self.default, "choices": self.choices,
            "value_type": self.value_type,
        }


# ================================================================
# 命令规格
# ================================================================
class CommandSpec:
    """命令规格"""

    def __init__(self, name: str = "", description: str = "",
                 usage: str = "", version: str = "",
                 subcommands: Optional[Dict[str, "CommandSpec"]] = None,
                 arguments: Optional[List[CommandArgument]] = None,
                 examples: Optional[List[str]] = None,
                 source: str = ""):
        self.name = name
        self.description = description
        self.usage = usage
        self.version = version
        self.subcommands = subcommands or {}
        self.arguments = arguments or []
        self.examples = examples or []
        self.source = source
        self.parsed_at = time.time()

    def get_all_arguments(self) -> List[CommandArgument]:
        """获取所有参数（包括子命令的）"""
        all_args = list(self.arguments)
        for sub in self.subcommands.values():
            all_args.extend(sub.get_all_arguments())
        return all_args

    def find_subcommand(self, path: str) -> Optional["CommandSpec"]:
        """按路径查找子命令"""
        parts = path.split()
        current = self
        for part in parts:
            if part in current.subcommands:
                current = current.subcommands[part]
            else:
                return None
        return current

    def validate_args(self, args: List[str]) -> Tuple[bool, List[str]]:
        """验证参数"""
        errors = []
        required = [a for a in self.arguments if a.required and a.arg_type == "positional"]
        # 简化验证
        return len(errors) == 0, errors

    def generate_completion(self, shell: str = "bash") -> str:
        """生成 shell 补全脚本"""
        if shell == "bash":
            return self._generate_bash_completion()
        elif shell == "zsh":
            return self._generate_zsh_completion()
        elif shell == "powershell":
            return self._generate_powershell_completion()
        return ""

    def _generate_bash_completion(self) -> str:
        lines = [f"# Bash completion for {self.name}", f"_{self.name}_completions() {{"]
        lines.append("    local cur prev opts")
        lines.append("    COMPREPLY=()")
        lines.append('    cur="${COMP_WORDS[COMP_CWORD]}"')
        lines.append('    prev="${COMP_WORDS[COMP_CWORD-1]}"')
        opts = " ".join(a.long or a.short for a in self.arguments if a.arg_type in ("option", "flag"))
        subcmds = " ".join(self.subcommands.keys())
        lines.append(f'    opts="{opts} {subcmds}"')
        lines.append('    COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )')
        lines.append("    return 0")
        lines.append("}")
        lines.append(f"complete -F _{self.name}_completions {self.name}")
        return "\n".join(lines)

    def _generate_zsh_completion(self) -> str:
        lines = [f"#compdef {self.name}", f"_{self.name}() {{"]
        lines.append("    local -a options")
        for arg in self.arguments:
            if arg.arg_type in ("option", "flag"):
                opt = arg.long or arg.short
                lines.append(f'    options+=("{opt}[{arg.description}]")')
        for name, sub in self.subcommands.items():
            lines.append(f'    options+=("{name}[{sub.description}]")')
        lines.append("    _describe 'command' options")
        lines.append("}")
        lines.append(f"_{self.name} \"$@\"")
        return "\n".join(lines)

    def _generate_powershell_completion(self) -> str:
        lines = [f"# PowerShell completion for {self.name}",
                 f"Register-ArgumentCompleter -Native -CommandName '{self.name}' -ScriptBlock {{"]
        lines.append("    param($wordToComplete, $commandAst, $cursorPosition)")
        opts = [a.long or a.short for a in self.arguments if a.arg_type in ("option", "flag")]
        opts.extend(self.subcommands.keys())
        lines.append(f"    $opts = @({', '.join(repr(o) for o in opts)})")
        lines.append("    $opts | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object {")
        lines.append("        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)")
        lines.append("    }")
        lines.append("}")
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name, "description": self.description,
            "usage": self.usage, "version": self.version,
            "arguments": [a.to_dict() for a in self.arguments],
            "subcommands": {k: v.to_dict() for k, v in self.subcommands.items()},
            "examples": self.examples,
            "source": self.source,
            "parsed_at": self.parsed_at,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    def to_yaml(self) -> str:
        lines = [f"name: {self.name}", f"description: {self.description}", f"usage: {self.usage}"]
        if self.arguments:
            lines.append("arguments:")
            for arg in self.arguments:
                lines.append(f"  - name: {arg.name}")
                lines.append(f"    type: {arg.arg_type}")
                lines.append(f"    description: {arg.description}")
                if arg.required:
                    lines.append("    required: true")
        if self.subcommands:
            lines.append("subcommands:")
            for name, sub in self.subcommands.items():
                lines.append(f"  {name}: {sub.description}")
        return "\n".join(lines)


# ================================================================
# 解析器
# ================================================================
class HelpParser:
    """结构化解析器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "parser_cache")
        os.makedirs(self.data_dir, exist_ok=True)
        self._cache: Dict[str, CommandSpec] = {}
        self._lock = threading.RLock()
        self._load_cache()

    def _load_cache(self):
        cache_file = os.path.join(self.data_dir, "parser_cache.json")
        try:
            if os.path.exists(cache_file):
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for name, spec_data in data.get("specs", {}).items():
                    self._cache[name] = self._spec_from_dict(spec_data)
        except Exception:
            pass

    def _save_cache(self):
        cache_file = os.path.join(self.data_dir, "parser_cache.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "specs": {k: v.to_dict() for k, v in self._cache.items()},
            }
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def _spec_from_dict(self, data: Dict[str, Any]) -> CommandSpec:
        spec = CommandSpec(
            name=data.get("name", ""), description=data.get("description", ""),
            usage=data.get("usage", ""), version=data.get("version", ""),
            source=data.get("source", ""),
        )
        for arg_data in data.get("arguments", []):
            spec.arguments.append(CommandArgument(**arg_data))
        for name, sub_data in data.get("subcommands", {}).items():
            spec.subcommands[name] = self._spec_from_dict(sub_data)
        spec.examples = data.get("examples", [])
        return spec

    def parse_help(self, command_name: str, help_text: str,
                   use_cache: bool = True) -> CommandSpec:
        """解析 --help 输出"""
        if use_cache and command_name in self._cache:
            return self._cache[command_name]

        spec = CommandSpec(name=command_name, source="help_output")

        # 提取描述
        desc_match = re.search(r'^([^\n]+(?:\n[ \t]+[^\n]+)*)', help_text)
        if desc_match:
            spec.description = desc_match.group(1).strip()[:200]

        # 提取用法
        usage_match = re.search(r'(?:Usage|usage|USAGE)\s*:\s*(.+?)(?:\n\n|\n[A-Z]|\Z)', help_text, re.DOTALL)
        if usage_match:
            spec.usage = usage_match.group(1).strip()

        # 提取版本
        version_match = re.search(r'(?:version|Version|VERSION)\s*[:=]\s*([\d.]+)', help_text)
        if version_match:
            spec.version = version_match.group(1)

        # 提取选项
        option_pattern = re.compile(
            r'(?:^|\n)\s*((?:-(?P<short>[a-zA-Z]),\s*)?--(?P<long>[a-zA-Z][\w-]*))'
            r'(?:[ =](?P<value>[A-Z_][\w_-]*|\[[^\]]+\]))?'
            r'\s{2,}(?P<desc>.+?)(?=\n\s*-|\n\n|\Z)',
            re.DOTALL
        )
        for match in option_pattern.finditer(help_text):
            arg = CommandArgument(
                name=match.group("long") or match.group("short") or "",
                arg_type="flag" if not match.group("value") else "option",
                short=match.group("short") or "",
                long=f"--{match.group('long')}" if match.group("long") else "",
                description=match.group("desc", "").strip()[:200],
            )
            spec.arguments.append(arg)

        # 提取子命令
        subcmd_pattern = re.compile(r'(?:^|\n)\s{2,}(?P<name>[a-z][\w-]*)\s{2,}(?P<desc>.+?)(?=\n\s{2,}[a-z]|\n\n|\Z)', re.DOTALL)
        in_commands_section = False
        for line in help_text.split("\n"):
            if re.match(r'(?i)\s*(Commands|Available Commands|Subcommands):', line):
                in_commands_section = True
                continue
            if in_commands_section and line.strip() and not line.startswith(" "):
                in_commands_section = False
            if in_commands_section:
                match = re.match(r'\s{2,}(\w[\w-]*)\s{2,}(.+)', line)
                if match:
                    sub_spec = CommandSpec(name=match.group(1), description=match.group(2).strip()[:200])
                    spec.subcommands[match.group(1)] = sub_spec

        # 提取示例
        example_pattern = re.compile(r'(?:^|\n)\s*\$\s+(.+?)(?=\n\s*\$|\n\n|\Z)', re.DOTALL)
        for match in example_pattern.finditer(help_text):
            spec.examples.append(match.group(1).strip())

        with self._lock:
            self._cache[command_name] = spec
            self._save_cache()

        return spec

    def get_help(self, command_name: str, tool_path: str = "", max_chars: int = 2000):
        """获取工具的--help输出并解析为结构化帮助文本。

        Args:
            command_name: 工具名（如nmap）
            tool_path: 工具路径（可选，不提供则用命令名）
            max_chars: 返回的帮助文本最大字符数

        Returns:
            格式化的帮助文本，失败返回None
        """
        # 1. 检查缓存
        if command_name in self._cache:
            spec = self._cache[command_name]
            return self._format_help_text(spec, max_chars)

        # 2. 确定要执行的命令
        cmd = tool_path or command_name

        # 3. 执行--help获取输出
        try:
            import subprocess
            result = subprocess.run(
                [cmd, "--help"],
                capture_output=True,
                text=True,
                timeout=10,
                encoding="utf-8",
                errors="replace"
            )
            help_text = result.stdout or result.stderr
            if not help_text or not help_text.strip():
                return None
        except Exception:
            return None

        # 4. 解析帮助输出
        try:
            spec = self.parse_help(command_name, help_text)
        except Exception:
            # 解析失败，返回原始帮助文本的前max_chars字符
            return help_text[:max_chars]

        # 5. 格式化为帮助文本
        return self._format_help_text(spec, max_chars)

    def _format_help_text(self, spec, max_chars: int = 2000) -> str:
        """将CommandSpec格式化为帮助文本。"""
        lines = []
        if spec.description:
            lines.append(f"说明: {spec.description}")
        if spec.usage:
            lines.append(f"用法: {spec.usage}")
        if spec.version:
            lines.append(f"版本: {spec.version}")

        # 选项
        options = [a for a in spec.arguments if a.arg_type in ("option", "flag")]
        if options:
            lines.append("\n选项:")
            for opt in options[:20]:
                opt_name = opt.long or opt.short
                if opt.value_type and opt.arg_type == "option":
                    opt_name += f" <{opt.value_type}>"
                line = f"  {opt_name}"
                if opt.description:
                    line += f"  {opt.description}"
                lines.append(line)
            if len(options) > 20:
                lines.append(f"  ... 还有{len(options)-20}个选项")

        # 子命令
        if spec.subcommands:
            lines.append("\n子命令:")
            for name, sub in list(spec.subcommands.items())[:15]:
                line = f"  {name}"
                if sub.description:
                    line += f"  {sub.description}"
                lines.append(line)

        # 示例
        if spec.examples:
            lines.append("\n示例:")
            for ex in spec.examples[:5]:
                lines.append(f"  $ {ex}")

        result = "\n".join(lines)
        return result[:max_chars]

    def parse_man_page(self, command_name: str, man_text: str) -> CommandSpec:
        """解析 man page"""
        spec = self.parse_help(command_name, man_text)
        spec.source = "man_page"
        return spec

    def parse_markdown(self, command_name: str, md_text: str) -> CommandSpec:
        """解析 Markdown 文档"""
        spec = CommandSpec(name=command_name, source="markdown")
        # 提取标题
        title_match = re.search(r'^#\s+(.+)$', md_text, re.MULTILINE)
        if title_match:
            spec.description = title_match.group(1).strip()
        # 提取代码块中的命令
        code_blocks = re.findall(r'```(?:bash|shell)?\n(.*?)```', md_text, re.DOTALL)
        for block in code_blocks:
            for line in block.split("\n"):
                if line.strip().startswith("$") or line.strip().startswith(command_name):
                    spec.examples.append(line.strip().lstrip("$ ").strip())
        return spec

    def parse_cli_table(self, table_text: str) -> List[Dict[str, str]]:
        """解析 CLI 输出表格"""
        rows = []
        lines = table_text.strip().split("\n")
        if not lines:
            return rows
        # 检测分隔行
        separator_idx = -1
        for i, line in enumerate(lines):
            if re.match(r'^[\s\-+|=]+$', line) and ("-" in line or "=" in line):
                separator_idx = i
                break
        if separator_idx > 0:
            headers = [h.strip() for h in re.split(r'\s{2,}|\|', lines[separator_idx - 1]) if h.strip()]
            for line in lines[separator_idx + 1:]:
                if not line.strip():
                    continue
                values = [v.strip() for v in re.split(r'\s{2,}|\|', line) if v.strip()]
                if values:
                    row = dict(zip(headers, values))
                    rows.append(row)
        return rows

    def infer_type(self, value: str) -> str:
        """推断参数类型"""
        if re.match(r'^-?\d+$', value):
            return "int"
        if re.match(r'^-?\d+\.\d+$', value):
            return "float"
        if value.lower() in ("true", "false", "yes", "no"):
            return "bool"
        if re.match(r'^https?://', value):
            return "url"
        if os.path.exists(value):
            return "path"
        return "string"

    def generate_validation_rules(self, spec: CommandSpec) -> Dict[str, Any]:
        """根据规格生成参数校验规则"""
        rules = {
            "command": spec.name,
            "required_positional": [a.name for a in spec.arguments if a.required and a.arg_type == "positional"],
            "options": {},
            "subcommands": list(spec.subcommands.keys()),
        }
        for arg in spec.arguments:
            if arg.arg_type in ("option", "flag"):
                opt_name = arg.long or arg.short
                rules["options"][opt_name] = {
                    "type": arg.value_type,
                    "required": arg.required,
                    "choices": arg.choices,
                    "default": arg.default,
                }
        return rules

    def get_spec(self, command_name: str) -> Optional[CommandSpec]:
        return self._cache.get(command_name)

    def list_cached(self) -> List[str]:
        return list(self._cache.keys())

    def clear_cache(self, command_name: str = ""):
        with self._lock:
            if command_name:
                self._cache.pop(command_name, None)
            else:
                self._cache.clear()
            self._save_cache()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "cached_commands": len(self._cache),
            "total_arguments": sum(len(s.get_all_arguments()) for s in self._cache.values()),
            "total_subcommands": sum(len(s.subcommands) for s in self._cache.values()),
            "cache_dir": self.data_dir,
        }


# 全局解析器
_help_parser = HelpParser()


def get_help_parser() -> HelpParser:
    return _help_parser


def parse_help(command_name: str, help_text: str, **kwargs) -> CommandSpec:
    return _help_parser.parse_help(command_name, help_text, **kwargs)

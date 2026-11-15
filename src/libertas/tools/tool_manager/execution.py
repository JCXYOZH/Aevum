"""
工具管理器

管理工具的生命周期：发现、注册、初始化、启用、调用、禁用、卸载。
支持依赖管理、配置、状态监控、分组、导入导出。
"""
import os
import json
import time
import uuid
import importlib
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.utils.text_decode import decode_output, describe_exception

from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus


class ToolExecutionMixin:
    """工具初始化、执行、文本匹配与执行。"""

    def initialize_tool(self, name: str, config: Optional[Dict[str, Any]] = None) -> bool:
        tool = self._tools.get(name)
        if not tool:
            return False
        return tool.initialize(config)

    def initialize_all(self, configs: Optional[Dict[str, Dict]] = None) -> Dict[str, bool]:
        results = {}
        for name in self._tools:
            config = (configs or {}).get(name)
            results[name] = self.initialize_tool(name, config)
        return results

    def execute(self, tool_name: str, params: dict) -> dict:
        """执行外部工具（兼容0.1.5版本调用方式）
    
        构建命令行并执行子进程，返回原始输出和解析结果。
        用于scanner.run_tool调用self.tool_manager.execute()。
        """
        import subprocess
        import shlex
    
        # 外部命令失败时用于生成可读原因（跳过空行/纯符号行，必要时回退 stdout）
        from ..tools.native_tools import external_exit_error as _external_exit_error
    
        # 原始工具名：下面「路径自动发现」会把 tool_name 改写成 basename，
        # 这时再拿它去翻译退出码就错位了（如 curl -> curl.exe）。
        _req_tool_name = str(tool_name or "")
        tool = self.get_tool(tool_name)
        if not tool:
            # 尝试动态注册
            if self.assembler and hasattr(self.assembler, 'register_minimal_tool'):
                try:
                    self.assembler.register_minimal_tool(tool_name)
                except Exception:
                    pass
            tool = {"path": tool_name, "args": [], "category": "自定义"}
            self.tools[tool_name] = tool
    
        try:
            cmd = self.build_command(tool_name, strict=True, **params)
        except MissingToolParams as _mp:
            # 不再拼一条残缺命令去跑：把「缺哪些参数、还能怎么传」直接回给模型，
            # 它下一轮就能补齐（比一句控制台告警有用得多）。
            _slots = "、".join(_mp.slots) or "未知"
            _generic = [s for s in _mp.slots if s in self._GENERIC_TARGET_KEYS]
            _others = [s for s in _mp.slots if s not in self._GENERIC_TARGET_KEYS]
            _hint = []
            if _generic:
                _hint.append("、".join(_generic) + " 可以直接用 target 传（会自动映射）")
            if _others:
                _hint.append("、".join(_others) + " 需要补进 params")
            _hint.append(f"可先调用 search_tools(tool_name=\"{tool_name}\") 查看参数说明")
            return {
                "success": False,
                "error": f"{tool_name} 缺少必填参数：{_slots}。" + "；".join(_hint),
                "error_kind": "bad_params",
                "missing_params": _mp.slots,
                "required_params": sorted(_mp.expected or {}),
                "command": "",
            }
        except Exception as e:
            return {"success": False, "error": f"构建命令失败: {e}"}
    
        try:
            output_file = params.get('output_file')
            if output_file:
                out_dir = os.path.dirname(output_file)
                if out_dir:
                    os.makedirs(out_dir, exist_ok=True)
    
            # 清除代理环境变量，防止外部工具走系统代理
            clean_env = dict(os.environ)
            for _proxy_key in ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
                               'all_proxy', 'ALL_PROXY', 'ftp_proxy', 'FTP_PROXY',
                               'no_proxy', 'NO_PROXY'):
                clean_env.pop(_proxy_key, None)
    
            # 工具路径自动发现：如果命令不在系统PATH中，或绝对路径不存在，尝试从配置的工具路径查找
            use_wsl = False
            if cmd and (not os.path.isabs(cmd[0]) or not os.path.isfile(cmd[0])):
                import shutil as _shutil
                import sys as _sys
                # 提取工具名（绝对路径取basename）
                tool_name = os.path.basename(cmd[0]) if os.path.isabs(cmd[0]) else cmd[0]
                if not _shutil.which(tool_name):
                    found_path = self._resolve_tool_path(tool_name)
                    if found_path:
                        # Python脚本需要用python解释器执行
                        if found_path.endswith('.py'):
                            cmd = [_sys.executable, found_path] + cmd[1:]
                        else:
                            cmd = [found_path] + cmd[1:]
                        print(f"[TOOL] 自动发现工具路径: {tool_name} -> {found_path}")
                    elif _sys.platform == 'win32':
                        # Windows平台：尝试通过WSL执行
                        try:
                            from libertas.tools.binary_executor import is_wsl_available, check_wsl_tool
                            if is_wsl_available() and check_wsl_tool(tool_name):
                                use_wsl = True
                                print(f"[TOOL] 通过WSL执行工具: {tool_name}")
                        except Exception:
                            pass
    
            # WSL执行模式
            if use_wsl:
                try:
                    from libertas.tools.binary_executor import WSL_DISTRO, windows_path_to_wsl
                    wsl_args = []
                    for arg in cmd[1:]:
                        if isinstance(arg, str) and os.path.isabs(arg):
                            wsl_args.append(windows_path_to_wsl(arg))
                        else:
                            wsl_args.append(arg)
                    wsl_cmd = ["wsl", "-d", WSL_DISTRO, cmd[0]] + wsl_args
                    proc = subprocess.run(
                        wsl_cmd,
                        capture_output=True,
                        timeout=params.get('timeout', 300),
                        env=clean_env,
                    )
                    # 统一"取字节 → 级联解码"：文本模式(text=True/encoding=)用的是
                    # 系统区域编码（Windows 中文环境=cp936），会把 UTF-8 的工具输出
                    # 解坏并抛 UnicodeDecodeError —— 工具其实跑成功了，结果却整段
                    # 被丢弃（用户报障 'gbk' codec can't decode byte 0x9a）。
                    stdout_text = decode_output(proc.stdout)
                    stderr_text = decode_output(proc.stderr)
                    raw_output = stdout_text
                    if output_file and os.path.exists(output_file):
                        try:
                            with open(output_file, 'r', encoding='utf-8', errors='replace') as f:
                                raw_output = f.read()
                        except Exception:
                            pass
                    result = {
                        "success": proc.returncode == 0,
                        "raw_output": raw_output,
                        "parsed": None,
                        "command": " ".join(shlex.quote(c) for c in wsl_cmd) if wsl_cmd else "",
                        "returncode": proc.returncode,
                        "stderr": stderr_text,
                        "wsl": True,
                    }
                    if proc.returncode != 0:
                        result["error"] = _external_exit_error(
                            proc.returncode, stderr_text, raw_output,
                            tool_name=_req_tool_name)
                        result["error_kind"] = ("missing_binary"
                                                if proc.returncode == 127 else "nonzero_exit")
                        result["stderr_tail"] = stderr_text[-500:]
                    return result
                except subprocess.TimeoutExpired:
                    return {"success": False,
                            "error": f"WSL执行超时 ({params.get('timeout', 300)}秒)",
                            "error_kind": "timeout", "wsl": True}
                except Exception as e:
                    friendly, kind = describe_exception(e)
                    return {"success": False,
                            "error": f"WSL执行失败: {friendly}",
                            "error_kind": kind, "wsl": True,
                            "error_detail": f"{type(e).__name__}: {str(e)[:300]}"}
    
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=params.get('timeout', 300),
                env=clean_env
            )
    
            # 同上：不要用 text=True（区域编码解码），改取字节后级联解码
            stdout_text = decode_output(proc.stdout)
            stderr_text = decode_output(proc.stderr)
            raw_output = stdout_text
            if output_file and os.path.exists(output_file):
                try:
                    with open(output_file, 'r', encoding='utf-8', errors='replace') as f:
                        raw_output = f.read()
                except Exception:
                    pass
    
            result = {
                "success": proc.returncode == 0,
                "raw_output": raw_output,
                "parsed": None,
                "command": " ".join(shlex.quote(c) for c in cmd) if cmd else "",
                "returncode": proc.returncode,
                "stderr": stderr_text,
            }
            if proc.returncode != 0:
                result["error"] = _external_exit_error(
                    proc.returncode, stderr_text, raw_output,
                    tool_name=_req_tool_name)
                result["error_kind"] = ("missing_binary"
                                        if proc.returncode == 127 else "nonzero_exit")
                result["stderr_tail"] = stderr_text[-500:]
            return result
        except subprocess.TimeoutExpired:
            return {"success": False,
                    "error": f"执行超时 ({params.get('timeout', 300)}秒)",
                    "error_kind": "timeout"}
        except FileNotFoundError:
            return {"success": False,
                    "error": f"工具未找到: {cmd[0] if cmd else tool_name}",
                    "error_kind": "missing_binary"}
        except Exception as e:
            friendly, kind = describe_exception(e)
            return {"success": False, "error": friendly, "error_kind": kind,
                    "error_detail": f"{type(e).__name__}: {str(e)[:300]}"}

    def execute_tool(self, name: str, *args, **kwargs) -> Any:
        tool = self._tools.get(name)
        if not tool:
            raise ValueError(f"工具不存在: {name}")
        return tool.execute(*args, **kwargs)

    def _text_tokens(self, text: str):
        """把描述切成「拉丁词」与「中文二元组」，用于和工具元数据做重合打分。
    
        中文没有空格，这里退而求其次用二元组（bigram）做子串匹配：
        「端口扫描」→ {端口, 口扫, 扫描}，能命中工具描述里的同名词组，
        既不引入分词依赖（jieba 是可选依赖），也不改变既有行为。
        """
        import re as _re
        _text = text or ""
        latin = set(_re.findall(r"[a-z0-9][a-z0-9_.-]{1,}", _text.lower()))
        cjk = set()
        for _seg in _re.findall(r"[\u4e00-\u9fff]+", _text):
            for _i in range(len(_seg) - 1):
                cjk.add(_seg[_i:_i + 2])
        return latin, cjk

    def _native_tool_candidates(self, text: str, tokens, bigrams) -> List[Tuple[int, str, Dict]]:
        """按「名称/描述/类别」与「参数说明」的重合度给原生工具打分。
    
        - 文本里直接点名工具名（如 dns_lookup）→ +10；
        - 命中名称/描述/类别（强特征）→ 每条 +2；
        - 只命中参数说明（弱特征：很多工具都写「目标/端口」这类通用词）→ 每条 +1。
        门槛设为 2，弱特征单独命中的工具不计入，避免「提到端口」就把一堆
        无关工具全推荐出来。打分只用于推荐/挑选，不改变任何执行语义。
        """
        try:
            from ..tools import native_tools as _nt
            registry = getattr(_nt, "NATIVE_TOOLS", {}) or {}
        except Exception:
            return []
        _low = (text or "").lower()
        scored: List[Tuple[int, str, Dict]] = []
        for _name, _info in registry.items():
            if not isinstance(_info, dict):
                continue
            _strong = " ".join([
                str(_name),
                str(_info.get("description", "")),
                str(_info.get("category", "")),
            ]).lower()
            _weak = " ".join(
                str(_v) for _v in (_info.get("params") or {}).values()
            ).lower()
            _score = 10 if str(_name).lower() in _low else 0
            for _tok in tokens:
                if _tok in _strong:
                    _score += 2
                elif _tok in _weak:
                    _score += 1
            for _bg in bigrams:
                if _bg in _strong:
                    _score += 2
                elif _bg in _weak:
                    _score += 1
            if _score >= 2:
                scored.append((_score, str(_name), _info))
        scored.sort(key=lambda x: (-x[0], x[1]))
        return scored

    def suggest_tools(self, text: str) -> List[Dict[str, Any]]:
        """根据自然语言描述推荐工具（原生工具优先，其次已配置的外部工具）。
    
        返回 ``[{name, description, category, native}]``，供 /api/tools/suggest 直接渲染。
        原生工具排前面：它们开箱即用，而外部工具常常没安装。
        """
        text = (text or "").strip()
        if not text:
            return []
        _tokens, _bigrams = self._text_tokens(text)
        suggestions: List[Dict[str, Any]] = []
        seen = set()
    
        for _score, _name, _info in self._native_tool_candidates(text, _tokens, _bigrams):
            if _name in seen:
                continue
            seen.add(_name)
            suggestions.append({
                "name": _name,
                "description": _info.get("description", ""),
                "category": _info.get("category", "其他"),
                "native": True,
            })
    
        try:
            _external = self.assembler.suggest_tool(text) if self.assembler else []
        except Exception:
            _external = []
        for _name in _external or []:
            if _name in seen:
                continue
            seen.add(_name)
            _cfg = self.tools.get(_name) if isinstance(self.tools, dict) else None
            _cfg = _cfg if isinstance(_cfg, dict) else {}
            suggestions.append({
                "name": _name,
                "description": _cfg.get("description", ""),
                "category": _cfg.get("category", "其他"),
                "native": False,
            })
        return suggestions[:10]

    def _pick_tool_for_text(self, text: str) -> str:
        """从描述里挑一个要执行的工具：文本点名优先，其次关键词推荐的第一名。"""
        _tokens, _bigrams = self._text_tokens(text)
        try:
            from ..tools import native_tools as _nt
            _native_names = set((getattr(_nt, "NATIVE_TOOLS", {}) or {}).keys())
        except Exception:
            _native_names = set()
        # 排序后再遍历：集合迭代顺序不稳定，避免同样的输入选出不同的工具
        for _t in sorted(_tokens):
            if _t in _native_names:
                return _t
        for _t in sorted(_tokens):
            if isinstance(self.tools, dict) and _t in self.tools:
                return _t
        for _cand in self.suggest_tools(text):
            return _cand["name"]
        return ""

    def _run_native_from_text(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """执行原生工具，并把结果整理成前端 /api/tools/execute_text 认得的形状。"""
        from ..tools import native_tools as _nt
        result = _nt.run_native_tool(tool_name, **params)
        if not isinstance(result, dict):
            return {"success": False, "tool": tool_name,
                    "error": "原生工具返回了无法识别的结果", "error_kind": "bad_result"}
        out = dict(result)
        if not out.get("command"):
            _kv = " ".join("%s=%s" % (_k, _v) for _k, _v in sorted(params.items()))
            out["command"] = "[原生] %s%s" % (tool_name, (" " + _kv) if _kv else "")
        if not isinstance(out.get("parsed"), (dict, list)):
            _data = out.get("data")
            out["parsed"] = _data if isinstance(_data, (dict, list)) else None
        if not out.get("stdout"):
            out["stdout"] = str(out.get("raw_output") or "")
        return out

    def execute_from_text(self, text: str, tool_name: Optional[str] = None) -> Dict[str, Any]:
        """从自然语言描述执行工具（供 /api/tools/execute_text）。
    
        参数来自 ``ToolAssembler.extract_params_from_text``；原生工具走
        ``run_native_tool``，外部工具走 ``self.execute``（与既有分发链一致，
        不另造轮子）。失败时返回可读 ``error`` + 机器可读 ``error_kind``，
        绝不把 Python 异常原样抛出。
        """
        text = (text or "").strip()
        if not text:
            return {"success": False, "error": "缺少 text 参数", "error_kind": "bad_request"}
    
        params: Dict[str, Any] = {}
        if self.assembler is not None:
            try:
                params = self.assembler.extract_params_from_text(text) or {}
            except Exception:
                params = {}
    
        chosen = (tool_name or "").strip() or self._pick_tool_for_text(text)
        if not chosen:
            return {
                "success": False,
                "error": ("未能从描述中识别出可用工具，请直接指定工具名后重试"
                          "（可用工具名可调用 search_tools 查询）"),
                "error_kind": "no_tool_matched",
                "extracted_params": params,
            }
    
        try:
            from ..tools import native_tools as _nt
            _is_native = chosen in (getattr(_nt, "NATIVE_TOOLS", {}) or {})
        except Exception:
            _is_native = False
    
        if _is_native:
            return self._run_native_from_text(chosen, params)
    
        result = self.execute(chosen, params)
        if not isinstance(result, dict):
            return {"success": False, "tool": chosen,
                    "error": "工具返回了无法识别的结果", "error_kind": "bad_result"}
        out = dict(result)
        if not out.get("stdout"):
            out["stdout"] = str(out.get("raw_output") or "")
        return out

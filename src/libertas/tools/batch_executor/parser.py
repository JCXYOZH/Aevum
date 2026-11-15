"""职责模块：parser。"""

from __future__ import annotations

from typing import Dict, List, Any, Optional, Callable
import inspect
import json
import re

from .models import ToolTask

def parse_tool_tag(tag_text: str) -> Optional[ToolTask]:
    """解析 <<<TOOL:name target [args]>>> 标签内容为ToolTask"""
    parts = tag_text.strip().split()
    if not parts:
        return None
    tool_name_raw = parts[0].lower()
    tool_name = tool_name_raw[len("native_"):] if tool_name_raw.startswith("native_") else tool_name_raw
    args = parts[1:]

    target = ""
    kwargs = {}
    positional = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.startswith("--"):
            key = arg[2:]
            if i + 1 < len(args) and not args[i + 1].startswith("-"):
                kwargs[key] = args[i + 1]
                i += 2
            else:
                kwargs[key] = True
                i += 1
        elif arg.startswith("-") and len(arg) > 1:
            if i + 1 < len(args) and not args[i + 1].startswith("-"):
                kwargs[arg.lstrip("-")] = args[i + 1]
                i += 2
            else:
                i += 1
        elif not target:
            target = arg
            i += 1
        else:
            positional.append(arg)
            i += 1

    # 清理target
    if target:
        target = target.strip("/")
        target = re.sub(r"^https?://", "", target)
        target = target.split("/")[0]

    # 位置参数按函数签名映射
    if positional:
        try:
            from ..tools import native_tools as _nt
            func = getattr(_nt, f"native_{tool_name}", None)
            if func:
                sig = inspect.signature(func)
                params = [p for p in sig.parameters if p not in ("target", "timeout")]
                pos_params = [p for p in params[1:]
                              if sig.parameters[p].default is inspect.Parameter.empty
                              or sig.parameters[p].default is not None]
                for j, val in enumerate(positional):
                    if j < len(pos_params):
                        kwargs[pos_params[j]] = val
        except Exception:
            pass

    return ToolTask(tool_name=tool_name, target=target, kwargs=kwargs)

def parse_batch_block(block_text: str) -> List[ToolTask]:
    """解析BATCH块，展开为ToolTask列表。

    支持两种格式：
    1. 列表格式：
       <<<BATCH>>>
       - dns_lookup runoob.com A
       - port_scan 192.168.1.1 -p 1-100
       <<<END>>>

    2. 矩阵格式：
       <<<BATCH>>>
       target: runoob.com, baidu.com
       tools: dns_lookup A, http_fingerprint
       <<<END>>>
    """
    tasks = []
    text = block_text.strip()

    # 检测矩阵格式
    target_match = re.search(r"^target[s]?\s*:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)
    tools_match = re.search(r"^tools?\s*:\s*(.+)$", text, re.MULTILINE | re.IGNORECASE)

    if target_match and tools_match:
        targets = [t.strip() for t in re.split(r"[,，;；]", target_match.group(1)) if t.strip()]
        tools_raw = [t.strip() for t in re.split(r"[,，;；]", tools_match.group(1)) if t.strip()]
        for target in targets:
            for tool_str in tools_raw:
                parts = tool_str.split()
                if not parts:
                    continue
                tool_name = parts[0].lower()
                tool_name = tool_name[len("native_"):] if tool_name.startswith("native_") else tool_name
                args = parts[1:]
                kwargs = {}
                positional = []
                for a in args:
                    if a.startswith("-"):
                        kwargs[a.lstrip("-")] = True
                    else:
                        positional.append(a)
                # 清理target
                clean_target = target.strip("/")
                clean_target = re.sub(r"^https?://", "", clean_target)
                clean_target = clean_target.split("/")[0]
                tasks.append(ToolTask(tool_name=tool_name, target=clean_target, kwargs=kwargs))
                # 位置参数映射
                if positional:
                    try:
                        from ..tools import native_tools as _nt
                        func = getattr(_nt, f"native_{tool_name}", None)
                        if func:
                            sig = inspect.signature(func)
                            params = [p for p in sig.parameters if p not in ("target", "timeout")]
                            pos_params = [p for p in params[1:]
                                          if sig.parameters[p].default is inspect.Parameter.empty
                                          or sig.parameters[p].default is not None]
                            for j, val in enumerate(positional):
                                if j < len(pos_params):
                                    tasks[-1].kwargs[pos_params[j]] = val
                    except Exception:
                        pass
        return tasks

    # 列表格式：每行 - tool_name target [args]
    for line in text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^[-*•]\s*", "", line)
        task = parse_tool_tag(line)
        if task:
            tasks.append(task)

    return tasks

def extract_tasks_from_reply(reply: str) -> List[ToolTask]:
    """从模型回复中提取所有TOOL标签和BATCH块，返回ToolTask列表"""
    tasks = []

    # 提取BATCH块
    batch_pat = re.compile(r"<<<\s*BATCH\s*>>>(.*?)<<<\s*END\s*>>>", re.DOTALL | re.IGNORECASE)
    for m in batch_pat.finditer(reply):
        batch_tasks = parse_batch_block(m.group(1))
        tasks.extend(batch_tasks)

    # 提取单个TOOL标签（排除BATCH块内的）
    clean = batch_pat.sub("", reply)
    tool_pat = re.compile(r"<<<\s*TOOL\s*:\s*(.+?)\s*>>>", re.DOTALL | re.IGNORECASE)
    for m in tool_pat.finditer(clean):
        task = parse_tool_tag(m.group(1))
        if task:
            tasks.append(task)

    # 去重（相同工具+目标+参数）
    seen = set()
    unique = []
    for t in tasks:
        key = (t.tool_name, t.target, json.dumps(t.kwargs, sort_keys=True, ensure_ascii=False))
        if key not in seen:
            seen.add(key)
            t.index = len(unique)
            unique.append(t)
    return unique

"""插件: 增强版JSON工具
版本: 2.0.0
分类: 工具
描述: JSON格式化、压缩、验证、路径查询、键值提取、差异比较、JSON转YAML/XML/CSV
"""
import json
import re


def register(registry):
    registry.register_tool(
        "json_tool",
        json_tool,
        params={"text": "JSON文本", "mode": "模式(format/minify/validate/path/keys/values/diff/to_yaml/to_xml/to_csv)",
                "path": "JSON路径查询（如 $.data.items[0].name）",
                "text2": "第二个JSON文本（diff模式用）"},
        category="工具",
        desc="增强版JSON工具，格式化/验证/路径查询/键值提取/差异比较/格式转换"
    )


def _get_by_path(data, path):
    """通过JSON路径获取值"""
    if not path or path == "$":
        return data
    # 移除开头的$
    path = path.lstrip("$").lstrip(".")
    current = data
    # 解析路径，支持 .key 和 [index]
    tokens = re.findall(r'\.?([^.\[\]]+)|\[(\d+)\]', path)
    for token in tokens:
        key = token[0] if token[0] else token[1]
        if isinstance(current, dict):
            if key in current:
                current = current[key]
            else:
                return None, f"键 '{key}' 不存在"
        elif isinstance(current, list):
            try:
                idx = int(key)
                if 0 <= idx < len(current):
                    current = current[idx]
                else:
                    return None, f"索引 {idx} 超出范围 (0-{len(current)-1})"
            except ValueError:
                return None, f"列表索引必须是整数，得到 '{key}'"
        else:
            return None, f"无法在类型 {type(current).__name__} 上查找 '{key}'"
    return current, None


def _flatten_json(data, prefix="", separator="."):
    """扁平化JSON"""
    items = {}
    if isinstance(data, dict):
        for key, value in data.items():
            new_key = f"{prefix}{separator}{key}" if prefix else key
            if isinstance(value, (dict, list)):
                items.update(_flatten_json(value, new_key, separator))
            else:
                items[new_key] = value
    elif isinstance(data, list):
        for i, value in enumerate(data):
            new_key = f"{prefix}[{i}]"
            if isinstance(value, (dict, list)):
                items.update(_flatten_json(value, new_key, separator))
            else:
                items[new_key] = value
    return items


def _json_to_yaml(data, indent=0):
    """简单JSON转YAML"""
    lines = []
    prefix = "  " * indent
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, (dict, list)):
                lines.append(f"{prefix}{key}:")
                lines.append(_json_to_yaml(value, indent + 1))
            else:
                lines.append(f"{prefix}{key}: {json.dumps(value, ensure_ascii=False)}")
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, (dict, list)):
                lines.append(f"{prefix}-")
                lines.append(_json_to_yaml(item, indent + 1))
            else:
                lines.append(f"{prefix}- {json.dumps(item, ensure_ascii=False)}")
    else:
        lines.append(f"{prefix}{json.dumps(data, ensure_ascii=False)}")
    return "\n".join(lines)


def _json_to_xml(data, root="root", indent=0):
    """简单JSON转XML"""
    lines = []
    prefix = "  " * indent
    if isinstance(data, dict):
        lines.append(f"{prefix}<{root}>")
        for key, value in data.items():
            safe_key = re.sub(r'[^a-zA-Z0-9_]', '_', str(key))
            if isinstance(value, (dict, list)):
                lines.append(_json_to_xml(value, safe_key, indent + 1))
            else:
                lines.append(f"{prefix}  <{safe_key}>{json.dumps(value, ensure_ascii=False)}</{safe_key}>")
        lines.append(f"{prefix}</{root}>")
    elif isinstance(data, list):
        lines.append(f"{prefix}<{root}>")
        for i, item in enumerate(data):
            if isinstance(item, (dict, list)):
                lines.append(_json_to_xml(item, f"item_{i}", indent + 1))
            else:
                lines.append(f"{prefix}  <item>{json.dumps(item, ensure_ascii=False)}</item>")
        lines.append(f"{prefix}</{root}>")
    else:
        lines.append(f"{prefix}<{root}>{json.dumps(data, ensure_ascii=False)}</{root}>")
    return "\n".join(lines)


def _json_diff(data1, data2, path=""):
    """比较两个JSON的差异"""
    diffs = []
    if type(data1) != type(data2):
        diffs.append({"path": path or "$", "type": "类型不同",
                       "old": type(data1).__name__, "new": type(data2).__name__})
        return diffs
    if isinstance(data1, dict):
        all_keys = set(data1.keys()) | set(data2.keys())
        for key in all_keys:
            current_path = f"{path}.{key}" if path else key
            if key not in data1:
                diffs.append({"path": current_path, "type": "新增", "new": data2[key]})
            elif key not in data2:
                diffs.append({"path": current_path, "type": "删除", "old": data1[key]})
            else:
                diffs.extend(_json_diff(data1[key], data2[key], current_path))
    elif isinstance(data1, list):
        max_len = max(len(data1), len(data2))
        for i in range(max_len):
            current_path = f"{path}[{i}]"
            if i >= len(data1):
                diffs.append({"path": current_path, "type": "新增", "new": data2[i]})
            elif i >= len(data2):
                diffs.append({"path": current_path, "type": "删除", "old": data1[i]})
            else:
                diffs.extend(_json_diff(data1[i], data2[i], current_path))
    else:
        if data1 != data2:
            diffs.append({"path": path or "$", "type": "值不同", "old": data1, "new": data2})
    return diffs


def json_tool(text: str = "", mode: str = "format", path: str = "", text2: str = "") -> dict:
    """JSON处理（增强版）"""
    if not text:
        return {"success": False, "error": "请输入JSON文本"}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"JSON解析错误: {e}",
                "错误位置": f"行 {e.lineno}, 列 {e.colno}",
                "错误消息": e.msg}
    except Exception as e:
        return {"success": False, "error": str(e)}

    result = {"模式": mode, "输入类型": type(data).__name__}

    if mode == "format":
        output = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False)
        result["输出"] = output
        result["格式化后大小"] = len(output)
    elif mode == "minify":
        output = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
        result["输出"] = output
        result["压缩后大小"] = len(output)
        result["压缩率"] = f"{round((1 - len(output)/len(text)) * 100, 1)}%"
    elif mode == "validate":
        result["有效"] = True
        result["类型"] = type(data).__name__
        if isinstance(data, dict):
            result["顶层键数"] = len(data)
            result["顶层键"] = list(data.keys())[:20]
        elif isinstance(data, list):
            result["元素数"] = len(data)
        result["大小(字节)"] = len(text)
    elif mode == "path":
        if not path:
            return {"success": False, "error": "path模式需要指定JSON路径"}
        value, error = _get_by_path(data, path)
        if error:
            result["错误"] = error
        else:
            result["路径"] = path
            result["值"] = value
            result["值类型"] = type(value).__name__
            if isinstance(value, (dict, list)):
                result["格式化值"] = json.dumps(value, indent=2, ensure_ascii=False)
    elif mode == "keys":
        if isinstance(data, dict):
            result["所有键"] = list(_flatten_json(data).keys())
            result["键数"] = len(result["所有键"])
        else:
            result["错误"] = "keys模式需要JSON对象(dict)"
    elif mode == "values":
        flattened = _flatten_json(data)
        result["所有键值对"] = flattened
        result["键值对数"] = len(flattened)
    elif mode == "flatten":
        flattened = _flatten_json(data)
        result["扁平化结果"] = flattened
        result["键值对数"] = len(flattened)
    elif mode == "diff":
        if not text2:
            return {"success": False, "error": "diff模式需要第二个JSON文本(text2)"}
        try:
            data2 = json.loads(text2)
            diffs = _json_diff(data, data2)
            result["差异数"] = len(diffs)
            result["差异详情"] = diffs[:100]
            result["是否相同"] = len(diffs) == 0
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"第二个JSON解析错误: {e}"}
    elif mode == "to_yaml":
        result["YAML输出"] = _json_to_yaml(data)
    elif mode == "to_xml":
        result["XML输出"] = _json_to_xml(data)
    elif mode == "to_csv":
        if isinstance(data, list) and all(isinstance(item, dict) for item in data):
            if data:
                keys = list(data[0].keys())
                csv_lines = [",".join(keys)]
                for item in data:
                    csv_lines.append(",".join(str(item.get(k, "")) for k in keys))
                result["CSV输出"] = "\n".join(csv_lines)
                result["行数"] = len(data) + 1
            else:
                result["错误"] = "空列表无法转换为CSV"
        else:
            result["错误"] = "to_csv模式需要JSON对象列表(list of dict)"
    else:
        return {"success": False, "error": f"未知模式: {mode}",
                "支持的模式": ["format", "minify", "validate", "path", "keys", "values",
                              "flatten", "diff", "to_yaml", "to_xml", "to_csv"]}
    return {"success": True, "result": result}

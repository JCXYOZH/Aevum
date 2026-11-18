"""JSON格式化、压缩、验证、路径查询、键值提取、差异比较、JSON转YAML/XML/CSV注册入口。"""

from .logic import json_tool

def register(registry):
    registry.register_tool(
        "json_tool",
        json_tool,
        params={"text": "JSON文本", "mode": "模式(format/minify/validate/path/keys/values/diff/to_yaml/to_xml/to_csv)",
                "path": "JSON路径查询（如 $.data.items[0].name）",
                "text2": "第二个JSON文本（diff模式用）"},
        category="工具",
        desc="JSON工具，格式化/验证/路径查询/键值提取/差异比较/格式转换"
    )

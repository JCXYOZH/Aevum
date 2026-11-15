"""测试正则表达式匹配、替换、分割，提供常用正则模式库，显示所有匹配结果和分组注册入口。"""

from .logic import regex_test

def register(registry):
    registry.register_tool(
        "regex_test",
        regex_test,
        params={"pattern": "正则表达式", "text": "要匹配的文本", "flags": "标志(i/m/s/x，如im)",
                "mode": "模式(match/replace/split/findall)", "replacement": "替换文本(replace模式)",
                "maxsplit": "最大分割次数(split模式，默认0表示全部)"},
        category="工具",
        desc="正则测试，匹配/替换/分割/常用模式库"
    )

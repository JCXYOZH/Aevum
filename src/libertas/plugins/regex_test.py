"""插件: 增强版正则表达式测试
版本: 2.0.0
分类: 工具
描述: 测试正则表达式匹配、替换、分割，提供常用正则模式库，显示所有匹配结果和分组
"""
import re


# 常用正则模式库
COMMON_PATTERNS = {
    "邮箱": r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}',
    "URL": r'https?://[^\s<>"\']+',
    "IP地址(IPv4)": r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b',
    "IPv6": r'(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}',
    "手机号(中国)": r'1[3-9]\d{9}',
    "身份证号(中国)": r'[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]',
    "日期(YYYY-MM-DD)": r'\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])',
    "时间(HH:MM:SS)": r'(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d',
    "十六进制颜色": r'#(?:[0-9a-fA-F]{3}){1,2}\b',
    "HTML标签": r'<[^>]+>',
    "HTML注释": r'<!--[\s\S]*?-->',
    "CSS类名": r'\.[a-zA-Z_][a-zA-Z0-9_-]*',
    "JavaScript变量": r'\b(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)',
    "JSON键值对": r'"([^"]+)"\s*:\s*("[^"]*"|\d+|true|false|null)',
    "SQL注入特征": r"(?:'|\"|;|--|/\*|\*/|union\s+select|or\s+1=1|drop\s+table)",
    "XSS特征": r'(?:<script|onerror=|onload=|javascript:|alert\()',
    "路径遍历": r'(?:\.\./|\.\.\\|/etc/passwd|/etc/shadow)',
    "命令注入": r'(?:;\s*(?:cat|id|whoami|uname)|\|\s*(?:cat|id|whoami)|\$\(|`)',
    "敏感文件": r'(?:\.env|\.git/config|wp-config|phpinfo|\.htaccess|web\.config)',
    "Base64": r'[A-Za-z0-9+/]{20,}={0,2}',
    "MD5": r'\b[a-fA-F0-9]{32}\b',
    "SHA1": r'\b[a-fA-F0-9]{40}\b',
    "SHA256": r'\b[a-fA-F0-9]{64}\b',
    "JWT": r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+',
    "UUID": r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
    "MAC地址": r'(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}',
    "端口号": r'\b(?:[0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])\b',
    "中文字符": r'[\u4e00-\u9fa5]',
    "英文单词": r'\b[a-zA-Z]+\b',
    "数字": r'\b\d+\b',
    "浮点数": r'-?\d+\.\d+',
    "科学计数法": r'-?\d+(?:\.\d+)?[eE][+-]?\d+',
    "用户名": r'^[a-zA-Z0-9_-]{3,16}$',
    "强密码": r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$',
    "车牌号(中国)": r'[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]',
    "邮政编码(中国)": r'[1-9]\d{5}(?!\d)',
    "QQ号": r'[1-9][0-9]{4,10}',
    "微信号": r'[a-zA-Z][a-zA-Z0-9_-]{5,19}',
}


def register(registry):
    registry.register_tool(
        "regex_test",
        regex_test,
        params={"pattern": "正则表达式", "text": "要匹配的文本", "flags": "标志(i/m/s/x，如im)",
                "mode": "模式(match/replace/split/findall)", "replacement": "替换文本(replace模式)",
                "maxsplit": "最大分割次数(split模式，默认0表示全部)"},
        category="工具",
        desc="增强版正则测试，匹配/替换/分割/常用模式库"
    )


def regex_test(pattern: str = "", text: str = "", flags: str = "",
               mode: str = "match", replacement: str = "", maxsplit: int = 0) -> dict:
    """正则测试（增强版）"""
    if not pattern:
        return {
            "success": False,
            "error": "请输入正则表达式",
            "常用模式库": list(COMMON_PATTERNS.keys()),
        }
    try:
        # 解析标志
        flag_val = 0
        flags_lower = (flags or "").lower()
        if "i" in flags_lower:
            flag_val |= re.IGNORECASE
        if "m" in flags_lower:
            flag_val |= re.MULTILINE
        if "s" in flags_lower:
            flag_val |= re.DOTALL
        if "x" in flags_lower:
            flag_val |= re.VERBOSE
        # 编译正则
        compiled = re.compile(pattern, flag_val)
        result = {
            "正则": pattern,
            "标志": flags or "无",
            "模式": mode,
            "文本长度": len(text),
        }
        if mode == "match":
            # 查找所有匹配
            matches = []
            for m in compiled.finditer(text):
                match_info = {
                    "匹配": m.group(),
                    "起始位置": m.start(),
                    "结束位置": m.end(),
                    "长度": len(m.group()),
                }
                if m.groups():
                    match_info["分组"] = list(m.groups())
                if m.groupdict():
                    match_info["命名分组"] = m.groupdict()
                matches.append(match_info)
            result["匹配数"] = len(matches)
            result["匹配结果"] = matches[:100]
            # 匹配统计
            if matches:
                result["首次匹配位置"] = matches[0]["起始位置"]
                result["最后匹配位置"] = matches[-1]["结束位置"]
                result["匹配覆盖率"] = f"{round(sum(m['长度'] for m in matches)/len(text)*100, 1)}%" if text else "0%"
        elif mode == "findall":
            # findall返回所有匹配
            all_matches = compiled.findall(text)
            result["匹配数"] = len(all_matches)
            result["所有匹配"] = all_matches[:100]
        elif mode == "replace":
            if not replacement:
                return {"success": False, "error": "replace模式需要指定replacement"}
            # 统计替换次数
            count = len(compiled.findall(text))
            new_text = compiled.sub(replacement, text)
            result["替换次数"] = count
            result["原文本长度"] = len(text)
            result["新文本长度"] = len(new_text)
            result["替换后文本"] = new_text
        elif mode == "split":
            # 分割文本
            parts = compiled.split(text, maxsplit=maxsplit if maxsplit > 0 else 0)
            result["分割数"] = len(parts)
            result["分割结果"] = parts[:100]
            result["最大分割次数"] = maxsplit or "全部"
        elif mode == "search":
            # 搜索第一个匹配
            m = compiled.search(text)
            if m:
                result["找到匹配"] = True
                result["匹配"] = m.group()
                result["位置"] = f"{m.start()}-{m.end()}"
                if m.groups():
                    result["分组"] = list(m.groups())
            else:
                result["找到匹配"] = False
        else:
            return {
                "success": False,
                "error": f"未知模式: {mode}",
                "支持的模式": ["match", "findall", "replace", "split", "search"],
            }
        # 正则复杂度评估
        result["正则长度"] = len(pattern)
        if len(pattern) > 100:
            result["复杂度"] = "高（建议优化）"
        elif len(pattern) > 50:
            result["复杂度"] = "中"
        else:
            result["复杂度"] = "低"
        # 常用模式匹配建议
        matched_common = []
        for name, common_pattern in COMMON_PATTERNS.items():
            if pattern == common_pattern:
                matched_common.append(name)
        if matched_common:
            result["匹配常用模式"] = matched_common
        return {"success": True, "result": result}
    except re.error as e:
        return {
            "success": False,
            "error": f"正则错误: {e}",
            "错误位置": getattr(e, 'pos', '未知'),
            "常用模式库": list(COMMON_PATTERNS.keys()),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

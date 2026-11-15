"""插件: 增强版密码生成器
版本: 2.0.0
分类: 工具
描述: 生成强随机密码，支持自定义长度、字符集、密码强度评估、密码策略建议
"""
import random
import string
import re


def register(registry):
    registry.register_tool(
        "password_gen",
        password_gen,
        params={"length": "密码长度（默认16）", "count": "生成数量（默认5）",
                "symbols": "是否包含特殊字符(true/false)", "digits": "是否包含数字(true/false)",
                "uppercase": "是否包含大写字母(true/false)", "lowercase": "是否包含小写字母(true/false)",
                "exclude": "要排除的字符（如容易混淆的字符）"},
        category="工具",
        desc="增强版密码生成器，支持自定义字符集、强度评估、策略建议"
    )


def _evaluate_password_strength(password):
    """评估密码强度"""
    score = 0
    feedback = []
    length = len(password)
    # 长度评分
    if length >= 16:
        score += 25
    elif length >= 12:
        score += 20
    elif length >= 8:
        score += 10
    else:
        score += 5
        feedback.append("密码长度不足8位，建议至少12位")
    # 字符类型评分
    has_upper = bool(re.search(r'[A-Z]', password))
    has_lower = bool(re.search(r'[a-z]', password))
    has_digit = bool(re.search(r'[0-9]', password))
    has_symbol = bool(re.search(r'[^A-Za-z0-9]', password))
    char_types = sum([has_upper, has_lower, has_digit, has_symbol])
    score += char_types * 15
    if char_types < 3:
        feedback.append(f"仅包含{char_types}种字符类型，建议包含大小写字母、数字和特殊字符")
    # 复杂度评分
    if length >= 12 and char_types >= 4:
        score += 15
    elif length >= 8 and char_types >= 3:
        score += 10
    # 常见模式检测
    common_patterns = ["123", "abc", "qwerty", "password", "admin", "111", "000"]
    for pattern in common_patterns:
        if pattern in password.lower():
            score -= 10
            feedback.append(f"包含常见模式'{pattern}'，容易被字典攻击")
    # 等级
    if score >= 80:
        level = "极强"
    elif score >= 60:
        level = "强"
    elif score >= 40:
        level = "中等"
    elif score >= 20:
        level = "弱"
    else:
        level = "极弱"
    return {"score": min(score, 100), "level": level, "feedback": feedback,
            "length": length, "char_types": char_types,
            "has_upper": has_upper, "has_lower": has_lower,
            "has_digit": has_digit, "has_symbol": has_symbol}


def password_gen(length: int = 16, count: int = 5, symbols: str = "true",
                 digits: str = "true", uppercase: str = "true", lowercase: str = "true",
                 exclude: str = "") -> dict:
    """生成密码（增强版）"""
    try:
        length = min(max(int(length) if length else 16, 4), 128)
        count = min(max(int(count) if count else 5, 1), 50)
        use_symbols = str(symbols).lower() not in ("false", "0", "no", "")
        use_digits = str(digits).lower() not in ("false", "0", "no", "")
        use_upper = str(uppercase).lower() not in ("false", "0", "no", "")
        use_lower = str(lowercase).lower() not in ("false", "0", "no", "")
        exclude_chars = set(exclude) if exclude else set()
        # 构建字符集
        chars = ""
        required = []
        if use_upper:
            upper_chars = ''.join(c for c in string.ascii_uppercase if c not in exclude_chars)
            chars += upper_chars
            if upper_chars:
                required.append(random.choice(upper_chars))
        if use_lower:
            lower_chars = ''.join(c for c in string.ascii_lowercase if c not in exclude_chars)
            chars += lower_chars
            if lower_chars:
                required.append(random.choice(lower_chars))
        if use_digits:
            digit_chars = ''.join(c for c in string.digits if c not in exclude_chars)
            chars += digit_chars
            if digit_chars:
                required.append(random.choice(digit_chars))
        if use_symbols:
            symbol_chars = ''.join(c for c in "!@#$%^&*()_+-=[]{}|;:,.<>?/~`" if c not in exclude_chars)
            chars += symbol_chars
            if symbol_chars:
                required.append(random.choice(symbol_chars))
        if not chars:
            return {"success": False, "error": "字符集为空，请至少启用一种字符类型"}
        # 生成密码
        passwords = []
        for _ in range(count):
            pwd = required[:]
            pwd += [random.choice(chars) for _ in range(max(0, length - len(pwd)))]
            random.shuffle(pwd)
            password = "".join(pwd)
            strength = _evaluate_password_strength(password)
            passwords.append({"password": password, "strength": strength})
        # 密码策略建议
        policy = {
            "推荐长度": "至少12位，建议16位以上",
            "推荐字符类型": "大小写字母+数字+特殊字符（4种）",
            "避免使用": "生日、姓名、常见单词、连续字符（123456、abcdef）",
            "定期更换": "重要账户建议每3-6个月更换",
            "唯一密码": "每个账户使用不同密码，避免一处泄露多处受影响",
            "双因素认证": "重要账户建议开启2FA/MFA",
        }
        return {
            "success": True,
            "result": {
                "密码列表": passwords,
                "数量": count,
                "长度": length,
                "字符集配置": {
                    "大写字母": use_upper,
                    "小写字母": use_lower,
                    "数字": use_digits,
                    "特殊字符": use_symbols,
                    "排除字符": exclude or "无",
                },
                "密码策略建议": policy,
            }
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

"""脱敏规则与默认规则表。"""

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Pattern

@dataclass
class DesensitizationRule:
    """脱敏规则"""
    name: str
    pattern: Pattern
    strategy: str = "mask"  # mask / replace / hash / truncate / generalize
    mask_char: str = "*"
    replacement: str = ""
    hash_salt: str = ""
    keep_prefix: int = 0
    keep_suffix: int = 0
    enabled: bool = True
    description: str = ""

def _build_default_rules() -> List[DesensitizationRule]:
    rules = [
        DesensitizationRule(
            name="phone",
            pattern=re.compile(r'(?<!\d)(1[3-9]\d{9})(?!\d)'),
            strategy="mask", keep_prefix=3, keep_suffix=4,
            description="手机号码",
        ),
        DesensitizationRule(
            name="id_card",
            pattern=re.compile(r'(?<!\d)(\d{17}[\dXx])(?!\d)'),
            strategy="mask", keep_prefix=6, keep_suffix=4,
            description="身份证号",
        ),
        DesensitizationRule(
            name="email",
            pattern=re.compile(r'([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})'),
            strategy="mask", keep_prefix=2, keep_suffix=0,
            description="邮箱地址",
        ),
        DesensitizationRule(
            name="ipv4",
            pattern=re.compile(r'(?<!\d)((?:\d{1,3}\.){3}\d{1,3})(?!\d)'),
            strategy="mask", keep_prefix=6, keep_suffix=0,
            description="IPv4 地址",
        ),
        DesensitizationRule(
            name="ipv6",
            pattern=re.compile(r'(?<![0-9a-fA-F:])([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){7})(?![0-9a-fA-F:])'),
            strategy="mask", keep_prefix=4, keep_suffix=0,
            description="IPv6 地址",
        ),
        DesensitizationRule(
            name="bank_card",
            pattern=re.compile(r'(?<!\d)(\d{16,19})(?!\d)'),
            strategy="mask", keep_prefix=4, keep_suffix=4,
            description="银行卡号",
        ),
        DesensitizationRule(
            name="api_key",
            pattern=re.compile(r'(?i)(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["\']?([A-Za-z0-9_\-]{16,})["\']?'),
            strategy="replace", replacement=r'\1=***',
            description="API 密钥",
        ),
        DesensitizationRule(
            name="password",
            pattern=re.compile(r'(?i)(password|passwd|pwd|pass)\s*[=:]\s*["\']?([^"\'\s,;}]{4,})["\']?'),
            strategy="replace", replacement=r'\1=***',
            description="密码",
        ),
        DesensitizationRule(
            name="jwt_token",
            pattern=re.compile(r'(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'),
            strategy="mask", keep_prefix=10, keep_suffix=0,
            description="JWT Token",
        ),
        DesensitizationRule(
            name="bearer_token",
            pattern=re.compile(r'(?i)(bearer)\s+([A-Za-z0-9_\-\.]{16,})'),
            strategy="replace", replacement=r'\1 ***',
            description="Bearer Token",
        ),
        DesensitizationRule(
            name="url_with_credentials",
            pattern=re.compile(r'(https?://)([^:@/\s]+):([^@/\s]+)@'),
            strategy="replace", replacement=r'\1***:***@',
            description="带凭据的 URL",
        ),
        DesensitizationRule(
            name="chinese_name",
            pattern=re.compile(r'(?<![\u4e00-\u9fa5])([\u4e00-\u9fa5]{2,4})(?![\u4e00-\u9fa5])'),
            strategy="mask", keep_prefix=1, keep_suffix=0,
            description="中文姓名（需上下文确认）",
        ),
        DesensitizationRule(
            name="home_address",
            pattern=re.compile(r'([\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|村|街道|路|号|室|栋|单元))[\u4e00-\u9fa50-9号栋单元室]*'),
            strategy="mask", keep_prefix=6, keep_suffix=0,
            description="家庭地址",
        ),
        DesensitizationRule(
            name="mac_address",
            pattern=re.compile(r'(?i)([0-9A-F]{2}(?::[0-9A-F]{2}){5})'),
            strategy="mask", keep_prefix=5, keep_suffix=0,
            description="MAC 地址",
        ),
        DesensitizationRule(
            name="latitude_longitude",
            pattern=re.compile(r'(?<![\d.])(-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,})(?![\d.])'),
            strategy="generalize",
            description="经纬度坐标",
        ),
        DesensitizationRule(
            name="license_plate",
            pattern=re.compile(r'([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{5})'),
            strategy="mask", keep_prefix=2, keep_suffix=2,
            description="车牌号",
        ),
        DesensitizationRule(
            name="social_credit",
            pattern=re.compile(r'(?<![0-9A-Z])([0-9A-HJ-NPQRTUWXY]{18})(?![0-9A-Z])'),
            strategy="mask", keep_prefix=6, keep_suffix=4,
            description="统一社会信用代码",
        ),
        DesensitizationRule(
            name="passport",
            pattern=re.compile(r'(?<![A-Z0-9])([A-Z]\d{8}|[A-Z]{2}\d{7})(?![A-Z0-9])'),
            strategy="mask", keep_prefix=2, keep_suffix=2,
            description="护照号",
        ),
        DesensitizationRule(
            name="wechat_id",
            pattern=re.compile(r'(?i)(wx|wechat|weixin)[_-]?id\s*[=:]\s*["\']?([A-Za-z0-9_-]{6,20})["\']?'),
            strategy="replace", replacement=r'\1_id=***',
            description="微信号",
        ),
        DesensitizationRule(
            name="qq_number",
            pattern=re.compile(r'(?<!\d)([1-9]\d{4,11})(?!\d)'),
            strategy="mask", keep_prefix=2, keep_suffix=2,
            description="QQ 号（需上下文确认）",
        ),
    ]
    return rules

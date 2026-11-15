"""AI辅助规则编写器：通过自然语言生成WAF/YARA/Snort/Sigma/Nuclei规则。"""
import os
import json
import time
from typing import Dict, Optional
from libertas.foundation.config import get_data_dir


RULE_TEMPLATES = {
    "waf": {
        "name": "ModSecurity WAF规则",
        "ext": "conf",
        "system_prompt": (
            "你是一个Web安全专家。根据用户的自然语言描述，生成ModSecurity CRS风格的WAF规则。"
            "要求：1) 使用SecRule语法 2) 包含id、phase、deny/status/log/msg/tag动作 "
            "3) 正则使用@rx 4) 规则ID使用9000001-9999999范围 5) 只输出规则代码，不要解释。"
        ),
        "template": """# WAF规则: {desc}
# 生成时间: {time}
SecRule REQUEST_URI|REQUEST_HEADERS|REQUEST_BODY "@rx (?i){pattern}" \\
    "id:{rule_id},phase:2,deny,status:403,log,msg:'{desc}',tag:'GENERATED',severity:'CRITICAL'"
""",
    },
    "yara": {
        "name": "YARA规则",
        "ext": "yar",
        "system_prompt": (
            "你是一个恶意代码分析专家。根据用户描述生成YARA规则。"
            "要求：1) 标准YARA语法 2) 包含meta(description/author/date/severity) "
            "3) strings使用十六进制和文本混合 4) 至少2个条件 5) 只输出规则代码。"
        ),
        "template": """rule {rule_name} {{
    meta:
        description = "{desc}"
        author = "Libertas AI Rule Writer"
        date = "{date}"
        severity = "high"
    strings:
        $ = ""
    condition:
        all of them
}}
""",
    },
    "snort": {
        "name": "Snort/Suricata规则",
        "ext": "rules",
        "system_prompt": (
            "你是一个网络入侵检测专家。根据用户描述生成Snort 3/Suricata规则。"
            "要求：1) 标准规则头+规则选项 2) 包含msg、sid、rev、classtype、reference "
            "3) SID使用9000001-9999999 4) content使用明确特征 5) 只输出规则代码。"
        ),
        "template": """# {desc}
alert tcp $EXTERNAL_NET any -> $HOME_NET any (msg:"{desc}"; flow:established,to_server; content:""; sid:{sid}; rev:1; classtype:attempted-admin; priority:1; metadata:created_at {date};)
""",
    },
    "sigma": {
        "name": "Sigma规则",
        "ext": "yml",
        "system_prompt": (
            "你是一个SIEM检测工程专家。根据用户描述生成Sigma规则(YAML格式)。"
            "要求：1) 完整YAML结构 2) 包含title、id、status、description、logsource、detection、falsepositives、level "
            "3) detection包含selection和condition 4) 只输出YAML代码。"
        ),
        "template": """title: {desc}
id: {uuid}
status: experimental
description: "{desc}"
logsource:
    category: process_creation
    product: windows
detection:
    selection:
        CommandLine|contains:
            - ""
    condition: selection
falsepositives:
    - Legitimate administrative activity
level: high
tags:
    - generated
""",
    },
    "nuclei": {
        "name": "Nuclei模板",
        "ext": "yaml",
        "system_prompt": (
            "你是一个漏洞扫描模板专家。根据用户描述生成Nuclei模板(YAML)。"
            "要求：1) 标准Nuclei模板结构 2) 包含id、info(name/author/severity/description) "
            "3) http请求块包含method/path/matchers 4) severity准确 5) 只输出YAML代码。"
        ),
        "template": """id: {rule_id}
info:
  name: {desc}
  author: Libertas AI
  severity: high
  description: "{desc}"
http:
  - method: GET
    path:
      - "{{{{BaseURL}}}}/"
    matchers:
      - type: word
        words:
          - ""
""",
    },
    "custom": {
        "name": "自定义脚本",
        "ext": "py",
        "system_prompt": (
            "你是一个安全工具开发专家。根据用户描述生成Python检测脚本。"
            "要求：1) 可直接运行 2) 使用标准库 3) 包含argparse命令行参数 "
            "4) 输出JSON格式结果 5) 只输出Python代码，不要解释。"
        ),
        "template": """#!/usr/bin/env python3
\"\"\"{desc}\"\"\"
import argparse
import json
import sys
from libertas.foundation.config import get_data_dir

def detect(target):
    results = []
    # TODO: 实现检测逻辑
    return {{"success": True, "target": target, "findings": results}}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="{desc}")
    parser.add_argument("target", help="目标")
    args = parser.parse_args()
    print(json.dumps(detect(args.target), ensure_ascii=False, indent=2))
""",
    },
}


class RuleWriter:
    def __init__(self, data_dir: str = ""):
        self.rules_dir = os.path.join(data_dir or get_data_dir(), "rules")
        os.makedirs(self.rules_dir, exist_ok=True)

    def get_rule_types(self) -> Dict:
        return {k: {"name": v["name"], "ext": v["ext"]} for k, v in RULE_TEMPLATES.items()}

    def get_system_prompt(self, rule_type: str) -> str:
        return RULE_TEMPLATES.get(rule_type, RULE_TEMPLATES["custom"])["system_prompt"]

    def build_prompt(self, rule_type: str, description: str) -> str:
        tpl = RULE_TEMPLATES.get(rule_type, RULE_TEMPLATES["custom"])
        return f"规则类型: {tpl['name']}\n需求描述: {description}\n\n请生成完整的、可直接使用的规则代码。"

    def save_rule(self, rule_type: str, content: str, description: str = "") -> Dict:
        tpl = RULE_TEMPLATES.get(rule_type, RULE_TEMPLATES["custom"])
        timestamp = int(time.time())
        safe_desc = "".join(c for c in description[:30] if c.isalnum() or c in "_- ").strip().replace(" ", "_")
        filename = f"{rule_type}_{safe_desc or 'rule'}_{timestamp}.{tpl['ext']}"
        path = os.path.join(self.rules_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "path": path, "filename": filename}

    def list_rules(self) -> list:
        rules = []
        if not os.path.isdir(self.rules_dir):
            return rules
        for fn in sorted(os.listdir(self.rules_dir), reverse=True):
            path = os.path.join(self.rules_dir, fn)
            if os.path.isfile(path):
                rules.append({
                    "filename": fn,
                    "size": os.path.getsize(path),
                    "time": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(path))),
                })
        return rules[:50]

    def generate_fallback(self, rule_type: str, description: str) -> str:
        """当AI不可用时的模板回退生成"""
        import uuid
        tpl = RULE_TEMPLATES.get(rule_type, RULE_TEMPLATES["custom"])
        template = tpl["template"]
        now = time.strftime("%Y-%m-%d", time.localtime())
        rule_id = 9000000 + (int(time.time()) % 999999)
        return template.format(
            desc=description,
            time=time.strftime("%Y-%m-%d %H:%M:%S"),
            date=now,
            rule_name="Detect_" + "".join(c for c in description[:20] if c.isalnum() or c == "_"),
            rule_id=rule_id,
            sid=rule_id,
            uuid=str(uuid.uuid4()),
        )

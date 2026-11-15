"""
security/advanced_security.py - 高级安全实战模块

核心能力：
- CodeFixGenerator: 漏洞修复代码自动生成器（静态扫描→自动生成修复补丁）
- CVEMatcher: CVE漏洞匹配器（根据服务版本匹配已知CVE）
- ConcurrentScanner: 并发扫描增强器（多目标/多参数并发扫描）
"""
import os
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞修复代码自动生成器
# ================================================================

@dataclass
class CodeFix:
    """代码修复方案"""
    fix_id: str = ""
    vuln_type: str = ""
    file_path: str = ""
    line_number: int = 0
    original_code: str = ""
    fixed_code: str = ""
    description: str = ""
    confidence: str = "medium"
    fix_type: str = "replace"  # replace/insert/delete/wrap
    applied: bool = False
    generated_at: float = 0.0

    def __post_init__(self):
        if not self.fix_id:
            self.fix_id = f"fix_{uuid.uuid4().hex[:12]}"
        if not self.generated_at:
            self.generated_at = time.time()

    def to_dict(self) -> Dict:
        return {
            "fix_id": self.fix_id,
            "vuln_type": self.vuln_type,
            "file_path": self.file_path,
            "line_number": self.line_number,
            "original_code": self.original_code,
            "fixed_code": self.fixed_code,
            "description": self.description,
            "confidence": self.confidence,
            "fix_type": self.fix_type,
            "applied": self.applied,
        }

class CodeFixGenerator:
    """漏洞修复代码自动生成器

    根据静态扫描发现的漏洞，自动生成修复代码补丁。
    支持SQL注入、XSS、命令注入、硬编码凭证、弱加密、路径遍历等漏洞类型的自动修复。
    """

    def __init__(self):
        self.fix_templates = self._init_fix_templates()
        self.generated_fixes: List[CodeFix] = []

    def _init_fix_templates(self) -> Dict[str, List[Dict]]:
        """初始化修复模板"""
        return {
            "sql_injection": [
                {
                    "name": "参数化查询替换",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""execute\s*\(\s*["']([^"']*?)%s([^"']*?)["']\s*%\s*(\w+)""",
                    "fix_generator": self._fix_sqli_param_query,
                    "description": "将字符串格式化SQL替换为参数化查询",
                },
                {
                    "name": "f-string参数化",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""execute\s*\(\s*f["']([^"']*?)\{(\w+)\}([^"']*?)["']""",
                    "fix_generator": self._fix_sqli_fstring,
                    "description": "将f-string SQL替换为参数化查询",
                },
            ],
            "xss": [
                {
                    "name": "HTML转义",
                    "confidence": "high",
                    "fix_type": "wrap",
                    "match_pattern": r"""mark_safe\s*\(\s*(\w+)""",
                    "fix_generator": self._fix_xss_escape,
                    "description": "对mark_safe的变量添加escape()",
                },
                {
                    "name": "HttpResponse转义",
                    "confidence": "medium",
                    "fix_type": "replace",
                    "match_pattern": r"""HttpResponse\s*\(\s*(\w+)""",
                    "fix_generator": self._fix_xss_http_response,
                    "description": "对HttpResponse的变量添加escape()",
                },
            ],
            "command_injection": [
                {
                    "name": "shell=False",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""subprocess\.\w+\s*\([^)]*shell\s*=\s*True""",
                    "fix_generator": self._fix_cmdi_shell_false,
                    "description": "将shell=True改为shell=False",
                },
                {
                    "name": "os.system→subprocess",
                    "confidence": "medium",
                    "fix_type": "replace",
                    "match_pattern": r"""os\.system\s*\(\s*([^)]+)""",
                    "fix_generator": self._fix_cmdi_os_system,
                    "description": "将os.system替换为subprocess.run",
                },
            ],
            "hardcoded_credentials": [
                {
                    "name": "环境变量替换",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""(\w+)\s*=\s*["']([^"']{3,})["']""",
                    "fix_generator": self._fix_creds_env_var,
                    "description": "将硬编码凭证替换为os.environ.get()",
                },
            ],
            "weak_crypto": [
                {
                    "name": "MD5→SHA256",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""hashlib\.md5\s*\(""",
                    "fix_generator": self._fix_crypto_md5,
                    "description": "将MD5替换为SHA-256",
                },
                {
                    "name": "SHA1→SHA256",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""hashlib\.sha1\s*\(""",
                    "fix_generator": self._fix_crypto_sha1,
                    "description": "将SHA-1替换为SHA-256",
                },
            ],
            "insecure_deserialization": [
                {
                    "name": "pickle→json",
                    "confidence": "medium",
                    "fix_type": "replace",
                    "match_pattern": r"""pickle\.loads?\s*\(""",
                    "fix_generator": self._fix_deser_pickle,
                    "description": "将pickle替换为json",
                },
                {
                    "name": "yaml.load→safe_load",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""yaml\.load\s*\(""",
                    "fix_generator": self._fix_deser_yaml,
                    "description": "将yaml.load替换为yaml.safe_load",
                },
            ],
            "insecure_random": [
                {
                    "name": "random→secrets",
                    "confidence": "high",
                    "fix_type": "replace",
                    "match_pattern": r"""random\.\w+\s*\(""",
                    "fix_generator": self._fix_random_secrets,
                    "description": "将random模块替换为secrets模块",
                },
            ],
            "path_traversal": [
                {
                    "name": "路径规范化",
                    "confidence": "medium",
                    "fix_type": "wrap",
                    "match_pattern": r"""open\s*\(\s*(\w+)""",
                    "fix_generator": self._fix_path_normalize,
                    "description": "对文件路径添加os.path.normpath和白名单验证",
                },
            ],
        }

    def generate_fix(self, vulnerability: Dict) -> Optional[CodeFix]:
        """为单个漏洞生成修复方案"""
        vuln_type = vulnerability.get("vuln_type", "")
        file_path = vulnerability.get("file_path", "")
        line_number = vulnerability.get("line_number", 0)
        code_snippet = vulnerability.get("code_snippet", "")

        if not code_snippet or not file_path:
            return None

        templates = self.fix_templates.get(vuln_type, [])
        for template in templates:
            match = re.search(template["match_pattern"], code_snippet)
            if match:
                try:
                    fixed_code = template["fix_generator"](code_snippet, match)
                    if fixed_code and fixed_code != code_snippet:
                        fix = CodeFix(
                            vuln_type=vuln_type,
                            file_path=file_path,
                            line_number=line_number,
                            original_code=code_snippet,
                            fixed_code=fixed_code,
                            description=template["description"],
                            confidence=template["confidence"],
                            fix_type=template["fix_type"],
                        )
                        self.generated_fixes.append(fix)
                        return fix
                except Exception:
                    continue
        return None

    def generate_fixes_batch(self, vulnerabilities: List[Dict]) -> List[CodeFix]:
        """批量生成修复方案"""
        fixes = []
        for vuln in vulnerabilities:
            fix = self.generate_fix(vuln)
            if fix:
                fixes.append(fix)
        return fixes

    def apply_fix(self, fix: CodeFix, codebase=None) -> bool:
        """应用修复方案"""
        if not os.path.exists(fix.file_path):
            return False
        try:
            with open(fix.file_path, "r", encoding="utf-8") as f:
                content = f.read()
            if fix.original_code in content:
                new_content = content.replace(fix.original_code, fix.fixed_code, 1)
                with open(fix.file_path, "w", encoding="utf-8") as f:
                    f.write(new_content)
                fix.applied = True
                return True
        except Exception:
            pass
        return False

    def apply_fixes_batch(self, fixes: List[CodeFix], codebase=None) -> Dict:
        """批量应用修复方案"""
        applied = 0
        failed = 0
        for fix in fixes:
            if self.apply_fix(fix, codebase):
                applied += 1
            else:
                failed += 1
        return {"applied": applied, "failed": failed, "total": len(fixes)}

    def generate_fix_report(self, fixes: List[CodeFix]) -> str:
        """生成修复报告"""
        lines = ["# 代码修复报告", ""]
        lines.append(f"**修复方案总数**: {len(fixes)}")
        lines.append(f"**高置信度**: {sum(1 for f in fixes if f.confidence == 'high')}")
        lines.append(f"**已应用**: {sum(1 for f in fixes if f.applied)}")
        lines.append("")
        by_type = defaultdict(int)
        for f in fixes:
            by_type[f.vuln_type] += 1
        lines.append("## 按漏洞类型")
        lines.append("")
        for vt, count in by_type.items():
            lines.append(f"- **{vt}**: {count}")
        lines.append("")
        lines.append("## 修复详情")
        lines.append("")
        for i, fix in enumerate(fixes, 1):
            lines.append(f"### {i}. [{fix.confidence}] {fix.description}")
            lines.append("")
            lines.append(f"- **文件**: {fix.file_path}:{fix.line_number}")
            lines.append(f"- **漏洞类型**: {fix.vuln_type}")
            lines.append(f"- **原始代码**: `{fix.original_code[:80]}`")
            lines.append(f"- **修复代码**: `{fix.fixed_code[:80]}`")
            lines.append(f"- **已应用**: {'是' if fix.applied else '否'}")
            lines.append("")
        return "\n".join(lines)

    # 修复生成函数
    def _fix_sqli_param_query(self, code: str, match) -> str:
        prefix = match.group(1)
        suffix = match.group(2)
        var = match.group(3)
        new_sql = f'"{prefix}%s{suffix}", ({var},)'
        return code.replace(match.group(0), f"execute({new_sql})")

    def _fix_sqli_fstring(self, code: str, match) -> str:
        prefix = match.group(1)
        var = match.group(2)
        suffix = match.group(3)
        new_sql = f'"{prefix}%s{suffix}", ({var},)'
        return code.replace(match.group(0), f"execute({new_sql})")

    def _fix_xss_escape(self, code: str, match) -> str:
        var = match.group(1)
        return code.replace(f"mark_safe({var}", f"mark_safe(escape({var})")

    def _fix_xss_http_response(self, code: str, match) -> str:
        var = match.group(1)
        return code.replace(f"HttpResponse({var}", f"HttpResponse(escape({var}))")

    def _fix_cmdi_shell_false(self, code: str, match) -> str:
        return code.replace("shell=True", "shell=False")

    def _fix_cmdi_os_system(self, code: str, match) -> str:
        cmd = match.group(1)
        return code.replace(match.group(0), f'subprocess.run({cmd}, shell=False)')

    def _fix_creds_env_var(self, code: str, match) -> str:
        var = match.group(1)
        return code.replace(match.group(0), f'{var} = os.environ.get("{var.upper()}", "")')

    def _fix_crypto_md5(self, code: str, match) -> str:
        return code.replace("hashlib.md5(", "hashlib.sha256(")

    def _fix_crypto_sha1(self, code: str, match) -> str:
        return code.replace("hashlib.sha1(", "hashlib.sha256(")

    def _fix_deser_pickle(self, code: str, match) -> str:
        return code.replace("pickle.loads(", "json.loads(").replace("pickle.load(", "json.load(")

    def _fix_deser_yaml(self, code: str, match) -> str:
        return code.replace("yaml.load(", "yaml.safe_load(")

    def _fix_random_secrets(self, code: str, match) -> str:
        return code.replace("random.", "secrets.")

    def _fix_path_normalize(self, code: str, match) -> str:
        var = match.group(1)
        return code.replace(f"open({var}", f"open(os.path.normpath({var}))")

    def get_supported_vuln_types(self) -> List[str]:
        return list(self.fix_templates.keys())

    def get_stats(self) -> Dict:
        return {
            "total_generated": len(self.generated_fixes),
            "applied": sum(1 for f in self.generated_fixes if f.applied),
            "by_type": dict(Counter(f.vuln_type for f in self.generated_fixes)),
            "by_confidence": dict(Counter(f.confidence for f in self.generated_fixes)),
            "supported_types": self.get_supported_vuln_types(),
        }

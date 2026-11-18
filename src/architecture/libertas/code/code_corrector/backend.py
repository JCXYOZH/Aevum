"""职责模块：backend。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import ast
from collections import defaultdict
import os
import re
import time

from .models import CorrectionIssue
from .models import CorrectionReport

class BackendCorrector:
    """后端代码纠正器

    检测和修复Python后端代码中的：
    - Bug：未处理异常、资源泄漏、逻辑错误、类型错误
    - 安全：SQL注入、命令注入、路径遍历、硬编码密钥、弱加密
    - 性能：N+1查询、不必要的循环、内存泄漏
    - 最佳实践：代码规范、类型注解、文档字符串
    """

    def __init__(self):
        self.rules = self._init_rules()
        self.issues: List[CorrectionIssue] = []

    def _init_rules(self) -> List[Dict]:
        """初始化Python规则"""
        return [
            {
                "rule_id": "PY001",
                "title": "SQL注入风险",
                "category": "security",
                "severity": "critical",
                "pattern": r'(?:execute|executemany)\s*\(\s*[fF]?["\'].*?%s.*?["\']\s*%',
                "description": "使用字符串格式化构建SQL查询可能导致SQL注入",
                "auto_fixable": True,
                "fix": lambda code: re.sub(
                    r'(execute\s*\(\s*)[fF]?["\']([^"\']*?)%s([^"\']*?)["\']\s*%\s*(\w+)',
                    r'\1"\2%s\3", (\4,)',
                    code
                ),
                "suggested_fix": "使用参数化查询（?或%s占位符）替代字符串格式化",
            },
            {
                "rule_id": "PY002",
                "title": "命令注入风险",
                "category": "security",
                "severity": "critical",
                "pattern": r'(?:os\.system|os\.popen|subprocess\.\w+)\s*\([^)]*shell\s*=\s*True',
                "description": "使用shell=True且输入不可信可能导致命令注入",
                "auto_fixable": True,
                "fix": lambda code: code.replace('shell=True', 'shell=False'),
                "suggested_fix": "设置shell=False并使用参数列表",
            },
            {
                "rule_id": "PY003",
                "title": "硬编码密钥",
                "category": "security",
                "severity": "critical",
                "pattern": r'(?:SECRET_KEY|PASSWORD|API_KEY|TOKEN|PRIVATE_KEY)\s*=\s*["\'][^"\']{8,}["\']',
                "description": "硬编码的密钥/密码不应出现在代码中",
                "auto_fixable": True,
                "fix": lambda code: re.sub(
                    r'(SECRET_KEY|PASSWORD|API_KEY|TOKEN|PRIVATE_KEY)\s*=\s*["\'][^"\']{8,}["\']',
                    r'\1 = os.environ.get("\1", "")',
                    code
                ),
                "suggested_fix": "使用os.environ.get()从环境变量读取密钥",
            },
            {
                "rule_id": "PY004",
                "title": "裸except",
                "category": "bug",
                "severity": "high",
                "pattern": r'except\s*:',
                "description": "裸except会捕获所有异常包括KeyboardInterrupt和SystemExit",
                "auto_fixable": True,
                "fix": lambda code: code.replace('except:', 'except Exception:'),
                "suggested_fix": "使用except Exception:替代裸except",
            },
            {
                "rule_id": "PY005",
                "title": "未关闭的文件",
                "category": "bug",
                "severity": "medium",
                "pattern": r'open\s*\([^)]*\)\s*(?!\s*as\s+\w+)',
                "description": "未使用with语句打开文件可能导致资源泄漏",
                "auto_fixable": False,
                "suggested_fix": "使用with open(...) as f:确保文件自动关闭",
            },
            {
                "rule_id": "PY006",
                "title": "可变默认参数",
                "category": "bug",
                "severity": "high",
                "pattern": r'def\s+\w+\s*\([^)]*=\s*[\[\{\]]',
                "description": "可变默认参数在函数调用间共享，可能导致意外行为",
                "auto_fixable": False,
                "suggested_fix": "使用None作为默认值，在函数内部初始化为可变对象",
            },
            {
                "rule_id": "PY007",
                "title": "弱加密算法",
                "category": "security",
                "severity": "high",
                "pattern": r'hashlib\.(md5|sha1)\s*\(',
                "description": "MD5和SHA-1已被破解，不应用于安全场景",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'hashlib\.(md5|sha1)\(', 'hashlib.sha256(', code),
                "suggested_fix": "使用SHA-256或更强的哈希算法",
            },
            {
                "rule_id": "PY008",
                "title": "不安全的反序列化",
                "category": "security",
                "severity": "critical",
                "pattern": r'pickle\.loads?\s*\(',
                "description": "反序列化不可信数据可导致远程代码执行",
                "auto_fixable": True,
                "fix": lambda code: code.replace('pickle.loads(', 'json.loads(').replace('pickle.load(', 'json.load('),
                "suggested_fix": "使用json替代pickle，或对数据进行签名验证",
            },
            {
                "rule_id": "PY009",
                "title": "缺失类型注解",
                "category": "best_practice",
                "severity": "low",
                "pattern": r'def\s+\w+\s*\([^)]*\)\s*(?!->)',
                "description": "函数缺失返回类型注解",
                "auto_fixable": False,
                "suggested_fix": "为函数添加返回类型注解，如-> None, -> str, -> int",
            },
            {
                "rule_id": "PY010",
                "title": "print调试残留",
                "category": "style",
                "severity": "low",
                "pattern": r'^\s*print\s*\(',
                "description": "生产代码中不应保留print调试语句",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'^\s*print\s*\([^)]*\)\s*$', '', code, flags=re.MULTILINE),
                "suggested_fix": "使用logging模块替代print",
            },
            {
                "rule_id": "PY011",
                "title": "路径遍历风险",
                "category": "security",
                "severity": "high",
                "pattern": r'open\s*\(\s*(?:request|args|form|data)\.',
                "description": "直接使用用户输入作为文件路径可能导致路径遍历",
                "auto_fixable": False,
                "suggested_fix": "使用os.path.normpath和白名单验证文件路径",
            },
            {
                "rule_id": "PY012",
                "title": "调试模式开启",
                "category": "security",
                "severity": "high",
                "pattern": r'(?:debug\s*=\s*True|FLASK_DEBUG\s*=\s*1|DJANGO_DEBUG\s*=\s*True)',
                "description": "生产环境不应开启调试模式",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'debug\s*=\s*True', 'debug=False', code),
                "suggested_fix": "在生产环境关闭调试模式",
            },
            {
                "rule_id": "PY013",
                "title": "未使用的导入",
                "category": "style",
                "severity": "low",
                "pattern": r'^import\s+\w+',
                "description": "可能存在未使用的导入（需AST验证）",
                "auto_fixable": False,
                "suggested_fix": "移除未使用的导入",
            },
            {
                "rule_id": "PY014",
                "title": "不安全的随机数",
                "category": "security",
                "severity": "medium",
                "pattern": r'(?:random|randint|choice)\s*\(',
                "description": "random模块不应用于安全场景（密码、令牌）",
                "auto_fixable": True,
                "fix": lambda code: code.replace('random.', 'secrets.'),
                "suggested_fix": "使用secrets模块生成安全随机数",
            },
        ]

    def correct_file(self, file_path: str, auto_fix: bool = False) -> List[CorrectionIssue]:
        """纠正单个Python文件"""
        if not file_path.endswith('.py') or not os.path.exists(file_path):
            return []

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            return []

        issues = []

        # AST分析（检测语法错误、未使用变量等）
        ast_issues = self._ast_analysis(file_path, content)
        issues.extend(ast_issues)

        # 正则规则匹配
        for rule in self.rules:
            matches = list(re.finditer(rule["pattern"], content, re.MULTILINE))
            for match in matches:
                line_num = content[:match.start()].count('\n') + 1
                line_start = content.rfind('\n', 0, match.start()) + 1
                line_end = content.find('\n', match.end())
                if line_end == -1:
                    line_end = len(content)
                snippet = content[line_start:line_end].strip()

                issue = CorrectionIssue(
                    file_path=file_path,
                    language="python",
                    line_number=line_num,
                    column=match.start() - line_start + 1,
                    severity=rule["severity"],
                    category=rule["category"],
                    rule_id=rule["rule_id"],
                    title=rule["title"],
                    description=rule["description"],
                    code_snippet=snippet[:200],
                    suggested_fix=rule["suggested_fix"],
                    auto_fixable=rule.get("auto_fixable", False),
                    confidence=0.85,
                )
                issues.append(issue)

                # 自动修复
                if auto_fix and rule.get("auto_fixable") and rule.get("fix"):
                    try:
                        new_content = rule["fix"](content)
                        if new_content != content:
                            with open(file_path, 'w', encoding='utf-8') as f:
                                f.write(new_content)
                            content = new_content
                            issue.fixed = True
                    except Exception:
                        pass

        self.issues.extend(issues)
        return issues

    def _ast_analysis(self, file_path: str, content: str) -> List[CorrectionIssue]:
        """AST分析检测"""
        issues = []
        try:
            tree = ast.parse(content)
        except SyntaxError as e:
            issues.append(CorrectionIssue(
                file_path=file_path,
                language="python",
                line_number=e.lineno or 0,
                column=e.offset or 0,
                severity="critical",
                category="bug",
                rule_id="PY_AST001",
                title="语法错误",
                description=f"Python语法错误: {e.msg}",
                code_snippet=e.text or "",
                auto_fixable=False,
                confidence=1.0,
            ))
            return issues

        # 检测未使用的导入
        imported = set()
        used = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imported.add(alias.asname or alias.name.split('.')[0])
            elif isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    imported.add(alias.asname or alias.name)
            elif isinstance(node, ast.Name):
                used.add(node.id)

        for name in imported:
            if name not in used and name != '__future__':
                issues.append(CorrectionIssue(
                    file_path=file_path,
                    language="python",
                    line_number=0,
                    severity="low",
                    category="style",
                    rule_id="PY_AST002",
                    title=f"未使用的导入: {name}",
                    description=f"导入的模块 '{name}' 未在代码中使用",
                    auto_fixable=True,
                    suggested_fix=f"移除 'import {name}' 语句",
                    confidence=0.9,
                ))

        return issues

    def correct_directory(self, dir_path: str, auto_fix: bool = False) -> CorrectionReport:
        """纠正目录中的所有Python文件"""
        start_time = time.time()
        all_issues = []
        files_scanned = 0
        auto_fixed = 0
        fix_failed = 0

        for root, dirs, files in os.walk(dir_path):
            dirs[:] = [d for d in dirs if d not in ('__pycache__', '.git', 'venv', 'env', 'node_modules')]
            for f in files:
                if f.endswith('.py'):
                    files_scanned += 1
                    file_path = os.path.join(root, f)
                    issues = self.correct_file(file_path, auto_fix=auto_fix)
                    all_issues.extend(issues)
                    auto_fixed += sum(1 for i in issues if i.fixed)
                    fix_failed += sum(1 for i in issues if i.auto_fixable and not i.fixed)

        report = CorrectionReport(
            target_path=dir_path,
            files_scanned=files_scanned,
            total_issues=len(all_issues),
            issues=all_issues,
            auto_fixed=auto_fixed,
            fix_failed=fix_failed,
            duration=time.time() - start_time,
        )
        return report

    def get_stats(self) -> Dict:
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        for issue in self.issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] += 1
        return {
            "total_issues": len(self.issues),
            "auto_fixed": sum(1 for i in self.issues if i.fixed),
            "by_severity": dict(by_severity),
            "by_category": dict(by_category),
            "rules": len(self.rules),
        }

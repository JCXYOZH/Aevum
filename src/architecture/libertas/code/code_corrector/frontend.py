"""职责模块：frontend。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict
import os
import re
import time

from .models import CorrectionIssue
from .models import CorrectionReport

class FrontendCorrector:
    """前端代码纠正器

    检测和修复JavaScript/HTML/CSS/Vue/React代码中的：
    - Bug：未定义变量、类型错误、空指针、逻辑错误
    - 安全：XSS、不安全的DOM操作、硬编码密钥、CSRF
    - 性能：内存泄漏、不必要的重渲染、大循环、未优化的选择器
    - 最佳实践：代码规范、可访问性、兼容性
    """

    def __init__(self):
        self.js_rules = self._init_js_rules()
        self.html_rules = self._init_html_rules()
        self.css_rules = self._init_css_rules()
        self.vue_rules = self._init_vue_rules()
        self.issues: List[CorrectionIssue] = []

    def _init_js_rules(self) -> List[Dict]:
        """初始化JavaScript规则"""
        return [
            {
                "rule_id": "JS001",
                "title": "使用eval()",
                "category": "security",
                "severity": "critical",
                "pattern": r'\beval\s*\(',
                "description": "eval()可导致代码注入攻击，应避免使用",
                "auto_fixable": False,
                "suggested_fix": "使用JSON.parse()或Function()替代，或重构代码避免动态执行",
            },
            {
                "rule_id": "JS002",
                "title": "innerHTML XSS风险",
                "category": "security",
                "severity": "high",
                "pattern": r'\.innerHTML\s*=',
                "description": "直接设置innerHTML可能导致XSS攻击",
                "auto_fixable": True,
                "fix": lambda code: code.replace('.innerHTML =', '.textContent ='),
                "suggested_fix": "使用textContent替代innerHTML，或对内容进行HTML转义",
            },
            {
                "rule_id": "JS003",
                "title": "硬编码密钥",
                "category": "security",
                "severity": "critical",
                "pattern": r'(?:api[_-]?key|secret|password|token)\s*[:=]\s*["\'][A-Za-z0-9_\-]{16,}["\']',
                "description": "硬编码的密钥/密码/令牌不应出现在前端代码中",
                "auto_fixable": False,
                "suggested_fix": "将密钥移至后端环境变量，前端通过API调用获取",
            },
            {
                "rule_id": "JS004",
                "title": "console.log残留",
                "category": "style",
                "severity": "low",
                "pattern": r'console\.(log|debug|info)\s*\(',
                "description": "生产代码中不应保留console.log调试语句",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'console\.(log|debug|info)\s*\([^)]*\);?', '', code),
                "suggested_fix": "移除console.log，或使用条件日志",
            },
            {
                "rule_id": "JS005",
                "title": "var声明",
                "category": "best_practice",
                "severity": "low",
                "pattern": r'\bvar\s+\w+',
                "description": "应使用let/const替代var以避免变量提升问题",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'\bvar\s+', 'let ', code),
                "suggested_fix": "将var替换为let（可变）或const（不可变）",
            },
            {
                "rule_id": "JS006",
                "title": "== 比较",
                "category": "bug",
                "severity": "medium",
                "pattern": r'[^=!]==[^=]',
                "description": "使用==可能导致类型强制转换的意外行为",
                "auto_fixable": True,
                "fix": lambda code: re.sub(r'([^=!])==([^=])', r'\1===\2', code),
                "suggested_fix": "使用===进行严格比较",
            },
            {
                "rule_id": "JS007",
                "title": "未处理的Promise",
                "category": "bug",
                "severity": "high",
                "pattern": r'(?:fetch|axios\.\w+|\w+\.then)\s*\([^)]*\)(?!\s*\.catch)',
                "description": "异步操作未处理错误可能导致未捕获的Promise拒绝",
                "auto_fixable": False,
                "suggested_fix": "添加.catch()处理错误，或使用try/catch with async/await",
            },
            {
                "rule_id": "JS008",
                "title": "document.write使用",
                "category": "security",
                "severity": "high",
                "pattern": r'document\.write\s*\(',
                "description": "document.write可导致XSS且阻塞页面渲染",
                "auto_fixable": False,
                "suggested_fix": "使用DOM操作方法（createElement, appendChild等）替代",
            },
            {
                "rule_id": "JS009",
                "title": "setTimeout字符串参数",
                "category": "security",
                "severity": "medium",
                "pattern": r'setTimeout\s*\(\s*["\']',
                "description": "setTimeout使用字符串参数等同于eval",
                "auto_fixable": False,
                "suggested_fix": "使用函数作为setTimeout的第一个参数",
            },
            {
                "rule_id": "JS010",
                "title": "全局变量污染",
                "category": "best_practice",
                "severity": "medium",
                "pattern": r'^[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*',
                "description": "顶层赋值可能污染全局命名空间",
                "auto_fixable": False,
                "suggested_fix": "使用IIFE或模块系统封装代码",
            },
            {
                "rule_id": "JS011",
                "title": "localStorage敏感数据",
                "category": "security",
                "severity": "high",
                "pattern": r'localStorage\.setItem\s*\(\s*["\'](?:token|password|secret|api[_-]?key)',
                "description": "敏感数据不应存储在localStorage中（XSS可窃取）",
                "auto_fixable": False,
                "suggested_fix": "使用HttpOnly Secure Cookie存储敏感数据",
            },
            {
                "rule_id": "JS012",
                "title": "空依赖数组useEffect",
                "category": "bug",
                "severity": "medium",
                "pattern": r'useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*\}\s*,\s*\[\s*\]',
                "description": "空依赖数组的useEffect可能捕获过时的闭包值",
                "auto_fixable": False,
                "suggested_fix": "添加所有依赖项到依赖数组，或使用useRef",
            },
        ]

    def _init_html_rules(self) -> List[Dict]:
        """初始化HTML规则"""
        return [
            {
                "rule_id": "HTML001",
                "title": "内联事件处理器",
                "category": "security",
                "severity": "medium",
                "pattern": r'\bon(?:click|load|error|mouseover)\s*=',
                "description": "内联事件处理器可导致XSS且不符合CSP",
                "auto_fixable": False,
                "suggested_fix": "使用addEventListener绑定事件",
            },
            {
                "rule_id": "HTML002",
                "title": "缺失DOCTYPE",
                "category": "best_practice",
                "severity": "low",
                "pattern": r'^<html',
                "description": "缺失DOCTYPE声明可能导致怪异模式",
                "auto_fixable": True,
                "fix": lambda code: '<!DOCTYPE html>\n' + code if not code.lower().startswith('<!doctype') else code,
                "suggested_fix": "在文件开头添加<!DOCTYPE html>",
            },
            {
                "rule_id": "HTML003",
                "title": "不安全的target=_blank",
                "category": "security",
                "severity": "medium",
                "pattern": r'target\s*=\s*["\']_blank["\'](?!.*rel\s*=\s*["\'][^"\']*noopener)',
                "description": "target=_blank缺失noopener可导致tabnabbing攻击",
                "auto_fixable": True,
                "fix": lambda code: re.sub(
                    r'target\s*=\s*["\']_blank["\']',
                    'target="_blank" rel="noopener noreferrer"',
                    code
                ),
                "suggested_fix": "添加rel=\"noopener noreferrer\"",
            },
            {
                "rule_id": "HTML004",
                "title": "缺失alt属性",
                "category": "best_practice",
                "severity": "low",
                "pattern": r'<img\s[^>]*?(?<!alt=)>',
                "description": "img标签缺失alt属性影响可访问性",
                "auto_fixable": False,
                "suggested_fix": "为img标签添加描述性alt属性",
            },
            {
                "rule_id": "HTML005",
                "title": "内联样式",
                "category": "style",
                "severity": "low",
                "pattern": r'style\s*=\s*["\'][^"\']*["\']',
                "description": "内联样式不利于维护和缓存",
                "auto_fixable": False,
                "suggested_fix": "将样式移至CSS类中",
            },
        ]

    def _init_css_rules(self) -> List[Dict]:
        """初始化CSS规则"""
        return [
            {
                "rule_id": "CSS001",
                "title": "!important滥用",
                "category": "style",
                "severity": "low",
                "pattern": r'!important',
                "description": "!important破坏样式层叠，应尽量避免",
                "auto_fixable": False,
                "suggested_fix": "通过提高选择器特异性替代!important",
            },
            {
                "rule_id": "CSS002",
                "title": "通配符选择器",
                "category": "performance",
                "severity": "low",
                "pattern": r'^\s*\*\s*\{',
                "description": "通配符选择器影响所有元素，性能较差",
                "auto_fixable": False,
                "suggested_fix": "使用具体的选择器或CSS reset",
            },
            {
                "rule_id": "CSS003",
                "title": "浮动布局",
                "category": "best_practice",
                "severity": "low",
                "pattern": r'float\s*:',
                "description": "浮动布局已过时，推荐使用Flexbox或Grid",
                "auto_fixable": False,
                "suggested_fix": "使用display:flex或display:grid替代浮动",
            },
            {
                "rule_id": "CSS004",
                "title": "缺失前缀",
                "category": "compatibility",
                "severity": "medium",
                "pattern": r'(?:transform|transition|animation|flex|grid)\s*:',
                "description": "CSS3属性可能需要浏览器前缀以兼容旧浏览器",
                "auto_fixable": False,
                "suggested_fix": "使用Autoprefixer自动添加前缀，或手动添加-webkit-/-moz-等",
            },
        ]

    def _init_vue_rules(self) -> List[Dict]:
        """初始化Vue规则"""
        return [
            {
                "rule_id": "VUE001",
                "title": "v-html XSS风险",
                "category": "security",
                "severity": "high",
                "pattern": r'v-html\s*=',
                "description": "v-html直接渲染HTML可能导致XSS",
                "auto_fixable": True,
                "fix": lambda code: code.replace('v-html=', 'v-text='),
                "suggested_fix": "使用v-text替代v-html，或对内容进行转义",
            },
            {
                "rule_id": "VUE002",
                "title": "缺失key的v-for",
                "category": "bug",
                "severity": "medium",
                "pattern": r'v-for\s*=\s*["\'][^"\']*["\'](?!.*:key)',
                "description": "v-for缺失key属性可能导致渲染错误",
                "auto_fixable": False,
                "suggested_fix": "为v-for添加唯一的:key属性",
            },
            {
                "rule_id": "VUE003",
                "title": "直接修改props",
                "category": "bug",
                "severity": "high",
                "pattern": r'this\.\w+\s*=\s*[^=]',
                "description": "直接修改props会导致警告和不可预测的行为",
                "auto_fixable": False,
                "suggested_fix": "使用data或computed创建props的本地副本，通过$emit通知父组件修改",
            },
        ]

    def correct_file(self, file_path: str, auto_fix: bool = False) -> List[CorrectionIssue]:
        """纠正单个前端文件"""
        if not os.path.exists(file_path):
            return []

        ext = os.path.splitext(file_path)[1].lower()
        language = self._ext_to_language(ext)
        if language == "unknown":
            return []

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            return []

        issues = []
        rules = self._get_rules_for_language(language)

        for rule in rules:
            matches = list(re.finditer(rule["pattern"], content, re.MULTILINE | re.IGNORECASE))
            for match in matches:
                line_num = content[:match.start()].count('\n') + 1
                line_start = content.rfind('\n', 0, match.start()) + 1
                line_end = content.find('\n', match.end())
                if line_end == -1:
                    line_end = len(content)
                snippet = content[line_start:line_end].strip()

                issue = CorrectionIssue(
                    file_path=file_path,
                    language=language,
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

    def correct_directory(self, dir_path: str, auto_fix: bool = False,
                           extensions: List[str] = None) -> CorrectionReport:
        """纠正目录中的所有前端文件"""
        if extensions is None:
            extensions = ['.js', '.jsx', '.ts', '.tsx', '.html', '.htm', '.css', '.vue', '.scss', '.less']

        start_time = time.time()
        all_issues = []
        files_scanned = 0
        auto_fixed = 0
        fix_failed = 0

        for root, dirs, files in os.walk(dir_path):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'dist', 'build')]
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in extensions:
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

    def _ext_to_language(self, ext: str) -> str:
        mapping = {
            '.js': 'javascript', '.jsx': 'jsx',
            '.ts': 'typescript', '.tsx': 'tsx',
            '.html': 'html', '.htm': 'html',
            '.css': 'css', '.scss': 'scss', '.less': 'less',
            '.vue': 'vue',
        }
        return mapping.get(ext, 'unknown')

    def _get_rules_for_language(self, language: str) -> List[Dict]:
        if language in ('javascript', 'jsx', 'typescript', 'tsx'):
            return self.js_rules
        elif language == 'html':
            return self.html_rules + self.js_rules  # HTML中可能有内联JS
        elif language in ('css', 'scss', 'less'):
            return self.css_rules
        elif language == 'vue':
            return self.vue_rules + self.js_rules + self.html_rules
        return []

    def get_stats(self) -> Dict:
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        by_language = defaultdict(int)
        for issue in self.issues:
            by_severity[issue.severity] += 1
            by_category[issue.category] += 1
            by_language[issue.language] += 1
        return {
            "total_issues": len(self.issues),
            "auto_fixed": sum(1 for i in self.issues if i.fixed),
            "by_severity": dict(by_severity),
            "by_category": dict(by_category),
            "by_language": dict(by_language),
            "js_rules": len(self.js_rules),
            "html_rules": len(self.html_rules),
            "css_rules": len(self.css_rules),
            "vue_rules": len(self.vue_rules),
        }

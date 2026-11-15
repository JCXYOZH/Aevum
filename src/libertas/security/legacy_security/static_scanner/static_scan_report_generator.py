"""
security/static_scanner.py - 静态代码漏洞扫描器

核心能力：
- 扫描源代码文件中的漏洞模式
- 支持Python、JavaScript、Java、PHP、C/C++等多语言
- 检测SQL注入、XSS、命令注入、硬编码凭证、路径遍历、SSRF、
  不安全反序列化、弱加密、XXE、开放重定向等漏洞
- 基础数据流分析（source到sink追踪）
- 漏洞报告生成（JSON/Markdown/HTML）
- 与Codebase模块集成，支持整个项目扫描
"""
import os
import re
import sys
import json
import time
import uuid
import ast
import hashlib
import threading
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict, Counter


# ================================================================
# 枚举和数据结构
# ================================================================
from .models import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403
from .language_detector import *  # noqa: F401,F403
from . import VulnPatternLibrary  # noqa: F401

class StaticScanReportGenerator:
    """静态扫描报告生成器"""

    def generate_json(self, result: StaticScanResult) -> str:
        return json.dumps(result.to_dict(), ensure_ascii=False, indent=2)

    def generate_markdown(self, result: StaticScanResult) -> str:
        summary = result.get_summary()
        lines = []
        lines.append("# 静态代码漏洞扫描报告")
        lines.append("")
        lines.append(f"**扫描ID**: {result.scan_id}")
        lines.append(f"**项目路径**: {result.project_path}")
        lines.append(f"**扫描时间**: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(result.started_at))}")
        lines.append(f"**扫描时长**: {summary['duration_seconds']:.1f}秒")
        lines.append(f"**扫描文件数**: {summary['total_files_scanned']}")
        lines.append(f"**扫描代码行数**: {summary['total_lines_scanned']:,}")
        lines.append("")
        lines.append("## 漏洞概览")
        lines.append("")
        lines.append("| 严重程度 | 数量 |")
        lines.append("|----------|------|")
        for sev in ["critical", "high", "medium", "low", "info"]:
            lines.append(f"| {sev.upper()} | {summary['by_severity'].get(sev, 0)} |")
        lines.append("")
        lines.append(f"**总漏洞数**: {summary['total_vulnerabilities']}")
        lines.append("")

        if summary.get("by_file"):
            lines.append("## 漏洞最多的文件")
            lines.append("")
            lines.append("| 文件 | 漏洞数 |")
            lines.append("|------|--------|")
            for f in summary["by_file"][:10]:
                lines.append(f"| {f['file']} | {f['count']} |")
            lines.append("")

        if result.vulnerabilities:
            lines.append("## 漏洞详情")
            lines.append("")
            for i, vuln in enumerate(result.vulnerabilities, 1):
                lines.append(f"### {i}. [{vuln.severity.value.upper()}] {vuln.description}")
                lines.append("")
                lines.append(f"- **漏洞ID**: {vuln.vuln_id}")
                lines.append(f"- **漏洞类型**: {vuln.vuln_type.value}")
                lines.append(f"- **置信度**: {vuln.confidence.value}")
                lines.append(f"- **文件**: {vuln.file_path}:{vuln.line_number}")
                if vuln.function_name:
                    lines.append(f"- **函数**: {vuln.function_name}")
                if vuln.class_name:
                    lines.append(f"- **类**: {vuln.class_name}")
                lines.append(f"- **代码**: `{vuln.code_snippet[:100]}`")
                lines.append(f"- **证据**: {vuln.evidence}")
                lines.append(f"- **CWE**: {vuln.cwe}")
                lines.append(f"- **修复建议**: {vuln.remediation}")
                lines.append("")

        return "\n".join(lines)

    def save_report(self, result: StaticScanResult, output_path: str, format: str = "markdown") -> bool:
        try:
            if format == "json":
                content = self.generate_json(result)
            else:
                content = self.generate_markdown(result)
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"保存报告失败: {e}")
            return False

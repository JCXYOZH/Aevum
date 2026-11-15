"""
security/vuln_detector.py - 漏洞探测与验证引擎

核心能力：
- 自动发送payload到目标的多个注入点（URL参数、POST数据、Header、Cookie）
- 分析响应判断漏洞是否存在（状态码、内容、时间延迟、错误信息、特定模式）
- 漏洞验证（确认漏洞真实存在，排除误报）
- 支持SQL注入、XSS、命令注入、目录遍历、SSRF、文件上传、CRLF、SSTI等漏洞类型
- 扫描报告生成
"""
import os
import re
import sys
import json
import time
import uuid
import socket
import hashlib
import threading
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple, Set, Callable
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict


# ================================================================
# 漏洞类型和严重程度枚举
# ================================================================
from .models import *  # noqa: F401,F403
from .http_client import *  # noqa: F401,F403
from .response_analyzer import *  # noqa: F401,F403
from .vulnerability_verifier import *  # noqa: F401,F403
from .vulnerability_detector import *  # noqa: F401,F403

class ScanReportGenerator:
    """扫描报告生成器 - 生成JSON/Markdown/HTML格式的扫描报告"""

    def __init__(self):
        pass

    def generate_json(self, result: ScanResult) -> str:
        """生成JSON报告"""
        return json.dumps(result.to_dict(), ensure_ascii=False, indent=2)

    def generate_markdown(self, result: ScanResult) -> str:
        """生成Markdown报告"""
        summary = result.get_summary()
        lines = []
        lines.append(f"# 漏洞扫描报告")
        lines.append("")
        lines.append(f"**扫描ID**: {result.scan_id}")
        lines.append(f"**目标URL**: {result.target_url}")
        lines.append(f"**扫描时间**: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(result.started_at))}")
        lines.append(f"**扫描时长**: {summary['duration_seconds']:.1f}秒")
        lines.append(f"**总请求数**: {summary['total_requests']}")
        lines.append(f"**注入点数**: {summary['total_injection_points']}")
        lines.append("")
        lines.append("## 漏洞概览")
        lines.append("")
        lines.append("| 严重程度 | 数量 |")
        lines.append("|----------|------|")
        for sev in ["critical", "high", "medium", "low", "info"]:
            lines.append(f"| {sev.upper()} | {summary['by_severity'].get(sev, 0)} |")
        lines.append("")
        lines.append(f"**已验证漏洞**: {summary['verified_vulnerabilities']}")
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
                lines.append(f"- **已验证**: {'是' if vuln.verified else '否'}")
                lines.append(f"- **CWE**: {vuln.cwe}")
                lines.append(f"- **URL**: {vuln.url}")
                if vuln.injection_point:
                    lines.append(f"- **注入点**: [{vuln.injection_point.location}] {vuln.injection_point.name}")
                lines.append(f"- **Payload**: `{vuln.payload[:100]}`")
                lines.append(f"- **证据**: {vuln.evidence}")
                lines.append(f"- **修复建议**: {vuln.remediation}")
                lines.append("")

        if result.errors:
            lines.append("## 错误信息")
            lines.append("")
            for err in result.errors[:20]:
                lines.append(f"- {err}")
            lines.append("")

        return "\n".join(lines)

    def generate_html(self, result: ScanResult) -> str:
        """生成HTML报告"""
        md = self.generate_markdown(result)
        # 简单的Markdown转HTML
        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>漏洞扫描报告 - {result.target_url}</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }}
        .container {{ max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }}
        h1 {{ color: #333; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px; }}
        h2 {{ color: #555; margin-top: 30px; }}
        h3 {{ color: #666; }}
        table {{ border-collapse: collapse; width: 100%; margin: 15px 0; }}
        th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
        th {{ background: #f0f0f0; }}
        .critical {{ color: #d32f2f; font-weight: bold; }}
        .high {{ color: #f57c00; font-weight: bold; }}
        .medium {{ color: #fbc02d; }}
        .low {{ color: #388e3c; }}
        code {{ background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }}
        .vuln-card {{ border: 1px solid #e0e0e0; border-radius: 6px; padding: 15px; margin: 10px 0; }}
    </style>
</head>
<body>
<div class="container">
<pre>{md}</pre>
</div>
</body>
</html>"""
        return html

    def save_report(self, result: ScanResult, output_path: str, format: str = "markdown") -> bool:
        """保存报告到文件"""
        try:
            if format == "json":
                content = self.generate_json(result)
            elif format == "html":
                content = self.generate_html(result)
            else:
                content = self.generate_markdown(result)

            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        except Exception as e:
            print(f"保存报告失败: {e}")
            return False

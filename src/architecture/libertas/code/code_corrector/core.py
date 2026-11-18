"""职责模块：core。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import os
import time

from .backend import BackendCorrector
from .models import CorrectionIssue
from .models import CorrectionReport
from .frontend import FrontendCorrector

class CodeCorrector:
    """统一代码纠正入口

    自动识别文件语言，分发到前端或后端纠正器。
    支持批量纠正、自动修复、报告生成。
    """

    def __init__(self):
        self.frontend_corrector = FrontendCorrector()
        self.backend_corrector = BackendCorrector()
        self.reports: List[CorrectionReport] = []

    def correct(self, target_path: str, auto_fix: bool = False,
                language: str = "auto") -> CorrectionReport:
        """纠正文件或目录

        Args:
            target_path: 文件或目录路径
            auto_fix: 是否自动修复可修复的问题
            language: 指定语言（auto/javascript/python/css/html/vue）
        """
        start_time = time.time()

        if os.path.isfile(target_path):
            issues = self._correct_file(target_path, auto_fix, language)
            report = CorrectionReport(
                target_path=target_path,
                files_scanned=1,
                total_issues=len(issues),
                issues=issues,
                auto_fixed=sum(1 for i in issues if i.fixed),
                fix_failed=sum(1 for i in issues if i.auto_fixable and not i.fixed),
                duration=time.time() - start_time,
            )
        elif os.path.isdir(target_path):
            # 分别纠正前端和后端
            fe_report = self.frontend_corrector.correct_directory(target_path, auto_fix=auto_fix)
            be_report = self.backend_corrector.correct_directory(target_path, auto_fix=auto_fix)

            all_issues = fe_report.issues + be_report.issues
            report = CorrectionReport(
                target_path=target_path,
                files_scanned=fe_report.files_scanned + be_report.files_scanned,
                total_issues=len(all_issues),
                issues=all_issues,
                auto_fixed=fe_report.auto_fixed + be_report.auto_fixed,
                fix_failed=fe_report.fix_failed + be_report.fix_failed,
                duration=time.time() - start_time,
            )
        else:
            report = CorrectionReport(
                target_path=target_path,
                files_scanned=0,
                total_issues=0,
                duration=time.time() - start_time,
            )

        self.reports.append(report)
        return report

    def _correct_file(self, file_path: str, auto_fix: bool,
                       language: str) -> List[CorrectionIssue]:
        """纠正单个文件"""
        ext = os.path.splitext(file_path)[1].lower()

        if language == "auto":
            if ext in ('.py',):
                return self.backend_corrector.correct_file(file_path, auto_fix=auto_fix)
            else:
                return self.frontend_corrector.correct_file(file_path, auto_fix=auto_fix)
        elif language == "python":
            return self.backend_corrector.correct_file(file_path, auto_fix=auto_fix)
        else:
            return self.frontend_corrector.correct_file(file_path, auto_fix=auto_fix)

    def generate_report_markdown(self, report: CorrectionReport) -> str:
        """生成Markdown格式的纠正报告"""
        lines = ["# 代码纠正报告", ""]
        lines.append(f"**目标**: `{report.target_path}`")
        lines.append(f"**扫描文件数**: {report.files_scanned}")
        lines.append(f"**问题总数**: {report.total_issues}")
        lines.append(f"**自动修复**: {report.auto_fixed}")
        lines.append(f"**修复失败**: {report.fix_failed}")
        lines.append(f"**耗时**: {report.duration:.2f}秒")
        lines.append("")

        data = report.to_dict()
        lines.append("## 按严重程度")
        lines.append("")
        for sev, count in sorted(data.get("by_severity", {}).items()):
            lines.append(f"- **{sev}**: {count}")
        lines.append("")

        lines.append("## 按类别")
        lines.append("")
        for cat, count in sorted(data.get("by_category", {}).items()):
            lines.append(f"- **{cat}**: {count}")
        lines.append("")

        lines.append("## 问题详情")
        lines.append("")
        for i, issue in enumerate(report.issues[:100], 1):
            lines.append(f"### {i}. [{issue.severity.upper()}] {issue.title}")
            lines.append("")
            lines.append(f"- **规则**: {issue.rule_id}")
            lines.append(f"- **类别**: {issue.category}")
            lines.append(f"- **文件**: `{issue.file_path}:{issue.line_number}`")
            lines.append(f"- **语言**: {issue.language}")
            lines.append(f"- **置信度**: {issue.confidence:.0%}")
            lines.append(f"- **可自动修复**: {'是' if issue.auto_fixable else '否'}")
            lines.append(f"- **已修复**: {'是' if issue.fixed else '否'}")
            lines.append("")
            lines.append(f"**描述**: {issue.description}")
            lines.append("")
            if issue.code_snippet:
                lines.append(f"**代码**:")
                lines.append(f"```\n{issue.code_snippet}\n```")
                lines.append("")
            lines.append(f"**建议**: {issue.suggested_fix}")
            lines.append("")

        return "\n".join(lines)

    def get_stats(self) -> Dict:
        return {
            "total_reports": len(self.reports),
            "total_files_scanned": sum(r.files_scanned for r in self.reports),
            "total_issues": sum(r.total_issues for r in self.reports),
            "total_auto_fixed": sum(r.auto_fixed for r in self.reports),
            "frontend": self.frontend_corrector.get_stats(),
            "backend": self.backend_corrector.get_stats(),
        }

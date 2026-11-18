"""
core/report_generator.py - 自动化报告生成

报告模板、数据收集、格式化输出、多格式导出、定时生成、报告分发。
"""
import os
import json
import time
import uuid
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 报告类型
# ================================================================
class ReportType(Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    AD_HOC = "ad_hoc"
    ALERT = "alert"
    AUDIT = "audit"
    PERFORMANCE = "performance"
    SECURITY = "security"


# ================================================================
# 报告格式
# ================================================================
class ReportFormat(Enum):
    JSON = "json"
    MARKDOWN = "markdown"
    HTML = "html"
    TEXT = "text"
    CSV = "csv"


# ================================================================
# 报告模板
# ================================================================
class ReportTemplate:
    """报告模板"""

    def __init__(self, name: str = "", report_type: str = "ad_hoc",
                 description: str = "", sections: Optional[List[str]] = None,
                 data_sources: Optional[List[str]] = None,
                 format: str = "markdown"):
        self.template_id = f"tpl_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.report_type = report_type
        self.description = description
        self.sections = sections or ["summary", "details", "metrics", "recommendations"]
        self.data_sources = data_sources or []
        self.format = format
        self.created_at = time.time()
        self.updated_at = time.time()
        self.usage_count = 0
        self.custom_template = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "report_type": self.report_type,
            "description": self.description,
            "sections": self.sections,
            "data_sources": self.data_sources,
            "format": self.format,
            "created_at": self.created_at,
            "usage_count": self.usage_count,
        }


# ================================================================
# 报告实例
# ================================================================
class Report:
    """报告实例"""

    def __init__(self, title: str = "", report_type: str = "ad_hoc",
                 template_id: str = "", format: str = "markdown"):
        self.report_id = f"rpt_{uuid.uuid4().hex[:8]}"
        self.title = title
        self.report_type = report_type
        self.template_id = template_id
        self.format = format
        self.created_at = time.time()
        self.generated_at = 0.0
        self.generation_time_ms = 0.0
        self.status = "pending"  # pending / generating / completed / failed
        self.sections: Dict[str, Any] = {}
        self.data: Dict[str, Any] = {}
        self.content = ""
        self.file_path = ""
        self.error = ""
        self.metadata: Dict[str, Any] = {}
        self.generated_by = ""
        self.tags: List[str] = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "report_id": self.report_id,
            "title": self.title,
            "report_type": self.report_type,
            "template_id": self.template_id,
            "format": self.format,
            "created_at": self.created_at,
            "generated_at": self.generated_at,
            "generation_time_ms": round(self.generation_time_ms, 1),
            "status": self.status,
            "sections": list(self.sections.keys()),
            "file_path": self.file_path,
            "error": self.error,
            "tags": self.tags,
        }


# ================================================================
# 报告生成器
# ================================================================
class ReportGenerator:
    """自动化报告生成"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "reports")
        self.reports_dir = os.path.join(self.data_dir, "generated")
        os.makedirs(self.reports_dir, exist_ok=True)
        self._templates: Dict[str, ReportTemplate] = {}
        self._reports: Dict[str, Report] = {}
        self._data_collectors: Dict[str, Callable] = {}
        self._lock = threading.RLock()
        self._scheduled_reports: List[Dict[str, Any]] = []
        self._init_default_templates()
        self._init_data_collectors()
        self._load()

    def _init_default_templates(self):
        """初始化默认报告模板"""
        defaults = [
            ReportTemplate("系统状态日报", "daily", "每日系统运行状态报告",
                          sections=["summary", "system_metrics", "service_status",
                                   "alerts", "performance", "recommendations"],
                          data_sources=["monitor", "metrics", "alerts"],
                          format="markdown"),
            ReportTemplate("安全审计报告", "audit", "安全事件与合规审计报告",
                          sections=["summary", "security_events", "vulnerabilities",
                                   "access_logs", "compliance", "recommendations"],
                          data_sources=["security", "audit", "vulnerabilities"],
                          format="markdown"),
            ReportTemplate("性能分析报告", "performance", "系统性能分析与优化建议",
                          sections=["summary", "performance_metrics", "bottlenecks",
                                   "trends", "optimizations", "recommendations"],
                          data_sources=["performance", "metrics", "timing"],
                          format="markdown"),
            ReportTemplate("周报", "weekly", "每周工作总结与计划",
                          sections=["summary", "achievements", "metrics",
                                   "issues", "next_week_plan"],
                          data_sources=["tasks", "metrics", "alerts"],
                          format="markdown"),
        ]
        for template in defaults:
            self._templates[template.template_id] = template

    def _init_data_collectors(self):
        """初始化数据收集器"""
        def collect_system_info():
            return {
                "timestamp": time.time(),
                "platform": os.name,
                "python_version": sys.version,
                "cwd": os.getcwd(),
            }
        self._data_collectors["system"] = collect_system_info

        def collect_time_info():
            now = datetime.now()
            return {
                "current_time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "date": now.strftime("%Y-%m-%d"),
                "weekday": now.strftime("%A"),
                "week_number": now.isocalendar()[1],
            }
        self._data_collectors["time"] = collect_time_info

    def _load(self):
        config_file = os.path.join(self.data_dir, "report_config.json")
        try:
            if os.path.exists(config_file):
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for r_data in data.get("reports", []):
                    report = Report(
                        title=r_data.get("title", ""),
                        report_type=r_data.get("report_type", "ad_hoc"),
                        template_id=r_data.get("template_id", ""),
                        format=r_data.get("format", "markdown"),
                    )
                    report.report_id = r_data.get("report_id", report.report_id)
                    report.status = r_data.get("status", "pending")
                    report.file_path = r_data.get("file_path", "")
                    report.generated_at = r_data.get("generated_at", 0)
                    self._reports[report.report_id] = report
        except Exception as e:
            terminal.warn(f"加载报告配置失败: {e}", "report")

    def _save(self):
        config_file = os.path.join(self.data_dir, "report_config.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "templates": [t.to_dict() for t in self._templates.values()],
                "reports": [r.to_dict() for r in self._reports.values()],
            }
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def register_template(self, template: ReportTemplate) -> str:
        with self._lock:
            self._templates[template.template_id] = template
            self._save()
        return template.template_id

    def get_template(self, template_id: str) -> Optional[ReportTemplate]:
        return self._templates.get(template_id)

    def list_templates(self, report_type: str = "") -> List[ReportTemplate]:
        templates = list(self._templates.values())
        if report_type:
            templates = [t for t in templates if t.report_type == report_type]
        return templates

    def register_data_collector(self, name: str, collector: Callable):
        self._data_collectors[name] = collector

    def collect_data(self, sources: Optional[List[str]] = None) -> Dict[str, Any]:
        """收集报告数据"""
        data = {}
        sources_to_use = sources or list(self._data_collectors.keys())
        for source in sources_to_use:
            collector = self._data_collectors.get(source)
            if collector:
                try:
                    data[source] = collector()
                except Exception as e:
                    data[source] = {"error": str(e)}
        return data

    def generate_report(self, title: str, template_id: str = "",
                        report_type: str = "ad_hoc", format: str = "markdown",
                        data: Optional[Dict[str, Any]] = None,
                        sections: Optional[Dict[str, Any]] = None,
                        save_to_file: bool = True) -> Report:
        """生成报告"""
        start = time.time()
        report = Report(title, report_type, template_id, format)
        report.status = "generating"
        report.generated_by = "system"

        try:
            # 获取模板
            template = self._templates.get(template_id)
            if template:
                template.usage_count += 1
                report.sections = {s: {} for s in template.sections}
            else:
                report.sections = {"summary": {}, "details": {}}

            # 收集数据
            if data is None:
                data = self.collect_data(template.data_sources if template else None)
            report.data = data

            # 填充章节
            if sections:
                report.sections.update(sections)

            # 生成内容
            report.content = self._render_report(report, data)

            # 保存文件
            if save_to_file:
                report.file_path = self._save_report_file(report)

            report.status = "completed"
            report.generated_at = time.time()
            report.generation_time_ms = (time.time() - start) * 1000

            with self._lock:
                self._reports[report.report_id] = report
                self._save()

            terminal.success(f"报告生成完成: {title} ({report.generation_time_ms:.0f}ms)", "report")

        except Exception as e:
            report.status = "failed"
            report.error = str(e)
            report.generated_at = time.time()
            report.generation_time_ms = (time.time() - start) * 1000
            with self._lock:
                self._reports[report.report_id] = report
                self._save()
            terminal.error(f"报告生成失败: {title} - {e}", "report")

        return report

    def _render_report(self, report: Report, data: Dict[str, Any]) -> str:
        """渲染报告内容"""
        if report.format == "json":
            return json.dumps({
                "title": report.title,
                "report_type": report.report_type,
                "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "data": data,
                "sections": report.sections,
            }, ensure_ascii=False, indent=2)

        # Markdown 格式
        lines = [f"# {report.title}\n"]
        lines.append(f"**报告类型**: {report.report_type}")
        lines.append(f"**生成时间**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append("")

        for section_name, section_data in report.sections.items():
            lines.append(f"## {section_name.replace('_', ' ').title()}\n")
            if isinstance(section_data, dict):
                for key, value in section_data.items():
                    lines.append(f"- **{key}**: {value}")
            elif isinstance(section_data, list):
                for item in section_data:
                    lines.append(f"- {item}")
            elif isinstance(section_data, str):
                lines.append(section_data)
            lines.append("")

        # 数据摘要
        if data:
            lines.append("## 数据来源\n")
            for source, source_data in data.items():
                lines.append(f"### {source}\n")
                if isinstance(source_data, dict):
                    for key, value in list(source_data.items())[:10]:
                        lines.append(f"- {key}: {value}")
                lines.append("")

        return "\n".join(lines)

    def _save_report_file(self, report: Report) -> str:
        """保存报告到文件"""
        ext_map = {"json": "json", "markdown": "md", "html": "html", "text": "txt", "csv": "csv"}
        ext = ext_map.get(report.format, "txt")
        filename = f"{report.report_id}_{report.title[:30].replace(' ', '_')}.{ext}"
        file_path = os.path.join(self.reports_dir, filename)
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(report.content)
        except Exception as e:
            terminal.warn(f"保存报告文件失败: {e}", "report")
        return file_path

    def get_report(self, report_id: str) -> Optional[Report]:
        return self._reports.get(report_id)

    def list_reports(self, report_type: str = "", status: str = "",
                     limit: int = 50) -> List[Report]:
        reports = list(self._reports.values())
        if report_type:
            reports = [r for r in reports if r.report_type == report_type]
        if status:
            reports = [r for r in reports if r.status == status]
        reports.sort(key=lambda r: r.created_at, reverse=True)
        return reports[:limit]

    def delete_report(self, report_id: str) -> bool:
        with self._lock:
            report = self._reports.pop(report_id, None)
            if report:
                if report.file_path and os.path.exists(report.file_path):
                    try:
                        os.remove(report.file_path)
                    except Exception:
                        pass
                self._save()
                return True
        return False

    def schedule_report(self, title: str, template_id: str = "",
                        schedule: str = "daily",  # daily / weekly / monthly
                        format: str = "markdown") -> str:
        """定时报告"""
        schedule_id = f"sched_{uuid.uuid4().hex[:6]}"
        self._scheduled_reports.append({
            "schedule_id": schedule_id,
            "title": title,
            "template_id": template_id,
            "schedule": schedule,
            "format": format,
            "created_at": time.time(),
            "last_run": 0.0,
            "enabled": True,
        })
        terminal.info(f"定时报告已创建: {title} ({schedule})", "report")
        return schedule_id

    def get_scheduled_reports(self) -> List[Dict[str, Any]]:
        return self._scheduled_reports

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._reports)
        completed = sum(1 for r in self._reports.values() if r.status == "completed")
        failed = sum(1 for r in self._reports.values() if r.status == "failed")
        return {
            "total_reports": total,
            "completed": completed,
            "failed": failed,
            "templates": len(self._templates),
            "data_collectors": len(self._data_collectors),
            "scheduled_reports": len(self._scheduled_reports),
            "by_type": {t: sum(1 for r in self._reports.values() if r.report_type == t)
                        for t in set(r.report_type for r in self._reports.values())},
        }


import sys

# 全局报告生成器
_report_generator = ReportGenerator()


def get_report_generator() -> ReportGenerator:
    return _report_generator


def generate_report(title: str, **kwargs) -> Report:
    return _report_generator.generate_report(title, **kwargs)

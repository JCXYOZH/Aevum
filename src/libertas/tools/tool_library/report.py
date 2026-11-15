"""职责模块：report。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import re
import time
import uuid

class ToolReportGenerator:
    """工具报告生成器 - 聚合多个工具结果，生成结构化安全报告"""

    def __init__(self):
        self.report_templates = {
            "recon": self._generate_recon_report,
            "web_audit": self._generate_web_audit_report,
            "generic": self._generate_generic_report,
        }

    def generate_report(self, chain_result: Dict[str, Any],
                         report_type: str = "generic") -> Dict[str, Any]:
        """从工具链结果生成报告"""
        generator = self.report_templates.get(report_type, self._generate_generic_report)
        return generator(chain_result)

    def _generate_generic_report(self, chain_result: Dict) -> Dict:
        """生成通用报告"""
        findings = []
        for tool_name, result in chain_result.get("results", {}).items():
            if result.get("status") == "success":
                findings.append({
                    "tool": tool_name,
                    "status": "success",
                    "summary": self._extract_summary(tool_name, result),
                    "raw_output_preview": result.get("raw_output", "")[:500],
                })
            else:
                findings.append({
                    "tool": tool_name,
                    "status": result.get("status", "failed"),
                    "error": result.get("error", ""),
                })
        return {
            "report_id": f"report_{uuid.uuid4().hex[:8]}",
            "report_type": "generic",
            "generated_at": time.time(),
            "chain_id": chain_result.get("chain_id", ""),
            "summary": {
                "total_tools": chain_result.get("total_tools", 0),
                "successful": chain_result.get("success_count", 0),
                "failed": chain_result.get("failed_count", 0),
                "success_rate": chain_result.get("success_rate", 0),
                "total_duration_ms": chain_result.get("total_duration_ms", 0),
            },
            "findings": findings,
            "risk_level": self._assess_risk_level(findings),
            "recommendations": self._generate_recommendations(findings),
        }

    def _generate_recon_report(self, chain_result: Dict) -> Dict:
        """生成信息收集报告"""
        generic = self._generate_generic_report(chain_result)
        generic["report_type"] = "recon"
        # 提取目标信息
        target_info = {}
        for tool_name, result in chain_result.get("results", {}).items():
            if tool_name == "ping_host" and result.get("status") == "success":
                target_info["ping"] = self._parse_ping_output(result.get("raw_output", ""))
            elif tool_name == "whois_lookup" and result.get("status") == "success":
                target_info["whois"] = self._parse_key_value_output(result.get("raw_output", ""))
            elif tool_name == "dns_lookup" and result.get("status") == "success":
                target_info["dns"] = result.get("raw_output", "")[:1000]
            elif tool_name == "nmap_scan" and result.get("status") == "success":
                target_info["open_ports"] = self._parse_nmap_ports(result.get("raw_output", ""))
        generic["target_info"] = target_info
        return generic

    def _generate_web_audit_report(self, chain_result: Dict) -> Dict:
        """生成Web审计报告"""
        generic = self._generate_generic_report(chain_result)
        generic["report_type"] = "web_audit"
        vulnerabilities = []
        for tool_name, result in chain_result.get("results", {}).items():
            if result.get("status") != "success":
                continue
            if tool_name == "nikto_scan":
                vulns = self._parse_nikto_vulns(result.get("raw_output", ""))
                vulnerabilities.extend(vulns)
            elif tool_name == "http_headers":
                header_issues = self._check_security_headers(result.get("raw_output", ""))
                vulnerabilities.extend(header_issues)
        generic["vulnerabilities"] = vulnerabilities
        generic["vulnerability_count"] = len(vulnerabilities)
        return generic

    def _extract_summary(self, tool_name: str, result: Dict) -> str:
        """从工具结果提取摘要"""
        raw = result.get("raw_output", "")
        if not raw:
            return "无输出"
        lines = [l.strip() for l in raw.split("\n") if l.strip()]
        return "\n".join(lines[:5])

    def _assess_risk_level(self, findings: List[Dict]) -> str:
        """评估风险等级"""
        high_risk_tools = {"hydra_brute", "sqlmap_scan"}
        has_high_risk = any(f.get("tool") in high_risk_tools and f.get("status") == "success"
                           for f in findings)
        failed_count = sum(1 for f in findings if f.get("status") != "success")
        if has_high_risk:
            return "high"
        if failed_count > len(findings) * 0.5:
            return "medium"
        return "low"

    def _generate_recommendations(self, findings: List[Dict]) -> List[str]:
        """生成建议"""
        recs = []
        failed = [f for f in findings if f.get("status") != "success"]
        if failed:
            recs.append(f"{len(failed)}个工具执行失败，建议检查工具安装和网络连接")
        successful = [f for f in findings if f.get("status") == "success"]
        if len(successful) < 3:
            recs.append("成功执行的工具较少，建议增加更多信息收集工具")
        if not recs:
            recs.append("所有工具执行成功，建议人工复核结果并生成最终报告")
        return recs

    def _parse_ping_output(self, output: str) -> Dict:
        """解析ping输出"""
        result = {"reachable": False, "avg_latency": 0, "packet_loss": 0}
        if "0% packet loss" in output or "0%丢包" in output:
            result["reachable"] = True
        import re
        loss_match = re.search(r'(\d+(?:\.\d+)?)% packet loss', output)
        if loss_match:
            result["packet_loss"] = float(loss_match.group(1))
        avg_match = re.search(r'(?:avg|平均)[ =](\d+(?:\.\d+)?)', output)
        if avg_match:
            result["avg_latency"] = float(avg_match.group(1))
        return result

    def _parse_key_value_output(self, output: str) -> Dict:
        """解析键值对输出"""
        result = {}
        for line in output.split("\n"):
            if ":" in line:
                key, _, value = line.partition(":")
                result[key.strip()] = value.strip()
        return result

    def _parse_nmap_ports(self, output: str) -> List[Dict]:
        """解析nmap开放端口"""
        ports = []
        import re
        for match in re.finditer(r'(\d+)/(tcp|udp)\s+(open|filtered|closed)\s+(\S+)', output):
            ports.append({
                "port": int(match.group(1)),
                "protocol": match.group(2),
                "state": match.group(3),
                "service": match.group(4),
            })
        return ports

    def _parse_nikto_vulns(self, output: str) -> List[Dict]:
        """解析nikto漏洞"""
        vulns = []
        for line in output.split("\n"):
            if "OSVDB" in line or "vulnerability" in line.lower() or "risk" in line.lower():
                vulns.append({"source": "nikto", "description": line.strip()[:200]})
        return vulns

    def _check_security_headers(self, output: str) -> List[Dict]:
        """检查安全头配置"""
        issues = []
        required_headers = {
            "X-Frame-Options": "防止点击劫持",
            "X-Content-Type-Options": "防止MIME类型嗅探",
            "X-XSS-Protection": "XSS防护",
            "Strict-Transport-Security": "强制HTTPS",
            "Content-Security-Policy": "内容安全策略",
        }
        for header, desc in required_headers.items():
            if header.lower() not in output.lower():
                issues.append({
                    "source": "http_headers",
                    "severity": "medium",
                    "description": f"缺少安全头 {header} ({desc})",
                })
        return issues

    def export_report_markdown(self, report: Dict) -> str:
        """将报告导出为Markdown格式"""
        lines = [f"# 安全工具执行报告", ""]
        lines.append(f"**报告ID**: {report.get('report_id', '')}")
        lines.append(f"**报告类型**: {report.get('report_type', '')}")
        lines.append(f"**风险等级**: {report.get('risk_level', 'unknown')}")
        lines.append(f"**生成时间**: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(report.get('generated_at', time.time())))}")
        lines.append("")
        summary = report.get("summary", {})
        lines.append("## 执行摘要")
        lines.append(f"- 总工具数: {summary.get('total_tools', 0)}")
        lines.append(f"- 成功: {summary.get('successful', 0)}")
        lines.append(f"- 失败: {summary.get('failed', 0)}")
        lines.append(f"- 成功率: {summary.get('success_rate', 0)*100:.1f}%")
        lines.append(f"- 总耗时: {summary.get('total_duration_ms', 0):.0f}ms")
        lines.append("")
        lines.append("## 发现详情")
        for finding in report.get("findings", []):
            lines.append(f"### {finding.get('tool', '')} - {finding.get('status', '')}")
            if finding.get("summary"):
                lines.append(f"```\n{finding.get('summary', '')}\n```")
            if finding.get("error"):
                lines.append(f"**错误**: {finding.get('error', '')}")
            lines.append("")
        if report.get("recommendations"):
            lines.append("## 建议")
            for rec in report.get("recommendations", []):
                lines.append(f"- {rec}")
        return "\n".join(lines)

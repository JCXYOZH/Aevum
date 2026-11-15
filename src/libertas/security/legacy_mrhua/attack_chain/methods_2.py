"""
security/attack_chain.py - 攻击链编排器

核心能力：
- 串联信息收集→资产发现→漏洞探测→漏洞验证→利用生成→报告生成的完整攻击链路
- 支持多种预设攻击链（Web应用链、网络服务链、代码审计链、综合链）
- 自动根据目标类型选择扫描策略
- 攻击链进度追踪和中间结果保存
- 支持断点续跑
- 与四大能力（记忆/工具/代码/大脑）深度整合
"""
import os
from pathlib import Path
from datetime import datetime, date
import re
import sys
import json
import time
import uuid
import threading
from typing import Any, Dict, List, Optional, Tuple, Callable
from dataclasses import dataclass, field, asdict, is_dataclass
from enum import Enum
from collections import defaultdict


# ================================================================
# 枚举和数据结构
# ================================================================
from .chain_phase import *  # noqa: F401,F403
from .atomic_write_json import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .methods_1 import *  # noqa: F401,F403

class AttackChainOrchestratorPart2(object):
    def _phase_report(self, target: AttackTarget, config: Dict,
                      chain_result: AttackChainResult) -> Dict:
        """报告生成阶段"""
        findings = []
        output = {}

        summary = chain_result.get_summary()
        findings.append({"type": "report_summary", "summary": summary})

        # 生成Markdown报告
        report = self._generate_chain_report(chain_result)
        output["report_markdown"] = report
        output["report_length"] = len(report)

        return {"findings": findings, "vulnerabilities": [], "output": output}
    def _generate_chain_report(self, chain_result: AttackChainResult) -> str:
        """生成攻击链报告"""
        lines = []
        lines.append("# 攻击链扫描报告")
        lines.append("")
        lines.append(f"**攻击链ID**: {chain_result.chain_id}")
        lines.append(f"**攻击链名称**: {chain_result.chain_name}")
        lines.append(f"**目标**: {chain_result.target.target if chain_result.target else 'N/A'}")
        lines.append(f"**目标类型**: {chain_result.target.target_type.value if chain_result.target else 'N/A'}")
        lines.append(f"**状态**: {chain_result.status.value}")
        lines.append(f"**总耗时**: {chain_result.duration_seconds:.1f}秒")
        lines.append("")

        # 阶段概览
        lines.append("## 阶段执行概览")
        lines.append("")
        lines.append("| 阶段 | 状态 | 耗时 | 发现数 |")
        lines.append("|------|------|------|--------|")
        for phase_name, phase_result in chain_result.phases.items():
            if phase_result.status == ChainStatus.PENDING:
                continue
            lines.append(f"| {phase_name} | {phase_result.status.value} | "
                        f"{phase_result.duration_seconds:.1f}s | {len(phase_result.findings)} |")
        lines.append("")

        # 漏洞概览
        lines.append("## 漏洞概览")
        lines.append("")
        lines.append(f"**总漏洞数**: {len(chain_result.all_vulnerabilities)}")
        by_severity = defaultdict(int)
        for v in chain_result.all_vulnerabilities:
            by_severity[v.get("severity", "unknown")] += 1
        for sev in ["critical", "high", "medium", "low", "info"]:
            lines.append(f"- **{sev.upper()}**: {by_severity.get(sev, 0)}")
        lines.append("")

        # 漏洞详情
        if chain_result.all_vulnerabilities:
            lines.append("## 漏洞详情")
            lines.append("")
            for i, vuln in enumerate(chain_result.all_vulnerabilities, 1):
                lines.append(f"### {i}. [{vuln.get('severity', '').upper()}] {vuln.get('description', vuln.get('vuln_type', ''))}")
                lines.append("")
                lines.append(f"- **类型**: {vuln.get('vuln_type')}")
                lines.append(f"- **置信度**: {vuln.get('confidence')}")
                lines.append(f"- **URL**: {vuln.get('url', vuln.get('file_path', 'N/A'))}")
                if vuln.get("line_number"):
                    lines.append(f"- **行号**: {vuln['line_number']}")
                lines.append(f"- **Payload**: `{vuln.get('payload', '')[:80]}`")
                lines.append(f"- **证据**: {vuln.get('evidence', '')}")
                lines.append(f"- **修复建议**: {vuln.get('remediation', '')}")
                if vuln.get("waf_bypassed"):
                    lines.append(f"- **WAF绕过**: 是（{vuln.get('bypass_technique')}）")
                lines.append("")

        return "\n".join(lines)
    def _auto_select_template(self, target: AttackTarget) -> str:
        """根据目标类型自动选择攻击链模板"""
        if target.target_type == TargetType.WEB_APPLICATION:
            return "web"
        elif target.target_type == TargetType.NETWORK_SERVICE:
            return "network"
        elif target.target_type == TargetType.SOURCE_CODE:
            return "code"
        elif target.target_type == TargetType.API_ENDPOINT:
            return "web"
        return "quick"
    def _save_checkpoint(self, result: AttackChainResult):
        """保存检查点（失败必须可见，原来 except: pass 会让损坏静默发生）"""
        try:
            os.makedirs(self.checkpoint_dir, exist_ok=True)
            path = os.path.join(self.checkpoint_dir, f"{result.chain_id}.json")
            result.save_checkpoint(path)
        except Exception as e:
            # 记到 result 上，随作战历史一起暴露给用户，而不是吞掉
            try:
                result.errors.append("检查点保存失败: %s: %s" % (type(e).__name__, e))
            except Exception:
                pass
    def _save_to_memory(self, phase: ChainPhase, output: Dict, target: AttackTarget):
        """保存到记忆系统"""
        if not self.memory_system:
            return
        try:
            memory_content = {
                "phase": phase.value,
                "target": target.target,
                "findings_count": len(output.get("findings", [])),
                "vulns_count": len(output.get("vulnerabilities", [])),
            }
            if hasattr(self.memory_system, "add_memory"):
                self.memory_system.add_memory(
                    content=json.dumps(memory_content, ensure_ascii=False),
                    memory_type="scan_result",
                    metadata={"target": target.target, "phase": phase.value},
                )
        except Exception:
            pass
    def cancel(self):
        """取消当前攻击链"""
        self._cancelled = True
    def get_chain_history(self, limit: int = 10) -> List[Dict]:
        return [r.get_summary() for r in self.chain_history[-limit:]]
    def get_stats(self) -> Dict:
        return {
            "total_chains": len(self.chain_history),
            "completed_chains": sum(1 for r in self.chain_history if r.status == ChainStatus.COMPLETED),
            "total_vulnerabilities": sum(len(r.all_vulnerabilities) for r in self.chain_history),
            "available_modules": {
                "vuln_detector": self.vuln_detector is not None,
                "waf_bypass": self.waf_bypass is not None,
                "static_scanner": self.static_scanner is not None,
                "asset_discovery": self.asset_discovery is not None,
                "directory_bruteforcer": self.directory_bruteforcer is not None,
                "oob_detector": self.oob_detector is not None,
                "exploit_generator": self.exploit_generator is not None,
                "memory_system": self.memory_system is not None,
                "tool_library": self.tool_library is not None,
                "codebase": self.codebase is not None,
                "agent_brain": self.agent_brain is not None,
            },
            "available_templates": AttackChainTemplates.list_templates(),
        }

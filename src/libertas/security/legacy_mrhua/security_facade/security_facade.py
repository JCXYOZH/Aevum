"""
security/security_facade.py - 统一安全API入口与漏洞优先级排序

核心能力：
- VulnerabilityPrioritizer: 漏洞优先级排序器（CVSS+可利用性+影响面+资产价值）
- SecurityFacade: 统一安全API入口（一键扫描/统一结果格式/多模块协调）
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
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞优先级排序器
# ================================================================
from .models import *  # noqa: F401,F403
from .vulnerability_prioritizer import *  # noqa: F401,F403

class SecurityFacade:
    """统一安全API入口

    提供统一的安全扫描接口，自动协调多个安全模块。
    支持一键扫描、统一结果格式、多模块结果聚合。
    """

    def __init__(self, vuln_detector=None, static_scanner=None,
                 attack_chain=None, fuzzer=None, prioritizer=None,
                 cve_matcher=None, code_fix_generator=None,
                 asset_discovery=None, waf_bypass=None,
                 oob_detector=None, exploit_generator=None,
                 concurrent_scanner=None):
        self.vuln_detector = vuln_detector
        self.static_scanner = static_scanner
        self.attack_chain = attack_chain
        self.fuzzer = fuzzer
        self.prioritizer = prioritizer or VulnerabilityPrioritizer()
        self.cve_matcher = cve_matcher
        self.code_fix_generator = code_fix_generator
        self.asset_discovery = asset_discovery
        self.waf_bypass = waf_bypass
        self.oob_detector = oob_detector
        self.exploit_generator = exploit_generator
        self.concurrent_scanner = concurrent_scanner
        self.scan_history = []

    def quick_scan(self, target: str, scan_type: str = "auto") -> Dict:
        """快速扫描（一键扫描入口）"""
        start_time = time.time()
        scan_id = f"scan_{uuid.uuid4().hex[:12]}"

        result = {
            "scan_id": scan_id,
            "target": target,
            "scan_type": scan_type,
            "status": "running",
            "started_at": start_time,
            "vulnerabilities": [],
            "modules_used": [],
            "summary": {},
        }

        try:
            # 自动判断扫描类型
            if scan_type == "auto":
                scan_type = self._detect_target_type(target)
                result["scan_type"] = scan_type

            vulnerabilities = []

            if scan_type == "web":
                vulns = self._scan_web(target)
                vulnerabilities.extend(vulns)
                result["modules_used"].append("vuln_detector")
            elif scan_type == "code":
                vulns = self._scan_code(target)
                vulnerabilities.extend(vulns)
                result["modules_used"].append("static_scanner")
            elif scan_type == "network":
                vulns = self._scan_network(target)
                vulnerabilities.extend(vulns)
                result["modules_used"].append("asset_discovery")
            elif scan_type == "full":
                web_vulns = self._scan_web(target)
                code_vulns = self._scan_code(target)
                vulnerabilities.extend(web_vulns)
                vulnerabilities.extend(code_vulns)
                result["modules_used"].extend(["vuln_detector", "static_scanner"])

            # 统一归一化成 dict：各扫描模块返回的可能是 dataclass 对象，
            # 后面按 dict 取值（v.get(...)）时会炸，也会让前端拿到不可序列化的对象。
            vulnerabilities = [v.to_dict() if hasattr(v, 'to_dict') else v
                               for v in vulnerabilities]

            # 优先级排序
            if vulnerabilities and self.prioritizer:
                try:
                    ranked = self.prioritizer.prioritize(vulnerabilities)
                    result["vulnerabilities"] = [v.to_dict() if hasattr(v, 'to_dict') else v
                                                for v in ranked]
                    result["modules_used"].append("prioritizer")
                except Exception:
                    # 排序失败不影响主流程（原来会连带把整个扫描判成失败）
                    result["vulnerabilities"] = vulnerabilities
            else:
                result["vulnerabilities"] = vulnerabilities

            # 生成修复建议
            if vulnerabilities and self.code_fix_generator:
                code_vulns = [v for v in vulnerabilities
                              if isinstance(v, dict) and v.get("file_path")]
                if code_vulns:
                    fixes = self.code_fix_generator.generate_fixes_batch(code_vulns)
                    result["fix_suggestions"] = [f.to_dict() for f in fixes]
                    result["modules_used"].append("code_fix_generator")

            result["status"] = "completed"
            result["duration"] = time.time() - start_time
            result["summary"] = self._generate_summary(result["vulnerabilities"])

        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)
            result["duration"] = time.time() - start_time

        self.scan_history.append(result)
        return result

    def deep_scan(self, target: str, options: Dict = None) -> Dict:
        """深度扫描（使用攻击链编排器）"""
        if self.attack_chain:
            chain_result = self.attack_chain.run_chain(target, template="full")
            return {
                "scan_id": f"deep_{uuid.uuid4().hex[:12]}",
                "target": target,
                "type": "deep",
                "chain_result": chain_result.get_summary() if hasattr(chain_result, 'get_summary') else chain_result,
                "status": "completed",
            }
        return self.quick_scan(target, "full")

    def fuzz_scan(self, url: str, mode: str = "parameter", count: int = 50) -> Dict:
        """模糊测试扫描"""
        if self.fuzzer:
            return self.fuzzer.fuzz_target(url, mode=mode, count=count)
        return {"error": "Fuzzer not available"}

    def _detect_target_type(self, target: str) -> str:
        """自动检测目标类型"""
        if target.startswith("http://") or target.startswith("https://"):
            return "web"
        if os.path.exists(target):
            if os.path.isdir(target) or target.endswith(('.py', '.java', '.php', '.js')):
                return "code"
        if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', target):
            return "network"
        if re.match(r'^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', target):
            return "web"
        return "web"

    def _scan_web(self, target: str) -> List[Dict]:
        """Web扫描"""
        if not self.vuln_detector:
            return []
        try:
            result = self.vuln_detector.scan_url(target, deep=False)
            if hasattr(result, 'vulnerabilities'):
                return [v.to_dict() if hasattr(v, 'to_dict') else v for v in result.vulnerabilities]
            return result.get("vulnerabilities", []) if isinstance(result, dict) else []
        except Exception:
            return []

    def _scan_code(self, target: str) -> List[Dict]:
        """代码扫描"""
        if not self.static_scanner:
            return []
        try:
            if os.path.isfile(target):
                results = self.static_scanner.scan_file(target)
            elif os.path.isdir(target):
                results = self.static_scanner.scan_directory(target)
            else:
                return []
            # static_scanner 的 scan_file/scan_directory 返回的是 StaticVulnerability 对象【列表】，
            # 不是带 .vulnerabilities 属性的结果对象。原来走到最后一行会把对象列表原样返回，
            # 下游按 dict 用（v.get(...)）就抛 AttributeError，扫描结果全被丢掉。
            if hasattr(results, 'vulnerabilities'):
                raw = list(results.vulnerabilities)
            elif isinstance(results, list):
                raw = results
            else:
                raw = []
            return [v.to_dict() if hasattr(v, 'to_dict') else v for v in raw]
        except Exception:
            return []

    def _scan_network(self, target: str) -> List[Dict]:
        """网络扫描"""
        vulns = []
        if self.asset_discovery and hasattr(self.asset_discovery, 'port_scanner'):
            try:
                ports = self.asset_discovery.port_scanner.scan(target)
                for p in ports:
                    vulns.append({
                        "vuln_type": "open_port",
                        "severity": "info",
                        "port": p.port,
                        "service": p.service,
                        "banner": p.banner,
                    })
            except Exception:
                pass
        return vulns

    def _generate_summary(self, vulnerabilities: List[Dict]) -> Dict:
        """生成扫描摘要"""
        by_severity = defaultdict(int)
        by_type = defaultdict(int)
        for v in vulnerabilities:
            severity = v.get("priority_level", v.get("severity", "unknown"))
            vuln_type = v.get("original", {}).get("vuln_type", v.get("vuln_type", "unknown"))
            by_severity[severity] += 1
            by_type[vuln_type] += 1
        return {
            "total": len(vulnerabilities),
            "by_severity": dict(by_severity),
            "by_type": dict(by_type),
        }

    def get_scan_history(self, limit: int = 20) -> List[Dict]:
        """获取扫描历史"""
        return self.scan_history[-limit:]

    def get_stats(self) -> Dict:
        return {
            "total_scans": len(self.scan_history),
            "modules": {
                "vuln_detector": self.vuln_detector is not None,
                "static_scanner": self.static_scanner is not None,
                "attack_chain": self.attack_chain is not None,
                "fuzzer": self.fuzzer is not None,
                "prioritizer": self.prioritizer is not None,
                "cve_matcher": self.cve_matcher is not None,
                "code_fix_generator": self.code_fix_generator is not None,
                "asset_discovery": self.asset_discovery is not None,
                "waf_bypass": self.waf_bypass is not None,
                "oob_detector": self.oob_detector is not None,
                "exploit_generator": self.exploit_generator is not None,
                "concurrent_scanner": self.concurrent_scanner is not None,
            },
        }

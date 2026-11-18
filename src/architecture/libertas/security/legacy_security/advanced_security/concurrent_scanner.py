"""
security/advanced_security.py - 高级安全实战模块

核心能力：
- CodeFixGenerator: 漏洞修复代码自动生成器（静态扫描→自动生成修复补丁）
- CVEMatcher: CVE漏洞匹配器（根据服务版本匹配已知CVE）
- ConcurrentScanner: 并发扫描增强器（多目标/多参数并发扫描）
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
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor, as_completed


# ================================================================
# 漏洞修复代码自动生成器
# ================================================================
from .code_fix import *  # noqa: F401,F403
from .cve_match import *  # noqa: F401,F403

class ConcurrentScanner:
    """并发扫描增强器

    支持多目标、多参数、多漏洞类型的并发扫描。
    与VulnerabilityDetector和AttackChainOrchestrator集成。
    """

    def __init__(self, vuln_detector=None, max_workers: int = 5,
                 delay_between: float = 0.1):
        self.vuln_detector = vuln_detector
        self.max_workers = max_workers
        self.delay_between = delay_between
        self.scan_results = []
        self._lock = threading.RLock()

    def scan_urls_concurrent(self, urls: List[str], vuln_types: List[str] = None,
                              deep: bool = False) -> List[Dict]:
        """并发扫描多个URL"""
        if not self.vuln_detector:
            return []

        results = []

        def scan_url(url):
            time.sleep(self.delay_between)
            try:
                result = self.vuln_detector.scan_url(url, vuln_types=vuln_types, deep=deep)
                return result.get_summary()
            except Exception as e:
                return {"url": url, "error": str(e)}

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(scan_url, url): url for url in urls}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    with self._lock:
                        results.append(result)
                        self.scan_results.append(result)
                except Exception:
                    pass

        return results

    def scan_parameters_concurrent(self, url: str, parameters: List[Dict],
                                     vuln_types: List[str] = None) -> List[Dict]:
        """并发扫描同一URL的多个参数"""
        if not self.vuln_detector:
            return []

        results = []

        def scan_param(param_info):
            time.sleep(self.delay_between)
            try:
                result = self.vuln_detector.scan_parameter(
                    url=url,
                    parameter=param_info["name"],
                    location=param_info.get("location", "url_param"),
                    method=param_info.get("method", "GET"),
                    vuln_types=vuln_types,
                )
                return result.get_summary()
            except Exception as e:
                return {"parameter": param_info["name"], "error": str(e)}

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(scan_param, p): p for p in parameters}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    with self._lock:
                        results.append(result)
                except Exception:
                    pass

        return results

    def scan_multi_target_chain(self, targets: List[str], template: str = "auto",
                                  attack_chain_orchestrator=None) -> List[Dict]:
        """并发执行多目标攻击链"""
        if not attack_chain_orchestrator:
            return []

        results = []

        def run_chain(target):
            try:
                result = attack_chain_orchestrator.run_chain(target, template=template)
                return result.get_summary()
            except Exception as e:
                return {"target": target, "error": str(e)}

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(run_chain, t): t for t in targets}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    with self._lock:
                        results.append(result)
                except Exception:
                    pass

        return results

    def get_stats(self) -> Dict:
        total_vulns = sum(r.get("total_vulnerabilities", 0) for r in self.scan_results)
        return {
            "total_scans": len(self.scan_results),
            "total_vulnerabilities": total_vulns,
            "max_workers": self.max_workers,
        }

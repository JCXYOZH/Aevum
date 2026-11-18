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

def _atomic_write_json(path: str, data) -> bool:
    """先写临时文件再原子替换 —— 写失败绝不留半截文件。"""
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_json_safe(data), f, ensure_ascii=False, indent=2)
            f.flush()
            try:
                os.fsync(f.fileno())
            except Exception:
                pass
        os.replace(tmp, path)      # 同一文件系统上是原子的
        return True
    except Exception:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        raise

class AttackChainTemplates:
    """预设攻击链模板"""

    @staticmethod
    def web_application_chain() -> Dict:
        """Web应用攻击链"""
        return {
            "name": "Web应用综合攻击链",
            "description": "针对Web应用的完整攻击链路：信息收集→资产发现→目录爆破→漏洞扫描→漏洞验证→利用生成→报告",
            "phases": [
                ChainPhase.RECON,
                ChainPhase.ASSET_DISCOVERY,
                ChainPhase.VULN_SCAN,
                ChainPhase.VULN_VERIFY,
                ChainPhase.EXPLOIT_GENERATE,
                ChainPhase.REPORT,
            ],
            "vuln_types": ["sql_injection", "xss", "command_injection", "directory_traversal",
                           "ssrf", "ssti", "file_upload", "xxe", "insecure_deserialization",
                           "open_redirect", "crlf_injection"],
            "deep_scan": True,
            "verify_vulns": True,
            "concurrent": 3,
        }

    @staticmethod
    def network_service_chain() -> Dict:
        """网络服务攻击链"""
        return {
            "name": "网络服务攻击链",
            "description": "针对网络服务的攻击链路：端口扫描→服务识别→漏洞匹配→弱口令检测→报告",
            "phases": [
                ChainPhase.RECON,
                ChainPhase.VULN_SCAN,
                ChainPhase.VULN_VERIFY,
                ChainPhase.REPORT,
            ],
            "vuln_types": [],
            "port_range": "1-10000",
            "service_detection": True,
            "weak_password_check": True,
        }

    @staticmethod
    def source_code_chain() -> Dict:
        """代码审计攻击链"""
        return {
            "name": "源代码审计攻击链",
            "description": "针对源代码的审计链路：静态扫描→漏洞分析→修复建议→修复代码生成→报告",
            "phases": [
                ChainPhase.VULN_SCAN,
                ChainPhase.VULN_VERIFY,
                ChainPhase.EXPLOIT_GENERATE,
                ChainPhase.REPORT,
            ],
            "languages": ["python", "javascript", "java", "php", "c_cpp", "go", "ruby"],
            "min_severity": "medium",
            "data_flow_analysis": True,
            "generate_fixes": True,
        }

    @staticmethod
    def quick_scan_chain() -> Dict:
        """快速扫描链"""
        return {
            "name": "快速扫描链",
            "description": "快速漏洞扫描：仅扫描高危漏洞，不验证，快速出结果",
            "phases": [
                ChainPhase.VULN_SCAN,
                ChainPhase.REPORT,
            ],
            "vuln_types": ["sql_injection", "xss", "command_injection"],
            "deep_scan": False,
            "verify_vulns": False,
            "concurrent": 5,
            "timeout": 5,
        }

    @staticmethod
    def full_chain() -> Dict:
        """完整攻击链（所有阶段）"""
        return {
            "name": "完整攻击链",
            "description": "包含所有阶段的完整攻击链路",
            "phases": list(ChainPhase),
            "vuln_types": "all",
            "deep_scan": True,
            "verify_vulns": True,
            "generate_exploits": True,
            "concurrent": 3,
        }

    @classmethod
    def list_templates(cls) -> List[str]:
        return ["web_application_chain", "network_service_chain", "source_code_chain",
                "quick_scan_chain", "full_chain"]

    @classmethod
    def get_template(cls, name: str) -> Optional[Dict]:
        templates = {
            "web": cls.web_application_chain,
            "web_application": cls.web_application_chain,
            "network": cls.network_service_chain,
            "network_service": cls.network_service_chain,
            "code": cls.source_code_chain,
            "source_code": cls.source_code_chain,
            "quick": cls.quick_scan_chain,
            "quick_scan": cls.quick_scan_chain,
            "full": cls.full_chain,
            "full_chain": cls.full_chain,
        }
        fn = templates.get(name.lower())
        return fn() if fn else None

"""工具治理模块（ToolGovernance）

四大能力：
1. 操作许可边界 —— 明确模型可以调用哪些工具、不可以调用哪些工具、什么条件下可以执行
2. 执行确认机制 —— 模型在执行操作前获得用户明确授权，而不是自动执行
3. 操作记录与追溯 —— 每一次操作都被记录和存储，随时查看和审计
4. 错误处理与回退 —— 工具失败时识别错误并选择处理策略，不停留在失败状态

工具风险分级：
- safe:    只读、无副作用（DNS查询、WHOIS、HTTP头检查、SSL信息、编码解码）
- low:     轻度主动探测（Ping、端口扫描、HTTP指纹、子域名枚举）
- medium:  目录爆破、漏洞扫描、爬虫（可能触发目标告警）
- high:    暴力破解、攻击利用、哈希破解（需要明确授权）
- dangerous: 可能造成破坏的操作（默认禁止）
"""

from __future__ import annotations

import os
import json
import time
import uuid
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)

from .catalog_data import CATEGORY_DEFAULT_RISK, EXTERNAL_TOOL_RISK, NATIVE_TOOL_REGISTRY, PLUGIN_REGISTRY
from .constants import WSL_SECURITY_TOOLS, WSL_TOOL_RISK
from .models import PendingApproval, RiskLevel, ToolCallRecord


class GovernanceConfigMixin:
    """治理配置加载、覆盖、保存与重置。"""

    def _config_file(self) -> str:
        return os.path.join(self._data_dir, "tool_governance.json")

    def _load_config(self):
        try:
            if os.path.exists(self._config_file()):
                with open(self._config_file(), "r", encoding="utf-8") as f:
                    saved = json.load(f)
                self._config.update(saved)
        except Exception as e:
            logger.warning(f"加载工具治理配置失败: {e}")

    def _apply_yaml_overrides(self):
        """从 config.yaml 的 `tool_governance` 段读取授权策略（可选）。
    
        优先级：代码默认 < config.yaml < 数据目录的 tool_governance.json（界面保存的）。
        目的是「想放开或收紧工具授权，改配置文件就行，不用改代码」。
    
        支持的核心键：
          auto_approve_max_risk / model_visible_max_risk: safe|low|medium|high|dangerous
          require_approval_risks / blocked_risks: 列表或逗号分隔字符串
          enabled_types / enabled_categories / approval_wait_seconds …
        """
        try:
            from libertas.foundation.config import config as _cfg
            section = _cfg.get("tool_governance", {}) or {}
        except Exception:
            return
        if not isinstance(section, dict):
            return
        alias = {"auto": "auto_approve_max_risk", "visible": "model_visible_max_risk"}
        for key, value in section.items():
            k = alias.get(key, key)
            if k not in self._config:
                continue
            try:
                if k in ("auto_approve_max_risk", "model_visible_max_risk") and isinstance(value, str):
                    value = value.strip().lower()
                elif k in ("require_approval_risks", "blocked_risks"):
                    if isinstance(value, str):
                        value = [x.strip().lower() for x in value.split(",") if x.strip()]
                self._config[k] = value
            except Exception:
                continue

    def _save_config(self):
        try:
            os.makedirs(self._data_dir, exist_ok=True)
            with open(self._config_file(), "w", encoding="utf-8") as f:
                json.dump(self._config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"保存工具治理配置失败: {e}")

    def get_config(self) -> Dict:
        with self._lock:
            cfg = dict(self._config)
            # 确保RiskLevel枚举转为字符串
            for k, v in cfg.items():
                if isinstance(v, RiskLevel):
                    cfg[k] = v.value
                elif isinstance(v, list):
                    cfg[k] = [x.value if isinstance(x, RiskLevel) else x for x in v]
            return cfg

    def update_config(self, updates: Dict) -> Dict:
        with self._lock:
            for k, v in updates.items():
                if k in self._config:
                    self._config[k] = v
            self._save_config()
            return {"success": True, "config": dict(self._config)}

    def reset_to_defaults(self) -> Dict:
        """重置所有治理配置为默认值"""
        with self._lock:
            self._config = {
                "enabled": True,
                "auto_approve_max_risk": RiskLevel.HIGH,
                "model_visible_max_risk": RiskLevel.HIGH,
                "require_approval_risks": [RiskLevel.DANGEROUS],
                "blocked_risks": [],
                "tool_whitelist": [],
                "tool_blacklist": [],
                "enabled_categories": {
                    "信息收集": True, "扫描爆破": True, "编码解码": True,
                    "网络工具": True, "外部工具": True, "插件工具": True,
                    "字典资源": True, "工具管理": True,
                },
                "enabled_types": {
                    "web": True, "native": True, "external": True,
                    "plugin": True, "wordlist": True, "installable": True,
                },
                "model_can_call_tools": True,
                "show_tool_status": True,
                "log_params": True,
                "approval_wait_seconds": 8,
                "fallback_strategy": "retry_then_alternate",
                "max_retries": 2,
                "audit_enabled": True,
                "audit_retention_days": 30,
            }
            self._save_config()
            return {"success": True, "message": "工具治理已恢复默认"}

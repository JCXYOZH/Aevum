"""职责模块：templates。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, Union
import json
import os
import time
import uuid

class ToolTemplateManager:
    """工具模板管理器 - 保存和复用常用工具组合和参数配置"""

    def __init__(self, storage_dir: str = "tool_templates"):
        self.storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
        self.templates: Dict[str, Dict[str, Any]] = {}
        self._load_builtin_templates()

    def _load_builtin_templates(self):
        """加载内置模板"""
        self.templates["quick_recon"] = {
            "name": "快速信息收集",
            "description": "快速收集目标基本信息",
            "tools": ["ping_host", "whois_lookup", "dns_lookup", "nmap_scan"],
            "default_params": {
                "nmap_scan": {"ports": "1-1000", "scan_type": "syn"},
            },
            "risk_level": "low_risk",
            "estimated_time": "1-3分钟",
        }
        self.templates["full_recon"] = {
            "name": "全面信息收集",
            "description": "全面收集目标信息，包括子域名和目录",
            "tools": ["ping_host", "whois_lookup", "dns_lookup", "subfinder_enum",
                      "http_headers", "nmap_scan", "dirb_scan"],
            "default_params": {
                "nmap_scan": {"ports": "1-65535", "scan_type": "syn"},
                "dirb_scan": {"extensions": "php,asp,aspx,txt,bak"},
            },
            "risk_level": "medium_risk",
            "estimated_time": "10-30分钟",
        }
        self.templates["web_audit"] = {
            "name": "Web安全审计",
            "description": "Web应用安全审计标准流程",
            "tools": ["http_headers", "nikto_scan", "dirb_scan", "nmap_scan"],
            "default_params": {
                "nmap_scan": {"ports": "80,443,8080,8443"},
            },
            "risk_level": "medium_risk",
            "estimated_time": "5-15分钟",
        }

    def create_template(self, name: str, description: str, tools: List[str],
                        default_params: Dict = None, risk_level: str = "low_risk",
                        estimated_time: str = "") -> Dict[str, Any]:
        """创建自定义模板"""
        template_id = f"tpl_{uuid.uuid4().hex[:8]}"
        template = {
            "template_id": template_id,
            "name": name,
            "description": description,
            "tools": tools,
            "default_params": default_params or {},
            "risk_level": risk_level,
            "estimated_time": estimated_time,
            "created_at": time.time(),
            "custom": True,
        }
        self.templates[template_id] = template
        self._save_template(template)
        return template

    def get_template(self, template_id: str) -> Optional[Dict]:
        """获取模板"""
        return self.templates.get(template_id)

    def list_templates(self, risk_level: str = "") -> List[Dict]:
        """列出所有模板"""
        templates = list(self.templates.values())
        if risk_level:
            templates = [t for t in templates if t.get("risk_level") == risk_level]
        return templates

    def delete_template(self, template_id: str) -> bool:
        """删除模板"""
        if template_id in self.templates and self.templates[template_id].get("custom"):
            del self.templates[template_id]
            path = os.path.join(self.storage_dir, f"{template_id}.json")
            if os.path.exists(path):
                os.remove(path)
            return True
        return False

    def apply_template(self, template_id: str, target: str = "",
                       extra_params: Dict = None) -> Dict[str, Any]:
        """应用模板，返回工具列表和参数（可直接传给ToolChainExecutor）"""
        template = self.get_template(template_id)
        if not template:
            return {"success": False, "error": "模板不存在"}
        tools = template["tools"]
        params = dict(template.get("default_params", {}))
        # 注入目标
        if target:
            for tool in tools:
                if tool not in params:
                    params[tool] = {}
                for key in ("target", "domain", "url", "host"):
                    if key not in params[tool]:
                        params[tool][key] = target
        # 合并额外参数
        if extra_params:
            for tool, tool_params in extra_params.items():
                if tool in params:
                    params[tool].update(tool_params)
                else:
                    params[tool] = tool_params
        return {
            "success": True,
            "template_name": template["name"],
            "tools": tools,
            "parameters": params,
            "risk_level": template.get("risk_level", "low_risk"),
            "estimated_time": template.get("estimated_time", ""),
        }

    def _save_template(self, template: Dict):
        """保存模板到磁盘"""
        path = os.path.join(self.storage_dir, f"{template['template_id']}.json")
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(template, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

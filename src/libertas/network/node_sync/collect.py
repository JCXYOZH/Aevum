"""
远程节点同步

结合0.1.5版本的实际同步功能和现在版本的抽象设计：
- 与广域网（WAN）集成，支持节点间数据同步
- 支持推送（push）、拉取（pull）、接收（receive）数据
- 支持变更预览、备份、回滚
- 支持多种数据类型：配置、字典、规则、工作流、记忆、工具
- SyncItem 抽象和冲突检测/解决
- 节点状态管理和统计监控
"""
import os
import json
import time
import uuid
import hashlib
import shutil
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .constants import MAX_PUSH_BYTES, MAX_FILE_BYTES, _project_root, _resolve_config_paths, _find_wordlist_dirs, _format_size
from .models import NodeSyncStatus, SyncItem


class NodeSyncCollectMixin:
    """配置、字典、规则、工作流、记忆的采集与应用。"""

    def _collect_data(self, data_type: str, file_name: str = "") -> Dict:
        """收集指定类型的数据"""
        if data_type == "tool_config":
            return self._collect_config()
        elif data_type == "wordlists":
            return self._collect_wordlists(file_name)
        elif data_type == "rules":
            return self._collect_rules(file_name)
        elif data_type == "workflows":
            return self._collect_workflows()
        elif data_type == "memory":
            return self._collect_memory()
        else:
            return {"success": False, "error": f"不支持的数据类型: {data_type}"}

    def _collect_config(self) -> Dict:
        """收集配置文件内容"""
        for cp in _resolve_config_paths():
            if os.path.isfile(cp):
                try:
                    with open(cp, "r", encoding="utf-8") as f:
                        content = f.read()
                    return {"success": True, "content": content,
                            "file_name": "config.yaml",
                            "message": "已收集配置文件"}
                except Exception as e:
                    return {"success": False, "error": f"读取配置失败: {e}"}
        return {"success": False, "error": "未找到 config.yaml"}

    def _collect_wordlists(self, file_name: str = "") -> Dict:
        """收集字典文件内容"""
        if not file_name:
            return {"success": False, "error": "请指定要推送的字典文件名"}
        for d in _find_wordlist_dirs():
            for root, _dirs, files in os.walk(d):
                if file_name in files:
                    fp = os.path.join(root, file_name)
                    try:
                        sz = os.path.getsize(fp)
                        if sz > MAX_FILE_BYTES:
                            return {"success": False, "error": f"文件太大（{sz}字节），请选择较小的文件"}
                        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        return {"success": True, "content": content,
                                "file_name": file_name,
                                "message": f"已收集字典: {file_name}"}
                    except Exception as e:
                        return {"success": False, "error": f"读取字典失败: {e}"}
        return {"success": False, "error": f"未找到字典文件: {file_name}"}

    def _collect_rules(self, file_name: str = "") -> Dict:
        """收集规则文件内容"""
        if not file_name:
            return {"success": False, "error": "请指定要推送的规则文件名"}
        rules_dir = os.path.join(self.data_dir, "rules")
        fp = os.path.join(rules_dir, file_name)
        if not os.path.isfile(fp):
            return {"success": False, "error": f"未找到规则文件: {file_name}"}
        try:
            sz = os.path.getsize(fp)
            if sz > MAX_FILE_BYTES:
                return {"success": False, "error": f"文件太大（{sz}字节）"}
            with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            return {"success": True, "content": content,
                    "file_name": file_name,
                    "message": f"已收集规则: {file_name}"}
        except Exception as e:
            return {"success": False, "error": f"读取规则失败: {e}"}

    def _collect_workflows(self) -> Dict:
        """收集所有工作流"""
        wf_dir = os.path.join(self.data_dir, "workflows")
        if not os.path.isdir(wf_dir):
            return {"success": False, "error": "工作流目录不存在"}
        workflows = []
        for fn in os.listdir(wf_dir):
            if fn.endswith(".json"):
                try:
                    with open(os.path.join(wf_dir, fn), "r", encoding="utf-8") as f:
                        workflows.append(json.load(f))
                except Exception:
                    pass
        return {"success": True, "content": workflows,
                "file_name": "",
                "message": f"已收集 {len(workflows)} 个工作流"}

    def _collect_memory(self) -> Dict:
        """收集记忆摘要（不收集完整内容，保护隐私）"""
        mem_dir = os.path.join(self.data_dir, "MemorySystem", "记忆河流")
        if not os.path.isdir(mem_dir):
            return {"success": False, "error": "记忆目录不存在"}
        memories = []
        for fn in os.listdir(mem_dir):
            if fn.endswith(".json"):
                try:
                    with open(os.path.join(mem_dir, fn), "r", encoding="utf-8") as f:
                        mem = json.load(f)
                    # 只收集摘要，不收集完整内容
                    memories.append({
                        "memory_id": mem.get("memory_id", fn.replace(".json", "")),
                        "memory_type": mem.get("memory_type", mem.get("类型", "")),
                        "tags": mem.get("tags", mem.get("主题标签", [])),
                        "created_at": mem.get("created_at", mem.get("时间", "")),
                        "content_preview": str(mem.get("content", mem.get("内容", "")))[:100],
                    })
                except Exception:
                    pass
        return {"success": True, "content": memories,
                "file_name": "",
                "message": f"已收集 {len(memories)} 条记忆摘要"}

    def _apply_tool_config(self, content: str) -> Dict:
        """应用工具配置（写入 config.yaml）"""
        try:
            config_path = os.path.join(self.data_dir, "config.yaml")
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            with open(config_path, "w", encoding="utf-8") as f:
                f.write(content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, indent=2))
            return {"success": True, "message": "配置已应用，重启后生效"}
        except Exception as e:
            return {"success": False, "error": f"应用配置失败: {e}"}

    def _apply_wordlist(self, data, file_name: str) -> Dict:
        """应用字典文件"""
        try:
            safe_name = os.path.basename(file_name) if file_name else f"wordlist_{int(time.time())}.txt"
            target_dir = os.path.join(self.data_dir, "wordlists")
            os.makedirs(target_dir, exist_ok=True)
            fp = os.path.join(target_dir, safe_name)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False))
            return {"success": True, "message": f"字典已保存: {safe_name}", "path": fp}
        except Exception as e:
            return {"success": False, "error": f"保存字典失败: {e}"}

    def _apply_rule(self, data, file_name: str) -> Dict:
        """应用规则文件"""
        try:
            safe_name = os.path.basename(file_name) if file_name else f"rule_{int(time.time())}.rules"
            target_dir = os.path.join(self.data_dir, "rules")
            os.makedirs(target_dir, exist_ok=True)
            fp = os.path.join(target_dir, safe_name)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False))
            return {"success": True, "message": f"规则已保存: {safe_name}", "path": fp}
        except Exception as e:
            return {"success": False, "error": f"保存规则失败: {e}"}

    def _apply_workflows(self, workflows: List) -> Dict:
        """应用工作流列表"""
        try:
            wf_dir = os.path.join(self.data_dir, "workflows")
            os.makedirs(wf_dir, exist_ok=True)
            applied = 0
            skipped = 0
            for wf in workflows:
                wf_id = wf.get("id", "")
                if not wf_id:
                    continue
                fp = os.path.join(wf_dir, f"{wf_id}.json")
                if os.path.isfile(fp):
                    skipped += 1
                    continue
                with open(fp, "w", encoding="utf-8") as f:
                    json.dump(wf, f, ensure_ascii=False, indent=2)
                applied += 1
            return {"success": True, "message": f"工作流已应用: 新增{applied}个, 跳过{skipped}个"}
        except Exception as e:
            return {"success": False, "error": f"应用工作流失败: {e}"}

    def _apply_memory(self, data) -> Dict:
        """应用记忆（只导入摘要，不覆盖现有记忆）"""
        try:
            # 记忆同步比较复杂，这里只记录日志，实际导入需要用户确认
            return {"success": True, "message": "记忆摘要已接收，完整记忆导入需要用户确认"}
        except Exception as e:
            return {"success": False, "error": f"应用记忆失败: {e}"}

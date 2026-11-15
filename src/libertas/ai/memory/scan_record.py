"""
core/memory.py - 记忆系统（优化版）

融合两个版本的优点：
- 保留当前版本的Memory类（遗忘曲线+强度计算+6种记忆类型）
- 吸收0.1.5版本的丰富功能（哈希管理+向量索引+扫描记忆+混合检索+记忆网络+完整性验证+自动提取+系统管理）
- 短期记忆（对话上下文）、长期记忆（事实/偏好/经历）、记忆检索、遗忘曲线、记忆整合
"""
import os
import re
import json
import time
import uuid
import math
import hashlib
import shutil
import threading
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta
from enum import Enum
from libertas.foundation.config import get_data_dir

# 可选依赖
try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import jieba
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False

# 日志记录器
import logging
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

from .models import HAS_JIEBA, HAS_NUMPY, LibertasHashManager, Memory, MemoryType, SimpleVectorizer, _coerce_timestamp


class MemoryScanRecordMixin:
    """扫描记忆、扫描内容生成与漏洞记忆写入。"""

    def record_scan_memory(self, target: str, scan_type: str, content: str,
                           raw_output: str, extra: Dict = None) -> str:
        """
        记录安全扫描结果到专用目录，并更新扫描索引（优化版：支持任意工具类型）
        强制在内容中插入 [scan_type] 确保工具名可被检索。
        不再固定工具类型，支持任意 scan_type。
        """
        with self._lock:
            # 1. 如果未提供 content，自动生成（支持任意工具类型）
            if not content:
                content = self._generate_scan_content(target, scan_type, raw_output)
    
            # 2. 强制插入工具名标记（确保任何内容都包含 scan_type）
            if scan_type not in content:
                content = f"[{scan_type}] {content}"
    
            # 3. 构建上下文
            context = {
                "target": target,
                "scan_type": scan_type,
                "raw_output": raw_output[:5000] if raw_output else "",
                **(extra or {})
            }
    
            # 4. 记录到记忆系统
            tag = self.record_memory(
                content=content,
                memory_type="安全扫描",
                emotional_color="中性",
                context_description=f"{scan_type} - {target}",
                context=context
            )
    
            # 5. 移动到扫描专用目录
            if tag:
                src = os.path.join(self.MemoryRiverDirectory, f"{tag}.json")
                dst = os.path.join(self.ScanMemoryDirectory, f"{tag}.json")
                if os.path.exists(src):
                    try:
                        shutil.move(src, dst)
                    except Exception:
                        # 如果移动失败，复制然后删除
                        try:
                            shutil.copy2(src, dst)
                            os.remove(src)
                        except Exception:
                            pass
                # 保留在全局索引中（确保扫描记忆也能被全局检索到）
                # 同时更新缓存（因为文件已经移动到扫描记忆目录）
                if tag in self.MemoryCache:
                    # 更新缓存中的文件路径信息
                    self.MemoryCache[tag]["_scan_memory"] = True
                # 系统状态不减（扫描记忆也是记忆的一部分）
                self._save_system_state()
                # 更新扫描索引
                self.ScanIndex[target].append(tag)
                if scan_type not in self.ScanIndex:
                    self.ScanIndex[scan_type] = []
                if tag not in self.ScanIndex[scan_type]:
                    self.ScanIndex[scan_type].append(tag)
                self._save_scan_index()
    
                # 6. 立即更新扫描向量索引（确保新扫描记忆进索引）
                self._add_scan_vector(tag, content)
    
            # 7. 更新元数据
            self.SystemMetadata["total_scan_memories"] = len(self._get_scan_memory_files())
            self._save_system_metadata()
    
            return tag

    def _generate_scan_content(self, target: str, scan_type: str, raw_output: str) -> str:
        """
        自动生成扫描内容（优化版：支持任意工具类型，不固定工具）
        根据 scan_type 和 raw_output 智能生成内容描述。
        """
        content = ""
        scan_type_lower = scan_type.lower()
    
        # 通用模式：根据关键词识别扫描类型
        # 端口扫描类
        if any(kw in scan_type_lower for kw in ["port", "端口", "nmap", "masscan", "rustscan", "scan"]):
            ports = re.findall(r'(\d+)/tcp\s+open', raw_output or "")
            if ports:
                port_str = ", ".join(ports)
                content = f"端口扫描 - 目标 {target}，开放端口: {port_str}"
            else:
                content = f"端口扫描 - 目标 {target}"
    
        # HTTP/Web 扫描类
        elif any(kw in scan_type_lower for kw in ["http", "web", "url", "目录", "dir", "fuzz", "ffuf", "gobuster", "dirb"]):
            status_match = re.search(r'→ (\d{3})', raw_output or "")
            if status_match:
                status = status_match.group(1)
                content = f"HTTP请求 - 目标 {target}，状态码 {status}"
            else:
                content = f"HTTP/Web扫描 - 目标 {target}"
    
        # 漏洞扫描类
        elif any(kw in scan_type_lower for kw in ["vuln", "漏洞", "xray", "nuclei", "nikto", "wapiti", "trivy", "lynis"]):
            content = f"漏洞扫描 - 目标 {target}，工具: {scan_type}"
    
        # 服务识别类
        elif any(kw in scan_type_lower for kw in ["service", "服务", "banner", "指纹", "fingerprint", "whatweb"]):
            content = f"服务识别 - 目标 {target}"
    
        # 子域名/域名枚举类
        elif any(kw in scan_type_lower for kw in ["subdomain", "子域名", "域名", "dns", "subfinder", "amass", "sublist3r"]):
            content = f"子域名枚举 - 目标 {target}"
    
        # 爆破/弱口令类
        elif any(kw in scan_type_lower for kw in ["brute", "爆破", "hydra", "medusa", "ncrack", "john", "hashcat"]):
            content = f"爆破测试 - 目标 {target}，工具: {scan_type}"
    
        # 漏洞利用类
        elif any(kw in scan_type_lower for kw in ["exploit", "利用", "metasploit", "msf", "sqlmap", "cve"]):
            content = f"漏洞利用 - 目标 {target}，工具: {scan_type}"
    
        # 网络探测类
        elif any(kw in scan_type_lower for kw in ["ping", "traceroute", "netstat", "网络", "discover", "host"]):
            content = f"网络探测 - 目标 {target}"
    
        # 其他任意工具类型（通用处理）
        else:
            content = f"{scan_type} - 目标 {target}"
    
        # 添加原始输出预览
        if raw_output:
            preview = raw_output.replace('\n', ' ')[:200]
            content += f"：{preview}"
    
        return content

    def write_vulnerability_memory(self, core_data: Dict, detection_result: Dict) -> str:
        """
        写入漏洞记忆，并自动生成精准的主题标签（吸收0.1.5，完整实现）
        """
        # 1. 构建详细的记忆内容（吸收0.1.5）
        content = (
            f"漏洞目标: {core_data.get('target', '')}\n"
            f"漏洞类型: {', '.join(core_data.get('vulnerability_types', core_data.get('vuln_type', [])))}\n"
            f"核心特征: {', '.join(core_data.get('core_features', []))}\n"
            f"检测详情: {detection_result.get('vulnerability_detail', {}).get('detail', '')}"
        )
        # 2. 使用 record_memory 存储，类型标记为"漏洞"（吸收0.1.5）
        context = {
            "漏洞核心数据": core_data,
            "检测结果": detection_result,
        }
        tag = self.record_memory(
            content=content,
            memory_type="漏洞",
            emotional_color="中性",
            context_description=detection_result.get("tool", "手动录入"),
            context=context,
            associated_memories=None,
        )
        if not tag:
            return tag
        # 3. 读取刚保存的记忆，更新主题标签（吸收0.1.5）
        mem = self.read_memory(tag)
        if not mem:
            return tag
        # ========== 生成精准标签 ==========
        new_tags = set(mem.get("tags", mem.get("tags", [])))  # 保留原有标签
        # 1. 基础标签
        new_tags.add("漏洞")
        new_tags.add("扫描")
        # 2. 工具标签
        tool = detection_result.get("tool", "")
        if tool:
            new_tags.add(tool.lower())
        # 3. 目标 IP/域名/URL
        target = core_data.get("target", "")
        if target:
            new_tags.add(target)
            # 提取可能的端口（例如 "192.168.1.1:8080" 或 "http://example.com:443"）
            port_match = re.search(r':(\d+)', target)
            if port_match:
                new_tags.add(f"端口{port_match.group(1)}")
        # 4. 漏洞类型
        vuln_types = core_data.get("vulnerability_types", core_data.get("vuln_type", []))
        if isinstance(vuln_types, str):
            vuln_types = [vuln_types]
        for vuln_type in vuln_types:
            if vuln_type:
                new_tags.add(vuln_type)
        # 5. 核心特征（如 "SQL注入"、"XSS"）
        for feature in core_data.get("core_features", []):
            if feature:
                new_tags.add(feature)
        # 更新记忆的主题标签
        mem["tags"] = list(new_tags)
        mem["tags"] = list(new_tags)
        # 4. 写回文件（吸收0.1.5）
        file_path = os.path.join(self.MemoryRiverDirectory, f"{tag}.json")
        if not os.path.exists(file_path):
            file_path = os.path.join(self.MemoryRiverDirectory, tag)
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(mem, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[WARN] 写回漏洞记忆文件失败: {e}")
        # 5. 更新缓存和索引（重要！吸收0.1.5）
        self.MemoryCache[tag] = mem
        # 重新建立该记忆的索引（先移除旧索引，再添加新索引）
        self._remove_from_index(tag, silent=True)
        self._index_memory(tag, mem)
        return tag

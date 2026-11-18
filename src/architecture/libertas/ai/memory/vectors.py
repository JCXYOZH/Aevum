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


class MemoryVectorMixin:
    """向量检索、高质量检索与扫描记忆检索。"""

    def vector_search_scan(self, query: str, top_k: int = 5,
                           similarity_threshold: float = 0.3) -> List[Dict]:
        """
        向量搜索扫描（吸收0.1.5，完整实现）
        基于 TagVectorizer 的向量相似度检索，并集成语义扩展。
        similarity_threshold: 低于此值的将被过滤，若结果为空则自动回退到关键词检索。
        """
        if not self.scan_vectors and not self._scan_vector_built:
            self._build_scan_vector_index()
        if not self.scan_vectors or not self._vectorizer_fitted:
            # 降级为关键词搜索
            return self.search_scan_memories_keyword(query, limit=top_k)
    
        # ----- 语义扩展（吸收0.1.5，50+工具名的同义词扩展）-----
        expansion_map = {
            "nmap": ["nmap", "端口扫描", "端口", "扫描", "port", "scan"],
            "masscan": ["masscan", "快速端口扫描", "端口", "扫描"],
            "rustscan": ["rustscan", "端口扫描", "扫描"],
            "subfinder": ["subfinder", "子域名", "域名", "subdomain", "dns"],
            "amass": ["amass", "子域名", "域名", "enum"],
            "ffuf": ["ffuf", "目录爆破", "dir", "web", "fuzz"],
            "gobuster": ["gobuster", "目录爆破", "dir", "web"],
            "hydra": ["hydra", "爆破", "brute", "password"],
            "medusa": ["medusa", "爆破", "brute"],
            "ncrack": ["ncrack", "爆破", "brute"],
            "xray": ["xray", "漏洞", "vuln", "web", "scan"],
            "nuclei": ["nuclei", "漏洞", "vuln", "cve", "scan"],
            "sqlmap": ["sqlmap", "sql注入", "注入", "sqli"],
            "trivy": ["trivy", "容器", "漏洞", "vuln", "k8s"],
            "whatweb": ["whatweb", "web指纹", "指纹", "fingerprint"],
            "wpscan": ["wpscan", "wordpress", "wp", "漏洞"],
            "metasploit": ["metasploit", "msf", "漏洞利用", "exploit"],
            "searchsploit": ["searchsploit", "漏洞", "exploit", "cve"],
            "nikto": ["nikto", "web扫描", "漏洞", "vuln"],
            "wafw00f": ["wafw00f", "waf", "防火墙", "fingerprint"],
            "cve-bin-tool": ["cve-bin-tool", "cve", "漏洞", "vuln"],
            "clamav": ["clamav", "病毒", "恶意软件", "scan"],
            "lynis": ["lynis", "系统审计", "安全", "audit"],
            "kube-bench": ["kube-bench", "k8s", "kubernetes", "安全", "audit"],
            "wapiti3": ["wapiti3", "web漏洞", "扫描", "vuln"],
            "kube-hunter": ["kube-hunter", "k8s", "kubernetes", "渗透", "pentest"],
            "bettercap": ["bettercap", "中间人", "嗅探", "mitm", "sniff"],
            "ettercap": ["ettercap", "中间人", "嗅探", "mitm", "sniff"],
            "impacket": ["impacket", "smb", "网络", "协议", "enum"],
            "tshark": ["tshark", "wireshark", "流量", "分析", "pcap"],
            "zeek": ["zeek", "bro", "流量", "分析", "ids"],
            "snort": ["snort", "ids", "入侵检测", "流量"],
            "volatility3": ["volatility3", "内存取证", "forensic", "memory"],
            "sleuthkit": ["sleuthkit", "磁盘取证", "forensic", "disk"],
            "aircrack-ng": ["aircrack-ng", "wifi", "无线", "破解", "crack"],
            "reaver": ["reaver", "wps", "wifi", "破解"],
            "john": ["john", "john the ripper", "密码破解", "crack"],
            "hashcat": ["hashcat", "密码破解", "crack", "gpu"],
            "gitleaks": ["gitleaks", "git", "密钥泄露", "secret"],
            "trufflehog": ["trufflehog", "git", "密钥泄露", "secret"],
            "jwt_tool": ["jwt_tool", "jwt", "token", "安全"],
            "dnsx": ["dnsx", "dns", "查询", "record"],
            "shuffledns": ["shuffledns", "dns", "枚举", "enum"],
            "massdns": ["massdns", "dns", "解析", "bulk"],
            "sublist3r": ["sublist3r", "子域名", "enum"],
            "dnsenum": ["dnsenum", "dns", "枚举", "enum"],
            "dnsmap": ["dnsmap", "dns", "枚举", "enum"],
            "socat": ["socat", "网络", "连接", "proxy"],
            "joomscan": ["joomscan", "joomla", "漏洞", "scan"],
            "droopescan": ["droopescan", "drupal", "漏洞", "scan"],
            "postman": ["postman", "api", "测试", "collection"],
            "newman": ["newman", "api", "测试", "collection"],
            "burp": ["burp", "burpsuite", "代理", "web", "proxy"],
            "docker-bench": ["docker-bench", "docker", "安全", "audit"],
            "find-rshell": ["find-rshell", "反向shell", "检测", "shell"],
            "vuln-update": ["vuln-update", "漏洞库", "更新", "update"],
            "radare2": ["radare2", "逆向", "反汇编", "disassemble"],
            "rizin": ["rizin", "逆向", "反汇编", "disassemble"],
            "binwalk": ["binwalk", "固件", "提取", "firmware"],
        }
    
        # 分词并扩展
        if HAS_JIEBA:
            q_words = list(jieba.cut(query))
        else:
            q_words = list(query)
        expanded_words = set(q_words)
        for word in q_words:
            # 尝试精确匹配
            if word in expansion_map:
                expanded_words.update(expansion_map[word])
            # 也尝试小写匹配
            lower_word = word.lower()
            for key, vals in expansion_map.items():
                if lower_word in vals:
                    expanded_words.update(vals)
                    expanded_words.add(key)
    
        # 向量化
        expanded_query = " ".join(expanded_words)
        query_vector = self.tag_vectorizer.transform(expanded_query)
        if not query_vector:
            query_vector = self.tag_vectorizer.transform(query)
        if not query_vector:
            return []
    
        # 计算相似度
        results = []
        for tag, vector in self.scan_vectors.items():
            similarity = SimpleVectorizer.cosine_similarity(query_vector, vector)
            if similarity >= similarity_threshold:
                mem = self._read_scan_memory(tag)
                if mem:
                    results.append({**mem, "similarity": round(similarity, 4)})
    
        # 过滤低于阈值的结果，结果为空自动回退到关键词检索
        if not results:
            return self.search_scan_memories_keyword(query, limit=top_k)
    
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    def vector_search_river(self, query: str, top_k: int = 5,
                            similarity_threshold: float = 0.2) -> List[Dict]:
        """
        向量搜索记忆河流
        基于 TagVectorizer 的向量相似度检索记忆河流中的长期记忆。
        similarity_threshold: 低于此值的将被过滤，若结果为空则自动回退到关键词检索。
        """
        if not self.river_vectors and not self._river_vector_built:
            self._build_river_vector_index()
        if not self.river_vectors or not self._vectorizer_fitted:
            # 降级为关键词搜索
            return self.retrieve(query, limit=top_k)
    
        # 向量化查询
        query_vector = self.tag_vectorizer.transform(query)
        if not query_vector:
            return self.retrieve(query, limit=top_k)
    
        # 计算相似度
        results = []
        for mem_id, vector in self.river_vectors.items():
            similarity = SimpleVectorizer.cosine_similarity(query_vector, vector)
            if similarity >= similarity_threshold:
                mem = self._long_term.get(mem_id)
                if mem:
                    results.append({
                        **mem.to_dict(),
                        "memory_id": mem_id,
                        "similarity": round(similarity, 4),
                        "source": "river_semantic"
                    })
    
        # 结果为空自动回退到关键词检索
        if not results:
            return self.retrieve(query, limit=top_k)
    
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]

    def high_quality_search(self, keyword: str = "", quantity: int = 5,
                            emotional_type: str = None,
                            minimum_importance: str = "日常片段",
                            user_id: str = None,
                            min_importance: float = 0.3) -> List[Dict[str, Any]]:
        """
        高质量搜索（吸收0.1.5，完整实现）
        支持叙事重要性等级过滤、主题标签索引搜索、动态吸附引擎权重、相关性分数计算
        """
        with self._lock:
            candidates = []
            if keyword:
                # 1. 通过主题标签索引搜索
                topic_tags = []
                for index_key in self.MemoryIndex.keys():
                    if index_key.startswith("主题:") and keyword in index_key:
                        topic_tags.extend(self.MemoryIndex[index_key])
                candidates = list(set(topic_tags))[:quantity*3]
                # 2. 如果主题标签索引没有结果，全文搜索
                if not candidates:
                    for mem_id in self._long_term.keys():
                        memory = self.read_memory(mem_id, silent=True)
                        if not memory:
                            continue
                        context_text = ""
                        if isinstance(memory.get("context"), dict):
                            context_text = json.dumps(memory.get("context"), ensure_ascii=False)
                        elif memory.get("context") is not None:
                            context_text = str(memory.get("context"))
                        if (keyword in memory.get("content", "") or
                                keyword in memory.get("context", "") or
                                keyword in context_text):
                            candidates.append(mem_id)
                            if len(candidates) >= quantity * 3:
                                break
            else:
                candidates = list(self._long_term.keys())
    
            # 叙事重要性等级（吸收0.1.5，10个等级）
            importance_level = {
                "日常片段": 1,
                "值得记忆的详细叙述": 2,
                "值得记忆的充实内容": 2,
                "值得记忆的里程碑时刻": 3,
                "值得记忆的情感深刻": 3,
                "值得记忆的个人相关": 3,
                "值得记忆的特殊情境": 3,
                "有意义时刻": 4,
                "重要记忆节点": 5
            }
            min_level = importance_level.get(minimum_importance, 1)
    
            results = []
            for tag in candidates:
                memory = self.read_memory(tag, silent=True)
                if not memory:
                    continue
                # 情感类型过滤
                if emotional_type:
                    mem_emotional = memory.get("emotional_valence", 0)
                    if emotional_type == "positive" and mem_emotional < 0:
                        continue
                    if emotional_type == "negative" and mem_emotional > 0:
                        continue
                # 叙事重要性等级过滤
                current_imp = memory.get("importance_level", "日常片段")
                cur_level = importance_level.get(current_imp, 1)
                # 同时支持浮点数重要性过滤
                float_imp = memory.get("importance", 0.5)
                if cur_level < min_level and float_imp < min_importance:
                    continue
    
                # 相关性分数计算（吸收0.1.5，7个维度）
                relevance = 0
                mem_content = memory.get("content", "")
                # 1. 内容长度
                content_len = len(mem_content)
                if content_len > 200:
                    relevance += 2
                elif content_len > 100:
                    relevance += 1
                # 2. 主题标签数量
                topic_count = len(memory.get("tags", []))
                relevance += min(topic_count, 3)
                # 3. 关联记忆数量
                rel_count = len(memory.get("related_memories", []))
                relevance += min(rel_count, 2)
                # 4. 网络位置
                net_pos = self._analyze_location_in_memory_networks(tag)["网络位置"]
                if net_pos == "核心节点":
                    relevance += 3
                elif net_pos == "枢纽节点":
                    relevance += 2
                elif net_pos == "连接节点":
                    relevance += 1
                # 5. 关键词出现次数加分（吸收0.1.5，最多+3）
                if keyword:
                    kw_count = mem_content.count(keyword)
                    relevance += min(kw_count, 3)
                # 6. 扫描记忆额外加分（吸收0.1.5，匹配目标/扫描类型+3）
                mem_context = memory.get("context", {})
                if not isinstance(mem_context, dict):
                    mem_context = {}
                mem_type = memory.get("memory_type", "")
                is_scan = (mem_type == "scan" or mem_type == "安全扫描" or
                           "scan" in tag.lower() or "扫描" in tag or
                           bool(mem_context.get("scan_type")) or
                           bool(mem_context.get("target")))
                if is_scan and keyword:
                    target = str(mem_context.get("target", ""))
                    scan_type = str(mem_context.get("scan_type", ""))
                    if keyword in target or keyword in scan_type:
                        relevance += 3
                    # 7. 工具名匹配scan_type再+5（吸收0.1.5）
                    tool_names = ['nmap','masscan','nuclei','subfinder','xray','wpscan',
                                   'hydra','ffuf','sqlmap','nikto','dirb','gobuster',
                                   'whatweb','wafw00f','testssl','rustscan','amass',
                                   'metasploit','searchsploit','john','hashcat','aircrack-ng']
                    if any(tn.lower() in scan_type.lower() for tn in tool_names if tn.lower() in keyword.lower()):
                        relevance += 5
                memory['相关性分数'] = relevance
                memory['quality_score'] = relevance
                results.append(memory)
    
            # 排序
            results.sort(key=lambda x: x.get('相关性分数', 0), reverse=True)
    
            # 动态吸附引擎权重应用（吸收0.1.5）
            if user_id and hasattr(self, 'affinity_engine') and self.affinity_engine:
                try:
                    effect = self.affinity_engine.get_interaction_effect(user_id)
                    weight = effect.get('weight_multiplier', 1.0)
                    if weight != 1.0:
                        for item in results:
                            item['相关性分数'] = item.get('相关性分数', 0) * weight
                            item['quality_score'] = item.get('quality_score', 0) * weight
                        results.sort(key=lambda x: x.get('相关性分数', 0), reverse=True)
                except Exception:
                    pass
    
            return results[:quantity]

    def search_scan_memories_keyword(self, keyword: str, limit: int = 5) -> List[Dict]:
        """直接关键词搜索扫描记忆目录（不依赖向量索引，吸收0.1.5，标准化字段）"""
        results = []
        if not keyword or not os.path.exists(self.ScanMemoryDirectory):
            return results
        for fname in os.listdir(self.ScanMemoryDirectory):
            if not fname.endswith('.json'):
                continue
            try:
                fpath = os.path.join(self.ScanMemoryDirectory, fname)
                with open(fpath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                content = data.get("content", data.get("content", ""))
                context_str = json.dumps(data.get("context", data.get("context", {})), ensure_ascii=False)
                if keyword in content or keyword in context_str:
                    results.append({
                        "tag": fname,
                        "content": content,
                        "context": data.get("context", data.get("context", {})),
                        "time": data.get("created_at", data.get("created_time", "")),
                        "target": data.get("target", ""),
                        "scan_type": data.get("scan_type", ""),
                    })
                    if len(results) >= limit:
                        break
            except Exception:
                continue
        return results

    def get_recent_scan_memories(self, limit: int = 5) -> List[Dict]:
        """获取最近扫描记忆（吸收0.1.5，标准化字段）"""
        results = []
        scan_files = self._get_scan_memory_files()
        scan_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        for filepath in scan_files[:limit]:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # 标准化字段（吸收0.1.5）
                results.append({
                    "tag": os.path.basename(filepath),
                    "content": data.get("content", data.get("content", "")),
                    "context": data.get("context", data.get("context", {})),
                    "time": data.get("created_at", data.get("created_time", "")),
                    "target": data.get("target", ""),
                    "scan_type": data.get("scan_type", ""),
                })
            except Exception:
                continue
        return results

    def get_recent_river_memories(self, limit: int = 5) -> List[Dict]:
        """获取最近河流记忆（吸收0.1.5，标准化字段）"""
        results = []
        river_dir = self.MemoryRiverDirectory
        if not os.path.exists(river_dir):
            return results
        files = [os.path.join(river_dir, f) for f in os.listdir(river_dir)
                 if f.endswith('.json')]
        files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        for filepath in files[:limit]:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # 标准化字段（吸收0.1.5）
                results.append({
                    "tag": os.path.basename(filepath),
                    "content": data.get("content", data.get("content", "")),
                    "context": data.get("context", data.get("context", {})),
                    "time": data.get("created_at", data.get("created_time", "")),
                })
            except Exception:
                continue
        return results

    def search_scan_memories(self, target: str = None, keyword: str = None,
                              limit: int = 5) -> List[Dict]:
        """
        检索扫描记忆（吸收0.1.5，完整实现：使用ScanIndex+关键词过滤）
        :param target: 指定目标，若提供则只返回该目标的记忆
        :param keyword: 关键词，在摘要和原始输出中搜索
        :param limit: 返回数量
        :return: 记忆列表，每个包含 'tag', 'content', 'context'
        """
        results = []
        tags_to_check = []
        if target:
            # 使用ScanIndex获取目标的记忆（吸收0.1.5）
            tags_to_check = self.ScanIndex.get(target, [])
        else:
            # 如果未指定目标，则检查所有扫描记忆（遍历目录）
            if os.path.exists(self.ScanMemoryDirectory):
                tags_to_check = [f for f in os.listdir(self.ScanMemoryDirectory) if f.endswith('.json')]
        for tag in tags_to_check[:limit*3]:  # 多取一些以便筛选
            filepath = os.path.join(self.ScanMemoryDirectory, tag)
            if not os.path.exists(filepath):
                continue
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                # 按关键词过滤（在摘要和原始输出中搜索，吸收0.1.5）
                if keyword:
                    content = data.get("content", data.get("content", ""))
                    context = str(data.get("context", data.get("context", {})))
                    raw_output = str(data.get("raw_output", ""))
                    if (keyword not in content and
                        keyword not in context and
                        keyword not in raw_output):
                        continue
                # 标准化字段（吸收0.1.5）
                results.append({
                    "tag": tag,
                    "content": data.get("content", data.get("content", "")),
                    "context": data.get("context", data.get("context", {})),
                    "target": data.get("target", ""),
                    "scan_type": data.get("scan_type", ""),
                })
                if len(results) >= limit:
                    break
            except Exception:
                continue
        return results

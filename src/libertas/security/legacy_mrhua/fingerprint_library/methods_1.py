"""
花先生 - 指纹库运维管理系统
============================
资产指纹规则的全生命周期管理。

核心能力：
1. 指纹规则CRUD（增删改查，不碰代码）
2. 规则导入导出（兼容Wappalyzer/WhatWeb/EHole格式）
3. 版本管理（版本号、变更日志、回滚）
4. 热更新（运行时加载新规则，无需重启）
5. 自动学习（从扫描结果中提取未知指纹模式）
6. 质量评估（命中率/误报率统计）
7. 规则冲突检测与优先级
8. 指纹库统计分析

作者：花先生
版本：2.0.0
"""

import json
import os
import time
import re
import hashlib
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any, Set
from enum import Enum
from collections import defaultdict, Counter
import logging
import threading
from .convert_mapper_match import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403

class FingerprintLibraryPart1(object):
    def __init__(self, library_path: str = "./fingerprint_library"):
        self.library_path = library_path
        self.rules_file = os.path.join(library_path, "rules.json")
        self.versions_file = os.path.join(library_path, "versions.json")
        self.learned_file = os.path.join(library_path, "learned_patterns.json")
        self.stats_file = os.path.join(library_path, "stats.json")

        self._lock = threading.Lock()
        self._rules: Dict[int, FingerprintRule] = {}
        self._versions: List[FingerprintLibraryVersion] = []
        self._learned: List[LearnedPattern] = []
        self._stats: Dict = defaultdict(int)
        self._next_id = 1
        self._current_version = "1.0.0"

        os.makedirs(library_path, exist_ok=True)
        # 首次初始化（规则文件还不存在）时用内置规则打底，否则指纹库开箱为空，
        #「规则列表 / 识别测试」两个子页面没有任何规则可用。
        _first_init = not os.path.exists(self.rules_file)
        self._load()
        if _first_init and not self._rules:
            try:
                self.seed_from_builtin_rules()
            except Exception as _seed_err:
                logger.warning("指纹库内置规则初始化失败: %s", _seed_err)
    def _load(self):
        """从磁盘加载指纹库"""
        # 加载规则
        if os.path.exists(self.rules_file):
            try:
                with open(self.rules_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                for rule_data in data.get("rules", []):
                    rule = FingerprintRule.from_dict(rule_data)
                    if rule.id:
                        self._rules[rule.id] = rule
                        self._next_id = max(self._next_id, rule.id + 1)
                self._current_version = data.get("version", "1.0.0")
            except Exception as e:
                logger.error(f"加载指纹规则失败: {e}")

        # 加载版本历史
        if os.path.exists(self.versions_file):
            try:
                with open(self.versions_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self._versions = [FingerprintLibraryVersion(**v) for v in data]
            except Exception:
                pass

        # 加载学习到的模式
        if os.path.exists(self.learned_file):
            try:
                with open(self.learned_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self._learned = [LearnedPattern(**lp) for lp in data]
            except Exception:
                pass

        # 加载统计
        if os.path.exists(self.stats_file):
            try:
                with open(self.stats_file, 'r', encoding='utf-8') as f:
                    self._stats = defaultdict(int, json.load(f))
            except Exception:
                pass
    def _save(self):
        """保存指纹库到磁盘"""
        # 保存规则
        data = {
            "version": self._current_version,
            "updated_at": time.time(),
            "rule_count": len(self._rules),
            "rules": [rule.to_dict() for rule in self._rules.values()],
        }
        with open(self.rules_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        # 保存版本历史
        with open(self.versions_file, 'w', encoding='utf-8') as f:
            json.dump([asdict(v) for v in self._versions], f, ensure_ascii=False, indent=2)

        # 保存学习到的模式
        with open(self.learned_file, 'w', encoding='utf-8') as f:
            json.dump([asdict(lp) for lp in self._learned], f, ensure_ascii=False, indent=2)

        # 保存统计
        with open(self.stats_file, 'w', encoding='utf-8') as f:
            json.dump(dict(self._stats), f, ensure_ascii=False, indent=2)
    def seed_from_builtin_rules(self) -> int:
        """用网络测绘引擎的内置指纹规则初始化指纹库（仅在库为空时生效）。

        网络空间测绘已经内置了一批指纹规则（AssetFingerprint），而指纹库独立持久化、
        开箱为空，导致同一套系统里"测绘能识别、指纹库却一条规则都没有"。
        这里只在库为空时把内置规则转换后导入，不会覆盖用户自己维护的规则。

        Returns:
            新增的规则条数
        """
        if self.get_rule_count() > 0:
            return 0
        try:
            from .network_space_mapper import AssetFingerprint
            specs = AssetFingerprint().rules
        except Exception as e:
            logger.warning("读取内置指纹规则失败: %s", e)
            return 0

        added = 0
        for spec in specs or []:
            if not isinstance(spec, dict):
                continue
            match_rules = []
            for m in spec.get("matches") or []:
                converted = _convert_mapper_match(m)
                if converted:
                    match_rules.append(converted)
            if not match_rules:
                continue
            try:
                self.add_rule({
                    "name": spec.get("name", ""),
                    "category": spec.get("category", "other"),
                    "description": spec.get("description", ""),
                    "match_rules": match_rules,
                    "condition": "or",          # 与测绘引擎「命中数>0 即命中」语义一致
                    "source": "builtin",
                    "author": "MrHua",
                    "enabled": True,
                })
                added += 1
            except Exception as e:
                logger.debug("内置规则导入跳过 %s: %s", spec.get("name"), e)
        if added:
            logger.info("指纹库已用内置规则初始化 %d 条", added)
        return added
    def add_rule(self, rule_data: Dict) -> int:
        """
        添加指纹规则

        Args:
            rule_data: 规则数据

        Returns:
            规则ID
        """
        with self._lock:
            now = time.time()
            rule = FingerprintRule.from_dict(rule_data)
            rule.id = self._next_id
            self._next_id += 1
            rule.created_at = now
            rule.updated_at = now
            if not rule.source:
                rule.source = "manual"

            self._rules[rule.id] = rule
            self._stats["total_rules_added"] += 1
            self._save()
            return rule.id
    def get_rule(self, rule_id: int) -> Optional[FingerprintRule]:
        """获取规则"""
        return self._rules.get(rule_id)
    def update_rule(self, rule_id: int, updates: Dict) -> bool:
        """更新规则"""
        with self._lock:
            rule = self._rules.get(rule_id)
            if not rule:
                return False

            for key, value in updates.items():
                if hasattr(rule, key) and key not in ("id", "created_at"):
                    setattr(rule, key, value)
            rule.updated_at = time.time()
            self._stats["total_rules_updated"] += 1
            self._save()
            return True
    def delete_rule(self, rule_id: int) -> bool:
        """删除规则"""
        with self._lock:
            if rule_id in self._rules:
                del self._rules[rule_id]
                self._stats["total_rules_deleted"] += 1
                self._save()
                return True
            return False
    def list_rules(self, category: Optional[str] = None,
                   enabled_only: bool = False,
                   search: Optional[str] = None,
                   page: int = 1, page_size: int = 50) -> Dict:
        """
        列出规则

        Args:
            category: 按类别过滤
            enabled_only: 只显示启用的
            search: 关键词搜索
            page: 页码
            page_size: 每页数量

        Returns:
            {"total": 总数, "rules": 规则列表}
        """
        rules = list(self._rules.values())

        if category:
            rules = [r for r in rules if r.category == category]
        if enabled_only:
            rules = [r for r in rules if r.enabled]
        if search:
            search_lower = search.lower()
            rules = [r for r in rules if
                     search_lower in r.name.lower() or
                     search_lower in r.vendor.lower() or
                     search_lower in r.description.lower()]

        # 按优先级排序
        rules.sort(key=lambda r: (r.priority, r.name))
        total = len(rules)

        # 分页
        start = (page - 1) * page_size
        end = start + page_size
        paged_rules = rules[start:end]

        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
            "rules": [r.to_dict() for r in paged_rules],
        }
    def enable_rule(self, rule_id: int) -> bool:
        """启用规则"""
        return self.update_rule(rule_id, {"enabled": True})
    def disable_rule(self, rule_id: int) -> bool:
        """禁用规则"""
        return self.update_rule(rule_id, {"enabled": False})
    def identify(self, url: str = "", headers: Optional[Dict] = None,
                 content: str = "", cookies: Optional[Dict] = None,
                 port: int = 0, banner: str = "",
                 favicon_hash: str = "", cert_info: Optional[Dict] = None) -> List[Dict]:
        """
        使用指纹库识别目标

        Args:
            url: URL
            headers: 响应头
            content: 响应内容
            cookies: Cookie
            port: 端口
            banner: Banner
            favicon_hash: Favicon哈希
            cert_info: 证书信息

        Returns:
            识别到的指纹列表
        """
        headers = headers or {}
        cookies = cookies or {}
        results = []

        for rule in self._rules.values():
            if not rule.enabled:
                continue

            try:
                matched, confidence = self._match_rule(
                    rule, url, headers, content, cookies, port, banner, favicon_hash, cert_info
                )
                if matched:
                    # 提取版本
                    version = ""
                    if rule.version_pattern:
                        try:
                            match = re.search(rule.version_pattern, content + banner + str(headers))
                            if match:
                                version = match.group(1) if match.groups() else match.group(0)
                        except Exception:
                            pass

                    results.append({
                        "id": rule.id,
                        "name": rule.name,
                        "category": rule.category,
                        "vendor": rule.vendor,
                        "confidence": round(confidence * rule.confidence, 2),
                        "version": version,
                        "icon": rule.icon,
                        "website": rule.website,
                        "cpe": rule.cpe,
                        "tags": rule.tags,
                    })

                    # 更新命中统计
                    rule.hits += 1
                    self._stats["total_matches"] += 1

            except Exception as e:
                logger.debug(f"指纹规则 {rule.name} 匹配出错: {e}")

        # 按置信度排序
        results.sort(key=lambda x: x["confidence"], reverse=True)

        # 定期保存统计
        if self._stats["total_matches"] % 100 == 0:
            self._save()

        return results
    def _match_rule(self, rule: FingerprintRule, url: str, headers: Dict,
                    content: str, cookies: Dict, port: int, banner: str,
                    favicon_hash: str, cert_info: Optional[Dict]) -> Tuple[bool, float]:
        """
        匹配单条规则

        Returns:
            (是否匹配, 置信度)
        """
        if not rule.match_rules:
            return False, 0.0

        match_results = []
        for mr in rule.match_rules:
            matched, conf = self._match_single_rule(mr, url, headers, content, cookies, port, banner, favicon_hash, cert_info)
            match_results.append((matched, conf))

        if rule.condition == "and":
            # 所有规则都必须匹配
            all_matched = all(m for m, _ in match_results)
            if all_matched:
                avg_conf = sum(c for _, c in match_results) / len(match_results)
                return True, avg_conf
            return False, 0.0
        else:
            # 任一规则匹配即可（or）
            matched_confs = [c for m, c in match_results if m]
            if matched_confs:
                return True, max(matched_confs)
            return False, 0.0

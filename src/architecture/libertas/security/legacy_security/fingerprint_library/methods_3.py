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
from .methods_1 import *  # noqa: F401,F403
from .methods_2 import *  # noqa: F401,F403

class FingerprintLibraryPart3(object):
    def rollback_to_version(self, version: str) -> bool:
        """
        回滚到指定版本

        Args:
            version: 目标版本号

        Returns:
            是否成功
        """
        with self._lock:
            snapshot_file = os.path.join(self.library_path, f"snapshot_{version}.json")
            if not os.path.exists(snapshot_file):
                return False

            try:
                with open(snapshot_file, 'r', encoding='utf-8') as f:
                    rules_data = json.load(f)

                self._rules.clear()
                for rule_data in rules_data:
                    rule = FingerprintRule.from_dict(rule_data)
                    if rule.id:
                        self._rules[rule.id] = rule
                        self._next_id = max(self._next_id, rule.id + 1)

                self._current_version = version
                self._save()
                return True
            except Exception:
                return False
    def list_versions(self) -> List[Dict]:
        """列出所有版本"""
        return [asdict(v) for v in sorted(self._versions, key=lambda x: x.created_at, reverse=True)]
    def learn_from_scan_result(self, url: str, headers: Dict, content: str,
                                cookies: Dict, port: int = 0) -> List[Dict]:
        """
        从扫描结果中学习未知指纹模式

        Args:
            url: URL
            headers: 响应头
            content: 响应内容
            cookies: Cookie
            port: 端口

        Returns:
            新发现的模式列表
        """
        new_patterns = []
        now = time.time()

        # 1. 学习独特的响应头
        known_headers = {"server", "content-type", "content-length", "date", "connection",
                         "transfer-encoding", "cache-control", "pragma", "expires",
                         "last-modified", "etag", "accept-ranges", "vary", "x-powered-by"}

        for header_name, header_val in headers.items():
            header_lower = header_name.lower()
            if header_lower not in known_headers and len(header_val) < 200:
                # 检查是否已有规则匹配
                pattern_str = f"{header_name}: {header_val}"
                existing = any(
                    lp.pattern == pattern_str for lp in self._learned
                )
                if not existing:
                    lp = LearnedPattern(
                        pattern=pattern_str,
                        match_type="header",
                        occurrences=1,
                        sample_urls=[url],
                        confidence=0.3,
                        suggested_name=header_name,
                        created_at=now,
                    )
                    self._learned.append(lp)
                    new_patterns.append(asdict(lp))

        # 2. 学习独特的Cookie
        for cookie_name in cookies.keys():
            pattern_str = f"cookie: {cookie_name}"
            existing = any(lp.pattern == pattern_str for lp in self._learned)
            if not existing:
                lp = LearnedPattern(
                    pattern=pattern_str,
                    match_type="cookie",
                    occurrences=1,
                    sample_urls=[url],
                    confidence=0.3,
                    suggested_name=cookie_name,
                    created_at=now,
                )
                self._learned.append(lp)
                new_patterns.append(asdict(lp))

        # 3. 学习独特的HTML注释/Meta
        meta_generator = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)["\']',
                                    content, re.IGNORECASE)
        if meta_generator:
            gen = meta_generator.group(1)
            pattern_str = f"meta generator: {gen}"
            existing = any(lp.pattern == pattern_str for lp in self._learned)
            if not existing:
                lp = LearnedPattern(
                    pattern=pattern_str,
                    match_type="meta",
                    occurrences=1,
                    sample_urls=[url],
                    confidence=0.5,
                    suggested_name=gen,
                    created_at=now,
                )
                self._learned.append(lp)
                new_patterns.append(asdict(lp))

        # 4. 学习独特的Script路径
        script_paths = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', content, re.IGNORECASE)
        for script in script_paths[:5]:
            # 提取有特征的路径（包含产品名的）
            if any(kw in script.lower() for kw in ["wp-content", "drupal", "joomla", "typo3",
                                                       "magento", "shopify", "wordpress"]):
                pattern_str = f"script: {script}"
                existing = any(lp.pattern == pattern_str for lp in self._learned)
                if not existing:
                    lp = LearnedPattern(
                        pattern=pattern_str,
                        match_type="script",
                        occurrences=1,
                        sample_urls=[url],
                        confidence=0.4,
                        suggested_name=script.split("/")[-1],
                        created_at=now,
                    )
                    self._learned.append(lp)
                    new_patterns.append(asdict(lp))

        # 学到新模式就落盘：原条件 len%10==0 会让积累到 1~9 条时长期不写盘
        if new_patterns:
            self._save()

        return new_patterns
    def approve_learned_pattern(self, pattern_id: int, rule_name: str,
                                  category: str = "other", reviewer: str = "") -> int:
        """
        审核通过学习到的模式，转为正式规则

        Args:
            pattern_id: 模式ID
            rule_name: 规则名称
            category: 类别
            reviewer: 审核人

        Returns:
            新规则ID
        """
        with self._lock:
            if pattern_id >= len(self._learned):
                return 0

            lp = self._learned[pattern_id]
            lp.status = "approved"
            lp.reviewed_by = reviewer

            # 创建正式规则
            rule = FingerprintRule(
                id=self._next_id,
                name=rule_name,
                category=category,
                match_rules=[{"type": lp.match_type, "pattern": lp.pattern}],
                condition="or",
                confidence=lp.confidence,
                created_at=time.time(),
                updated_at=time.time(),
                source="learned",
            )
            self._rules[self._next_id] = rule
            self._next_id += 1
            self._save()
            return rule.id
    def reject_learned_pattern(self, pattern_id: int, reviewer: str = ""):
        """拒绝学习到的模式"""
        with self._lock:
            if pattern_id < len(self._learned):
                self._learned[pattern_id].status = "rejected"
                self._learned[pattern_id].reviewed_by = reviewer
                self._save()
    def list_learned_patterns(self, status: Optional[str] = None) -> List[Dict]:
        """列出学习到的模式"""
        patterns = self._learned
        if status:
            patterns = [p for p in patterns if p.status == status]
        return [asdict(p) for p in sorted(patterns, key=lambda x: x.occurrences, reverse=True)]
    def report_false_positive(self, rule_id: int):
        """报告误报"""
        with self._lock:
            rule = self._rules.get(rule_id)
            if rule:
                rule.false_positives += 1
                self._stats["total_false_positives"] += 1
                self._save()
    def get_rule_quality(self, rule_id: int) -> Dict:
        """获取规则质量评估"""
        rule = self._rules.get(rule_id)
        if not rule:
            return {}

        accuracy = 1.0 - (rule.false_positives / rule.hits) if rule.hits > 0 else 1.0
        return {
            "rule_id": rule.id,
            "name": rule.name,
            "hits": rule.hits,
            "false_positives": rule.false_positives,
            "accuracy": round(accuracy, 4),
            "confidence": rule.confidence,
            "quality_score": round(accuracy * rule.confidence * 100, 2),
            "status": "excellent" if accuracy > 0.95 else "good" if accuracy > 0.8 else "needs_review",
        }
    def get_library_statistics(self) -> Dict:
        """获取指纹库统计"""
        rules = list(self._rules.values())

        # 按类别统计
        category_counts = Counter(r.category for r in rules)

        # 按来源统计
        source_counts = Counter(r.source for r in rules)

        # 质量分布
        quality_scores = []
        for r in rules:
            if r.hits > 0:
                accuracy = 1.0 - (r.false_positives / r.hits)
                quality_scores.append(accuracy * r.confidence)

        return {
            "total_rules": len(rules),
            "enabled_rules": sum(1 for r in rules if r.enabled),
            "disabled_rules": sum(1 for r in rules if not r.enabled),
            "categories": dict(category_counts),
            "sources": dict(source_counts),
            "current_version": self._current_version,
            "total_versions": len(self._versions),
            "learned_patterns": len(self._learned),
            "approved_patterns": sum(1 for p in self._learned if p.status == "approved"),
            "pending_patterns": sum(1 for p in self._learned if p.status == "pending"),
            "total_matches": self._stats.get("total_matches", 0),
            "total_false_positives": self._stats.get("total_false_positives", 0),
            "avg_quality": round(sum(quality_scores) / len(quality_scores), 4) if quality_scores else 1.0,
            "library_path": self.library_path,
        }
    def reload(self):
        """热更新：重新从磁盘加载规则"""
        with self._lock:
            old_count = len(self._rules)
            self._rules.clear()
            self._load()
            new_count = len(self._rules)
            logger.info(f"指纹库热更新: {old_count} -> {new_count} 条规则")
    def get_rule_count(self) -> int:
        """获取规则总数"""
        return len(self._rules)
    def get_categories(self) -> List[str]:
        """获取所有类别"""
        return sorted(set(r.category for r in self._rules.values()))

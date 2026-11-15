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

class FingerprintLibraryPart2(object):
    def _match_single_rule(self, mr: Dict, url: str, headers: Dict,
                            content: str, cookies: Dict, port: int, banner: str,
                            favicon_hash: str, cert_info: Optional[Dict]) -> Tuple[bool, float]:
        """匹配单条子规则"""
        match_type = mr.get("type", "")
        pattern = mr.get("pattern", "")
        name = mr.get("name", "")
        confidence = mr.get("confidence", 1.0)
        negate = mr.get("negate", False)

        matched = False

        try:
            if match_type == "header":
                if name:
                    header_val = headers.get(name, "")
                    if header_val and re.search(pattern, header_val, re.IGNORECASE):
                        matched = True
                else:
                    # 匹配任意header
                    for hname, hval in headers.items():
                        if re.search(pattern, f"{hname}: {hval}", re.IGNORECASE):
                            matched = True
                            break

            elif match_type == "content":
                if content and re.search(pattern, content, re.IGNORECASE):
                    matched = True

            elif match_type == "cookie":
                cookie_str = json.dumps(cookies)
                if name:
                    cookie_val = cookies.get(name, "")
                    if cookie_val and re.search(pattern, str(cookie_val), re.IGNORECASE):
                        matched = True
                elif re.search(pattern, cookie_str, re.IGNORECASE):
                    matched = True

            elif match_type == "url":
                if url and re.search(pattern, url, re.IGNORECASE):
                    matched = True

            elif match_type == "port":
                try:
                    target_port = int(pattern)
                    if port == target_port:
                        matched = True
                except (ValueError, TypeError):
                    pass

            elif match_type == "banner":
                if banner and re.search(pattern, banner, re.IGNORECASE):
                    matched = True

            elif match_type == "favicon":
                if favicon_hash and favicon_hash == pattern:
                    matched = True

            elif match_type == "cert":
                if cert_info:
                    cert_str = json.dumps(cert_info)
                    if re.search(pattern, cert_str, re.IGNORECASE):
                        matched = True

            elif match_type == "script":
                # 匹配script标签src
                scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', content, re.IGNORECASE)
                for script in scripts:
                    if re.search(pattern, script, re.IGNORECASE):
                        matched = True
                        break

            elif match_type == "meta":
                # 匹配meta标签
                metas = re.findall(r'<meta[^>]+>', content, re.IGNORECASE)
                for meta in metas:
                    if re.search(pattern, meta, re.IGNORECASE):
                        matched = True
                        break

        except re.error:
            # 正则表达式错误
            pass

        if negate:
            matched = not matched

        return matched, confidence
    def import_wappalyzer(self, filepath: str) -> int:
        """
        导入Wappalyzer格式指纹

        Args:
            filepath: Wappalyzer JSON文件路径

        Returns:
            导入的规则数
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        count = 0
        now = time.time()

        for name, app_data in data.get("technologies", {}).items():
            try:
                match_rules = []

                # Headers
                for header_name, header_pattern in (app_data.get("headers") or {}).items():
                    if isinstance(header_pattern, str):
                        match_rules.append({
                            "type": "header",
                            "name": header_name,
                            "pattern": header_pattern.split("\\;")[0],
                        })

                # HTML content
                for html_pattern in (app_data.get("html") or []):
                    if isinstance(html_pattern, str):
                        match_rules.append({
                            "type": "content",
                            "pattern": html_pattern.split("\\;")[0],
                        })

                # Scripts
                for script_pattern in (app_data.get("scripts") or []):
                    if isinstance(script_pattern, str):
                        match_rules.append({
                            "type": "script",
                            "pattern": script_pattern.split("\\;")[0],
                        })

                # Cookies
                for cookie_name in (app_data.get("cookies") or {}).keys():
                    match_rules.append({
                        "type": "cookie",
                        "name": cookie_name,
                        "pattern": ".+",
                    })

                # Meta
                for meta_name, meta_pattern in (app_data.get("meta") or {}).items():
                    if isinstance(meta_pattern, str):
                        match_rules.append({
                            "type": "meta",
                            "pattern": meta_pattern.split("\\;")[0],
                        })

                if not match_rules:
                    continue

                rule = FingerprintRule(
                    id=self._next_id,
                    name=name,
                    category=app_data.get("cats", ["other"])[0] if app_data.get("cats") else "other",
                    vendor=app_data.get("vendor", ""),
                    website=app_data.get("website", ""),
                    icon=app_data.get("icon", ""),
                    description=app_data.get("description", ""),
                    match_rules=match_rules,
                    condition="or",
                    priority=100,
                    confidence=0.8,
                    version_pattern=app_data.get("version", ""),
                    cpe=app_data.get("cpe", ""),
                    tags=app_data.get("tags", []),
                    enabled=True,
                    created_at=now,
                    updated_at=now,
                    source="wappalyzer_import",
                    version="1.0",
                )

                self._rules[self._next_id] = rule
                self._next_id += 1
                count += 1

            except Exception as e:
                logger.debug(f"导入Wappalyzer规则 {name} 失败: {e}")
                continue

        self._save()
        self._stats["total_imported"] += count
        return count
    def import_whatweb(self, filepath: str) -> int:
        """
        导入WhatWeb格式指纹（简化版）

        Args:
            filepath: WhatWeb插件文件路径

        Returns:
            导入的规则数
        """
        count = 0
        now = time.time()

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            # 解析WhatWeb插件（Ruby格式，简化解析）
            # 匹配名称
            name_match = re.search(r'Plugin\.define\s+"([^"]+)"', content)
            if not name_match:
                return 0

            name = name_match.group(1)

            # 匹配各种匹配规则
            match_rules = []

            # text匹配
            for text_match in re.findall(r':text\s*=>\s*"([^"]+)"', content):
                match_rules.append({"type": "content", "pattern": re.escape(text_match)})

            # regexp匹配
            for regex_match in re.findall(r':regexp\s*=>\s*\/([^\/]+)\/', content):
                match_rules.append({"type": "content", "pattern": regex_match})

            # version匹配
            version_pattern = ""
            version_match = re.search(r':version\s*=>\s*\/([^\/]+)\/', content)
            if version_match:
                version_pattern = version_match.group(1)

            if match_rules:
                rule = FingerprintRule(
                    id=self._next_id,
                    name=name,
                    category="other",
                    match_rules=match_rules,
                    condition="or",
                    confidence=0.7,
                    version_pattern=version_pattern,
                    created_at=now,
                    updated_at=now,
                    source="whatweb_import",
                )
                self._rules[self._next_id] = rule
                self._next_id += 1
                count = 1

        except Exception as e:
            logger.debug(f"导入WhatWeb规则失败: {e}")

        self._save()
        return count
    def import_ehope(self, filepath: str) -> int:
        """
        导入EHole格式指纹

        Args:
            filepath: EHole JSON文件路径

        Returns:
            导入的规则数
        """
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        count = 0
        now = time.time()

        # EHole格式通常是 {"fingerprint": [{"rule": "...", "name": "...", ...}]}
        for item in data if isinstance(data, list) else data.get("fingerprint", []):
            try:
                name = item.get("name", item.get("product", ""))
                if not name:
                    continue

                rule_str = item.get("rule", item.get("match", ""))
                match_rules = []

                # EHole规则格式："keyword1|||keyword2" 或 "header: value"
                if "|||" in rule_str:
                    for keyword in rule_str.split("|||"):
                        match_rules.append({"type": "content", "pattern": re.escape(keyword.strip())})
                elif rule_str:
                    match_rules.append({"type": "content", "pattern": re.escape(rule_str)})

                if not match_rules:
                    continue

                rule = FingerprintRule(
                    id=self._next_id,
                    name=name,
                    category=item.get("category", "other"),
                    vendor=item.get("vendor", ""),
                    match_rules=match_rules,
                    condition="or",
                    confidence=0.75,
                    created_at=now,
                    updated_at=now,
                    source="ehole_import",
                )
                self._rules[self._next_id] = rule
                self._next_id += 1
                count += 1

            except Exception:
                continue

        self._save()
        return count
    def export_rules(self, filepath: str, category: Optional[str] = None):
        """
        导出指纹规则为JSON

        Args:
            filepath: 导出文件路径
            category: 按类别过滤
        """
        rules = list(self._rules.values())
        if category:
            rules = [r for r in rules if r.category == category]

        data = {
            "version": self._current_version,
            "exported_at": time.time(),
            "rule_count": len(rules),
            "rules": [r.to_dict() for r in rules],
        }
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    def create_version(self, version: str, changelog: str = "", author: str = "") -> bool:
        """
        创建指纹库版本（快照）

        Args:
            version: 版本号
            changelog: 变更日志
            author: 作者

        Returns:
            是否成功
        """
        with self._lock:
            # 检查版本号是否已存在
            if any(v.version == version for v in self._versions):
                return False

            v = FingerprintLibraryVersion(
                version=version,
                created_at=time.time(),
                rule_count=len(self._rules),
                changelog=changelog,
                author=author,
            )
            self._versions.append(v)
            self._current_version = version

            # 保存版本快照
            snapshot_file = os.path.join(self.library_path, f"snapshot_{version}.json")
            with open(snapshot_file, 'w', encoding='utf-8') as f:
                json.dump([r.to_dict() for r in self._rules.values()], f, ensure_ascii=False, indent=2)

            self._save()
            return True

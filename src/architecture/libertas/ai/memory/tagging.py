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


class MemoryTagMixin:
    """自动标签/关键词提取、重要性评估与记忆文件读取。"""

    def _automatically_extract_topic_tags(self, content: str) -> List[str]:
        """自动提取主题标签（吸收0.1.5，完整实现：topic_mapping字典）"""
        topic_mapping = {
            "安全": ["漏洞", "扫描", "nmap", "端口", "防火墙", "入侵", "检测", "xray", "nuclei", "渗透", "攻击", "服务识别", "版本识别", "操作系统", "指纹", "banner", "安全", "防护", "病毒", "木马", "恶意软件", "exploit", "payload", "sql注入", "xss", "csrf"],
            "技术": ["Python", "Java", "算法", "数据结构", "编程", "开发", "软件", "硬件", "网络", "数据库", "Linux", "Git", "服务识别", "端口扫描", "nmap", "版本", "代码", "函数", "类", "模块", "API", "接口", "框架", "前端", "后端", "全栈"],
            "生活": ["今天", "昨天", "明天", "早上", "晚上", "吃饭", "睡觉", "起床", "出门", "回家", "天气", "下雨", "晴天", "温度", "衣服", "购物", "超市", "菜市场"],
            "情感": ["开心", "难过", "生气", "害怕", "紧张", "放松", "焦虑", "平静", "兴奋", "失落", "感动", "温暖", "孤独", "寂寞", "幸福", "痛苦", "爱", "恨", "喜欢", "讨厌"],
            "工作": ["项目", "任务", "会议", "报告", "文档", "需求", "设计", "开发", "测试", "部署", "上线", "维护", "优化", "重构", "bug", "修复", "进度", "截止日期", "加班"],
            "学习": ["学习", "教程", "课程", "书籍", "笔记", "知识", "技能", "练习", "复习", "考试", "证书", "培训", "自学", "入门", "进阶", "高级", "专家"],
            "记忆": ["记得", "回忆", "以前", "过去", "曾经", "那时", "有一次", "之前", "后来", "然后", "接着", "最后", "终于", "结果", "因为", "所以", "但是", "然而"],
            "对话": ["说", "问", "答", "聊", "谈", "讨论", "交流", "沟通", "表达", "倾听", "理解", "误会", "解释", "道歉", "感谢", "赞美", "批评", "建议", "意见"],
            "用户": ["用户", "客户", "主人", "朋友", "家人", "同事", "陌生人", "网友", "粉丝", "关注者", "订阅者", "会员", "访客", "管理员", "创建者", "工程师"],
            "系统": ["系统", "配置", "设置", "参数", "选项", "默认", "自定义", "初始化", "启动", "关闭", "重启", "更新", "升级", "降级", "备份", "恢复", "迁移", "同步"],
            "工具": ["工具", "软件", "应用", "程序", "脚本", "命令", "插件", "扩展", "模块", "库", "框架", "引擎", "平台", "服务", "接口", "API"],
        }
        found = []
        for topic, keywords in topic_mapping.items():
            if any(word in content for word in keywords):
                found.append(topic)
        # 如果内容较长但没有任何匹配，打上"杂谈"
        if not found and len(content.strip()) > 20:
            found.append("杂谈")
        # 使用jieba分词提取高频词（补充）
        if HAS_JIEBA and len(content) > 10:
            words = [w for w in jieba.cut(content) if len(w) >= 2]
            word_counts = Counter(words).most_common(3)
            for word, count in word_counts:
                if word not in found and count >= 1:
                    found.append(word)
        return list(set(found))[:5]  # 限制最多5个标签

    def _automatically_extract_context_keywords(self, content: str) -> bool:
        """自动提取上下文关键词（吸收0.1.5，完整实现）"""
        context_keywords = ["今天", "刚才", "记得", "那时", "有一次", "之前", "后来"]
        return any(kw in content for kw in context_keywords)

    def _assess_narrative_importance(self, content: str, context_description: str = ""):
        """
        评估叙事重要性（吸收0.1.5，完整实现）
        同时返回字符串描述（兼容0.1.5）和浮点数（兼容我的设计）
        返回值：{"level": str, "score": float, "features": List[str]}
        """
        features = []
        importance = 0.3
    
        # 1. 内容长度检测（吸收0.1.5）
        if len(content) > 200:
            features.append("详细叙述")
            importance += 0.1
        if len(content) > 500:
            importance += 0.1
    
        # 2. 里程碑关键词检测（吸收0.1.5）
        milestone_keywords = ["第一次", "突破", "重要", "关键", "转折", "里程碑", "首次", "开创"]
        if any(word in content for word in milestone_keywords):
            features.append("里程碑")
            importance += 0.2
    
        # 3. 强烈情感词检测（吸收0.1.5）
        strong_emotion = ["感动", "震撼", "惊喜", "深刻", "难忘", "痛苦", "悲伤", "愤怒", "恐惧", "幸福"]
        if any(w in content for w in strong_emotion):
            features.append("情感强烈")
            importance += 0.15
    
        # 4. 特殊时刻检测（吸收0.1.5）
        if context_description:
            if any(w in context_description for w in ["生日", "纪念", "特殊", "节日", "周年", "庆典"]):
                features.append("特殊时刻")
                importance += 0.15
    
        # 5. 技术/安全关键词检测（我的设计）
        high_importance_keywords = ["必须", "紧急", "漏洞", "错误", "修复", "安全",
                                     "密码", "密钥", "配置", "部署", "CVE", "exploit", "入侵"]
        for kw in high_importance_keywords:
            if kw in content:
                importance += 0.1
                if "技术重要" not in features:
                    features.append("技术重要")
                break
    
        # 6. 上下文检测（我的设计）
        if context_description:
            importance += 0.05
    
        # 7. 根据特征数量确定等级（吸收0.1.5）
        if not features:
            level = "日常片段"
        elif len(features) == 1:
            level = f"值得记忆的{features[0]}"
        else:
            level = "重要记忆节点"
    
        # 8. 限制分数范围
        score = min(1.0, max(0.0, importance))
    
        return {
            "level": level,
            "score": score,
            "features": features
        }

    def _get_all_memory_tags(self) -> List[str]:
        """获取所有记忆标签（只从记忆河流目录获取文件名，避免索引中的无效标签导致警告）"""
        try:
            return [f for f in os.listdir(self.MemoryRiverDirectory) if f.endswith('.json')]
        except FileNotFoundError:
            return []

    def get_all_memory_tags(self) -> List[str]:
        """获取所有记忆标签（公开方法）"""
        return self._get_all_memory_tags()

    def _get_scan_memory_files(self) -> List[str]:
        """获取扫描记忆文件列表"""
        if not os.path.exists(self.ScanMemoryDirectory):
            return []
        return [os.path.join(self.ScanMemoryDirectory, f)
                for f in os.listdir(self.ScanMemoryDirectory)
                if f.endswith('.json') and f != '_index.json']

    def _read_scan_memory(self, memory_id: str) -> Optional[Dict]:
        """读取扫描记忆"""
        filepath = os.path.join(self.ScanMemoryDirectory, f"{memory_id}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def read_memory(self, tag: str, silent: bool = False) -> Optional[Dict[str, Any]]:
        """读取记忆（吸收0.1.5，完整实现：缓存/多目录搜索/完整性校验/异常处理）"""
        file_path = None
        try:
            # 1. 先检查缓存
            if tag in self.MemoryCache:
                return self.MemoryCache[tag]
    
            # 2. 从长期记忆读取
            mem = self.get_memory(tag)
            if mem:
                memory_data = mem.to_dict()
                self.MemoryCache[tag] = memory_data
                return memory_data
    
            # 3. 搜索多个目录（吸收0.1.5）
            search_paths = [
                os.path.join(self.MemoryRiverDirectory, f"{tag}.json"),
                os.path.join(self.MemoryRiverDirectory, tag),
                os.path.join(self.ScanMemoryDirectory, f"{tag}.json"),
                os.path.join(self.ScanMemoryDirectory, tag),
                os.path.join(self.GlobalDir, "记忆河流", f"{tag}.json"),
                os.path.join(self.GlobalDir, "记忆河流", tag),
                os.path.join(self.GlobalDir, "扫描记忆", f"{tag}.json"),
                os.path.join(self.GlobalDir, "扫描记忆", tag),
            ]
            for sp in search_paths:
                if os.path.exists(sp):
                    file_path = sp
                    break
    
            # 4. 如果文件不存在，清除引用
            if not file_path:
                if not silent:
                    print(f"[WARN] 记忆文件不存在: {tag}")
                    print(f"   [DIR] 搜索目录: {self.MemoryRiverDirectory}")
                self._clear_memory_references(tag, silent=silent)
                return None
    
            # 5. 读取文件
            with open(file_path, 'r', encoding='utf-8') as f:
                memory_data = json.load(f)
    
            # 6. 完整性校验（吸收0.1.5）
            if not self._verify_memory_integrity(memory_data):
                print(f"[WARN] 记忆数据损坏: {tag}")
                try:
                    os.remove(file_path)
                    self._clear_memory_references(tag)
                except Exception as e:
                    print(f"[FAIL] 删除损坏文件失败: {e}")
                return None
    
            # 7. 存入缓存
            self.MemoryCache[tag] = memory_data
            return memory_data
    
        except RecursionError:
            # 8. 处理 RecursionError（嵌套过深）
            print(f"[WARN] 记忆文件 {tag} 嵌套过深，自动删除")
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                    global_path = os.path.join(self.GlobalDir, "记忆河流", tag)
                    if os.path.exists(global_path):
                        os.remove(global_path)
                        print(f"[DEL] 已删除全局副本: {tag}")
                    self._clear_memory_references(tag)
                    print(f"[DEL] 已删除损坏文件: {tag}")
                except Exception as e:
                    print(f"[FAIL] 删除文件失败: {e}")
            if tag in self.MemoryCache:
                del self.MemoryCache[tag]
            return None
    
        except Exception as e:
            # 9. 处理其他异常
            print(f"[FAIL] 读取记忆失败 {tag}: {e}")
            if tag in self.MemoryCache:
                del self.MemoryCache[tag]
            return None

    def _save_river_memory(self, mem: Memory):
        """保存到记忆河流"""
        river_file = os.path.join(self.MemoryRiverDirectory, f"{mem.memory_id}.json")
        try:
            with open(river_file, 'w', encoding='utf-8') as f:
                json.dump(mem.to_dict(), f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def _get_global_memory_tags(self) -> List[str]:
        """获取全局记忆标签（吸收0.1.5）"""
        global_river = os.path.join(self.GlobalDir, "记忆河流")
        if not os.path.exists(global_river):
            return []
        return [f for f in os.listdir(global_river) if f.endswith('.json')]

    def _read_global_memory(self, tag: str) -> Optional[Dict]:
        """读取全局记忆（吸收0.1.5）"""
        filepath = os.path.join(self.GlobalDir, "记忆河流", tag)
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def _search_global_memory(self, query: str, limit: int = 5) -> List[Dict]:
        """搜索全局记忆"""
        results = []
        global_river = os.path.join(self.GlobalDir, "记忆河流")
        if not os.path.exists(global_river):
            return results
        files = [os.path.join(global_river, f) for f in os.listdir(global_river)
                 if f.endswith('.json')]
        for filepath in files[:limit * 3]:
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if query.lower() in str(data.get("content", "")).lower():
                    results.append(data)
                    if len(results) >= limit:
                        break
            except Exception:
                continue
        return results

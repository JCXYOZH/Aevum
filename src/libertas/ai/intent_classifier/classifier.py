"""语义意图分类器。"""

import json
import os
import re
import threading
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from .models import ClassificationResult, IntentDefinition

class IntentClassifier:
    """语义意图分类器"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "intents")
        os.makedirs(self.data_dir, exist_ok=True)
        self._intents: Dict[str, IntentDefinition] = {}
        self._lock = threading.RLock()
        self._stop_words = set("的了是在我有和就不人都一上也很到说要去你会着没有看好自己这那她它我们你们他们什么怎么如何哪些哪个哪里什么时候多少可以能够应该需要必须请谢谢不是吗呢吧啊嗯哦的话然后因为所以但是如果虽然然而而且并且或者还是不是".split())
        self._init_default_intents()
        self._load()
        # 向量化器初始化（和0.1.5版本一样的懒加载+回退链）
        self._vectorizer = None
        self._sample_vectors = {}
        self._loaded = False
        self._lock = threading.RLock()

    def _init_default_intents(self):
        defaults = [
            IntentDefinition("greeting", "问候",
                           keywords=["你好", "您好", "hi", "hello", "嗨", "在吗", "在么"],
                           patterns=[r"^(你好|您好|hi|hello|嗨)"],
                           examples=["你好", "Hi，在吗"],
                           category="conversation", priority=10),
            IntentDefinition("farewell", "告别",
                           keywords=["再见", "拜拜", "bye", "晚安", "下次见"],
                           patterns=[r"^(再见|拜拜|bye|晚安)"],
                           examples=["再见", "晚安了"],
                           category="conversation", priority=10),
            IntentDefinition("help", "请求帮助",
                           keywords=["帮助", "帮忙", "怎么用", "如何使用", "功能", "命令", "help"],
                           patterns=[r"(怎么|如何).*(用|使用|操作)", r"(有什么|哪些).*(功能|命令)"],
                           examples=["怎么用这个功能", "有哪些命令"],
                           category="system", priority=8),
            IntentDefinition("search", "搜索查询",
                           keywords=["搜索", "查找", "查询", "search", "找一下", "有没有"],
                           patterns=[r"(搜索|查找|查询).+", r"有没有.+"],
                           examples=["搜索一下Python教程", "查找相关资料"],
                           category="information", priority=7),
            IntentDefinition("code_generation", "代码生成",
                           keywords=["写代码", "生成代码", "编写", "实现", "代码", "函数", "脚本", "程序"],
                           patterns=[r"(写|生成|编写|实现).*(代码|函数|脚本|程序|类)", r"(用|使用).*(语言|框架).*(写|实现)"],
                           examples=["写一个Python排序函数", "用Python实现一个爬虫"],
                           category="coding", priority=9),
            IntentDefinition("code_review", "代码审查",
                           keywords=["审查", "review", "检查代码", "优化代码", "代码问题", "bug"],
                           patterns=[r"(审查|review|检查).*(代码|程序)", r"(代码|程序).*(问题|bug|错误)"],
                           examples=["帮我审查这段代码", "代码有什么问题"],
                           category="coding", priority=8),
            IntentDefinition("explanation", "解释说明",
                           keywords=["解释", "说明", "什么是", "原理", "为什么", "怎么理解"],
                           patterns=[r"(解释|说明).+", r"什么是.+", r"为什么.+", r"(原理|机制).+"],
                           examples=["解释一下什么是机器学习", "为什么会出现这个错误"],
                           category="information", priority=7),
            IntentDefinition("translation", "翻译",
                           keywords=["翻译", "translate", "英文", "中文", "译成"],
                           patterns=[r"(翻译|translate).+", r"(把|将).+(翻译|译成).+"],
                           examples=["把这句话翻译成英文", "翻译一下这段文字"],
                           category="language", priority=8),
            IntentDefinition("summarization", "总结摘要",
                           keywords=["总结", "摘要", "概括", "要点", "总结一下", "主要内容"],
                           patterns=[r"(总结|摘要|概括).+", r"(主要|核心).*(内容|要点)"],
                           examples=["总结一下这篇文章", "概括主要内容"],
                           category="information", priority=7),
            IntentDefinition("security_scan", "安全扫描",
                           keywords=["扫描", "漏洞", "安全检测", "渗透", "端口扫描", "nmap"],
                           patterns=[r"(扫描|检测).*(漏洞|安全|端口)", r"(漏洞|安全).*(扫描|检测|检查)"],
                           examples=["扫描目标端口", "检测网站漏洞"],
                           category="security", priority=9),
            IntentDefinition("system_status", "系统状态",
                           keywords=["状态", "运行情况", "健康", "监控", "系统信息", "性能"],
                           patterns=[r"(系统|服务).*(状态|情况|运行)", r"(健康|性能).*(检查|状态)"],
                           examples=["查看系统状态", "系统运行情况"],
                           category="system", priority=6),
            IntentDefinition("configuration", "配置管理",
                           keywords=["配置", "设置", "修改配置", "参数", "选项", "config"],
                           patterns=[r"(修改|更改|调整).*(配置|设置|参数)", r"(配置|设置).+(怎么|如何)"],
                           examples=["修改系统配置", "怎么设置这个参数"],
                           category="system", priority=6),
            IntentDefinition("unknown", "未知意图",
                           keywords=[], patterns=[],
                           examples=[], category="other", priority=0),
        ]
        for intent in defaults:
            self._intents[intent.name] = intent

    def _load(self):
        intent_file = os.path.join(self.data_dir, "custom_intents.json")
        try:
            if os.path.exists(intent_file):
                with open(intent_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for i_data in data.get("intents", []):
                    intent = IntentDefinition(
                        name=i_data.get("name", ""),
                        description=i_data.get("description", ""),
                        keywords=i_data.get("keywords", []),
                        patterns=i_data.get("patterns", []),
                        examples=i_data.get("examples", []),
                        priority=i_data.get("priority", 0),
                        category=i_data.get("category", "general"),
                        handler=i_data.get("handler", ""),
                    )
                    self._intents[intent.name] = intent
        except Exception as e:
            terminal.warn(f"加载自定义意图失败: {e}", "intent")

    def _save(self):
        intent_file = os.path.join(self.data_dir, "custom_intents.json")
        try:
            custom = [i.to_dict() for i in self._intents.values()
                     if i.name not in ("greeting", "farewell", "help", "search",
                                       "code_generation", "code_review", "explanation",
                                       "translation", "summarization", "security_scan",
                                       "system_status", "configuration", "unknown")]
            data = {"version": "1.0", "updated_at": time.time(), "intents": custom}
            with open(intent_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def add_intent(self, intent: IntentDefinition) -> str:
        with self._lock:
            self._intents[intent.name] = intent
            self._save()
        return intent.name

    def remove_intent(self, name: str) -> bool:
        with self._lock:
            if name in self._intents and name != "unknown":
                del self._intents[name]
                self._save()
                return True
            return False

    def get_intent(self, name: str) -> Optional[IntentDefinition]:
        return self._intents.get(name)

    def list_intents(self, category: str = "") -> List[IntentDefinition]:
        intents = list(self._intents.values())
        if category:
            intents = [i for i in intents if i.category == category]
        return sorted(intents, key=lambda i: i.priority, reverse=True)

    def _extract_entities(self, text: str) -> Dict[str, str]:
        """提取实体"""
        entities = {}
        # URL
        urls = re.findall(r'https?://[^\s<>"]+|www\.[^\s<>"]+', text)
        if urls:
            entities["url"] = urls[0]
        # 邮箱
        emails = re.findall(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', text)
        if emails:
            entities["email"] = emails[0]
        # IP地址
        ips = re.findall(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
        if ips:
            entities["ip"] = ips[0]
        # 编程语言
        languages = ["python", "java", "javascript", "typescript", "c++", "c#", "go", "rust", "ruby", "php", "swift", "kotlin"]
        for lang in languages:
            if re.search(rf'\b{lang}\b', text, re.IGNORECASE):
                entities["language"] = lang
                break
        # 数字
        numbers = re.findall(r'\d+', text)
        if numbers:
            entities["number"] = numbers[0]
        return entities

    def _ensure_loaded(self):
        """懒加载向量化器和样本向量（和0.1.5版本一样）"""
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._init_vectorizer()
            self._build_sample_vectors()
            self._loaded = True

    def _init_vectorizer(self):
        """初始化向量化器，优先使用共享语义模型，逐级回退（和0.1.5版本一样）。"""
        import time
        # 检查设置是否启用语义模型（使用get_all()确保能读取到schema中定义的键，只有明确为False才禁用）
        semantic_enabled = True
        try:
            from libertas.data.system_settings import get_system_settings
            all_settings = get_system_settings().get_all()
            semantic_enabled = all_settings.get("semantic_enabled", True) is not False
        except Exception as e:
            print(f"[WARN] 读取 semantic_enabled 设置失败，默认启用: {e}")
            semantic_enabled = True
        # 优先使用共享语义向量化器（模型只加载一次，所有模块共用）
        if semantic_enabled:
            try:
                from libertas.ai.vectorizers import get_shared_semantic_vectorizer
                shared = get_shared_semantic_vectorizer()
                if shared is not None:
                    # 等待后台懒加载完成（最多30秒），使用is_ready()方法
                    wait_count = 0
                    while not shared.is_ready() and wait_count < 60:
                        time.sleep(0.5)
                        wait_count += 1
                    if shared.is_ready():
                        self._vectorizer = shared
                        print("[OK] 意图分类器使用共享语义模型")
                        return
                    else:
                        print("[WARN] 语义模型加载超时，回退到TF-IDF")
            except Exception as e:
                print(f"[WARN] 语义模型初始化失败，回退到TF-IDF: {e}")
                import traceback
                traceback.print_exc()

        # 回退到TF-IDF
        try:
            from libertas.ai.vectorizers import TfidfTagVectorizer
            self._vectorizer = TfidfTagVectorizer(dimension=512)
            all_samples = []
            for intent in self._intents.values():
                all_samples.extend(intent.examples)
            if all_samples:
                self._vectorizer._ensure_fitted(all_samples)
            print("[OK] 意图分类器回退到TF-IDF向量化器")
            return
        except Exception as e:
            print(f"[WARN] TF-IDF初始化失败，回退到Tag哈希: {e}")

        # 最终回退到Tag哈希
        try:
            from libertas.ai.vectorizers import TagVectorizer
            self._vectorizer = TagVectorizer(dimension=256)
            print("[OK] 意图分类器回退到Tag哈希向量化器")
        except Exception as e:
            print(f"[WARN] Tag哈希初始化失败: {e}")
            self._vectorizer = None

    def _vec(self, text: str):
        """统一的向量化接口（和0.1.5版本一样）"""
        if self._vectorizer is None:
            return None
        try:
            return self._vectorizer.vectorize([text])
        except Exception:
            return None

    def _build_sample_vectors(self):
        """编码所有意图样本（和0.1.5版本一样）。"""
        for intent_name, intent in self._intents.items():
            if intent_name == "unknown" or not intent.examples:
                continue
            vecs = []
            for s in intent.examples:
                try:
                    v = self._vec(s)
                    if v is not None:
                        vecs.append(v)
                except Exception:
                    pass
            if vecs:
                self._sample_vectors[intent_name] = vecs
        print(f"[OK] 意图分类器样本向量构建完成，{len(self._sample_vectors)} 个意图有样本向量")

    def classify(self, text: str, context: Optional[Dict[str, Any]] = None) -> ClassificationResult:
        """分类意图"""
        start = time.time()
        result = ClassificationResult(text)
        result.entities = self._extract_entities(text)
        # 确保向量化器已加载（懒加载，首次调用时加载，和0.1.5版本一样）
        self._ensure_loaded()

        if not text.strip():
            result.intent = "unknown"
            result.confidence = 0.0
            return result

        text_lower = text.lower()
        scores: Dict[str, float] = {}
        matched_details: Dict[str, Dict[str, Any]] = {}

        for intent in self._intents.values():
            if intent.name == "unknown":
                continue
            score = 0.0
            matched_kw = []
            matched_pat = []

            # 关键词匹配
            for keyword in intent.keywords:
                if keyword.lower() in text_lower:
                    score += 0.15
                    matched_kw.append(keyword)

            # 模式匹配
            for pattern in intent.compiled_patterns:
                if pattern.search(text):
                    score += 0.25
                    matched_pat.append(pattern.pattern)

            # 示例相似度（简化：检查示例中的词）
            for example in intent.examples:
                example_words = set(example.lower().split())
                text_words = set(text_lower.split())
                overlap = len(example_words & text_words)
                if overlap > 0:
                    score += min(0.2, overlap * 0.05)

            # 优先级加成
            score += intent.priority * 0.01

            # 语义相似度（和0.1.5版本一样，使用统一的_vec接口）
            if self._vectorizer is not None and intent.name in self._sample_vectors:
                try:
                    from libertas.ai.vectorizers import cosine_similarity
                    text_vec = self._vec(text)
                    if text_vec is not None:
                        valid_vecs = [v for v in self._sample_vectors[intent.name] if v is not None]
                        if valid_vecs:
                            max_sim = max(cosine_similarity(text_vec, v) for v in valid_vecs)
                            semantic_score = max(0.0, min(1.0, max_sim))
                            # 语义相似度权重0.4，关键词/模式匹配权重0.6
                            score = score * 0.6 + semantic_score * 0.4
                except Exception:
                    pass

            if score > 0:
                scores[intent.name] = min(score, 1.0)
                matched_details[intent.name] = {
                    "keywords": matched_kw,
                    "patterns": matched_pat,
                    "category": intent.category,
                }

        if scores:
            # 排序
            sorted_scores = sorted(scores.items(), key=lambda x: x[1], reverse=True)
            best_intent, best_score = sorted_scores[0]
            result.intent = best_intent
            result.confidence = round(best_score, 3)
            result.category = matched_details[best_intent]["category"]
            result.matched_keywords = matched_details[best_intent]["keywords"]
            result.matched_patterns = matched_details[best_intent]["patterns"]

            # 检查是否模糊（前两名分数接近）
            if len(sorted_scores) > 1 and sorted_scores[1][1] > 0 and best_score - sorted_scores[1][1] < 0.1:
                result.ambiguous = True

            # 备选意图
            for name, score in sorted_scores[1:4]:
                result.alternatives.append({
                    "intent": name,
                    "confidence": round(score, 3),
                    "category": matched_details.get(name, {}).get("category", ""),
                })

            # 更新匹配计数
            intent = self._intents.get(best_intent)
            if intent:
                intent.match_count += 1
        else:
            result.intent = "unknown"
            result.confidence = 0.0

        result.processing_time_ms = (time.time() - start) * 1000
        return result

    def batch_classify(self, texts: List[str]) -> List[ClassificationResult]:
        return [self.classify(text) for text in texts]

    def add_example(self, intent_name: str, example: str) -> bool:
        intent = self._intents.get(intent_name)
        if intent:
            intent.add_example(example)
            self._save()
            return True
        return False

    def get_stats(self) -> Dict[str, Any]:
        by_category = {}
        total_matches = 0
        for intent in self._intents.values():
            by_category[intent.category] = by_category.get(intent.category, 0) + 1
            total_matches += intent.match_count
        return {
            "total_intents": len(self._intents),
            "by_category": by_category,
            "total_matches": total_matches,
            "custom_intents": len([i for i in self._intents.values() if i.priority < 10]),
        }

"""
core/character.py - 人物分辨系统

基于文本特征、说话风格、行为模式识别人物身份，支持人物档案、相似度比对、身份验证。
"""
import os
import json
import time
import uuid
import re
import math
import threading
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter, defaultdict
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


# ================================================================
# 人物档案
# ================================================================
class CharacterProfile:
    """人物档案"""

    def __init__(self, name: str = "", display_name: str = "",
                 description: str = "", tags: Optional[List[str]] = None):
        self.profile_id = f"char_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.display_name = display_name or name
        self.description = description
        self.tags = tags or []
        self.created_at = time.time()
        self.updated_at = time.time()
        # 语言特征
        self.vocabulary: Counter = Counter()
        self.phrase_patterns: List[str] = []
        self.speaking_style: Dict[str, Any] = {
            "avg_sentence_length": 0,
            "formality_level": 0.5,
            "use_emoji": False,
            "punctuation_style": "standard",
            "capitalization": "normal",
        }
        # 行为特征
        self.behavior_patterns: Dict[str, Any] = {
            "response_time_avg": 0,
            "active_hours": [],
            "topic_preferences": [],
        }
        # 样本
        self.sample_count = 0
        self.samples: List[Dict[str, Any]] = []
        self.confidence = 0.0

    def add_sample(self, text: str, metadata: Optional[Dict[str, Any]] = None):
        """添加文本样本"""
        # 提取词汇
        words = re.findall(r'[\u4e00-\u9fff]|[a-zA-Z]+', text.lower())
        self.vocabulary.update(words)
        # 句子长度
        sentences = re.split(r'[。！？.!?]', text)
        avg_len = sum(len(s) for s in sentences if s.strip()) / max(len([s for s in sentences if s.strip()]), 1)
        if self.speaking_style["avg_sentence_length"] == 0:
            self.speaking_style["avg_sentence_length"] = avg_len
        else:
            self.speaking_style["avg_sentence_length"] = (
                self.speaking_style["avg_sentence_length"] * 0.9 + avg_len * 0.1
            )
        # 表情符号检测
        if re.search(r'[\U0001F300-\U0001F9FF]', text):
            self.speaking_style["use_emoji"] = True
        # 保存样本
        self.samples.append({
            "text": text[:500],
            "length": len(text),
            "timestamp": time.time(),
            "metadata": metadata or {},
        })
        if len(self.samples) > 100:
            self.samples = self.samples[-100:]
        self.sample_count += 1
        self.updated_at = time.time()
        self.confidence = min(1.0, self.sample_count / 50.0)

    def get_feature_vector(self) -> Dict[str, Any]:
        """获取特征向量"""
        top_words = [w for w, _ in self.vocabulary.most_common(100)]
        return {
            "top_vocabulary": top_words,
            "avg_sentence_length": self.speaking_style["avg_sentence_length"],
            "use_emoji": self.speaking_style["use_emoji"],
            "formality_level": self.speaking_style["formality_level"],
            "sample_count": self.sample_count,
            "vocabulary_size": len(self.vocabulary),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "profile_id": self.profile_id,
            "name": self.name,
            "display_name": self.display_name,
            "description": self.description,
            "tags": self.tags,
            "created_at": self.created_at,
            "sample_count": self.sample_count,
            "confidence": self.confidence,
            "speaking_style": self.speaking_style,
            "vocabulary_size": len(self.vocabulary),
            "top_words": [w for w, _ in self.vocabulary.most_common(20)],
        }


# ================================================================
# 人物分辨引擎
# ================================================================
class CharacterRecognizer:
    """人物分辨系统"""

    def __init__(self, data_dir: str = "", memory_system=None):
        # 智能识别：如果第一个参数是 MemorySystem 对象，则调整参数映射
        if not isinstance(data_dir, str) and data_dir is not None:
            memory_system = data_dir
            data_dir = ""
        self.data_dir = data_dir or os.path.join(get_data_dir(), "characters")
        self.memory_system = memory_system
        os.makedirs(self.data_dir, exist_ok=True)
        self._profiles: Dict[str, CharacterProfile] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self):
        profiles_file = os.path.join(self.data_dir, "profiles.json")
        try:
            if os.path.exists(profiles_file):
                with open(profiles_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for p_data in data.get("profiles", []):
                    profile = CharacterProfile(
                        name=p_data.get("name", ""),
                        display_name=p_data.get("display_name", ""),
                        description=p_data.get("description", ""),
                        tags=p_data.get("tags", []),
                    )
                    profile.profile_id = p_data.get("profile_id", profile.profile_id)
                    profile.sample_count = p_data.get("sample_count", 0)
                    profile.confidence = p_data.get("confidence", 0)
                    profile.speaking_style = p_data.get("speaking_style", profile.speaking_style)
                    self._profiles[profile.profile_id] = profile
        except Exception as e:
            terminal.warn(f"加载人物档案失败: {e}", "character")

    def _save(self):
        profiles_file = os.path.join(self.data_dir, "profiles.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "profiles": [p.to_dict() for p in self._profiles.values()],
            }
            with open(profiles_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def create_profile(self, name: str, display_name: str = "",
                       description: str = "", tags: Optional[List[str]] = None) -> CharacterProfile:
        profile = CharacterProfile(name, display_name, description, tags)
        with self._lock:
            self._profiles[profile.profile_id] = profile
            self._save()
        terminal.info(f"创建人物档案: {name}", "character")
        return profile

    def delete_profile(self, profile_id: str) -> bool:
        with self._lock:
            if profile_id in self._profiles:
                del self._profiles[profile_id]
                self._save()
                return True
            return False

    def get_profile(self, profile_id: str) -> Optional[CharacterProfile]:
        return self._profiles.get(profile_id)

    def get_profile_by_name(self, name: str) -> Optional[CharacterProfile]:
        for profile in self._profiles.values():
            if profile.name == name or profile.display_name == name:
                return profile
        return None

    def list_profiles(self) -> List[CharacterProfile]:
        return sorted(self._profiles.values(), key=lambda p: p.created_at)

    def add_sample(self, profile_id: str, text: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        profile = self._profiles.get(profile_id)
        if profile:
            profile.add_sample(text, metadata)
            self._save()
            return True
        return False

    def _text_similarity(self, text1: str, text2: str) -> float:
        """计算文本相似度（基于词频的余弦相似度）"""
        words1 = Counter(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z]+', text1.lower()))
        words2 = Counter(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z]+', text2.lower()))
        all_words = set(words1.keys()) | set(words2.keys())
        if not all_words:
            return 0.0
        vec1 = [words1.get(w, 0) for w in all_words]
        vec2 = [words2.get(w, 0) for w in all_words]
        dot = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    def _profile_similarity(self, text: str, profile: CharacterProfile) -> float:
        """计算文本与档案的相似度"""
        if profile.sample_count == 0:
            return 0.0
        # 与所有样本的平均相似度
        similarities = []
        for sample in profile.samples[-20:]:
            sim = self._text_similarity(text, sample["text"])
            similarities.append(sim)
        avg_sim = sum(similarities) / len(similarities) if similarities else 0
        # 词汇重叠度
        text_words = set(re.findall(r'[\u4e00-\u9fff]|[a-zA-Z]+', text.lower()))
        profile_words = set(profile.vocabulary.keys())
        overlap = len(text_words & profile_words) / max(len(text_words), 1)
        # 句子长度匹配
        sentences = re.split(r'[。！？.!?]', text)
        avg_len = sum(len(s) for s in sentences if s.strip()) / max(len([s for s in sentences if s.strip()]), 1)
        len_match = 1.0 - min(abs(avg_len - profile.speaking_style["avg_sentence_length"]) / 50.0, 1.0)
        # 综合评分
        score = avg_sim * 0.5 + overlap * 0.3 + len_match * 0.2
        return min(1.0, score * profile.confidence)

    def identify(self, text: str, top_k: int = 5,
                 min_confidence: float = 0.3) -> List[Dict[str, Any]]:
        """识别人物身份"""
        results = []
        for profile in self._profiles.values():
            if profile.sample_count < 3:
                continue
            score = self._profile_similarity(text, profile)
            if score >= min_confidence:
                results.append({
                    "profile_id": profile.profile_id,
                    "name": profile.name,
                    "display_name": profile.display_name,
                    "confidence": score,
                    "sample_count": profile.sample_count,
                })
        results.sort(key=lambda x: x["confidence"], reverse=True)
        return results[:top_k]

    def verify_identity(self, text: str, profile_id: str,
                        threshold: float = 0.5) -> Tuple[bool, float]:
        """验证身份"""
        profile = self._profiles.get(profile_id)
        if not profile:
            return False, 0.0
        score = self._profile_similarity(text, profile)
        return score >= threshold, score

    def compare_profiles(self, profile_id1: str, profile_id2: str) -> Dict[str, Any]:
        """比较两个人物档案"""
        p1 = self._profiles.get(profile_id1)
        p2 = self._profiles.get(profile_id2)
        if not p1 or not p2:
            return {"error": "档案不存在"}
        # 词汇相似度
        words1 = set(p1.vocabulary.keys())
        words2 = set(p2.vocabulary.keys())
        vocab_overlap = len(words1 & words2) / max(len(words1 | words2), 1)
        # 句子长度差异
        len_diff = abs(p1.speaking_style["avg_sentence_length"] - p2.speaking_style["avg_sentence_length"])
        # 综合相似度
        similarity = vocab_overlap * 0.6 + max(0, 1 - len_diff / 50) * 0.4
        return {
            "profile1": p1.name,
            "profile2": p2.name,
            "similarity": similarity,
            "vocabulary_overlap": vocab_overlap,
            "sentence_length_diff": len_diff,
            "same_person_likely": similarity > 0.7,
        }

    def get_stats(self) -> Dict[str, Any]:
        total = len(self._profiles)
        trained = sum(1 for p in self._profiles.values() if p.sample_count >= 3)
        total_samples = sum(p.sample_count for p in self._profiles.values())
        return {
            "total_profiles": total,
            "trained_profiles": trained,
            "untrained_profiles": total - trained,
            "total_samples": total_samples,
            "avg_confidence": sum(p.confidence for p in self._profiles.values()) / max(total, 1),
        }


# 全局识别器
_character_recognizer = CharacterRecognizer()


def get_character_recognizer() -> CharacterRecognizer:
    return _character_recognizer


def identify_character(text: str, **kwargs) -> List[Dict[str, Any]]:
    return _character_recognizer.identify(text, **kwargs)

# 向后兼容：旧版类名别名
CharacterDiscriminationSystem = CharacterRecognizer
DynamicRelationshipModeler = CharacterRecognizer
CharacterMemoryAssociationDevice = CharacterRecognizer

# models/schemas.py
# 所有数据类（@dataclass）和枚举（Enum）定义
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any, Tuple
import time
import uuid


# ==================== 枚举定义 ====================
class FeedbackType(Enum):
    FEATURE_SUGGESTION = "feature_suggestion"
    BUG_REPORT = "bug_report"
    CONTENT_FEEDBACK = "content_feedback"
    SYSTEM_IMPROVEMENT = "system_improvement"
    OTHER = "other"


class UserType(Enum):
    NORMAL = "normal"
    PREMIUM = "premium"
    CREATOR = "creator"


# ==================== 数据模型 ====================
@dataclass
class CognitiveConnection:
    memory1_hash: str
    memory2_hash: str
    strength: float
    connection_type: str
    similarity: float
    explanation: str
    create_time: str
    update_time: str
    update_count: int = 1


@dataclass
class PinFeedback:
    id: str
    user_id: str
    content: str
    type: FeedbackType
    context: Dict[str, Any]
    timestamp: str
    quality_score: float = 0.5
    processing_status: str = "pending"


@dataclass
class UserCognitiveState:
    """用户认知状态"""
    user_id: str
    # 核心三值向量（维度统一）
    q_vector: List[float]   # 问题倾向（Query）
    k_vector: List[float]   # 知识储备（Key）
    v_vector: List[float]   # 价值权重（Value）

    # 动态属性
    energy: float = 1.0                 # 活跃能量（0.1 ~ 1.0）
    raw_affinity: float = 0.5           # 与系统中心的原始亲和度
    permission_boost: float = 0.0       # 权限修正量（-0.3 ~ +0.3）
    phase_transition_count: int = 0     # 相变次数（观点突变次数）
    last_update: float = field(default_factory=time.time)

    # 历史轨迹（用于检测相变）
    vector_history: deque = field(default_factory=lambda: deque(maxlen=5))

    def to_dict(self) -> Dict:
        """序列化为字典（用于存入人物档案）"""
        return {
            "user_id": self.user_id,
            "q_vector": self.q_vector,
            "k_vector": self.k_vector,
            "v_vector": self.v_vector,
            "energy": self.energy,
            "raw_affinity": self.raw_affinity,
            "permission_boost": self.permission_boost,
            "phase_transition_count": self.phase_transition_count,
            "last_update": self.last_update
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "UserCognitiveState":
        """从字典还原"""
        state = cls(
            user_id=data["user_id"],
            q_vector=data["q_vector"],
            k_vector=data["k_vector"],
            v_vector=data["v_vector"],
            energy=data.get("energy", 1.0),
            raw_affinity=data.get("raw_affinity", 0.5),
            permission_boost=data.get("permission_boost", 0.0),
            phase_transition_count=data.get("phase_transition_count", 0),
            last_update=data.get("last_update", time.time())
        )
        state.vector_history = deque(maxlen=5)
        return state


@dataclass
class ThoughtAnnotation:
    """单条批注（对应地质记忆中的一个 V 子值单元）"""
    id: str                     # 唯一ID（MD5生成）
    user_id: str                # 发布者
    topic: str                  # 所属主题（如 "#漏洞", "#代码"）
    text: str                   # 批注内容
    timestamp: float            # 发布时间戳

    # 三值交互指标
    v1_approval: float = 0.0    # 赞同度（被点赞/认可）
    v2_question: float = 0.0    # 质疑度（是否提出问题）
    v3_extension: float = 0.0   # 延伸度（内容长度/引用数）

    # 动态属性
    energy: float = 1.0         # 当前热度能量（0.0 ~ 1.0）
    depth_level: int = 0        # 所处深度层（0=最新，1=中期，2=深层）

    # 上下文关联
    context: Dict = field(default_factory=dict)
    reply_to: Optional[str] = None  # 回复的批注ID

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "topic": self.topic,
            "text": self.text,
            "timestamp": self.timestamp,
            "v1_approval": self.v1_approval,
            "v2_question": self.v2_question,
            "v3_extension": self.v3_extension,
            "energy": self.energy,
            "depth_level": self.depth_level,
            "context": self.context,
            "reply_to": self.reply_to
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "ThoughtAnnotation":
        return cls(
            id=data["id"],
            user_id=data["user_id"],
            topic=data["topic"],
            text=data["text"],
            timestamp=data["timestamp"],
            v1_approval=data.get("v1_approval", 0.0),
            v2_question=data.get("v2_question", 0.0),
            v3_extension=data.get("v3_extension", 0.0),
            energy=data.get("energy", 0.5),
            depth_level=data.get("depth_level", 0),
            context=data.get("context", {}),
            reply_to=data.get("reply_to")
        )

    def get_age_label(self) -> str:
        """生成相对时间标签（供前端显示）"""
        elapsed = time.time() - self.timestamp
        if elapsed < 60:
            return "刚刚"
        elif elapsed < 3600:
            return f"{int(elapsed // 60)}分钟前"
        elif elapsed < 86400:
            return f"{int(elapsed // 3600)}小时前"
        else:
            return f"{int(elapsed // 86400)}天前"

    def get_display_score(self) -> float:
        """计算显示优先级分数"""
        # 0.5 * 能量（时效热度） + 0.3 * 互动度（V1+V2+V3） + 0.2 * 新鲜度（反向时间）
        freshness = max(0, 1.0 - (time.time() - self.timestamp) / 86400)  # 1天内逐渐衰减
        interaction = (self.v1_approval + self.v2_question + self.v3_extension) / 3.0
        return 0.5 * self.energy + 0.3 * interaction + 0.2 * freshness


@dataclass
class Experiment:
    """A/B 测试实验定义"""
    id: str                         # 实验唯一ID（MD5）
    name: str                       # 实验名称（如 "幽默回复测试"）
    description: str                # 描述

    # 分桶配置
    rollout_percentage: float = 0.2  # 实验组比例（0.0~1.0）

    # 实验逻辑配置
    treatment_config: Dict = field(default_factory=dict)   # 实验组参数（新逻辑）
    control_config: Dict = field(default_factory=dict)     # 对照组参数（旧逻辑）

    # 指标收集器（外部注入）
    metric_collector: Optional[Any] = None  # 实际是 Callable，但避免导入困难

    # 状态跟踪
    status: str = "pending"  # pending, running, validated, promoted, rolled_back
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    validation_threshold: float = 1.05   # 归池阈值（实验组/对照组 >= 1.05）
    rollback_threshold: float = 1.10     # 回滚阈值（对照组/实验组 >= 1.10）

    # 指标历史（用于检测相变）
    metric_history_treatment: deque = field(default_factory=lambda: deque(maxlen=100))
    metric_history_control: deque = field(default_factory=lambda: deque(maxlen=100))
    transition_detected: bool = False

    # 统计检验结果（scipy.stats）
    statistical_test: Optional[Dict] = None

    # 元数据
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "rollout_percentage": self.rollout_percentage,
            "treatment_config": self.treatment_config,
            "control_config": self.control_config,
            "status": self.status,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "validation_threshold": self.validation_threshold,
            "rollback_threshold": self.rollback_threshold,
            "metric_history_treatment": list(self.metric_history_treatment),
            "metric_history_control": list(self.metric_history_control),
            "transition_detected": self.transition_detected,
            "statistical_test": self.statistical_test,
            "created_at": self.created_at,
            "updated_at": self.updated_at
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "Experiment":
        exp = cls(
            id=data["id"],
            name=data["name"],
            description=data["description"],
            rollout_percentage=data.get("rollout_percentage", 0.2),
            treatment_config=data.get("treatment_config", {}),
            control_config=data.get("control_config", {}),
            status=data.get("status", "pending"),
            start_time=data.get("start_time", time.time()),
            end_time=data.get("end_time"),
            validation_threshold=data.get("validation_threshold", 1.05),
            rollback_threshold=data.get("rollback_threshold", 1.10),
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time())
        )
        exp.metric_history_treatment = deque(
            data.get("metric_history_treatment", []),
            maxlen=100
        )
        exp.metric_history_control = deque(
            data.get("metric_history_control", []),
            maxlen=100
        )
        exp.transition_detected = data.get("transition_detected", False)
        exp.statistical_test = data.get("statistical_test")
        return exp


# ==================== 人物特征相关数据类 ====================
@dataclass
class CharacterTraits:
    user_id: str
    basic_info: Dict[str, Any]
    dialogue_style: Dict[str, float]
    interest_preferences: List[str]
    emotional_pattern: Dict[str, float]
    knowledge_domains: List[str]
    values: List[str]
    behavior_pattern: Dict[str, Any]
    update_time: str
    interaction_count: int = 0


@dataclass
class SocialRelationships:
    relationship_type: str
    intensity: float
    intimacy: float
    trust: float
    last_interaction: str
    interaction_history: List[Dict]
    common_interests: List[str]
    relationship_trajectory: List[Tuple[str, float]]


# ==================== 配置数据类 ====================
@dataclass
class UserManagerConfig:
    """
    用户管理器配置类
    集中管理所有可调参数
    """
    db_path: str = "users.db"
    base_dir: str = "users"
    max_login_attempts: int = 5
    lockout_duration: int = 300
    hash_algorithm: str = "bcrypt"  # 实际会检查 bcrypt 是否可用
    enable_audit_log: bool = True


@dataclass
class User:
    """用户数据模型"""
    id: int
    username: str
    password_hash: str
    created_at: str
    last_login: Optional[str] = None
    login_attempts: int = 0
    locked_until: Optional[str] = None

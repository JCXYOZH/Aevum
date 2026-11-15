"""Agent 自主循环大脑公共入口。"""

from .enums import AgentPhase, TaskStatus, TaskPriority, DecisionStrategy, GoalType
from .models import AgentState, Task, Goal, CycleRecord
from .state_machine import AgentStateMachine
from .planning import TaskPlanner
from .decision import DecisionEngine
from .context import ContextManager
from .reflection import ReflectionLearner
from .goals import GoalManager
from .attention import AttentionMechanism
from .monitoring import SelfMonitor
from .cycle import AutonomousCycle
from .brain import AgentBrain
from .tracker import GoalTracker
from .decomposition import SubGoalDecomposer
from .quality import CycleQualityAssessor
from .checkpoint import CheckpointManager
from .queue import TaskQueue
from .multiturn import MultiTurnContext
from .parallel import ParallelTaskExecutor
from .singleton import get_agent_brain, init_agent_brain

__all__ = [
    "AgentPhase", "TaskStatus", "TaskPriority", "DecisionStrategy", "GoalType",
    "AgentState", "Task", "Goal", "CycleRecord", "AgentStateMachine", "TaskPlanner",
    "DecisionEngine", "ContextManager", "ReflectionLearner", "GoalManager",
    "AttentionMechanism", "SelfMonitor", "AutonomousCycle", "AgentBrain",
    "GoalTracker", "SubGoalDecomposer", "CycleQualityAssessor", "CheckpointManager",
    "TaskQueue", "MultiTurnContext", "ParallelTaskExecutor",
    "get_agent_brain", "init_agent_brain",
]

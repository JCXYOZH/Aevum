"""
core/agent_brain.py - Agent自主循环大脑

核心能力：七阶段自主循环（感知→思考→规划→决策→执行→观察→反思→学习）、
状态机驱动、任务动态规划、多策略决策、上下文智能裁剪、反思学习闭环、
目标层级管理、注意力聚焦、自我监控、可中断可恢复。
整合记忆库、工具库、代码库三大本地化能力。
"""
import os
import sys
import json
import time
import uuid
import math
import hashlib
import threading
import re
from typing import Any, Dict, List, Optional, Tuple, Callable
from collections import deque, Counter, defaultdict
from enum import Enum
from libertas.foundation.terminal import terminal


from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task
from .state_machine import AgentStateMachine
from .planning import TaskPlanner
from .decision import DecisionEngine
from .context import ContextManager
from .reflection import ReflectionLearner
from .goals import GoalManager
from .attention import AttentionMechanism
from .monitoring import SelfMonitor
from .cycle import AutonomousCycle



class AgentBrain:
    """Agent大脑主类 - 整合所有模块，统一对外接口"""

    def __init__(self, project_root: str = "", memory_module=None,
                 tool_module=None, code_module=None, auto_init: bool = True):
        self.brain_id = f"brain_{uuid.uuid4().hex[:8]}"
        self.project_root = project_root
        # 三大本地化能力（可选注入）
        self.memory = memory_module
        self.tools = tool_module
        self.codebase = code_module
        # 核心模块
        self.state_machine = AgentStateMachine()
        self.planner = TaskPlanner()
        self.decision_engine = DecisionEngine("adaptive")
        self.context_manager = ContextManager(max_tokens=8000)
        self.reflection_learner = ReflectionLearner()
        self.goal_manager = GoalManager()
        self.attention = AttentionMechanism()
        self.monitor = SelfMonitor()
        self.cycle = AutonomousCycle(
            self.state_machine, self.planner, self.decision_engine,
            self.context_manager, self.reflection_learner, self.monitor,
            memory_module=memory_module, tool_module=tool_module, codebase_module=code_module
        )
        self._lock = threading.RLock()
        self._initialized = False
        # 增强模块（可选注入，由主系统或调用方设置）
        self.goal_tracker = None
        self.checkpoint_manager = None
        self.cycle_quality_assessor = None
        self.tool_result_cache = None
        self.tool_health_checker = None
        self._checkpoint_interval = 5  # 每N轮保存一次检查点

        if auto_init:
            self.initialize()

    def set_enhancement_modules(self, goal_tracker=None, checkpoint_manager=None,
                                 cycle_quality_assessor=None, tool_result_cache=None,
                                 tool_health_checker=None):
        """注入增强模块"""
        if goal_tracker:
            self.goal_tracker = goal_tracker
        if checkpoint_manager:
            self.checkpoint_manager = checkpoint_manager
        if cycle_quality_assessor:
            self.cycle_quality_assessor = cycle_quality_assessor
        if tool_result_cache:
            self.tool_result_cache = tool_result_cache
        if tool_health_checker:
            self.tool_health_checker = tool_health_checker

    def initialize(self):
        """初始化Agent大脑"""
        with self._lock:
            if self.state_machine.get_current_phase() != AgentPhase.IDLE:
                self.state_machine.transition(AgentPhase.IDLE)
            self.monitor.record_metric("initialization_time", time.time())
            self._initialized = True
            terminal.info(f"Agent大脑已初始化 ({self.brain_id})", "agent_brain")

    def set_memory_module(self, memory_module):
        """注入记忆库模块"""
        self.memory = memory_module

    def set_tool_module(self, tool_module):
        """注入工具库模块"""
        self.tools = tool_module

    def set_codebase_module(self, code_module):
        """注入代码库模块"""
        self.codebase = code_module

    # ===== 主入口：处理用户需求 =====
    def process(self, requirement: str, context: Optional[Dict] = None,
                max_cycles: int = 50, callback: Optional[Callable] = None) -> Dict[str, Any]:
        """处理用户需求（自主循环主入口，接入目标追踪/检查点/质量评估）"""
        context = context or {}
        terminal.info(f"Agent开始处理: {requirement[:80]}", "agent_brain")
        process_start = time.time()

        # 1. 创建目标（同时写入增强目标追踪器）
        goal = self.goal_manager.create_goal(
            description=requirement,
            goal_type="short_term",
            priority="high",
            success_criteria="所有子任务完成且无未解决错误"
        )
        self.goal_manager.set_active_goal(goal.goal_id)
        enhanced_goal_id = None
        if self.goal_tracker:
            try:
                eg = self.goal_tracker.create_goal(description=requirement, priority=5)
                enhanced_goal_id = eg.get("goal_id")
            except Exception:
                pass

        # 2. 构建初始上下文
        self._build_initial_context(requirement, context)

        # 3. 包装callback，接入检查点保存和质量评估
        original_callback = callback
        cycle_count = [0]

        def enhanced_callback(record):
            cycle_count[0] += 1
            # 每N轮保存检查点
            if self.checkpoint_manager and cycle_count[0] % self._checkpoint_interval == 0:
                try:
                    self.checkpoint_manager.save_checkpoint(
                        cycle_number=cycle_count[0],
                        state={"phase": record.current_phase, "brain_id": self.brain_id},
                        context={"requirement": requirement},
                        metadata={"enhanced_goal_id": enhanced_goal_id}
                    )
                except Exception:
                    pass
            # 记录循环质量
            if self.cycle_quality_assessor:
                try:
                    self.cycle_quality_assessor.record_cycle({
                        "cycle_number": cycle_count[0],
                        "action_success": record.success,
                        "duration_ms": record.duration_ms,
                        "error_count": 1 if not record.success else 0,
                    })
                except Exception:
                    pass
            if original_callback:
                original_callback(record)

        # 4. 运行自主循环（注入自身引用，供执行阶段调用模块）
        context["_brain_ref"] = self
        result = self.cycle.run(requirement, context, max_cycles, enhanced_callback)

        # 5. 更新目标进度（同时更新增强目标追踪器）
        self.goal_manager.update_goal_progress(goal.goal_id, result.get("success_rate", 0))
        if self.goal_tracker and enhanced_goal_id:
            try:
                self.goal_tracker.update_goal_progress(
                    enhanced_goal_id,
                    result.get("success_rate", 0),
                    milestone=f"任务完成: {requirement[:50]}"
                )
            except Exception:
                pass

        # 6. 保存最终检查点
        if self.checkpoint_manager:
            try:
                self.checkpoint_manager.save_checkpoint(
                    cycle_number=result.get("cycles_executed", 0),
                    state={"phase": "complete", "brain_id": self.brain_id},
                    context={"requirement": requirement, "result": result},
                    metadata={"enhanced_goal_id": enhanced_goal_id, "final": True}
                )
            except Exception:
                pass

        # 7. 记录监控指标
        total_duration = (time.time() - process_start) * 1000
        self.monitor.record_metric("total_actions", result.get("total_actions", 0))
        self.monitor.record_metric("success_count", result.get("success_actions", 0))
        self.monitor.record_metric("error_count", result.get("errors", 0))
        self.monitor.record_metric("process_duration_ms", total_duration)

        return result

    def _build_initial_context(self, requirement: str, context: Dict):
        """构建初始上下文（聚合记忆/工具/代码）"""
        # 添加对话历史
        self.context_manager.add_conversation("user", requirement)

        # 从记忆库检索相关记忆
        if self.memory and hasattr(self.memory, 'search'):
            try:
                memories = self.memory.search(requirement, limit=5)
                for mem in memories:
                    content = mem.get('content', str(mem)) if isinstance(mem, dict) else str(mem)
                    self.context_manager.add_item("memory", content, relevance=0.7,
                                                  source="memory_library")
            except Exception as e:
                terminal.warn(f"记忆检索失败: {e}", "agent_brain")

        # 从工具库搜索相关工具
        if self.tools and hasattr(self.tools, 'search_tools'):
            try:
                tools = self.tools.search_tools(requirement, limit=5)
                for tool in tools:
                    tool_desc = tool.description if hasattr(tool, 'description') else str(tool)
                    self.context_manager.add_item("tools", tool_desc, relevance=0.6,
                                                  source="tool_library")
            except Exception as e:
                terminal.warn(f"工具搜索失败: {e}", "agent_brain")

        # 从代码库搜索相关代码
        if self.codebase and hasattr(self.codebase, 'search_code'):
            try:
                code_results = self.codebase.search_code(requirement, limit=5)
                for cr in code_results:
                    content = cr.get('snippet', str(cr)) if isinstance(cr, dict) else str(cr)
                    self.context_manager.add_item("code", content, relevance=0.65,
                                                  source="code_library")
            except Exception as e:
                terminal.warn(f"代码搜索失败: {e}", "agent_brain")

    # ===== 单步执行（非自主循环模式） =====
    def think(self, input_text: str) -> Dict[str, Any]:
        """单步思考"""
        self.state_machine.transition(AgentPhase.THINK)
        context = self.context_manager.build_context(input_text)
        thought = f"分析输入: {input_text[:100]}... 上下文包含 {context['total_tokens']} tokens"
        self.state_machine.get_state().add_thought(thought)
        return {"thought": thought, "context": context}

    def decide_action(self, available_actions: List[Dict],
                      context: Optional[Dict] = None) -> Dict[str, Any]:
        """决策下一步行动"""
        return self.decision_engine.decide(available_actions, context or {})

    def execute_action(self, action: str, parameters: Optional[Dict] = None) -> Dict[str, Any]:
        """执行单个行动"""
        self.state_machine.transition(AgentPhase.EXECUTE)
        parameters = parameters or {}
        result = {"action": action, "success": True, "output": ""}

        # 根据行动类型路由到对应模块
        if action.startswith("memory.") and self.memory:
            method = action.replace("memory.", "")
            if hasattr(self.memory, method):
                result["output"] = getattr(self.memory, method)(**parameters)
        elif action.startswith("tool.") and self.tools:
            method = action.replace("tool.", "")
            if hasattr(self.tools, method):
                result["output"] = getattr(self.tools, method)(**parameters)
        elif action.startswith("code.") and self.codebase:
            method = action.replace("code.", "")
            if hasattr(self.codebase, method):
                result["output"] = getattr(self.codebase, method)(**parameters)
        else:
            result["output"] = f"行动 {action} 已记录（无对应模块）"

        # 反思学习
        reflection = self.reflection_learner.reflect(action, str(result.get("output", "")),
                                                       result["success"])
        result["reflection"] = reflection.get("lesson", "")
        return result

    # ===== 循环控制 =====
    def pause_cycle(self):
        self.cycle.pause()

    def resume_cycle(self):
        self.cycle.resume()

    def stop_cycle(self):
        self.cycle.stop()

    # ===== 目标管理 =====
    def create_goal(self, description: str, goal_type: str = "short_term",
                    priority: str = "medium") -> Goal:
        return self.goal_manager.create_goal(description, goal_type, priority=priority)

    def get_goal_tree(self) -> Dict[str, Any]:
        return self.goal_manager.get_goal_tree()

    # ===== 上下文管理 =====
    def add_context(self, item_type: str, content: str, relevance: float = 0.5):
        self.context_manager.add_item(item_type, content, relevance)

    def get_context(self, query: str = "", max_tokens: int = 0) -> Dict[str, Any]:
        return self.context_manager.build_context(query, max_tokens=max_tokens)

    def clear_context(self):
        self.context_manager.clear()

    # ===== 经验学习 =====
    def get_lessons(self, limit: int = 20) -> List[Dict]:
        return self.reflection_learner.get_lessons(limit=limit)

    def get_success_rate(self) -> float:
        return self.reflection_learner.get_success_rate()

    # ===== 状态查询 =====
    def get_state(self) -> Dict[str, Any]:
        return self.state_machine.get_state().to_dict()

    def get_health(self) -> Dict[str, Any]:
        return self.monitor.get_health_status()

    def get_alerts(self, unacknowledged_only: bool = True) -> List[Dict]:
        return self.monitor.get_alerts(unacknowledged_only=unacknowledged_only)

    def get_cycle_history(self, limit: int = 20) -> List[Dict]:
        return self.cycle.get_cycle_history(limit)

    def get_stats(self) -> Dict[str, Any]:
        """获取完整统计"""
        return {
            "brain_id": self.brain_id,
            "project_root": self.project_root,
            "initialized": self._initialized,
            "state": self.get_state(),
            "health": self.get_health(),
            "planner": self.planner.get_stats(),
            "decision_engine": self.decision_engine.get_stats(),
            "context_manager": self.context_manager.get_stats(),
            "reflection_learner": self.reflection_learner.get_stats(),
            "goal_manager": self.goal_manager.get_stats(),
            "attention": self.attention.get_stats(),
            "monitor": self.monitor.get_stats(),
            "cycle": self.cycle.get_stats(),
            "modules": {
                "memory": self.memory is not None,
                "tools": self.tools is not None,
                "codebase": self.codebase is not None,
            },
        }

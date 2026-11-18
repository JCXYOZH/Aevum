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

from .cycle_actions import CycleActionsMixin

from .enums import AgentPhase, DecisionStrategy, GoalType, TaskPriority, TaskStatus
from .models import AgentState, CycleRecord, Goal, Task
from .state_machine import AgentStateMachine
from .planning import TaskPlanner
from .decision import DecisionEngine
from .context import ContextManager
from .reflection import ReflectionLearner
from .monitoring import SelfMonitor



class AutonomousCycle(CycleActionsMixin):
    """自主循环引擎 - 七阶段循环：感知→思考→规划→决策→执行→观察→反思→学习"""

    def __init__(self, state_machine: AgentStateMachine, planner: TaskPlanner,
                 decision_engine: DecisionEngine, context_manager: ContextManager,
                 reflection_learner: ReflectionLearner, monitor: SelfMonitor,
                 memory_module=None, tool_module=None, codebase_module=None):
        self.cycle_id = f"cycle_{uuid.uuid4().hex[:8]}"
        self.state_machine = state_machine
        self.planner = planner
        self.decision_engine = decision_engine
        self.context_manager = context_manager
        self.reflection_learner = reflection_learner
        self.monitor = monitor
        # 三大本地化能力（可选注入）
        self.memory = memory_module
        self.tools = tool_module
        self.codebase = codebase_module
        self.cycle_records: deque = deque(maxlen=100)
        self.current_record: Optional[CycleRecord] = None
        self._lock = threading.RLock()
        self._running = False
        self._paused = False

    def run(self, requirement: str, context: Optional[Dict] = None,
            max_cycles: int = 50, callback: Optional[Callable] = None) -> Dict[str, Any]:
        """运行自主循环"""
        context = context or {}
        state = self.state_machine.get_state()
        state.max_cycles = max_cycles
        state.should_stop = False
        state.is_paused = False
        self._running = True
        self._paused = False
    
        terminal.info(f"自主循环启动: {requirement[:80]}", "autonomous_cycle")
    
        # 初始规划（不转换状态，让主循环从perceive开始正常转换）
        tasks = self.planner.plan(requirement, context)
        terminal.info(f"规划完成: {len(tasks)} 个子任务", "autonomous_cycle")
    
        # 主循环
        while state.should_continue() and self._running:
            if self._paused:
                time.sleep(0.5)
                continue
    
            state.cycle_count += 1
            record = CycleRecord(state.cycle_count)
            self.current_record = record
            terminal.info(f"第 {state.cycle_count} 轮循环开始", "autonomous_cycle")
    
            try:
                # 1. 感知
                terminal.info("  [1/8] 感知阶段：收集输入和环境信息", "autonomous_cycle")
                self._phase_perceive(record, requirement, context)
                terminal.info(f"       感知完成: {record.observation[:100] if record.observation else ''}", "autonomous_cycle")
                # 2. 思考
                terminal.info("  [2/8] 思考阶段：理解需求，分析问题", "autonomous_cycle")
                self._phase_think(record, context)
                terminal.info(f"       思考完成: {record.thought[:100] if record.thought else ''}", "autonomous_cycle")
                # 3. 规划（动态调整）
                terminal.info("  [3/8] 规划阶段：动态调整任务计划", "autonomous_cycle")
                self._phase_plan(record, context)
                terminal.info(f"       规划完成: {record.plan[:100] if record.plan else ''}", "autonomous_cycle")
                # 4. 决策
                terminal.info("  [4/8] 决策阶段：选择下一步行动", "autonomous_cycle")
                decision = self._phase_decide(record, context)
                terminal.info(f"       决策完成: {record.decision[:100] if record.decision else ''}", "autonomous_cycle")
                # 5. 执行
                terminal.info(f"  [5/8] 执行阶段：执行行动 {decision.get('action', '')}", "autonomous_cycle")
                execution_result = self._phase_execute(record, decision, context)
                terminal.info(f"       执行完成: {execution_result.get('output', '')[:100]}", "autonomous_cycle")
                # 6. 观察
                terminal.info("  [6/8] 观察阶段：收集执行结果", "autonomous_cycle")
                self._phase_observe(record, execution_result)
                terminal.info(f"       观察完成: {record.observation[:100] if record.observation else ''}", "autonomous_cycle")
                # 7. 反思
                terminal.info("  [7/8] 反思阶段：评估结果，总结经验", "autonomous_cycle")
                self._phase_reflect(record, execution_result)
                terminal.info(f"       反思完成: {record.reflection[:100] if record.reflection else ''}", "autonomous_cycle")
                # 8. 学习
                terminal.info("  [8/8] 学习阶段：更新记忆和策略", "autonomous_cycle")
                self._phase_learn(record)
                terminal.info(f"       学习完成: {record.learning[:100] if record.learning else ''}", "autonomous_cycle")
    
                terminal.info(f"第 {state.cycle_count} 轮循环完成", "autonomous_cycle")
                record.complete(success=True)
                state.record_action(decision.get("action", ""),
                                   str(execution_result)[:200], True)
    
            except Exception as e:
                record.complete(success=False, error=str(e))
                state.record_action("error", str(e), False)
                state.last_error = str(e)
                terminal.error(f"循环异常 (第{state.cycle_count}轮): {e}", "autonomous_cycle")
                if state.consecutive_errors >= state.max_consecutive_errors:
                    terminal.error("连续错误过多，自动停止循环", "autonomous_cycle")
                    break
    
            with self._lock:
                self.cycle_records.append(record)
    
            # 回调
            if callback:
                try:
                    callback(record.to_dict())
                except Exception:
                    pass
    
            # 检查任务完成
            pending = self.planner.get_pending_tasks()
            in_progress = self.planner.get_in_progress_tasks()
            if not pending and not in_progress:
                terminal.info("所有任务完成，循环结束", "autonomous_cycle")
                break
    
            self.monitor.record_metric("cycle_count", state.cycle_count)
            self.monitor.record_metric("consecutive_errors", state.consecutive_errors)
    
        self._running = False
        self.state_machine.transition(AgentPhase.COMPLETE)
    
        return self._get_final_result(requirement)

    def _phase_perceive(self, record: CycleRecord, requirement: str, context: Dict):
        """感知阶段：收集输入和环境信息"""
        start = time.time()
        self.state_machine.transition(AgentPhase.PERCEIVE)
        # 感知当前任务状态
        current_task = self.planner.get_next_task()
        perception = {
            "requirement": requirement,
            "current_task": current_task.to_dict() if current_task else None,
            "pending_tasks": len(self.planner.get_pending_tasks()),
            "cycle": record.cycle_number,
            "state": self.state_machine.get_state().to_dict(),
        }
        record.observation = json.dumps(perception, ensure_ascii=False)[:500]
        record.add_phase("perceive", (time.time() - start) * 1000, "收集任务状态和环境信息")

    def _phase_think(self, record: CycleRecord, context: Dict):
        """思考阶段：理解需求，分析问题"""
        start = time.time()
        self.state_machine.transition(AgentPhase.THINK)
        state = self.state_machine.get_state()
        # 构建思考上下文
        thought_context = self.context_manager.build_context(
            query=context.get("current_task", ""),
            max_tokens=4000
        )
        thought = (f"第{record.cycle_number}轮思考：当前任务进度 "
                  f"{len(self.planner.completed_tasks)}/{len(self.planner.tasks)}，"
                  f"连续错误 {state.consecutive_errors} 次，"
                  f"需要评估下一步最优行动。")
        state.add_thought(thought)
        record.thought = thought
        record.add_phase("think", (time.time() - start) * 1000, "分析当前状态和问题")

    def _phase_plan(self, record: CycleRecord, context: Dict):
        """规划阶段：动态调整任务计划"""
        start = time.time()
        self.state_machine.transition(AgentPhase.PLAN)
        # 检查是否需要插入新任务
        current_task = self.planner.get_next_task()
        plan_note = f"当前任务: {current_task.description if current_task else '无'}"
        record.plan = plan_note
        record.add_phase("plan", (time.time() - start) * 1000, plan_note)

    def _phase_decide(self, record: CycleRecord, context: Dict) -> Dict[str, Any]:
        """决策阶段：选择下一步行动"""
        start = time.time()
        self.state_machine.transition(AgentPhase.DECIDE)
        current_task = self.planner.get_next_task()
    
        # 构建可用行动列表
        available_actions = []
        if current_task:
            task_type = current_task.task_type
            # 根据任务类型生成行动
            if task_type in ("coding", "design"):
                available_actions.append({
                    "action": "write_code",
                    "description": f"编写代码: {current_task.description}",
                    "priority": 0.9, "risk": "medium", "expected_value": 0.8,
                    "required_context": ["codebase"],
                })
            elif task_type in ("analysis", "research"):
                available_actions.append({
                    "action": "search_memory",
                    "description": f"检索记忆: {current_task.description}",
                    "priority": 0.8, "risk": "low", "expected_value": 0.7,
                    "required_context": ["memory"],
                })
                available_actions.append({
                    "action": "search_code",
                    "description": f"搜索代码: {current_task.description}",
                    "priority": 0.7, "risk": "low", "expected_value": 0.6,
                    "required_context": ["codebase"],
                })
            elif task_type in ("scanning", "recon", "vuln_scan"):
                available_actions.append({
                    "action": "execute_tool",
                    "description": f"执行工具: {current_task.description}",
                    "priority": 0.9, "risk": "medium", "expected_value": 0.8,
                    "required_context": ["tools"],
                })
            elif task_type in ("verification", "testing"):
                available_actions.append({
                    "action": "run_test",
                    "description": f"运行测试: {current_task.description}",
                    "priority": 0.85, "risk": "low", "expected_value": 0.9,
                })
                available_actions.append({
                    "action": "review_code",
                    "description": f"代码审查: {current_task.description}",
                    "priority": 0.75, "risk": "low", "expected_value": 0.7,
                })
            else:
                available_actions.append({
                    "action": "execute_general",
                    "description": f"执行: {current_task.description}",
                    "priority": 0.7, "risk": "medium", "expected_value": 0.6,
                })
        else:
            available_actions.append({
                "action": "complete",
                "description": "所有任务完成",
                "priority": 1.0, "risk": "low", "expected_value": 1.0,
            })
    
        # 决策
        decision = self.decision_engine.decide(available_actions, context)
        record.decision = decision.get("action", "") + ": " + decision.get("reason", "")
        record.add_phase("decide", (time.time() - start) * 1000,
                        f"选择行动: {decision.get('action', '')}")
        return decision

    def _phase_observe(self, record: CycleRecord, execution_result: Dict[str, Any]):
        """观察阶段：收集执行结果"""
        start = time.time()
        self.state_machine.transition(AgentPhase.OBSERVE)
        observation = f"执行结果: success={execution_result.get('success')}, output={execution_result.get('output', '')[:200]}"
        self.state_machine.get_state().add_observation(observation)
        record.observation = observation
        record.add_phase("observe", (time.time() - start) * 1000, "收集执行结果")

    def _phase_reflect(self, record: CycleRecord, execution_result: Dict[str, Any]):
        """反思阶段：评估结果，总结经验"""
        start = time.time()
        self.state_machine.transition(AgentPhase.REFLECT)
        success = execution_result.get("success", False)
        current_task = self.planner.get_next_task()
        task_desc = current_task.description if current_task else "未知任务"
    
        reflection = self.reflection_learner.reflect(
            action=record.action,
            result=execution_result.get("output", ""),
            success=success,
            context={"task": task_desc, "cycle": record.cycle_number}
        )
    
        # 完成或失败当前任务
        if current_task:
            if success:
                self.planner.complete_task(current_task.task_id, execution_result.get("output", ""))
            else:
                self.planner.fail_task(current_task.task_id, reflection.get("analysis", ""))
                if current_task.can_retry():
                    self.planner.retry_task(current_task.task_id)
    
        record.reflection = reflection.get("lesson", "")
        record.add_phase("reflect", (time.time() - start) * 1000,
                        reflection.get("analysis", "")[:200])

    def _phase_learn(self, record: CycleRecord):
        """学习阶段：更新记忆和策略"""
        start = time.time()
        self.state_machine.transition(AgentPhase.LEARN)
        lessons = self.reflection_learner.get_lessons(limit=5)
        learning = f"已积累 {len(self.reflection_learner.lessons)} 条经验教训，" \
                  f"总体成功率 {self.reflection_learner.get_success_rate()*100:.1f}%"
        record.learning = learning
        record.add_phase("learn", (time.time() - start) * 1000, learning)

    def pause(self):
        self._paused = True
        self.state_machine.transition(AgentPhase.PAUSED)
        terminal.info("自主循环已暂停", "autonomous_cycle")

    def resume(self):
        self._paused = False
        self.state_machine.transition(AgentPhase.PERCEIVE)
        terminal.info("自主循环已恢复", "autonomous_cycle")

    def stop(self):
        self._running = False
        self.state_machine.get_state().should_stop = True
        terminal.info("自主循环已停止", "autonomous_cycle")

    def is_running(self) -> bool:
        return self._running

    def get_current_record(self) -> Optional[CycleRecord]:
        return self.current_record

    def get_cycle_history(self, limit: int = 20) -> List[Dict]:
        return [r.to_dict() for r in list(self.cycle_records)[-limit:]]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "cycle_id": self.cycle_id,
            "running": self._running,
            "paused": self._paused,
            "total_cycles": len(self.cycle_records),
            "current_cycle": self.state_machine.get_state().cycle_count,
        }

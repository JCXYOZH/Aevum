"""职责模块：singleton。"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from .engine import OrchestrationEngine

_orch_engine = OrchestrationEngine()

def get_orchestration_engine() -> OrchestrationEngine:
    return _orch_engine

def orchestrate(name: str, **kwargs) -> Dict[str, Any]:
    plan = _orch_engine.create_plan(name, **kwargs)
    return _orch_engine.execute_plan(plan.plan_id)

def get_followup_tasks(tool_name: str, tool_result: Dict) -> List[Dict]:
    return _orch_engine.get_followup_tasks(tool_name, tool_result)

# 智能管线协调器
# 整合：意图分类 → 工具匹配 → help解析 → 动态提示词 → 输出校验 → 兜底
# 作为 model_engine.py 的新管线入口，替代旧的正则意图判断
import time
import threading
from typing import Dict, List, Optional, Any, Callable

from libertas.ai.intent_classifier import get_intent_classifier
from libertas.tools.tool_matcher import get_tool_matcher
from libertas.tools.help_parser import get_help_parser
from libertas.ai.dynamic_prompt import build_dynamic_context, build_function_definitions
from libertas.ai.output_validator import validate_output, build_fallback_prompt, ValidationResult
from libertas.workflow.task_planner import decompose_task, format_steps_for_prompt, detect_multi_step


class PipelineCoordinator:
    """统一管线协调器。

    使用方式：
        pc = get_pipeline_coordinator()
        # 1. 分析用户消息
        analysis = pc.analyze("帮我用nmap扫一下192.168.1.1")
        # 2. 获取动态上下文（注入系统提示词）
        context = pc.build_context(analysis, search_results_text="...")
        # 3. 校验模型输出
        validation = pc.validate(reply, analysis, search_urls=[...])
        # 4. 如果有问题，获取兜底提示词
        if not validation.ok:
            fallback = pc.get_fallback(validation, user_message, search_results_text)
    """

    def __init__(self):
        self._intent_clf = None
        self._tool_matcher = None
        self._help_parser = None
        self._lock = threading.Lock()
        self._initialized = False

        # 设置（可从config覆盖）
        self._settings = {
            "top_k_tools": 5,
            "auto_attach_help": True,
            "help_max_chars": 2000,
            "tool_confirm": False,
            "enable_semantic_rerank": True,
            "batch_max_workers": 5,
            "batch_task_timeout": 30.0,
            "batch_result_max_chars": 500,
        }

    def _ensure_init(self):
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            self._intent_clf = get_intent_classifier()
            self._tool_matcher = get_tool_matcher()
            self._help_parser = get_help_parser()
            self._initialized = True

    def update_settings(self, **kwargs):
        """更新设置（从设置页面调用）。"""
        self._settings.update(kwargs)

    def analyze(self, user_message: str) -> Dict[str, Any]:
        """分析用户消息：意图分类 + 工具匹配 + help获取。

        返回完整分析结果，包含：
        - intent: 意图分类结果
        - keyword: 搜索关键词
        - matched_tools: 匹配的工具列表
        - tool_help: {工具名: help文本}
        - timing: 各阶段耗时
        """
        self._ensure_init()
        t0 = time.time()

        # 1. 意图分类
        intent = self._intent_clf.classify(user_message)
        t_intent = time.time() - t0

        # 2. 工具匹配（仅在工具意图或不确定时）
        matched_tools = []
        tool_help = {}
        t_tool = 0.0
        if (intent["needs_tool"] or intent.get("uncertain", False)) and not intent.get("is_meta", False):
            t1 = time.time()
            matched_tools = self._tool_matcher.match(
                user_message, top_k=self._settings["top_k_tools"]
            )
            t_tool = time.time() - t1

            # 3. 获取已安装工具的help
            if self._settings["auto_attach_help"]:
                for t in matched_tools:
                    if t.get("installed") and not t.get("native"):
                        try:
                            help_text = self._help_parser.get_help(
                                t["name"],
                                max_chars=self._settings["help_max_chars"],
                            )
                            if help_text:
                                tool_help[t["name"]] = help_text
                        except Exception:
                            pass
                    elif t.get("native"):
                        # 原生工具：从函数签名生成帮助
                        try:
                            import inspect
                            from ..tools import native_tools as _nt
                            func_name = f"native_{t['name']}"
                            func = getattr(_nt, func_name, None)
                            if func:
                                sig = inspect.signature(func)
                                params = []
                                for pname, param in sig.parameters.items():
                                    if pname == "timeout":
                                        continue
                                    if param.default is inspect.Parameter.empty:
                                        params.append(pname)
                                    else:
                                        params.append(f"{pname}={param.default!r}")
                                doc = (func.__doc__ or "").strip().split("\n")[0] if func.__doc__ else t["description"]
                                tool_help[t["name"]] = (
                                    f"工具: {t['name']}\n"
                                    f"说明: {doc}\n"
                                    f"参数: {', '.join(params)}\n"
                                    f"调用: <<<TOOL:{t['name']} <目标> [选项]>>>"
                                )
                            else:
                                tool_help[t["name"]] = f"工具: {t['name']}\n{t['description']}"
                        except Exception:
                            tool_help[t["name"]] = f"工具: {t['name']}\n{t['description']}"

        # 4. 多步骤任务分解
        task_steps = []
        task_steps_text = ""
        if detect_multi_step(user_message):
            task_steps = decompose_task(user_message)
            task_steps_text = format_steps_for_prompt(task_steps)

        # 多步骤任务：检查所有步骤是否需要搜索/工具
        needs_search = intent["needs_search"]
        needs_tool = intent["needs_tool"]
        for step in task_steps:
            if step.step_type == "search":
                needs_search = True
            elif step.step_type in ("scan", "tool", "fetch"):
                needs_tool = True

        return {
            "intent": intent,
            "keyword": intent["keyword"],
            "needs_search": needs_search,
            "needs_tool": needs_tool,
            "matched_tools": matched_tools,
            "tool_help": tool_help,
            "task_steps": task_steps,
            "task_steps_text": task_steps_text,
            "timing": {
                "intent_ms": round(t_intent * 1000, 1),
                "tool_match_ms": round(t_tool * 1000, 1),
            },
        }

    def build_context(self, analysis: Dict, search_results_text: str = "") -> str:
        """根据分析结果构建动态提示词上下文。"""
        ctx = build_dynamic_context(
            intent=analysis["intent"],
            matched_tools=analysis["matched_tools"],
            tool_help_texts=analysis["tool_help"],
            search_results_summary=search_results_text,
            settings=self._settings,
        )
        # 追加任务分解指令
        steps_text = analysis.get("task_steps_text", "")
        if steps_text:
            ctx = (ctx + "\n\n" + steps_text) if ctx else steps_text
        return ctx

    def build_functions(self, analysis: Dict) -> List[Dict]:
        """构建 Function Calling 工具定义（如果API支持）。"""
        if not analysis["matched_tools"]:
            return []
        return build_function_definitions(
            analysis["matched_tools"], analysis["tool_help"]
        )

    def validate(self, model_output: str, analysis: Dict,
                 search_urls: List[str] = None) -> ValidationResult:
        """校验模型输出。"""
        return validate_output(
            text=model_output,
            search_results_urls=search_urls or [],
            expect_tool=analysis.get("needs_tool", False),
            expect_search=analysis.get("needs_search", False),
        )

    def get_fallback(self, validation: ValidationResult, user_message: str,
                     search_results_text: str = "", analysis: Dict = None) -> str:
        """根据校验结果生成兜底提示词。"""
        matched_tools = []
        if analysis:
            matched_tools = analysis.get("matched_tools", [])
        return build_fallback_prompt(
            validation=validation,
            original_query=user_message,
            search_results=search_results_text,
            matched_tools=matched_tools,
        )


# 全局单例
_coordinator: Optional[PipelineCoordinator] = None
_coordinator_lock = threading.Lock()


def get_pipeline_coordinator() -> PipelineCoordinator:
    global _coordinator
    if _coordinator is None:
        with _coordinator_lock:
            if _coordinator is None:
                _coordinator = PipelineCoordinator()
    return _coordinator


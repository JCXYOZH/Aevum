"""动态提示词职责：assembler。"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from libertas.foundation.config import get_data_dir

from .models import PromptComponent
from .models import PromptTemplate

class DynamicPromptAssembler:
    """动态提示词组装器（融合两个版本）"""

    def __init__(self, data_dir: str = ""):
        self.data_dir = data_dir or os.path.join(get_data_dir(), "prompts")
        os.makedirs(self.data_dir, exist_ok=True)
        self._components: Dict[str, PromptComponent] = {}
        self._templates: Dict[str, PromptTemplate] = {}
        self._cache: Dict[str, str] = {}
        self._lock = threading.RLock()
        self._init_default_components()
        self._load()

    # ========================================================
    # 默认组件（扩展到15+，吸收0.1.5）
    # ========================================================

    def _init_default_components(self):
        """初始化默认组件（扩展，吸收0.1.5的动态上下文）"""
        defaults = [
            # 基础系统
            PromptComponent("system_base", "你是一个专业的AI助手。", "system", priority=100,
                          description="基础系统提示"),
            # 角色
            PromptComponent("role_analyst", "你是一个专业分析师，擅长数据分析和逻辑推理。", "role", priority=90,
                          conditions={"task_type": "analysis"}, description="分析师角色"),
            PromptComponent("role_coder", "你是一个资深程序员，擅长编写高质量代码。", "role", priority=90,
                          conditions={"task_type": "coding"}, description="程序员角色"),
            PromptComponent("role_security", "你是一个网络安全专家，擅长漏洞分析和渗透测试。", "role", priority=90,
                          conditions={"task_type": "security"}, description="安全专家角色"),
            # 输出格式
            PromptComponent("output_json", "请以JSON格式输出，不要包含其他文字。", "output", priority=80,
                          conditions={"output_format": "json"}, description="JSON输出格式"),
            PromptComponent("output_markdown", "请以Markdown格式输出。", "output", priority=80,
                          conditions={"output_format": "markdown"}, description="Markdown输出格式"),
            # 上下文
            PromptComponent("context_memory", "相关记忆：\n{{ memory_context }}", "context", priority=70,
                          conditions={"include_memory": True}, description="记忆上下文"),
            PromptComponent("fewshot_examples", "示例：\n{% for ex in examples %}\nQ: {{ ex.question }}\nA: {{ ex.answer }}\n{% endfor %}",
                          "fewshot", priority=60, conditions={"include_examples": True},
                          description="少样本示例"),
            # 搜索结果注入（吸收0.1.5）
            PromptComponent("search_results",
                          "【网络搜索结果】\n"
                          "以下是本地系统搜索到的网络信息，你必须基于这些结果回答，不得拒绝或推脱：\n\n"
                          "{{ search_results_summary }}\n\n"
                          "要求：\n"
                          "- 直接使用以上搜索结果回答，不要说'让我搜索'、'我无法访问网络'等话\n"
                          "- 完整介绍搜索结果中的信息，不要只说一句话摘要\n"
                          "- 引用信息时标注来源URL\n"
                          "- 如果搜索结果不足以回答，明确说明，不要编造",
                          "context", priority=75,
                          conditions={"include_search_results": True},
                          description="搜索结果注入（吸收0.1.5）"),
            # 工具调用指令（吸收0.1.5）
            PromptComponent("tool_call_instructions",
                          "【安全工具调用】\n"
                          "用户需要使用安全工具。以下是匹配到的工具（按相关度排序）：\n"
                          "{{ tool_list }}\n\n"
                          "调用规则：\n"
                          "- 优先使用已安装([OK])的工具，未安装([FAIL])的工具提示用户安装\n"
                          "- 内置工具可以直接调用，不需要安装\n"
                          "- 调用格式：<<<TOOL:工具名 目标 [选项]>>>\n"
                          "- 目标直接写域名或IP，不要带http://前缀和路径\n"
                          "- 工具标签必须独占一行，前后不要有其他文字\n"
                          "- 不要编造工具执行结果，等待系统返回\n"
                          "- 多个目标/工具批量执行时用BATCH块（系统自动并行）：\n"
                          "  <<<BATCH>>>\n"
                          "  target: 目标1, 目标2, 目标3\n"
                          "  tools: dns_lookup A, http_fingerprint, port_scan -p 1-1000\n"
                          "  <<<END>>>\n"
                          "- function calling 和 TOOL/BATCH 标签两种方式都可以，优先用 function calling",
                          "context", priority=75,
                          conditions={"include_tool_instructions": True},
                          description="工具调用指令（吸收0.1.5）"),
            # 代码任务指令（吸收0.1.5）
            PromptComponent("code_task",
                          "【代码任务】\n"
                          "- 代码用markdown代码块包裹，标注语言\n"
                          "- 代码要完整可运行，不要省略关键逻辑\n"
                          "- 需要写入文件时使用 <<<FILE:路径>>> ... <<<END>>> 格式\n"
                          "- 解释代码思路要简洁，重点在代码本身",
                          "context", priority=70,
                          conditions={"is_code_task": True},
                          description="代码任务指令（吸收0.1.5）"),
            # 闲聊模式（吸收0.1.5）
            PromptComponent("chat_mode",
                          "【对话模式】\n"
                          "这是日常对话，保持人格设定自然回应即可，不需要调用工具或搜索。",
                          "context", priority=60,
                          conditions={"is_chat_mode": True},
                          description="闲聊模式（吸收0.1.5）"),
            # 意图判断（吸收0.1.5）
            PromptComponent("intent_judgment",
                          "【意图判断】\n"
                          "如果用户的问题需要最新网络信息才能回答，输出 <<<WEB_SEARCH:关键词>>>；"
                          "如果需要安全工具，输出 <<<TOOL:工具名 参数>>>；"
                          "否则直接回答。",
                          "context", priority=65,
                          conditions={"needs_intent_judgment": True},
                          description="意图判断（吸收0.1.5）"),
            # 安全合规
            PromptComponent("security_compliance",
                          "【安全合规】\n"
                          "- 所有操作必须在授权范围内进行\n"
                          "- 不得提供未经授权的攻击手段\n"
                          "- 敏感信息需要脱敏处理",
                          "system", priority=95,
                          conditions={"include_security_compliance": True},
                          description="安全合规"),
        ]
        for comp in defaults:
            self._components[comp.name] = comp

    # ========================================================
    # 持久化
    # ========================================================

    def _load(self):
        """加载自定义组件和模板"""
        comp_file = os.path.join(self.data_dir, "components.json")
        try:
            if os.path.exists(comp_file):
                with open(comp_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for c_data in data.get("components", []):
                    comp = PromptComponent(
                        name=c_data["name"], content=c_data.get("content", ""),
                        component_type=c_data.get("component_type", "general"),
                        priority=c_data.get("priority", 0),
                        enabled=c_data.get("enabled", True),
                        conditions=c_data.get("conditions", {}),
                        description=c_data.get("description", ""),
                    )
                    self._components[comp.name] = comp
        except Exception:
            pass

    def _save(self):
        comp_file = os.path.join(self.data_dir, "components.json")
        try:
            default_names = {"system_base", "role_analyst", "role_coder", "role_security",
                           "output_json", "output_markdown", "context_memory", "fewshot_examples",
                           "search_results", "tool_call_instructions", "code_task",
                           "chat_mode", "intent_judgment", "security_compliance"}
            data = {
                "version": "2.0", "updated_at": time.time(),
                "components": [c.to_dict() for c in self._components.values()
                              if c.name not in default_names],
            }
            with open(comp_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    # ========================================================
    # 组件管理
    # ========================================================

    def register_component(self, component: PromptComponent):
        with self._lock:
            self._components[component.name] = component
            self._save()

    def get_component(self, name: str) -> Optional[PromptComponent]:
        return self._components.get(name)

    def list_components(self, component_type: str = "", enabled_only: bool = False) -> List[PromptComponent]:
        comps = list(self._components.values())
        if component_type:
            comps = [c for c in comps if c.component_type == component_type]
        if enabled_only:
            comps = [c for c in comps if c.enabled]
        return sorted(comps, key=lambda c: c.priority, reverse=True)

    def remove_component(self, name: str) -> bool:
        with self._lock:
            if name in self._components:
                del self._components[name]
                self._save()
                return True
        return False

    def register_template(self, template: PromptTemplate):
        with self._lock:
            self._templates[template.name] = template

    # ========================================================
    # 组装
    # ========================================================

    def assemble(self, template_name: str = "", context: Optional[Dict[str, Any]] = None,
                 component_names: Optional[List[str]] = None,
                 token_budget: int = 4096) -> Dict[str, Any]:
        """组装提示词"""
        context = context or {}
        sections = []
        total_tokens = 0
        used_components = []

        # 确定要使用的组件
        if component_names:
            comps = [self._components[n] for n in component_names if n in self._components]
        elif template_name and template_name in self._templates:
            template = self._templates[template_name]
            comps = [self._components[n] for n in template.components if n in self._components]
        else:
            comps = self.list_components(enabled_only=True)

        # 按优先级排序并渲染
        for comp in sorted(comps, key=lambda c: c.priority, reverse=True):
            if not comp.enabled:
                continue
            rendered = comp.render(context)
            if not rendered:
                continue
            comp_tokens = comp.estimate_tokens()
            if total_tokens + comp_tokens > token_budget:
                continue
            sections.append(rendered)
            total_tokens += comp_tokens
            used_components.append(comp.name)

        system_prompt = "\n\n".join(sections)
        cache_key = f"{template_name}:{json.dumps(context, sort_keys=True, default=str)}"
        self._cache[cache_key] = system_prompt

        return {
            "system_prompt": system_prompt,
            "components_used": used_components,
            "total_tokens": total_tokens,
            "token_budget": token_budget,
        }

    def assemble_simple(self, system_prompt: str = "", user_context: str = "",
                        context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """简单组装"""
        context = context or {}
        result = self.assemble(context=context)
        if system_prompt:
            result["system_prompt"] = system_prompt + "\n\n" + result["system_prompt"]
        if user_context:
            result["user_prompt"] = user_context
        return result

    # ========================================================
    # 动态上下文构建（吸收0.1.5）
    # ========================================================

    def build_dynamic_context(self, intent: Dict[str, Any],
                              matched_tools: List[Dict] = None,
                              tool_help_texts: Dict[str, str] = None,
                              search_results_summary: str = "",
                              settings: Dict[str, Any] = None) -> str:
        """根据意图和工具匹配结果，构建动态上下文片段（吸收0.1.5）"""
        settings = settings or {}
        matched_tools = matched_tools or []
        tool_help_texts = tool_help_texts or {}
        sections = []

        needs_search = intent.get("needs_search", False)
        needs_tool = intent.get("needs_tool", False)
        is_code = intent.get("code", 0) >= 0.60
        is_chat = not needs_search and not needs_tool and not is_code

        # 搜索结果注入
        if search_results_summary:
            context = dict(self._components.get("search_results", PromptComponent()).conditions)
            context["include_search_results"] = True
            context["search_results_summary"] = search_results_summary
            rendered = self._components["search_results"].render(context)
            if rendered:
                sections.append(rendered)

        # 工具调用指令
        if needs_tool and matched_tools:
            tool_lines = []
            for i, t in enumerate(matched_tools, 1):
                status = "[OK]已安装" if t.get("installed") else "[FAIL]未安装"
                native_tag = " [内置]" if t.get("native") else ""
                tool_lines.append(f"{i}. {t['name']}{native_tag} ({status}) - {t['description']}")

            help_section = ""
            if tool_help_texts and settings.get("auto_attach_help", True):
                help_parts = []
                for t in matched_tools:
                    if t.get("installed") and t["name"] in tool_help_texts:
                        help_parts.append(tool_help_texts[t["name"]])
                if help_parts:
                    help_section = "\n\n【工具帮助文档】\n以下是相关工具的帮助信息，调用时参考这些参数：\n\n" + "\n\n---\n\n".join(help_parts)

            confirm_rule = ""
            if settings.get("tool_confirm", False):
                confirm_rule = "\n- 调用工具前先告知用户你要执行的命令，等待确认"

            context = {
                "include_tool_instructions": True,
                "tool_list": "\n".join(tool_lines),
            }
            rendered = self._components["tool_call_instructions"].render(context)
            if rendered:
                sections.append(rendered + confirm_rule + help_section)

        # 代码任务指令
        if is_code:
            context = {"is_code_task": True}
            rendered = self._components["code_task"].render(context)
            if rendered:
                sections.append(rendered)

        # 闲聊模式
        if is_chat and not search_results_summary:
            context = {"is_chat_mode": True}
            rendered = self._components["chat_mode"].render(context)
            if rendered:
                sections.append(rendered)

        # 意图判断
        if intent.get("uncertain") and not needs_search and not needs_tool:
            context = {"needs_intent_judgment": True}
            rendered = self._components["intent_judgment"].render(context)
            if rendered:
                sections.append(rendered)

        if not sections:
            return ""
        return "\n\n".join(sections)

    # ========================================================
    # 函数定义构建（吸收0.1.5）
    # ========================================================

    def build_function_definitions(self, matched_tools: List[Dict],
                                   tool_help_texts: Dict[str, str] = None) -> List[Dict]:
        """为 Function Calling 构建工具定义（吸收0.1.5，OpenAI格式）"""
        tool_help_texts = tool_help_texts or {}
        functions = []

        for t in matched_tools:
            if not t.get("installed") and not t.get("native"):
                continue

            description = t["description"]
            if t["name"] in tool_help_texts:
                help_text = tool_help_texts[t["name"]]
                if len(help_text) > 1500:
                    help_text = help_text[:1500] + "..."
                description = f"{description}\n\n工具帮助:\n{help_text}"

            functions.append({
                "type": "function",
                "function": {
                    "name": f"security_tool_{t['name']}",
                    "description": description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {
                                "type": "string",
                                "description": f"要执行的 {t['name']} 命令参数，例如: -sV 192.168.1.1",
                            },
                            "target": {
                                "type": "string",
                                "description": "目标主机/IP/URL/域名",
                            },
                        },
                        "required": ["target"],
                    },
                },
            })

        return functions

    # ========================================================
    # 缓存和统计
    # ========================================================

    def get_cache(self, key: str) -> Optional[str]:
        return self._cache.get(key)

    def clear_cache(self):
        self._cache.clear()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_components": len(self._components),
            "enabled_components": len([c for c in self._components.values() if c.enabled]),
            "total_templates": len(self._templates),
            "cache_size": len(self._cache),
            "component_types": {},
            "components": [
                {"name": c.name, "type": c.component_type, "priority": c.priority,
                 "enabled": c.enabled, "tokens": c.estimate_tokens()}
                for c in self.list_components()
            ],
        }

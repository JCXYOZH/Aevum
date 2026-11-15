from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .prompt_context import *  # noqa: F401,F403
from .prompt_settings import *  # noqa: F401,F403
from .message_safety import *  # noqa: F401,F403
from .cloud_api import *  # noqa: F401,F403
from .tool_retry import *  # noqa: F401,F403
from .cloud_stream import *  # noqa: F401,F403
from .model_lifecycle import *  # noqa: F401,F403
from .model_load_fallback import *  # noqa: F401,F403
from .generation import *  # noqa: F401,F403
from .generation_stream import *  # noqa: F401,F403

class ModelEnginePromptBuilder(object):
    def _get_thinking_template(self, user_id: str = None, question: str = "") -> str:
        """
        获取用于补充 <thinking> 标签的模板文本。
        子类或外部可覆写此方法以实现动态逻辑。
        默认从 config.yaml 读取，若未配置则返回默认通用模板。
        """
        # 方式一：从全局 config 读取（原有方式）
        from libertas.foundation.config import config as global_config
        template = global_config.get('thinking_fallback_template', '')
        if template:
            return template.format(question=question)
    
        # 方式二：可根据 user_id 从用户规则中读取自定义模板
        if user_id:
            try:
                rules = self.user_manager.load_rules(user_id)
                custom_template = rules.get("思考模板")  # 允许用户在 rules.json 中自定义
                if custom_template:
                    return custom_template.format(question=question)
            except Exception:
                pass
                
        # 方式三：默认通用模板（最终后备）
        return f"思考：用户问的是“{question}...”，我将基于已有知识给出回应。"
    def _ensure_thinking_tag(self, content: str, prompt: str, user_id: str = None) -> str:
        """清理不完整的thinking标签，保留完整标签对。不生成假思考内容。"""
        # 防御：确保 content 是 str
        if isinstance(content, bytes):
            content = content.decode('utf-8', errors='replace')
        elif content is not None and not isinstance(content, str):
            content = str(content)
        import re
        # 如果有完整的标签对，保留不动
        if re.search(r'<thinking>.*?</thinking>', content, re.DOTALL):
            # 只清理完整标签对之外的残留碎片
            def clean_outside(m):
                return m.group(0)
            # 先提取完整标签对保护起来
            placeholders = []
            def protect(m):
                placeholders.append(m.group(0))
                return f"\x00{len(placeholders)-1}\x00"
            protected = re.sub(r'<thinking>.*?</thinking>', protect, content, flags=re.DOTALL)
            # 清理残留碎片
            protected = re.sub(r'</?t?h?i?n?k?i?n?g?>?', '', protected)
            # 还原完整标签对
            for i, ph in enumerate(placeholders):
                protected = protected.replace(f"\x00{i}\x00", ph)
            return protected
        else:
            # 没有完整标签对，清理所有标签碎片
            return re.sub(r'</?t?h?i?n?k?i?n?g?>?', '', content)
    def _building_intelligent_prompts(self, user_input: str, context: Dict[str, Any] = None, include_thinking: bool = True, include_history: bool = True) -> str:
        """
        构建用户侧提示词（含记忆检索、上下文）。
        注意：系统提示词通过 system message 发送，不在此重复。
        include_history: 本地模型需要在prompt中包含历史；云端API通过messages发送历史，应设为False。
        """
        # ----- 1. 防御策略 -----
        # 防御：确保 user_input 是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        defense = "弱防御"
        if any(w in user_input for w in ["你是谁", "是不是AI", "真的吗"]):
            defense = "强防御"
        elif len(self.conversation_history) > 5:
            defense = "中防御"

        # 获取当前身份名字（从系统提示词配置中读取，不硬编码）
        try:
            username = self.user_manager.get_effective_username()
            rules = self.user_manager.load_rules(username)
            identity = rules.get("身份信息", {})
            sub_id = self._get_active_sub_identity()
            if sub_id:
                identity = {**identity, **sub_id}
            current_name = identity.get("名字", identity.get("name", ""))
        except Exception:
            current_name = ""
        if not current_name:
            try:
                preset = self.prompt_engine.persona_presets.get(self.prompt_engine.current_persona, {})
                current_name = preset.get("name", "")
            except Exception:
                current_name = ""

        obedience = self.prompt_engine.current_obedience if hasattr(self, 'prompt_engine') else "balanced"
        if defense == "强防御":
            inst = f"【规则强制执行】你必须保持{current_name}的身份，绝不能承认自己是AI。"
        elif obedience == "strict":
            inst = "【严格执行】直接回答，不添加多余内容。"
        elif obedience == "obedient":
            inst = "【顺从模式】优先满足用户要求，直接执行。"
        elif obedience == "absolute":
            inst = "【绝对服从】立即执行，不质疑，不推脱。"
        else:
            inst = ""

        # ----- 2. 对话历史与上下文 -----
        # 云端API通过messages数组发送历史，不需要在prompt中重复；本地模型需要
        history = ""
        if include_history and self.conversation_history:
            # 用当前人格名替换历史中的"花先生:"前缀
            hist_lines = []
            for entry in self.conversation_history:
                if entry.startswith("花先生: "):
                    hist_lines.append(entry.replace("花先生: ", f"{current_name or '助手'}: ", 1))
                else:
                    hist_lines.append(entry)
            history = "\n".join(hist_lines)
        context_text = self._format_context(context)
        related_memories_text = self._retrieve_related_memories(user_input, context)
        rag_context_text = self._retrieve_rag_context(user_input)
        feed_context_text = self._retrieve_feed_context(user_input)

        # 云端隐私：按分类过滤敏感数据
        is_cloud = not include_history  # 云端调用时 include_history=False
        if is_cloud:
            if not self._privacy_allows("memory"):
                related_memories_text = ""
            if not self._privacy_allows("knowledge"):
                rag_context_text = ""
            if not self._privacy_allows("feedback"):
                feed_context_text = ""
            if not self._privacy_allows("user_context"):
                context_text = ""
            if not self._privacy_allows("scan"):
                # 记忆文本中可能包含扫描结果，进一步过滤
                related_memories_text = self._filter_scan_from_text(related_memories_text)
                context_text = self._filter_scan_from_text(context_text)

        # ----- 3. 用户 prompt（不重复系统提示词）-----
        prompt = ""
        if inst:
            prompt += inst + "\n"
        if history:
            prompt += f"对话历史:\n{history}\n\n"
        if context_text:
            prompt += f"用户上下文:\n{context_text}\n\n"
        if related_memories_text:
            prompt += f"相关记忆信息:\n{related_memories_text}\n\n"
        if rag_context_text:
            prompt += f"{rag_context_text}\n\n"
        if feed_context_text:
            prompt += f"{feed_context_text}\n\n"
        prompt += f"用户问题：{user_input}"

        # ----- 4. 深度思考指令（根据配置启用） -----
        if include_thinking:
            # 4.1 全局开关（config.yaml）
            global_enabled = self.configuration.get("系统", {}).get("启用深度思考", True)
            if not global_enabled:
                return prompt

            # 4.2 用户规则中的开关（默认开启）
            user_enabled = self._get_thinking_config("enabled", True)
            if not user_enabled:
                return prompt

            # 4.3 尝试生成动态思考内容
            dynamic_thinking = self._generate_thinking_from_memory(
                user_input,
                self.user_manager.get_current_username() if self.user_manager else None
            )

            if dynamic_thinking:
                thinking_instruction = dynamic_thinking
            else:
                # 4.4 回退到用户自定义静态模板（若有）
                user_fallback = self._get_thinking_config("fallback_template")
                if user_fallback:
                    thinking_instruction = f"<thinking>{user_fallback}</thinking>"
                else:
                    # 4.5 回退到全局静态模板（config.yaml）
                    global_fallback = self.configuration.get("系统", {}).get("静态思考模板")
                    if global_fallback:
                        thinking_instruction = global_fallback
                    else:
                        # 4.6 最终保底：使用类常量（与未登录时一致）
                        thinking_instruction = self.THINKING_INSTRUCTION

            # 4.7 将思考指令插入到用户问题之前
            prompt = prompt.replace("用户问题：", f"{thinking_instruction}\n\n用户问题：")

        return prompt
    def _format_context(self, context: Dict[str, Any]) -> str:
        if not context or not isinstance(context, dict):
            return ""
        lines = []
        for key, value in context.items():
            if value is None:
                continue
            # 防御：确保 key 是 str
            if not isinstance(key, str):
                key = str(key)
            if isinstance(value, bytes):
                value = value.decode('utf-8', errors='replace')
            elif isinstance(value, (dict, list)):
                try:
                    value = json.dumps(value, ensure_ascii=False)
                except Exception:
                    value = str(value)
            elif not isinstance(value, str):
                value = str(value)
            lines.append(f"{key}: {value}")
        return "\n".join(lines)
    def _retrieve_rag_context(self, user_input: str) -> str:
        """从 RAG 知识库检索相关文档，返回格式化上下文字符串"""
        # 防御：确保 user_input 是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        try:
            from libertas.tools.legacy_tools.rag_engine import RAGKnowledgeBase
            from libertas.foundation.config import config as global_config, data_path
            if not hasattr(self, '_rag_kb') or self._rag_kb is None:
                rag_dir = global_config.resolve_path(global_config.get('rag_dir', '')) or data_path('RAG')
                self._rag_kb = RAGKnowledgeBase(rag_dir)
            if not self._rag_kb.chunks:
                return ""
            return self._rag_kb.get_context(user_input, top_k=3)
        except Exception:
            return ""
    def _retrieve_feed_context(self, user_input: str) -> str:
        """从漏洞情报库检索相关CVE/漏洞信息，提供安全建议"""
        # 防御：确保 user_input 是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        try:
            from libertas.security.feed_sync import FeedSyncManager
            if not hasattr(self, '_feed_mgr') or self._feed_mgr is None:
                self._feed_mgr = FeedSyncManager()
            # 提取搜索关键词：CVE编号、产品名、漏洞类型
            import re
            query = user_input
            # 直接搜索CVE编号
            cve_match = re.search(r'CVE-\d{4}-\d+', user_input, re.IGNORECASE)
            if cve_match:
                query = cve_match.group(0)
            items = self._feed_mgr.get_items(keyword=query)
            if not items:
                return ""
            # 按CVSS分数排序，取前5条
            items.sort(key=lambda x: x.get("cvss_score", 0), reverse=True)
            top = items[:5]
            lines = ["【漏洞情报参考】以下是本地漏洞库中相关的记录："]
            for it in top:
                score_val = it.get("cvss_score", 0)
                score_str = f"CVSS {score_val}" if score_val else "评分未知"
                vuln_id = it.get('vuln_id', '') or it.get('local_id', '')
                lines.append(f"- {vuln_id} [{it.get('severity','')}|{score_str}] {it.get('title','')}")
                desc = it.get("description", "")
                if desc:
                    lines.append(f"  描述: {desc[:200]}")
                refs = it.get("references", [])
                if refs and isinstance(refs, list):
                    for ref in refs[:2]:
                        if isinstance(ref, str):
                            lines.append(f"  链接: {ref}")
                        elif isinstance(ref, dict) and ref.get("url"):
                            lines.append(f"  链接: {ref['url']}")
            lines.append("请基于以上情报给出分析和建议。")
            return "\n".join(lines)
        except Exception:
            return ""

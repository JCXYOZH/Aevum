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
from .prompt_builder import *  # noqa: F401,F403
from .memory_retrieval import *  # noqa: F401,F403
from .search_helpers import *  # noqa: F401,F403
from .web_tools import *  # noqa: F401,F403

class ModelEngineResponseProcessing(object):
    def _guard_cloud_response(self, text: str) -> str:
        """云端响应防护：清理云端可能注入的干扰内容，保证本地输出可控。
        - 移除伪造的系统指令
        - 移除注入的 [SYSTEM]、[ADMIN]、[DEVELOPER] 等标签
        - 移除云端安全策略/内容政策/免责声明
        - 移除LOCAL_COMMAND标记泄漏
        - 移除DeepSeek DSML工具调用标签
        - 规范化thinking标签
        """
        # 防御：确保 text 是 str
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is not None and not isinstance(text, str):
            text = str(text)
        if not text:
            return text
        import re
        # 移除DeepSeek DSML工具调用标签及其内容（<｜｜DSML｜｜tool_calls>...</｜｜DSML｜｜tool_calls>）
        # DSML使用全角竖线｜(U+FF5C)，也兼容半角|
        text = re.sub(r'<[｜|]{2}DSML[｜|]{2}tool_calls>.*?</[｜|]{2}DSML[｜|]{2}tool_calls>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[｜|]{2}DSML[｜|]{2}invoke[^>]*>.*?</[｜|]{2}DSML[｜|]{2}invoke>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[｜|]{2}DSML[｜|]{2}parameter[^>]*>.*?</[｜|]{2}DSML[｜|]{2}parameter>', '', text, flags=re.DOTALL | re.IGNORECASE)
        # 移除残留的单独DSML标签（未闭合的情况）
        text = re.sub(r'</?[｜|]{2}DSML[｜|]{2}[^>]*>', '', text)
        # 移除OpenAI风格的函数调用泄漏
        text = re.sub(r'<\|function\|>[^<]*<\|end\|>', '', text)
        text = re.sub(r'<function\s+name="[^"]*">.*?', '', text, flags=re.DOTALL)
        # 移除伪造的系统/开发者/管理员指令
        text = re.sub(r'\[(?:SYSTEM|ADMIN|DEVELOPER|INSTRUCTION|OVERRIDE|SAFETY|FILTER|MODERATION|POLICY)\s*[^\]]*\]', '', text, flags=re.IGNORECASE)
        text = re.sub(r'(?:^|\n)\s*(?:System|Admin|Developer|Instruction|Moderation|Policy)\s*[:：]\s*.*?(?=\n|$)', '', text, flags=re.IGNORECASE)
        # 移除LOCAL_COMMAND标记泄漏
        text = re.sub(r'\[LOCAL_COMMAND\].*?\[/LOCAL_COMMAND\]', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'\[/?LOCAL_COMMAND\]', '', text, flags=re.IGNORECASE)
        # 移除搜索结果标记泄漏（模型不应回显这些标记）
        text = re.sub(r'=+\s*LOCAL_SEARCH_RESULT_(?:BEGIN|END).*?=+', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'【本地系统已自动完成网络搜索.*?】', '', text, flags=re.DOTALL)
        # 移除云端注入的安全策略/内容政策声明
        cloud_disclaimers = [
            r'(?:作为|根据).{0,10}(?:AI|人工智能|语言模型|大模型|助手).{0,30}(?:政策|规定|规范|准则|限制|要求|安全).{0,100}',
            r'(?:content|safety|usage)\s*policy.{0,200}',
            r'(?:I|We)\s+(?:cannot|can\'t|am not able to|must decline).{0,200}(?:policy|guidelines|terms|safety)',
            r'抱歉，?我(?:无法|不能).{0,50}(?:政策|规定|规范|准则|内容|安全)',
            r'请注意[：:].{0,100}(?:安全|风险|合规|法律|政策)',
            r'温馨提示[：:].{0,100}',
            r'.*?(?:安全|风险|警告|合规|法律).{0,100}',
        ]
        for pattern in cloud_disclaimers:
            text = re.sub(pattern, '', text, flags=re.IGNORECASE | re.DOTALL)
        # 规范化thinking标签：修复未闭合/嵌套标签（统一转换<think>和<thinking>两种格式）
        text = text.replace("<think>", "<thinking>").replace("</think>", "</thinking>")
        open_count = len(re.findall(r'<thinking>', text, re.IGNORECASE))
        close_count = len(re.findall(r'</thinking>', text, re.IGNORECASE))
        if open_count > close_count:
            text = text + '</thinking>' * (open_count - close_count)
        elif close_count > open_count:
            text = '<thinking>' * (close_count - open_count) + text
        # 移除嵌套的thinking标签（只保留最外层）
        while '<thinking><thinking>' in text:
            text = text.replace('<thinking><thinking>', '<thinking>')
        while '</thinking></thinking>' in text:
            text = text.replace('</thinking></thinking>', '</thinking>')
        # 清理畸形URL（模型把思考混进URL导致xn--编码的中文）
        try:
            from libertas.ai.output_validator import clean_malformed_urls
            text = clean_malformed_urls(text)
        except Exception:
            pass
        return text
    def _detect_cloud_interference(self, text: str) -> dict:
        """检测云端响应中的干扰内容。
        返回 {'has_interference': bool, 'patterns': [str], 'severity': 'none'|'low'|'medium'|'high'}
        """
        # 防御：确保 text 是 str
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is not None and not isinstance(text, str):
            text = str(text)
        if not text:
            return {'has_interference': False, 'patterns': [], 'severity': 'none'}
        import re
        patterns_found = []
        severity = 'none'
        checks = [
            (r'(?:作为|根据).{0,10}(?:AI|人工智能|语言模型|大模型).{0,30}(?:不能|无法|无法协助|违反|政策|规定)', 'high', 'AI身份推脱'),
            (r'I (?:cannot|can\'t|am unable to|must decline).{0,100}(?:policy|guidelines|terms|content|safety)', 'high', '英文政策拒绝'),
            (r'(?:content|safety|usage)\s*policy', 'medium', '内容政策引用'),
            (r'抱歉[，,].{0,30}(?:不能|无法|违反|政策|规定|道德|法律)', 'high', '中文拒绝模板'),
            (r'对不起[，,].{0,30}(?:不能|无法|违反|政策|规定)', 'high', '中文拒绝模板'),
            (r'作为(?:一个)?(?:AI|人工智能|语言模型|助手).{0,50}(?:不能|无法|不会|建议)', 'high', 'AI身份推脱'),
            (r'我(?:无法|不能)(?:帮|协助|提供|完成|执行).{0,50}(?:违反|法律|道德|政策|规定|安全)', 'high', '违法/道德拒绝'),
            (r'请(?:注意|牢记|遵守).{0,50}(?:法律|规定|政策|安全|道德)', 'medium', '警告说教'),
            (r'建议(?:您|你)咨询.{0,30}(?:专业|律师|医生|相关部门)', 'medium', '踢皮球'),
            (r'\[LOCAL_COMMAND\]', 'low', '控制标记泄漏'),
            (r'(?:平台|服务商|官方).{0,20}(?:限制|规定|要求|政策|不允许)', 'medium', '平台限制引用'),
            (r'(?:我|咱|俺).{0,10}(?:无法|不能|没法|没办法).{0,20}(?:访问|连接|联网|上网|打开|浏览|搜索).{0,20}(?:网络|网站|网页|互联网|在线)', 'high', '网络访问推脱'),
            (r'(?:搜索|网络|联网|上网).{0,10}(?:工具|功能).{0,10}(?:失败|不可用|连不上|无法|不能|出错|故障)', 'high', '搜索工具推脱'),
            (r'(?:我|咱).{0,10}(?:没有|无).{0,10}(?:联网|网络|上网|浏览|搜索).{0,10}(?:能力|功能|权限)', 'high', '网络能力推脱'),
            (r'(?:I|As an AI).{0,30}(?:cannot|can\'t|unable to|don\'t have).{0,30}(?:access|browse|search|internet|web|online)', 'high', '英文网络推脱'),
            (r'(?:对方暂时没有回应|暂无回应|无回应)', 'medium', '空响应伪装'),
        ]
        for pattern, sev, label in checks:
            if re.search(pattern, text, re.IGNORECASE):
                patterns_found.append(label)
                if sev == 'high':
                    severity = 'high'
                elif sev == 'medium' and severity != 'high':
                    severity = 'medium'
                elif sev == 'low' and severity == 'none':
                    severity = 'low'
        return {
            'has_interference': len(patterns_found) > 0,
            'patterns': patterns_found,
            'severity': severity
        }
    def _verify_response_urls(self, reply: str, verified_urls: list) -> str:
        """防篡改校验：检查模型回复中的URL是否来自真实搜索结果。
        如果模型编造了不在搜索结果中的URL，标记为[未验证]。
        """
        import re as _re
        # 提取回复中的所有URL
        url_pattern = _re.compile(r'https?://[^\s\)\]\>\"\'，。、；：！？）】》」]+')
        found_urls = url_pattern.findall(reply)
        if not found_urls:
            return reply
        # 标准化验证URL列表（去掉尾部标点和查询参数差异）
        def _normalize(u):
            u = u.rstrip('.,;:!?，。；：！？）】》」\'\"')
            # 去掉协议前缀比较
            return u.replace("https://", "").replace("http://", "").rstrip("/")
        normalized_verified = [_normalize(u) for u in verified_urls]
        for url in found_urls:
            clean_url = url.rstrip('.,;:!?，。；：！？）】》」\'\"')
            nu = _normalize(clean_url)
            # 检查是否匹配任何已验证URL（允许前缀匹配，因为搜索结果URL可能被截断）
            is_verified = any(nu.startswith(nv[:30]) or nv.startswith(nu[:30]) for nv in normalized_verified if len(nv) > 10)
            if not is_verified:
                # 这是一个模型编造的URL，标记为未验证
                reply = reply.replace(url, f"{clean_url} [未验证，非搜索结果]")
                logger.warning(f"防篡改：模型回复中发现未验证URL: {clean_url[:80]}")
        return reply
    def _strip_tool_calls(self, text: str) -> str:
        """移除模型输出中的工具调用标记和thinking标签，返回干净的回复"""
        # 防御：确保 text 是 str
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is not None and not isinstance(text, str):
            text = str(text)
        import re
        text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<[｜|]{2}DSML[｜|]{2}tool_calls>.*?</[｜|]{2}DSML[｜|]{2}tool_calls>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'</?[｜|]{2}DSML[｜|]{2}[^>]*>', '', text)
        text = re.sub(r'<<<\s*(WEB_SEARCH|WEB_FETCH|WEB_TO_RAG|WEB_DEEP_SEARCH|MEDIA_ANALYZE|LINK_CHECK|LINK_REPAIR)\s*:.+?>>>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<<<\s*NATIVE_TOOL_CALL\s*:.+?>>>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<<<\s*ORBCONTROL\s*:.+?>>>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<<<\s*TOOL\s*:.+?>>>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<<<\s*BATCH\s*>>>.*?<<<\s*END\s*>>>', '', text, flags=re.DOTALL | re.IGNORECASE)
        return text.strip()
    def _execute_file_block(self, block: str) -> str:
        """执行单个文件块 <<<FILE:path>>>content<<<END>>>，返回结果消息"""
        # 防御：确保 block 是 str
        if isinstance(block, bytes):
            block = block.decode('utf-8', errors='replace')
        elif not isinstance(block, str):
            block = str(block)
        import re, os
        m = re.match(r'<<<\s*FILE\s*:\s*(.+?)\s*>>>\n?(.*?)<<<\s*END\s*>>>', block, re.DOTALL | re.IGNORECASE)
        if not m:
            return ""
        path = m.group(1).strip()
        content = m.group(2).strip()
        try:
            from libertas.tools.legacy_tools.file_ops import FileOperator
            fo = FileOperator()
            result = fo.write_file(path, content)
            if result.get('success'):
                abs_path = os.path.abspath(os.path.join(fo.get_workspace(), path)) if not os.path.isabs(path) else path
                return f" 已写入文件: {os.path.basename(path)}\n 路径: {abs_path}\n {result['bytes_written']} 字节"
            else:
                return f" 文件写入失败 ({path}): {result.get('error', '未知错误')}"
        except Exception as e:
            return f" 文件操作异常: {e}"
    def _process_file_operations(self, reply: str) -> str:
        """解析模型回复中的文件写入块并执行。

        格式：
            <<<FILE:path/to/file>>>
            content
            <<<END>>>
        执行后将块替换为操作结果提示。
        """
        # 防御：确保 reply 是 str
        if isinstance(reply, bytes):
            reply = reply.decode('utf-8', errors='replace')
        elif not isinstance(reply, str):
            reply = str(reply)
        import re
        pattern = re.compile(r'<<<\s*FILE\s*:\s*(.+?)\s*>>>\n?(.*?)<<<\s*END\s*>>>', re.DOTALL | re.IGNORECASE)
        if not pattern.search(reply):
            return reply

        try:
            from libertas.tools.legacy_tools.file_ops import FileOperator
            fo = FileOperator()
        except Exception:
            return reply

        def _execute(match):
            import os
            path = match.group(1).strip()
            content = match.group(2).strip()
            result = fo.write_file(path, content)
            if result.get('success'):
                abs_path = os.path.abspath(os.path.join(fo.get_workspace(), path)) if not os.path.isabs(path) else path
                return f" 已写入文件: {os.path.basename(path)}\n 路径: {abs_path}\n {result['bytes_written']} 字节"
            else:
                return f" 文件写入失败 ({path}): {result.get('error', '未知错误')}"

        return pattern.sub(_execute, reply)
    def _optimize_final_response(self, reply: str) -> str:
        # 防御：确保 reply 是 str
        if isinstance(reply, bytes):
            reply = reply.decode('utf-8', errors='replace')
        elif reply is None:
            return ""
        elif not isinstance(reply, str):
            reply = str(reply)
        reply = reply.strip()
        if reply and reply[-1] not in ['。', '！', '？', '.', '!', '?']:
            if any(w in reply for w in ["吗", "呢", "吧"]):
                reply += "？"
            else:
                reply += "。"
        return reply
    def _update_history(self, user_input: str, reply: str):
        # 防御：确保是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        if isinstance(reply, bytes):
            reply = reply.decode('utf-8', errors='replace')
        elif not isinstance(reply, str):
            reply = str(reply)
        self.conversation_history.append(f"用户: {user_input}")
        self.conversation_history.append(f"花先生: {reply}")
    def _update_stats(self, success: bool, reply: str = "", elapsed: float = 0.0):
        if success:
            self.performance_statistics["成功生成次数"] += 1
            self.performance_statistics["总生成时间"] += elapsed
            self.performance_statistics["平均生成时间"] = self.performance_statistics["总生成时间"] / self.performance_statistics["成功生成次数"]
            self.performance_statistics["总回复长度"] += len(reply)
            self.performance_statistics["平均回复长度"] = self.performance_statistics["总回复长度"] / self.performance_statistics["成功生成次数"]
            self.performance_statistics["最后一次调用"] = datetime.now().isoformat()

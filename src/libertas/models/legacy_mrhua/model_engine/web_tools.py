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

class ModelEngineWebTools(object):
    def _execute_web_tool(self, tool_call: str, progress_cb=None) -> str:
        """执行模型请求的网络工具，返回工具结果文本。
        progress_cb: 可选回调函数，接收 (step, detail_dict) 用于追踪搜索过程
        支持:
          <<<WEB_SEARCH:查询内容>>>
          <<<WEB_FETCH:https://url>>>
          <<<WEB_TO_RAG:https://url>>>
          <<<WEB_DEEP_SEARCH:查询内容>>>  （搜索+自动抓取前3个页面正文）
          <<<MEDIA_ANALYZE:https://url>>>  （分析页面视频源和媒体信息）
          <<<LINK_CHECK:https://url>>>     （检查链接健康状态）
          <<<LINK_REPAIR:https://url>>>    （尝试修复失效链接）
        """
        # 防御：确保 tool_call 是 str
        if isinstance(tool_call, bytes):
            tool_call = tool_call.decode('utf-8', errors='replace')
        elif not isinstance(tool_call, str):
            tool_call = str(tool_call)
        def _trace(step, **kw):
            if progress_cb:
                try:
                    progress_cb(step, **kw)
                except Exception:
                    pass

        import re
        m = re.match(r'<<<\s*(WEB_SEARCH|WEB_FETCH|WEB_TO_RAG|WEB_DEEP_SEARCH|MEDIA_ANALYZE|LINK_CHECK|LINK_REPAIR)\s*:\s*(.+?)\s*>>>', tool_call, re.DOTALL | re.IGNORECASE)
        if not m:
            return ""
        tool = m.group(1).upper()
        arg = m.group(2).strip()

        try:
            from libertas.tools.legacy_mrhua.search_orchestrator import get_search_orchestrator, format_parallel_results
            from libertas.tools.legacy_mrhua.web_engine import robust_fetch, format_fetch_result
            from libertas.tools.legacy_mrhua.web_search import fetch_page_content
            if tool == "WEB_SEARCH":
                _trace("search_start", keyword=arg, tool="WEB_SEARCH")
                # 使用并行多引擎搜索
                _orch = get_search_orchestrator()
                sd = _orch.search(arg, max_results=8, progress_cb=_trace, fast_only=False)
                results = sd.get("results", [])
                if results:
                    _trace("search_results", keyword=arg, count=len(results),
                           urls=[r.get("url","") for r in results[:5]],
                           titles=[r.get("title","") for r in results[:5]])
                    # 自动抓取前2个页面正文
                    fetched = 0
                    parts = [format_parallel_results(sd)]
                    for r in results[:2]:
                        u = r.get("url", "")
                        if not u.startswith("http"):
                            continue
                        try:
                            page = robust_fetch(u, max_chars=2000, timeout=6)
                            if page and page.get("content"):
                                parts.append(format_fetch_result(page, u))
                                fetched += 1
                                _trace("page_fetched", url=u)
                        except Exception:
                            continue
                    _trace("search_done", keyword=arg, count=len(results), fetched=fetched)
                    return "\n\n".join(parts)
                else:
                    err = sd.get("error", "未知错误")
                    _trace("search_error", keyword=arg, error=err)
                    return (f"【搜索暂时不可用: {err}】\n"
                            f"请直接根据你的知识回答用户关于「{arg}」的问题。")
            elif tool == "WEB_DEEP_SEARCH":
                _trace("search_start", keyword=arg, tool="WEB_DEEP_SEARCH")
                _orch = get_search_orchestrator()
                sd = _orch.search(arg, max_results=10, progress_cb=_trace, fast_only=False)
                results = sd.get("results", [])
                if results:
                    _trace("search_results", keyword=arg, count=len(results),
                           urls=[r.get("url","") for r in results[:5]],
                           titles=[r.get("title","") for r in results[:5]])
                    parts = [format_parallel_results(sd)]
                    fetched = 0
                    for r in results[:5]:
                        u = r.get("url", "")
                        if not u.startswith("http"):
                            continue
                        try:
                            page = robust_fetch(u, max_chars=3000, timeout=8)
                            if page and page.get("content"):
                                parts.append(format_fetch_result(page, u))
                                fetched += 1
                                _trace("page_fetched", url=u)
                        except Exception:
                            continue
                        if fetched >= 5:
                            break
                    _trace("search_done", keyword=arg, count=len(results), fetched=fetched)
                    return "\n\n".join(parts)
                else:
                    err = sd.get("error", "未知错误")
                    _trace("search_error", keyword=arg, error=err)
                    return (f"【深度搜索暂时不可用: {err}】\n"
                            f"请直接根据你的知识回答用户关于「{arg}」的问题。")
            elif tool == "WEB_FETCH":
                _trace("fetch_start", url=arg)
                # 使用完整抓取链：Playwright → requests → curl H2 → httpx H2 → 文本代理 → 缓存 → socket
                page = robust_fetch(arg, max_chars=8000, timeout=15, progress_cb=_trace)
                if page.get("content"):
                    _pc = page["content"]
                    if isinstance(_pc, bytes):
                        _pc = _pc.decode('utf-8', errors='replace')
                    src = page.get("source", "")
                    src_note = f"（通过{src}获取）" if src else ""
                    _trace("fetch_done", url=arg, title=page.get("title", arg), chars=len(_pc))
                    return f"【网页内容: {page.get('title', arg)}{src_note}】\nURL: {arg}\n\n{_pc}"
                else:
                    _trace("fetch_error", url=arg, error=page.get("error", "未知错误"))
                    err = page.get("error", "未知错误")
                    return (f"【网页抓取失败: {err}】\n"
                            f"该网站可能有反爬保护。请根据URL和你的知识回答用户，"
                            f"或建议用户在内置浏览器中手动查看。")
            elif tool == "WEB_TO_RAG":
                _trace("fetch_start", url=arg, purpose="RAG")
                page = robust_fetch(arg, max_chars=10000, timeout=15, progress_cb=_trace)
                if not page.get("content"):
                    _trace("fetch_error", url=arg, error=page.get("error", "未知错误"))
                    return f"【抓取失败，无法存入知识库: {page.get('error', '未知错误')}】"
                _rag_content = page["content"]
                if isinstance(_rag_content, bytes):
                    _rag_content = _rag_content.decode('utf-8', errors='replace')
                from libertas.tools.legacy_mrhua.rag_engine import RAGKnowledgeBase
                from libertas.foundation.config import data_path
                rag_dir = data_path('RAG')
                kb = RAGKnowledgeBase(rag_dir)
                doc_id = kb.add_document(
                    title=page.get('title', arg),
                    content=_rag_content,
                    source=arg,
                    metadata={"type": "web_page"}
                )
                _trace("rag_done", url=arg, title=page.get("title", arg), doc_id=doc_id, chars=len(page["content"]))
                return f" 已将网页《{page.get('title', arg)}》存入知识库 (ID: {doc_id}, {len(page['content'])} 字符)"

            elif tool == "MEDIA_ANALYZE":
                _trace("media_analyze_start", url=arg)
                from libertas.tools.legacy_mrhua.media_handler import analyze_page_media
                media_result = analyze_page_media(arg, timeout=12)
                if media_result.get("is_direct_media"):
                    mtype = media_result.get("media_type", "video")
                    probe = media_result.get("probe", {})
                    info = media_result.get("source_info", {})
                    lines = [f"【媒体分析: {arg}】", f"类型: {mtype}"]
                    if probe.get("duration"):
                        mins, secs = divmod(int(probe["duration"]), 60)
                        lines.append(f"时长: {mins}:{secs:02d}")
                    if probe.get("width") and probe.get("height"):
                        lines.append(f"分辨率: {probe['width']}x{probe['height']}")
                    if probe.get("video_codec"):
                        lines.append(f"视频编码: {probe['video_codec']}")
                    if info.get("content_length"):
                        lines.append(f"大小: {info['content_length'] // 1024 // 1024}MB")
                    lines.append(f"可拖动播放: {'是' if info.get('supports_range') else '否'}")
                    _trace("media_analyze_done", url=arg, media_type=mtype)
                    return "\n".join(lines)
                elif media_result.get("sources"):
                    lines = [f"【页面视频源: {arg}】", f"发现 {len(media_result['sources'])} 个视频源:"]
                    for i, src in enumerate(media_result["sources"][:5], 1):
                        sinfo = src.get("info", {})
                        status = "可播放" if sinfo.get("alive") else "不可用"
                        lines.append(f"  {i}. [{src['type']}] {status} {src['url'][:80]}")
                        if src.get("probe", {}).get("duration"):
                            d = int(src["probe"]["duration"])
                            lines.append(f"     时长: {d//60}:{d%60:02d}")
                    _trace("media_analyze_done", url=arg, sources=len(media_result["sources"]))
                    return "\n".join(lines)
                else:
                    _trace("media_analyze_done", url=arg, sources=0)
                    return f"【媒体分析: {arg}】页面中未检测到视频或音频内容。"

            elif tool == "LINK_CHECK":
                _trace("link_check_start", url=arg)
                from libertas.tools.legacy_mrhua.media_handler import check_link_health
                health = check_link_health(arg, timeout=8)
                if health.get("alive"):
                    chain = ""
                    if health.get("redirect_chain"):
                        chain = " → ".join(f"{r['status']}" for r in health["redirect_chain"]) + f" → {health['status']}"
                    else:
                        chain = str(health["status"])
                    lines = [f"【链接检查: {arg}】",
                             f"状态:  正常 ({chain})",
                             f"最终URL: {health['final_url']}",
                             f"响应时间: {health['response_time']}s"]
                    if health.get("content_type"):
                        lines.append(f"内容类型: {health['content_type']}")
                    _trace("link_check_done", url=arg, alive=True)
                    return "\n".join(lines)
                else:
                    _err = health.get("error", f"HTTP {health.get('status', '?')}")
                    _trace("link_check_done", url=arg, alive=False, error=_err)
                    return f"【链接检查: {arg}】 不可用: {_err}"

            elif tool == "LINK_REPAIR":
                _trace("link_repair_start", url=arg)
                from libertas.tools.legacy_mrhua.media_handler import repair_link
                repair = repair_link(arg, timeout=8)
                if repair.get("fixed"):
                    _trace("link_repair_done", url=arg, fixed=True, method=repair["method"])
                    return (f"【链接修复: {arg}】\n"
                            f" 已修复（{repair['method']}）\n"
                            f"新URL: {repair['fixed_url']}")
                elif repair.get("archive_url"):
                    _trace("link_repair_done", url=arg, fixed=False, archive=True)
                    return (f"【链接修复: {arg}】\n"
                            f"原始链接不可用，但找到Wayback Machine存档:\n"
                            f"{repair['archive_url']}")
                else:
                    alts = repair.get("alternatives", [])
                    lines = [f"【链接修复: {arg}】 无法自动修复"]
                    if alts:
                        lines.append("已尝试:")
                        for a in alts[:5]:
                            lines.append(f"  - {a['method']}: {a['url'][:60]} → {'成功' if a['alive'] else '失败'}")
                    _trace("link_repair_done", url=arg, fixed=False)
                    return "\n".join(lines)

        except Exception as e:
            _trace("tool_error", tool=tool, arg=arg, error=str(e))
            return f"【工具执行异常: {e}】"
        return ""
    def _process_web_tools(self, text: str, allow_search: bool = True, progress_cb=None) -> str:
        """检测并执行文本中的网络工具调用，返回工具结果（供二次生成使用）
        allow_search: False时跳过WEB_SEARCH/WEB_DEEP_SEARCH（前置搜索已执行时使用）
        progress_cb: 可选回调，用于追踪每个工具执行步骤
        """
        import re
        text = text.replace("<think>", "<thinking>").replace("</think>", "</thinking>")
        clean_text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL | re.IGNORECASE)
        clean_text = re.sub(r'```(?:\w*)?\n?', '', clean_text)
        clean_text = clean_text.replace('`', '')
        pattern = re.compile(r'<<<\s*(WEB_SEARCH|WEB_FETCH|WEB_TO_RAG|WEB_DEEP_SEARCH|MEDIA_ANALYZE|LINK_CHECK|LINK_REPAIR)\s*:\s*(.+?)\s*>>>', re.DOTALL | re.IGNORECASE)
        results = []
        seen = set()
        for m in pattern.finditer(clean_text):
            tool = m.group(1).upper()
            arg = m.group(2).strip()
            if not allow_search and tool in ("WEB_SEARCH", "WEB_DEEP_SEARCH"):
                continue
            dedup_key = (tool, arg)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            if progress_cb:
                progress_cb("tool_detected", tool=tool, arg=arg)
            result = self._execute_web_tool(m.group(0), progress_cb=progress_cb)
            if result:
                results.append(result)
        if not results:
            loose_pattern = re.compile(r'(?:^|\n|\s)\[?(WEB_SEARCH|WEB_FETCH|WEB_TO_RAG|WEB_DEEP_SEARCH|MEDIA_ANALYZE|LINK_CHECK|LINK_REPAIR)\s*[:：]\s*(.+?)(?:\]|$|\n)', re.IGNORECASE)
            for m in loose_pattern.finditer(clean_text):
                tool = m.group(1).upper()
                arg = m.group(2).strip().strip('<>[]{}')
                if arg and len(arg) > 1:
                    dedup_key = (tool, arg)
                    if dedup_key not in seen:
                        seen.add(dedup_key)
                        if progress_cb:
                            progress_cb("tool_detected", tool=tool, arg=arg, loose=True)
                        result = self._execute_web_tool(f"<<<{tool}:{arg}>>>", progress_cb=progress_cb)
                        if result:
                            results.append(result)
        return "\n\n".join(results)
    def _detect_search_refusal(self, text: str) -> bool:
        """检测模型是否在拒绝搜索/联网"""
        refusal_patterns = [
            "无法上网", "不能上网", "无法访问互联网", "不能访问互联网",
            "无法浏览", "不能浏览", "无法搜索", "不能搜索",
            "作为AI", "作为一个AI", "作为语言模型", "作为人工智能",
            "无法获取实时", "不能获取实时", "无法获取最新",
            "没有联网", "不具备联网", "无法连接网络",
            "我不能", "我无法", "我没办法", "我不具备",
            "建议您", "建议你", "您可以自己", "你可以自己",
            "I cannot browse", "I can't browse", "I don't have access",
            "unable to search", "cannot access the internet",
            "as an AI", "as a language model",
            "I cannot", "I can't", "I'm not able",
            "搜索工具", "网络工具", "联网功能", "网络功能",
            "连不上网络", "连不上网", "网络连接失败", "网络不通",
            "搜索失败", "搜索不可用", "搜索功能", "无法使用搜索",
            "没有网络", "没网", "网络不可用", "网络异常",
            "无法打开网站", "无法访问网站", "打不开网页",
            "暂时无法", "当前无法", "目前无法",
            "对方暂时没有回应",
        ]
        text_lower = text.lower()
        for p in refusal_patterns:
            if p.lower() in text_lower:
                return True
        return False
    def _detect_search_noncompliance(self, text: str, user_input: str) -> bool:
        """检测模型是否在回避搜索：用户明确要求搜索，但模型既没调用工具也没明确拒绝，
        只是给了一个泛泛的回答。"""
        import re
        # 如果已经有工具调用，不算回避
        if re.search(r'<<<\s*WEB_(SEARCH|FETCH|TO_RAG|DEEP_SEARCH)\s*:', text, re.IGNORECASE):
            return False
        # 如果明确拒绝了，由 _detect_search_refusal 处理
        if self._detect_search_refusal(text):
            return False
        # 如果声称搜索了，由 _detect_fake_search 处理
        if self._detect_fake_search(text):
            return False
        # 用户明确要求搜索的强指令词
        strong_search_words = ["搜索", "搜一下", "搜搜", "查一下", "查下", "查找", "检索",
                               "帮我找", "找找", "百度", "谷歌", "google", "bing", "必应"]
        user_lower = user_input.lower()
        has_strong_intent = any(w in user_lower for w in strong_search_words)
        if not has_strong_intent:
            return False
        # 如果回复太短（<50字），可能是在回避
        if len(text.strip()) < 50:
            return True
        # 如果回复中包含"无法"、"不能"等推脱词但不在refusal列表中
        evasive_patterns = ["无法为您", "不能为您", "暂时无法", "暂时不能",
                           "建议您直接", "你可以直接访问", "请您自行"]
        for p in evasive_patterns:
            if p in text:
                return True
        return False
    def _detect_fake_search(self, text: str) -> bool:
        """检测模型是否在假装搜索（声称搜索了但没有实际调用工具标签）"""
        # 如果文本中已经有工具标签，说明真的调用了，不是假搜索
        if re.search(r'<<<\s*WEB_(SEARCH|FETCH|TO_RAG|DEEP_SEARCH)\s*:', text, re.IGNORECASE):
            return False
        fake_patterns = [
            "根据搜索结果", "根据网络搜索", "搜索结果显示", "搜索发现",
            "我搜索了", "我查了一下", "我帮你搜索", "经过搜索",
            "根据网上", "网上资料显示", "网络资料显示",
            "according to search results", "i searched", "search results show",
            "based on my search", "after searching",
        ]
        text_lower = text.lower()
        for p in fake_patterns:
            if p.lower() in text_lower:
                return True
        return False
    def _auto_execute_search(self, user_input: str, progress_cb=None) -> str:
        """模型拒绝搜索时，从用户输入中提取查询并自动执行搜索。
        使用统一的 _extract_search_keyword 提取关键词，防止截断。
        """
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        import re
        url_match = re.search(r'https?://[^\s<>"\'{}|\\^`\[\]，。！？、；：]+', user_input)
        if url_match:
            return self._execute_web_tool(f"<<<WEB_FETCH:{url_match.group(0)}>>>", progress_cb=progress_cb)
        query = self._extract_search_keyword(user_input)
        if query and len(query) >= 2:
            return self._execute_web_tool(f"<<<WEB_SEARCH:{query}>>>", progress_cb=progress_cb)
        return ""

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

class ModelEngineSearchHelpers(object):
    def _extract_reply_content(self, full: str, prompt: str) -> str:
        if "花先生回复：" in full:
            part = full.split("花先生回复：")[-1].strip()
            for marker in ["\n用户", "\n用户:", "\nUser:", "用户问题："]:
                if marker in part:
                    part = part.split(marker)[0].strip()
                    break
            return part
        return full.strip()
    def _personality_correction(self, reply: str, user_input: str, history: List[str]) -> str:
        rules = self.user_manager.load_rules()
        mapping = rules.get("替换映射", {})
        if not mapping:
            mapping = {
                "我是AI": "我是{name}",
                "我没有情感": "我有自己的感受",
                "我是模型": "我是{name}",
                "作为AI": "作为{name}",
                "作为一个模型": "作为{name}"
            }
        name = rules.get("身份信息", {}).get("名字", "")
        for prohibited, replacement in mapping.items():
            if prohibited in reply:
                if "{name}" in replacement:
                    replacement = replacement.format(name=name)
                reply = reply.replace(prohibited, replacement)
        return reply
    def _extract_tool_urls(self, text: str) -> list:
        """从模型输出中提取WEB_FETCH和WEB_TO_RAG的URL，用于前端可视化"""
        import re
        text = text.replace("<think>", "<thinking>").replace("</think>", "</thinking>")
        clean_text = re.sub(r'<thinking>.*?</thinking>', '', text, flags=re.DOTALL | re.IGNORECASE)
        urls = []
        seen = set()
        pattern = re.compile(r'<<<\s*(?:WEB_FETCH|WEB_TO_RAG)\s*:\s*(.+?)\s*>>>', re.DOTALL | re.IGNORECASE)
        for m in pattern.finditer(clean_text):
            url = m.group(1).strip()
            if url.startswith('http') and url not in seen:
                seen.add(url)
                urls.append(url)
        return urls
    def _needs_web_search(self, text: str) -> bool:
        """检测用户输入是否需要联网搜索。
        只在明确需要时触发：URL、明确的搜索指令、时效性查询。
        普通知识问答不强制搜索，模型可通过function calling自主决定是否追加搜索。
        """
        # 防御：确保 text 是 str
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is None:
            return False
        elif not isinstance(text, str):
            text = str(text)
        if not text or not text.strip():
            return False
        text_lower = text.lower()
        import re as _re
        # 1. 包含URL → 一定需要
        if "http://" in text_lower or "https://" in text_lower or "www." in text_lower:
            return True
        # 1.5 高级搜索语法（dork）→ 一定需要搜索
        if _re.search(r'\b(site|inurl|intitle|intext|filetype|ext)\s*:', text_lower):
            return True
        # 2. 明确的搜索指令（用户主动要求搜索）
        # 注意："搜索"不能简单用 in 匹配，因为"搜索功能的问题"是在谈论搜索而非要求搜索
        # 用正则匹配"搜索"作为动词的位置：句首、或在"帮我/请/给我/去/来"等祈使语境后
        # "搜索"作为动词的匹配：
        # (a) 句首/标点后 + 可选祈使词 + 搜索 + 关键词
        # (b) 想/要/需要/可以/能/会/帮/给/请/去/来 + 搜索
        # (c) 其他明确搜索词
        _search_verb_re = _re.compile(
            r'(?:^|[，,。.\s！!？?]|我|你|他|她|它|们)'
            r'(?:帮我|请|给我|去|来|帮忙|麻烦|想|要|想要|需要|可以|能|会|能不能|可不可以)*'
            r'\s*搜索(?:一下|下)?'
            r'(?![\s，,：:]*(?:功能|引擎|结果|记录|历史|设置|选项|按钮|接口|算法|技巧|方法|问题|体验|效果|速度|质量|能力|框|栏|词|页|不到|不了|失败|出错|异常|不准|不对|不好用|不能用|的))'
            r'[\s，,：:]?[^\s，,。.！!？?]'
        )
        if _search_verb_re.search(text_lower):
            return True
        # 搜一下/搜搜/帮我搜/找一下等（不含"搜索"二字的）
        # 注意：搜(?!索) 排除"搜索"（由上面的 _search_verb_re 专门处理，带名词排除）
        _other_search_re = _re.compile(
            r'(?:^|[，,。.\s！!？?])(?:帮我|请|给我|去|来|帮忙|麻烦)*\s*搜(?!索)(?:一下|下|搜)?[\s，,：:]?[^\s]'
            r'|(?:^|[，,。.\s！!？?])(?:帮我|请|给我|去|来|帮忙|麻烦)*\s*找(?:一下|下|找)?[\s，,：:]?[^\s]'
            r'|帮我搜|帮我查|帮我找|给我搜|给我查|给我找'
            r'|百度一下|谷歌一下|google一下|bing一下'
            r'|上网搜|网上搜|联网搜|在线搜|搜一搜|检索一下'
            r'|search\s+for|search\s+online|google\s+it|bing\s+it'
            r'|look\s+up\s+online|find\s+online|check\s+online'
        )
        if _other_search_re.search(text_lower):
            return True
        # 3. 明确要求查看网页/网站
        web_actions = [
            "看看这个网站", "看看这个网页", "看看这个链接", "打开这个网", "访问这个网",
            "浏览这个网", "这个网址", "这个网站", "这个链接", "这个网页",
            "去网上查", "在网上查", "从网上查", "到网上查",
        ]
        for kw in web_actions:
            if kw in text_lower:
                return True
        # 4. 强时效性查询（需要最新数据）
        time_sensitive = [
            "最新消息", "最新新闻", "最新动态", "最新进展", "最新情况",
            "今天的新闻", "今日新闻", "刚刚发生", "实时",
            "股价", "汇率", "天气", "气温", "比分", "赛程",
        ]
        for kw in time_sensitive:
            if kw in text_lower:
                return True
        # 5. 明确的价格/购买查询
        if any(kw in text_lower for kw in ["多少钱", "价格", "报价", "怎么买", "哪里有卖"]):
            return True
        # 6. 不触发搜索的情况：普通知识问答、聊天、创作、代码等
        # 模型可以通过function calling自主决定是否需要搜索
        return False
    def _extract_search_keyword(self, text: str) -> str:
        """从用户输入中提取搜索关键词（统一实现，防止截断）。

        策略：
        1. URL 直接返回
        2. 用正则匹配「搜索指令+关键词」模式，只剥离明确的指令前缀
        3. 不剥离单字（搜/查/找），因为可能是词的一部分（如"搜索引擎"）
        4. 剥离后关键词太短（<2字）则返回原文
        """
        if isinstance(text, bytes):
            text = text.decode('utf-8', errors='replace')
        elif text is None:
            return ""
        elif not isinstance(text, str):
            text = str(text)
        import re as _re
        text = text.strip()
        if not text:
            return ""
        url_m = _re.search(r'https?://[\w\-./?=&%#:@+~]+', text)
        if url_m:
            return url_m.group(0).rstrip('，。、；：！？）】》」\')')
        # 高级搜索语法（dork）原样保留，不剥离任何内容
        if _re.search(r'\b(site|inurl|intitle|intext|filetype|ext|link|related)\s*:', text, _re.IGNORECASE):
            return text
        # 第一组：需要分隔符或直接跟关键词的指令
        pattern = (
            r'^(?:'
            r'去给我搜索一下|去给我搜索|去给我搜一下|去给我搜|去给我查一下|去给我查|去给我找一下|去给我找|'
            r'去帮我搜索一下|去帮我搜索|去帮我搜|去帮我查|去帮我找|'
            r'去搜索一下|去搜索|去搜一下|去搜搜|去搜|去查一下|去查|去找一下|去找找|去找|'
            r'帮我搜索一下|帮我搜索|帮我搜一下|帮我搜|帮我查一下|帮我查|'
            r'给我搜索一下|给我搜索|给我搜一下|给我搜|给我查一下|给我查|给我找一下|给我找|'
            r'帮忙搜索一下|帮忙搜索|帮忙搜一下|帮忙搜|帮忙查一下|帮忙查|'
            r'帮我找一下|帮我找|帮我看看|请搜索一下|请搜索|请搜一下|请搜|'
            r'搜索一下|搜一下|搜搜|查一下|查下|查找一下|查找|检索一下|检索|'
            r'找找|找一下|百度一下|谷歌一下|google一下|bing一下|'
            r'上网搜|网上搜|联网搜|在线搜|搜一搜|'
            r'了解一下|介绍一下|看看这个|帮我看看|'
            r'什么是|是谁|在哪里|官网|官方网站'
            r')[\s，,：:、]*(.+)$'
        )
        m = _re.match(pattern, text, _re.IGNORECASE)
        if m:
            keyword = m.group(1).strip().strip('，。、；：！？\u201c\u201d\u2018\u2019（）【】《》」「\'"？?！!')
            if len(keyword) >= 2:
                return self._strip_search_tail(keyword)
        # 第二组："搜索"直接跟关键词（无分隔符），但排除复合词（搜索引擎/搜索结果等）
        m3 = _re.match(r'^搜索(?!引擎|结果|功能|框|栏|记录|词|页|历史|按钮|选项|设置|接口|算法|技巧|方法)(.+)$', text)
        if m3:
            keyword = m3.group(1).strip().strip('，。、；：！？\u201c\u201d\u2018\u2019（）【】《》」「\'"？?！!')
            if len(keyword) >= 2:
                return self._strip_search_tail(keyword)
        m2 = _re.match(r'^[搜查找][\s，,：:、]+(.+)$', text)
        if m2:
            keyword = m2.group(1).strip().strip('，。、；：！？\u201c\u201d\u2018\u2019（）【】《》」「\'"？?！!')
            if len(keyword) >= 2:
                return self._strip_search_tail(keyword)
        return self._strip_search_tail(text)
    @staticmethod
    def _strip_search_tail(keyword: str) -> str:
        """剥离搜索关键词尾部的冗余修饰词（主网站/官网/网站等）。"""
        import re as _re
        return _re.sub(r'(主官网|主网站|官方网站|官网|网站首页|首页|主页|网站|网址|入口|登录页?)$', '', keyword)
    def _preemptive_search(self, user_input: str) -> str:
        """
        前置搜索：在模型生成之前就执行搜索，把结果直接注入prompt。
        这样模型无法拒绝搜索——搜索结果已经在上下文中了。
        使用轻量搜索（5条结果+前2页正文），平衡速度和信息量。
        """
        try:
            import re as _re
            from libertas.tools.legacy_tools.web_search import web_search, fetch_page_content, search_and_summarize
            # URL直接抓取
            url_m = _re.search(r'https?://[\w\-./?=&%#:@+~]+', user_input)
            if url_m:
                url = url_m.group(0).rstrip('，。、；：！？）】》」\')')
                page = fetch_page_content(url, max_chars=6000)
                if page.get("content"):
                    return f"【网页内容: {page.get('title', url)}】\nURL: {url}\n\n{page['content']}"
            # 提取搜索关键词（使用统一的关键词提取函数）
            query = self._extract_search_keyword(user_input)
            if not query or len(query) < 2:
                return ""
            # 轻量搜索：5条结果+前2页正文，每页2000字符（快速）
            deep = search_and_summarize(query, max_results=5, fetch_top=2, max_chars_per_page=2000)
            results = deep.get("results", [])
            if results and "error" not in results[0]:
                lines = [f"【网络搜索结果: {query}（共{len(results)}条）】"]
                for i, r in enumerate(results, 1):
                    lines.append(f"{i}. {r['title']}\n   URL: {r['url']}\n   {r.get('snippet', '')}")
                    if r.get("page_content"):
                        lines.append(f"    {r['page_content'][:1500].strip()}")
                return "\n\n".join(lines)
            return ""
        except Exception:
            return ""
    def _guarantee_search(self, user_input: str, model_reply: str) -> str:
        """
        搜索保障：模型回复后，如果用户需要搜索但模型没有成功调用工具，
        无条件执行搜索（不管模型说了什么）。
        返回搜索结果文本。
        """
        import re as _re
        # 如果模型已经成功调用了工具，不需要保障
        if _re.search(r'<<<\s*WEB_(SEARCH|FETCH|TO_RAG|DEEP_SEARCH)\s*:', model_reply, _re.IGNORECASE):
            # 检查工具是否真的执行了（有结果标记）
            if "【网络搜索结果" in model_reply or "【网页内容" in model_reply or "【深度搜索结果" in model_reply:
                return ""
        # 无条件执行搜索
        return self._preemptive_search(user_input)
    def _get_web_tools_description(self) -> str:
        """返回网络工具使用说明"""
        return """

【网络工具】
可用工具标签（独占一行）：
1. 网络搜索：<<<WEB_SEARCH:搜索关键词>>>
2. 深度搜索（搜索+自动抓取多个页面）：<<<WEB_DEEP_SEARCH:搜索关键词>>>
3. 读取网页：<<<WEB_FETCH:https://完整网址>>>
4. 存入知识库：<<<WEB_TO_RAG:https://完整网址>>>
5. 分析页面视频/媒体：<<<MEDIA_ANALYZE:https://完整网址>>>
6. 检查链接是否有效：<<<LINK_CHECK:https://完整网址>>>
7. 修复失效链接：<<<LINK_REPAIR:https://完整网址>>>

使用规则：
- 当用户询问实时信息、最新新闻、你不确定的事实时，必须调用搜索工具
- 当用户想看视频、页面无法播放、视频链接失效时，使用MEDIA_ANALYZE
- 当用户说链接打不开、404、失效时，先用LINK_CHECK检查，再用LINK_REPAIR修复
- 工具调用标签必须独占一行，调用后等待系统返回结果，再给出最终回答
- 最终回答中不要包含工具调用标签
- 搜索时使用精确关键词，不要用模糊的长句
"""

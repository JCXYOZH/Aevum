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

class ModelEngineMemoryRetrieval(object):
    def _retrieve_related_memories(self, user_input: str, context: Dict[str, Any]) -> str:
        """
        智能检索相关记忆 - 四阶段连锁检索
        1. 历史内容关键词提取
        2. 向量语义检索 + 关键词匹配（普通+扫描）
        3. 关键词关联（从结果中提取新词）
        4. 连锁语义查找（用新词再次检索）
        """
        # 防御：确保 user_input 是 str
        if isinstance(user_input, bytes):
            user_input = user_input.decode('utf-8', errors='replace')
        elif not isinstance(user_input, str):
            user_input = str(user_input)
        if not self.memory_system:
            return ""

        # ================================================================
        # 前期准备：提取对话历史中的扫描摘要
        # ================================================================
        full_history = context.get('full_history') if context else []
        scan_summaries_in_history = []
        for entry in full_history:
            if entry.startswith('系统: 执行') and '扫描' in entry:
                scan_summaries_in_history.append(entry)

        # ================================================================
        # 第一阶段：历史内容关键词检索
        # ================================================================
        text_sources = [user_input]
        for entry in full_history[-10:]:
            if entry.startswith('用户: '):
                text_sources.append(entry[3:].strip())
            elif entry.startswith('花先生: '):
                text_sources.append(entry[4:].strip())
            elif entry.startswith('系统: 执行') and '扫描' in entry:
                text_sources.append(entry)

        stopwords = {'的','了','在','是','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','那','什么','怎么','为什么','如何','可以','应该','因为','所以','但是','如果','那么','嗯','啊','呢','吧','哦','哈','嘿','哎','喂','嗨','吗','呢','吧','呀','哦','啊','的话','一下','这个','那个','之前','现在','刚才','最近','之前'}

        # 预提取IP地址和域名（jieba会把IP拆成单字符）
        import re as _re
        _ip_re = _re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
        _domain_re = _re.compile(r'\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b')
        _port_re = _re.compile(r'\b\d{2,5}\b')

        initial_keywords = []
        for text in text_sources:
            if not text:
                continue
            # 提取IP和域名作为完整关键词
            for m in _ip_re.findall(text):
                if m not in initial_keywords:
                    initial_keywords.append(m)
            for m in _domain_re.findall(text):
                if m not in initial_keywords:
                    initial_keywords.append(m)
            if len(text) <= 3 and text.strip():
                if text.strip() not in initial_keywords:
                    initial_keywords.append(text.strip())
                continue

            words = jieba.lcut(text) if jieba else list(text)
            # 过滤：停用词、单字符、纯标点、纯数字片段、IP碎片
            keywords = []
            for w in words:
                w = w.strip()
                if not w or w in stopwords or len(w) < 2:
                    continue
                if not any(c.isalnum() for c in w):
                    continue
                if w.replace('.','').isdigit() and '.' in w and not _ip_re.match(w):
                    continue
                keywords.append(w)
            # 提取IP、域名、端口、工具名
            ip = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', text)
            if ip:
                keywords.append(ip.group())
            domain = re.search(r'\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b', text)
            if domain:
                keywords.append(domain.group())
            port = re.search(r'\b(\d{2,5})\b', text)
            if port and 1 <= int(port.group(1)) <= 65535:
                keywords.append(port.group(1))
            tools = ['nmap','masscan','nuclei','subfinder','xray','wpscan','hydra','ffuf','sqlmap','nikto','dirb','gobuster','whatweb','wafw00f','testssl']
            for t in tools:
                if t in text.lower():
                    keywords.append(t)
            initial_keywords.extend([k for k in keywords if k and k.strip()])

        initial_keywords = list(dict.fromkeys(initial_keywords))[:12]

        # ================================================================
        # 第二阶段：向量语义检索 + 关键词匹配
        # ================================================================
        all_memories = []
        seen_hashes = set()

        # 直接按IP/域名目标查找扫描记忆（最高优先级）
        for kw in initial_keywords:
            if _ip_re.match(kw) or _domain_re.match(kw):
                try:
                    target_results = self.memory_system.search_scan_memories(target=kw, limit=5)
                    for mem in target_results:
                        content = mem.get('content', '')
                        content_hash = hash(content[:100])
                        if content_hash not in seen_hashes:
                            seen_hashes.add(content_hash)
                            all_memories.append({
                                'source': 'scan_date',
                                'content': content,
                                'context': mem.get('context', {}),
                                'time': mem.get('time', ''),
                                'trigger': kw,
                                'score': 1.0
                            })
                except Exception:
                    pass

        # 漏洞相似匹配（当用户问题涉及漏洞时，查找历史相似漏洞）
        vuln_keywords = ['漏洞', 'CVE', 'cve', 'exploit', '注入', 'XSS', 'xss', 'SQL', 'sql', '溢出', '越权', 'RCE', 'rce', 'LFI', 'lfi', 'SSRF', 'ssrf', 'CSRF', 'csrf']
        has_vuln = any(kw in user_input for kw in vuln_keywords)
        if has_vuln:
            try:
                vuln_core = {
                    'target': user_input[:100],
                    'vulnerability_types': [kw for kw in vuln_keywords if kw in user_input],
                    'core_features': [kw for kw in vuln_keywords if kw in user_input],
                    'content': user_input
                }
                similar_vulns = self.memory_system.similar_match(vuln_core)
                for item in similar_vulns:
                    mem_tag = item.get('memory_tag', '')
                    mem_data = self.memory_system.read_memory(mem_tag, silent=True) if mem_tag else None
                    if not mem_data:
                        continue
                    content_text = mem_data.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'scan_vuln_similar',
                            'content': content_text,
                            'context': mem_data.get('context', {}),
                            'time': mem_data.get('time', mem_data.get('创建时间', '')),
                            'trigger': '漏洞相似匹配',
                            'score': 0.9
                        })
            except Exception:
                pass

        for keyword in initial_keywords[:10]:
            if len(keyword) < 1:
                continue

            # 向量语义检索扫描记忆
            try:
                scan_results = self.memory_system.vector_search_scan(
                    keyword, top_k=5, similarity_threshold=0.2
                )
                for mem in scan_results:
                    content = mem.get('content', '')
                    content_hash = hash(content[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'scan_semantic',
                            'content': content,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', ''),
                            'trigger': keyword,
                            'score': mem.get('score', 0.0)
                        })
            except Exception as e:
                print(f" 扫描记忆语义检索失败: {e}")

            # 混合检索记忆河流（关键词+全文+主题标签+多维度评分，吸收0.1.5）
            try:
                river_results = self.memory_system.retrieve_mixed(keyword, quantity=5)
                for mem in river_results:
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'river_mixed',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': keyword,
                            'score': mem.get('相关性分数', 0.0)
                        })
            except Exception as e:
                print(f" 记忆河流混合检索失败: {e}")

            # 密度加权检索记忆河流（能量×相关性×关联密度+亲和度权重，最强检索方法）
            try:
                density_results = self.memory_system.retrieve_by_density(keyword, top_k=5, min_energy=0.05)
                for item in density_results:
                    mem = item.get('memory', {})
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'river_density',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': keyword,
                            'score': item.get('density', 0.0)
                        })
            except Exception as e:
                print(f" 记忆河流密度检索失败: {e}")

            # 纯向量检索记忆河流（作为混合检索的补充）
            try:
                vec_river = self.memory_system.vector_search_river(keyword, top_k=3, similarity_threshold=0.15)
                for mem in vec_river:
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'river_vector',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': keyword,
                            'score': mem.get('similarity', 0.0)
                        })
            except Exception:
                pass

            # 基础关键词检索记忆河流（作为兜底）
            try:
                basic_river = self.memory_system.retrieve(keyword, limit=3)
                for mem in basic_river:
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'river_basic',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': keyword,
                            'score': mem.get('score', 0.0)
                        })
            except Exception:
                pass

            # 全局记忆搜索（跨用户共享记忆）
            try:
                global_results = self.memory_system._search_global_memory(keyword, limit=3)
                for mem in global_results:
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'river_global',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': keyword,
                            'score': 0.5
                        })
            except Exception:
                pass

            # 直接关键词搜索扫描记忆（补充向量检索的不足）
            try:
                kw_scan = self.memory_system.search_scan_memories_keyword(keyword, limit=3)
                for mem in kw_scan:
                    content = mem.get('content', '')
                    content_hash = hash(content[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'scan_keyword',
                            'content': content,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', ''),
                            'trigger': keyword,
                            'score': 0.7
                        })
            except Exception:
                pass

            # 关键词匹配普通记忆
            try:
                normal_results = self.memory_system.high_quality_search(
                    keyword=keyword, quantity=15, minimum_importance="日常片段"
                )
                for mem in normal_results:
                    content = mem.get('content', mem.get('内容', ''))
                    content_hash = hash(content[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'normal_keyword',
                            'content': content,
                            'context': mem.get('context', mem.get('上下文', {})),
                            'time': mem.get('time', mem.get('时间', '')),
                            'trigger': keyword,
                            'score': mem.get('相关性分数', mem.get('quality_score', 0.0))
                        })
            except Exception as e:
                print(f" 普通记忆关键词检索失败: {e}")

            # 日期检索（检测关键词中是否包含日期格式）
            date_match = re.search(r'(\d{4}-\d{2}-\d{2})', keyword)
            if not date_match:
                date_match = re.search(r'(\d{1,2})\s*[号日]', keyword)
            if date_match:
                try:
                    day = int(date_match.group(1))
                    now = datetime.now()
                    target_date = f"{now.year}-{now.month:02d}-{day:02d}"
                    date_results = self.memory_system.search_scan_memories(
                        target=None, keyword=target_date.replace('-', ''), limit=3
                    )
                    for mem in date_results:
                        content = mem.get('content', '')
                        content_hash = hash(content[:100])
                        if content_hash not in seen_hashes:
                            seen_hashes.add(content_hash)
                            all_memories.append({
                                'source': 'scan_date',
                                'content': content,
                                'context': mem.get('context', {}),
                                'time': mem.get('time', ''),
                                'trigger': f"日期:{target_date}",
                                'score': 0.8
                            })
                except Exception:
                    pass

        # ================================================================
        # 第三阶段：关键词关联（从检索结果中提取新关键词）
        # ================================================================
        new_keywords = []
        for mem in all_memories[:15]:
            content = mem.get('content', '')
            ip = re.search(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', content)
            if ip:
                new_keywords.append(ip.group())
            domain = re.search(r'\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b', content)
            if domain:
                new_keywords.append(domain.group())
            port = re.search(r'\b(\d{1,5})\b', content)
            if port and 1 <= int(port.group(1)) <= 65535:
                new_keywords.append(port.group(1))
            tools = ['nmap','masscan','nuclei','subfinder','xray','wpscan']
            for t in tools:
                if t in content.lower():
                    new_keywords.append(t)
            if jieba:
                words = jieba.lcut(content)
                for w in words:
                    if len(w) >= 2 and w not in stopwords:
                        new_keywords.append(w)
            else:
                for w in content.split():
                    if len(w) >= 2:
                        new_keywords.append(w)

        used_keywords = set(initial_keywords)
        new_keywords = [k for k in new_keywords if k not in used_keywords and len(k) >= 1]
        new_keywords = list(dict.fromkeys(new_keywords))[:8]

        # ================================================================
        # 第三点五阶段：记忆网络关联扩展（主题+时间+相关记忆）
        # ================================================================
        for mem in all_memories[:5]:
            content = mem.get('content', '')
            ctx = mem.get('context', {})
            if not isinstance(ctx, dict):
                ctx = {}

            # 主题标签关联扩展
            try:
                mem_tags = ctx.get('tags', [])
                if not mem_tags and content:
                    mem_tags = self.memory_system._automatically_extract_topic_tags(content)
                if mem_tags:
                    theme_related = self.memory_system._retrieve_theme_related_memories(mem_tags)
                    for related_id in theme_related[:3]:
                        related_mem = self.memory_system.read_memory(related_id, silent=True)
                        if not related_mem:
                            continue
                        content_text = related_mem.get('content', '')
                        if not content_text:
                            continue
                        content_hash = hash(content_text[:100])
                        if content_hash not in seen_hashes:
                            seen_hashes.add(content_hash)
                            all_memories.append({
                                'source': 'river_theme_related',
                                'content': content_text,
                                'context': related_mem.get('context', {}),
                                'time': related_mem.get('time', related_mem.get('创建时间', '')),
                                'trigger': f"主题关联→{mem_tags[0] if mem_tags else ''}",
                                'score': 0.6
                            })
            except Exception:
                pass

            # 时间关联扩展（±7天）
            try:
                mem_time = mem.get('time', '')
                if mem_time and isinstance(mem_time, str) and len(mem_time) >= 10:
                    time_related = self.memory_system._retrieve_time_related_memories(mem_time[:10])
                    for related_id in time_related[:2]:
                        related_mem = self.memory_system.read_memory(related_id, silent=True)
                        if not related_mem:
                            continue
                        content_text = related_mem.get('content', '')
                        if not content_text:
                            continue
                        content_hash = hash(content_text[:100])
                        if content_hash not in seen_hashes:
                            seen_hashes.add(content_hash)
                            all_memories.append({
                                'source': 'river_time_related',
                                'content': content_text,
                                'context': related_mem.get('context', {}),
                                'time': related_mem.get('time', related_mem.get('创建时间', '')),
                                'trigger': f"时间关联→{mem_time[:10]}",
                                'score': 0.55
                            })
            except Exception:
                pass

        # 相关记忆检索（兼容两种返回格式）
        try:
            relevant = self.memory_system._retrieve_relevant_memories(user_input, limit=3)
            relevant_list = relevant.get('相关记忆', relevant.get('memories', []))
            for mem in relevant_list:
                content_text = mem.get('内容', mem.get('content', ''))
                if not content_text:
                    continue
                content_hash = hash(content_text[:100])
                if content_hash not in seen_hashes:
                    seen_hashes.add(content_hash)
                    all_memories.append({
                        'source': 'river_relevant',
                        'content': content_text,
                        'context': mem.get('context', {}),
                        'time': mem.get('时间', mem.get('time', '')),
                        'trigger': '相关记忆',
                        'score': 0.5
                    })
        except Exception:
            pass

        # ================================================================
        # 第四阶段：连锁语义查找（用新关键词再次检索）
        # ================================================================
        for keyword in new_keywords:
            try:
                scan_results = self.memory_system.vector_search_scan(
                    keyword, top_k=3, similarity_threshold=0.15
                )
                for mem in scan_results:
                    content = mem.get('content', '')
                    content_hash = hash(content[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'chain_semantic',
                            'content': content,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', ''),
                            'trigger': f"连锁→{keyword}",
                            'score': mem.get('score', 0.0)
                        })
            except Exception:
                pass

            # 连锁混合检索记忆河流
            try:
                river_results = self.memory_system.retrieve_mixed(keyword, quantity=3)
                for mem in river_results:
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'chain_river_mixed',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': f"连锁河流→{keyword}",
                            'score': mem.get('相关性分数', 0.0)
                        })
            except Exception:
                pass

            # 连锁密度加权检索记忆河流
            try:
                chain_density = self.memory_system.retrieve_by_density(keyword, top_k=3, min_energy=0.05)
                for item in chain_density:
                    mem = item.get('memory', {})
                    content_text = mem.get('content', '')
                    if not content_text:
                        continue
                    content_hash = hash(content_text[:100])
                    if content_hash not in seen_hashes:
                        seen_hashes.add(content_hash)
                        all_memories.append({
                            'source': 'chain_river_density',
                            'content': content_text,
                            'context': mem.get('context', {}),
                            'time': mem.get('time', mem.get('创建时间', '')),
                            'trigger': f"连锁密度→{keyword}",
                            'score': item.get('density', 0.0)
                        })
            except Exception:
                pass

        # ================================================================
        # 最终输出
        # ================================================================
        lines = []

        # 1. 对话历史扫描摘要
        if scan_summaries_in_history:
            lines.append(" 当前对话中的扫描摘要：")
            for entry in scan_summaries_in_history[-3:]:
                lines.append(f"  {entry}")
            lines.append("")

        # 2. 普通记忆
        normal_mems = [m for m in all_memories if m['source'] == 'normal_keyword']
        if normal_mems:
            lines.append(" 相关普通记忆：")
            for mem in normal_mems[:15]:
                content = mem.get('content', '')
                if content:
                    ctx = mem.get('context', {})
                    if not isinstance(ctx, dict):
                        ctx = {}
                    context_desc = ctx.get('情境描述', '')
                    if context_desc:
                        lines.append(f"- {content} (情境: {context_desc})")
                    else:
                        lines.append(f"- {content}")
            lines.append("")

        # 3. 扫描记忆（排序：日期 > 关键词 > 语义 > 连锁）
        scan_mems = [m for m in all_memories if m['source'] != 'normal_keyword']
        if scan_mems:
            lines.append("--- 以下是相关历史安全扫描/HTTP请求记录（请以这些数据为准） ---")
            priority = {
                'scan_date': 0,
                'scan_vuln_similar': 0,
                'scan_keyword': 1,
                'scan_semantic': 2,
                'river_mixed': 2,
                'river_density': 2,
                'river_theme_related': 3,
                'river_time_related': 3,
                'river_relevant': 3,
                'river_vector': 4,
                'river_basic': 4,
                'river_global': 4,
                'chain_semantic': 5,
                'chain_river_mixed': 5,
                'chain_river_density': 5,
            }
            scan_mems.sort(key=lambda x: (priority.get(x['source'], 9), -x.get('score', 0)))
            for idx, mem in enumerate(scan_mems[:15], 1):
                ctx = mem.get('context', {})
                if not isinstance(ctx, dict):
                    ctx = {}
                mem_target = ctx.get('target', '未知目标')
                scan_type = ctx.get('scan_type', '未知类型')
                content = mem.get('content', '')
                time_str = mem.get('time', '')
                trigger = mem.get('trigger', '')
                lines.append(f"[记录 {idx}]")
                if time_str:
                    lines.append(f"  时间: {time_str}")
                lines.append(f"  目标: {mem_target}")
                lines.append(f"  类型: {scan_type}")
                lines.append(f"  摘要: {content}")
                if trigger and not trigger.startswith('连锁'):
                    lines.append(f"  触发词: {trigger}")
                raw = ctx.get('raw_output', '')
                if raw:
                    port_match = re.search(r'Ports:\s+(.+?)(?:\n|$)', raw)
                    if port_match:
                        lines.append(f"  端口: {port_match.group(1)}")
            lines.append("--- 请根据上述记录回答用户问题 ---")

        # 如果没有任何结果，尝试返回最近的记忆
        if not normal_mems and not scan_mems:
            try:
                recent_scan = self.memory_system.get_recent_scan_memories(limit=3)
                recent_river = self.memory_system.get_recent_river_memories(limit=3)
                if recent_scan or recent_river:
                    fallback_lines = [" 最近的记忆记录："]
                    for mem in recent_scan:
                        ctx = mem.get('context', {})
                        t = mem.get('target', ctx.get('target', ''))
                        st = ctx.get('scan_type', '')
                        c = mem.get('content', '')[:150]
                        fallback_lines.append(f"  [扫描] {t} ({st}): {c}")
                    for mem in recent_river:
                        c = mem.get('content', '')[:150]
                        fallback_lines.append(f"  [记忆] {c}")
                    return "\n".join(fallback_lines)
            except Exception:
                pass
            return ""

        # 组合最终结果
        result_lines = []
        # 先放扫描摘要
        scan_summary_part = [l for l in lines if l.startswith("")]
        if scan_summary_part:
            result_lines.extend(scan_summary_part)
        # 再放普通记忆
        normal_part = []
        normal_idx = -1
        for i, l in enumerate(lines):
            if l.startswith(""):
                normal_idx = i
                break
        if normal_idx != -1:
            normal_part = lines[normal_idx:normal_idx + len(normal_mems) + 2]  # 加上标题和空行
        # 最后放扫描记录
        scan_part = []
        scan_idx = -1
        for i, l in enumerate(lines):
            if l.startswith("---"):
                scan_idx = i
                break
        if scan_idx != -1:
            scan_part = lines[scan_idx:]

        # 按顺序拼接：扫描摘要 -> 普通记忆 -> 扫描记录
        final_lines = []
        if scan_summary_part:
            final_lines.extend(scan_summary_part)
        if normal_part:
            final_lines.extend(normal_part)
        if scan_part:
            final_lines.extend(scan_part)
        # 如果上面没有生成，回退到lines
        if not final_lines:
            final_lines = lines

        return "\n".join(final_lines)

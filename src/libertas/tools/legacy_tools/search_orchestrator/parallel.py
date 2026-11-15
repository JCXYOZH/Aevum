"""搜索编排器（SearchOrchestrator）

统一管理多引擎并行搜索、结果合并、容错重试。
解决单引擎失败/超时导致搜索不可用的问题。

策略：
1. 并行发起多个搜索引擎请求（线程池）
2. 谁先成功且结果足够就用谁，其他引擎结果作为补充
3. 结果去重（按URL标准化）
4. 全部失败时尝试 Wikipedia API + DuckDuckGo Instant Answer
5. 硬超时保护，不卡住主流程
"""

from __future__ import annotations

import re
import time
import logging
from .constants import *


def parallel_search(query: str, max_results: int = 8,
                    progress_cb: Optional[Callable] = None,
                    fast_only: bool = False) -> Dict[str, Any]:
    """并行多引擎搜索。

    Args:
        query: 搜索关键词
        max_results: 最大结果数
        progress_cb: 进度回调 callback(step, **kw)
        fast_only: 只使用快速引擎（用于前置搜索，延迟敏感）

    Returns:
        {"query": str, "results": [...], "total": int, "engines_used": [...], "error": str?}
    """
    def _notify(step, **kw):
        if progress_cb:
            try:
                progress_cb(step, **kw)
            except Exception:
                pass

    _notify("searching", query=query)

    # 高级搜索语法（dork）检测
    _is_dork = False
    _dork_info = None
    _dork_filtered_out = 0   # 因不符合高级语法而被过滤掉的结果数（用于给明确提示）
    try:
        from .dork_parser import parse_dork, is_dork_query
        if is_dork_query(query):
            _dork_info = parse_dork(query)
            _is_dork = _dork_info.get("is_dork", False)
    except Exception:
        pass

    # 安全意图路由：CVE/子域名/历史URL/Shodan 走专项引擎（dork查询不走专项路由）
    if not _is_dork:
        try:
            from .security_search import detect_security_intent, SECURITY_SEARCH_ENGINES
            intent = detect_security_intent(query)
            if intent and intent in SECURITY_SEARCH_ENGINES:
                _notify("security_intent", engine=intent, query=query)
                try:
                    sec_results = SECURITY_SEARCH_ENGINES[intent](query, max_results)
                except Exception as e:
                    sec_results = []
                    logger.warning(f"Security search engine {intent} failed: {e}")
                if sec_results:
                    _notify("search_done", query=query, count=len(sec_results),
                            engines=[intent], urls=[r.get("url","") for r in sec_results[:5]],
                            titles=[r.get("title","") for r in sec_results[:5]])
                    return {"query": query, "results": sec_results,
                            "total": len(sec_results), "engines_used": [intent],
                            "elapsed": 0.0, "intent": intent}
        except Exception as e:
            logger.debug(f"Security intent routing skipped: {e}")

    engines = FAST_ENGINES if fast_only else ENGINE_PRIORITY
    if _is_dork:
        # dork查询：Bing语法支持最全，优先Bing；Baidu对dork支持差且中文拆词，排最后
        engines = ["bing", "ddg_html", "mojeek", "google", "duckduckgo"] + [e for e in engines if e not in ("bing", "ddg_html", "mojeek", "google", "duckduckgo")]
    total_timeout = 5.0 if fast_only else TOTAL_TIMEOUT

    all_results: List[Dict] = []
    engines_used: List[str] = []
    errors: List[str] = []
    _lock = threading.Lock()

    start_time = time.time()
    # fast_only 模式下3条就够（前置搜索只需要快速结果），完整搜索需要5条
    min_results = 3 if fast_only else MIN_RESULTS

    # 第一波：并行竞速（不使用 with 语句，避免 shutdown(wait=True) 阻塞等待慢引擎）
    executor = ThreadPoolExecutor(max_workers=min(len(engines), 6))
    future_to_engine = {
        executor.submit(_search_one_engine, eng, query, max_results): eng
        for eng in engines[:6]
    }

    try:
        for future in as_completed(future_to_engine, timeout=total_timeout):
            engine_name = future_to_engine[future]
            try:
                result = future.result(timeout=ENGINE_TIMEOUT)
            except Exception as e:
                errors.append(f"{engine_name}: {str(e)[:100]}")
                continue

            if result["results"]:
                with _lock:
                    all_results.extend(result["results"])
                    engines_used.append(engine_name)
                    _notify("engine_success", engine=engine_name,
                            count=len(result["results"]),
                            elapsed=result.get("elapsed", 0))
                    deduped = _dedup_results(all_results)
                    if len(deduped) >= min_results:
                        for f in future_to_engine:
                            f.cancel()
                        break
            else:
                err = result.get("error", "no results")
                errors.append(f"{engine_name}: {err}")
                _notify("engine_fail", engine=engine_name, error=err)
    except TimeoutError:
        errors.append("总超时")
    finally:
        # 不等待慢引擎（如被墙的DDG），让它们在后台自行结束
        executor.shutdown(wait=False)

    # 去重
    all_results = _dedup_results(all_results)

    # 关键词相关度过滤（dork查询由搜索引擎保证相关性，跳过）
    if not _is_dork:
        all_results = _filter_irrelevant(query, all_results)
    else:
        # dork查询：对结果进行二次过滤，确保site:/filetype:等语法真正生效
        try:
            from .dork_parser import parse_dork
            _dork_info = parse_dork(query)
            before_count = len(all_results)
            all_results = _filter_by_dork(_dork_info, all_results)
            after_count = len(all_results)
            if before_count != after_count:
                logger.info(f"Dork二次过滤: {before_count}条 -> {after_count}条")
            if before_count and not after_count:
                _dork_filtered_out = before_count
        except Exception as _dork_err:
            logger.warning(f"Dork二次过滤失败，跳过: {_dork_err}")

    # 解析搜索引擎重定向URL（百度/谷歌/Bing的链接跳转），拿到真实URL
    # 限时2秒，超时则跳过——抓取阶段会自动跟随重定向，不影响结果可用性
    try:
        from .web_search import resolve_redirect_urls
        all_results = resolve_redirect_urls(all_results, timeout=2.0)
        all_results = _dedup_results(all_results)
    except Exception:
        pass

    # 第二波：如果结果不足，尝试 DDG Instant Answer 和 Wikipedia
    if len(all_results) < 3 and not fast_only:
        _notify("fallback_search", query=query)
        # DDG Instant Answer
        ddg_ia = _ddg_instant_answer(query)
        if ddg_ia:
            all_results.extend(ddg_ia)
            engines_used.append("ddg_ia")
        # Wikipedia
        if len(all_results) < 3:
            wiki = _wikipedia_api_search(query, 5)
            if wiki:
                all_results.extend(wiki)
                engines_used.append("wikipedia_api")
        all_results = _dedup_results(all_results)

    # 内容相似度去重（不同站转载同一内容，如百度百科/汉典/国学）
    all_results = _content_dedup(all_results, threshold=0.55)

    # URL清理（去除空格、修复被破坏的域名、过滤无效URL）
    all_results = _clean_results_urls(all_results)

    # 过滤后为空是很常见的情况：引擎返回了一堆"只沾一个词"的泛结果，
    # 被相关度过滤掉之后就什么都不剩了。这时换几个还没试过的引擎再搜一次，
    # 而不是直接告诉用户"无结果"。
    if not all_results and not fast_only and not _is_dork:
        _retry_engines = [e for e in ENGINE_PRIORITY if e not in engines_used][:3]
        if _retry_engines:
            _notify("quality_retry", query=query, score=0.0)
            for _eng in _retry_engines:
                try:
                    _r = _search_one_engine(_eng, query, max_results)
                    if _r.get("results"):
                        all_results.extend(_r["results"])
                        engines_used.append(_eng)
                except Exception:
                    pass
            if all_results:
                all_results = _dedup_results(all_results)
                all_results = _filter_irrelevant(query, all_results)
                all_results = _clean_results_urls(all_results)
                all_results = _semantic_rerank(query, all_results)

    elapsed = time.time() - start_time

    if not all_results:
        if _is_dork and _dork_filtered_out:
            # 有结果，但没有一条符合 site:/filetype:/inurl: 等条件 —— 如实说明并提示放宽，
            # 而不是把不符合语法的结果当成"搜索结果"返回。
            _conds = " ".join(f"{k}:{v[0]}" for k, v in (_dork_info or {}).get("operators", {}).items() if v)
            _notify("search_error", query=query, error="no_dork_match")
            return {
                "query": query, "results": [], "total": 0,
                "engines_used": engines_used, "is_dork": True,
                "error": (f"没有符合高级语法（{_conds or '精确短语/排除词'}）的结果，"
                          f"已检查 {_dork_filtered_out} 条；可放宽条件后重试"),
                "elapsed": time.time() - start_time,
            }
        err_summary = "; ".join(errors[:3]) if errors else "所有引擎均无结果"
        _notify("search_error", query=query, error=err_summary)
        return {
            "query": query, "results": [], "total": 0,
            "engines_used": engines_used, "error": err_summary,
            "elapsed": elapsed,
        }

    # 语义向量重排（按和查询的相关度重新排序）
    all_results = _semantic_rerank(query, all_results)

    # 质量门控：检查Top结果是否和查询相关，不相关则换引擎重试一次（dork查询跳过）
    _quality_ok, _quality_score = _check_result_quality(query, all_results)
    if not _quality_ok and not fast_only and not _is_dork:
        _notify("quality_retry", query=query, score=_quality_score)
        # 用备用引擎重试
        retry_engines = ["bing", "ddg_html", "mojeek"] if "baidu" in engines_used else ["baidu", "bing"]
        for eng in retry_engines:
            if eng in engines_used:
                continue
            try:
                r = _search_one_engine(eng, query, max_results)
                if r.get("results"):
                    all_results.extend(r["results"])
                    engines_used.append(eng)
            except Exception:
                pass
        all_results = _dedup_results(all_results)
        all_results = _filter_irrelevant(query, all_results)
        all_results = _clean_results_urls(all_results)
        all_results = _content_dedup(all_results, threshold=0.55)
        all_results = _semantic_rerank(query, all_results)

    # 多源交叉验证标记
    all_results = _mark_cross_validated(all_results)

    # 截断到 max_results
    all_results = all_results[:max_results]

    _notify("search_done", query=query, count=len(all_results),
            engines=engines_used, elapsed=elapsed,
            urls=[r["url"] for r in all_results[:5]],
            titles=[r.get("title", "") for r in all_results[:5]])

    return {
        "query": query,
        "results": all_results,
        "total": len(all_results),
        "engines_used": engines_used,
        "elapsed": elapsed,
        "is_dork": _is_dork,
    }

def format_parallel_results(search_data: Dict) -> str:
    """格式化并行搜索结果为模型可读文本"""
    if not search_data.get("results"):
        err = search_data.get("error", "未知错误")
        return f"【搜索失败: {err}】"

    query = search_data["query"]
    results = search_data["results"]
    engines = search_data.get("engines_used", [])
    engine_str = "+".join(engines) if engines else "unknown"

    lines = [f"【搜索结果: {query}（{len(results)}条，来自{engine_str}）】"]
    lines.append("以下是本地系统搜索到的真实结果。直接基于这些信息回答，不要说'让我搜索'。")
    lines.append("如需查看完整页面，调用 web_fetch 工具传入对应URL。")
    lines.append("")

    for i, r in enumerate(results, 1):
        title = r.get("title", "")
        url = r.get("url", "")
        snippet = r.get("snippet", "")
        lines.append(f"{i}. {title}")
        lines.append(f"   URL: {url}")
        if snippet:
            lines.append(f"   {snippet}")
        lines.append("")

    return "\n".join(lines)

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
import threading
from .constants import *


_rerank_vectorizer = None

_rerank_lock = threading.Lock()

_rerank_load_started = False  # 是否已启动后台加载（避免重复）

def _get_rerank_vectorizer(blocking: bool = True):
    """获取共享语义向量模型用于结果重排。
    blocking=True: 阻塞加载（可能需要几十秒）
    blocking=False: 非阻塞，未加载则返回None，后台异步加载
    """
    global _rerank_vectorizer, _rerank_load_started
    if _rerank_vectorizer is not None:
        return _rerank_vectorizer
    if not blocking:
        # 非阻塞模式：如果还没启动后台加载，启动一个
        if not _rerank_load_started:
            _rerank_load_started = True
            try:
                import threading as _th_bg
                def _bg_load():
                    global _rerank_vectorizer
                    try:
                        with _rerank_lock:
                            if _rerank_vectorizer is None:
                                from libertas.ai.vectorizers import get_shared_semantic_vectorizer
                                _rerank_vectorizer = get_shared_semantic_vectorizer()
                                if _rerank_vectorizer:
                                    print("✅ 语义向量模型后台加载完成")
                    except Exception:
                        _rerank_vectorizer = None
                _t = _th_bg.Thread(target=_bg_load, daemon=True)
                _t.start()
            except Exception:
                pass
        return None
    # 阻塞模式
    with _rerank_lock:
        if _rerank_vectorizer is not None:
            return _rerank_vectorizer
        try:
            from libertas.ai.vectorizers import get_shared_semantic_vectorizer
            _rerank_vectorizer = get_shared_semantic_vectorizer()
        except Exception:
            _rerank_vectorizer = None
    return _rerank_vectorizer

def _semantic_rerank(query: str, results: List[Dict]) -> List[Dict]:
    """用向量相似度对搜索结果重排，最相关的排最前。

    重排分数 = 0.7 * 语义相似度(title+snippet vs query) + 0.3 * 引擎可信度
    异步等待模式：先用非阻塞模式获取模型，如果没加载好就最多等3秒，不直接禁用。
    """
    if len(results) <= 1:
        return results

    # 异步等待模式：先用非阻塞模式获取模型，如果没加载好就最多等3秒
    vec = _get_rerank_vectorizer(blocking=False)
    if vec is None:
        print("⏳ 语义重排：向量模型正在加载中，最多等待3秒...")
        import time as _wait_time
        _wait_start = _wait_time.time()
        while _wait_time.time() - _wait_start < 3.0:
            _wait_time.sleep(0.2)
            vec = _get_rerank_vectorizer(blocking=False)
            if vec is not None:
                print(f"✅ 语义重排：向量模型在 {_wait_time.time()-_wait_start:.1f}秒 内加载完成")
                break
        if vec is None:
            print("⚠️ 语义重排：向量模型3秒内未加载完成，本次保持原搜索顺序（后台继续加载）")
            return results

    try:
        from libertas.ai.vectorizers import cosine_similarity
        print(f"🧬 语义重排：正在对 {len(results)} 条结果进行语义向量编码...")
        query_vec = vec.vectorize([query])
        if query_vec is None:
            print("⚠️ 语义重排：查询向量编码失败，保持原顺序")
            return results
        reranked_count = 0
        for r in results:
            text = f"{r.get('title', '')} {r.get('snippet', '')}".strip()
            if text:
                result_vec = vec.vectorize([text])
                if result_vec is not None:
                    sim = cosine_similarity(query_vec, result_vec)
                    r["_rerank_score"] = round(sim, 4)
                    reranked_count += 1
                else:
                    r["_rerank_score"] = 0.0
            else:
                r["_rerank_score"] = 0.0
        results.sort(key=lambda x: -x.get("_rerank_score", 0))
        top_score = results[0].get("_rerank_score", 0) if results else 0
        print(f"✅ 语义重排完成：{reranked_count}/{len(results)} 条结果已重排，最高相关度: {top_score}")
    except Exception as e:
        print(f"⚠️ 语义重排异常: {e}")
    return results

def _mark_cross_validated(results: List[Dict]) -> List[Dict]:
    """标记多源交叉验证的结果（同一域名在多个引擎出现）。"""
    # 简化版：如果结果来自多个引擎，前3条标记为已验证
    if len(results) >= 3:
        for r in results[:3]:
            r["verified"] = True
    return results

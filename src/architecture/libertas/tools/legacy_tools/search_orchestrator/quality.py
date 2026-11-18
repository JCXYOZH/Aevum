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


def _is_chinese_query(query: str) -> bool:
    """判断查询是否主要是中文。"""
    if not query:
        return False
    chinese_chars = sum(1 for c in query if '\u4e00' <= c <= '\u9fff')
    return chinese_chars / max(len(query), 1) > 0.3

def _check_result_quality(query: str, results: List[Dict],
                          threshold: float = 0.35) -> Tuple[bool, float]:
    """检查搜索结果与查询的相关性。

    用向量相似度检查Top-3结果的平均相关度。
    返回 (是否合格, 最高相关度分数)。
    """
    if not results:
        return False, 0.0

    vec = _get_rerank_vectorizer()
    if vec is None:
        return True, 1.0  # 向量不可用时不拦截

    try:
        from libertas.ai.vectorizers import cosine_similarity
        query_vec = vec.vectorize([query])
        scores = []
        for r in results[:3]:
            text = f"{r.get('title', '')} {r.get('snippet', '')}".strip()
            if text:
                sim = cosine_similarity(query_vec, vec.vectorize([text]))
                scores.append(sim)
        if not scores:
            return False, 0.0
        max_score = max(scores)
        avg_score = sum(scores) / len(scores)
        # Top结果相关度太低 → 质量不合格
        return max_score >= threshold, max_score
    except Exception:
        return True, 1.0  # 异常时不拦截

_protected_terms = None

_protected_terms_lock = threading.Lock()

def _load_protected_terms() -> set:
    """加载保护词典（安全术语、专有名词等不允许拆分的完整词）。"""
    global _protected_terms
    if _protected_terms is not None:
        return _protected_terms
    with _protected_terms_lock:
        if _protected_terms is not None:
            return _protected_terms
        terms = set()
        import os
        for path in (
            os.path.join(os.path.dirname(__file__), "..", "..", "config", "protected_terms.txt"),
            os.path.join(get_data_dir(), "protected_terms.txt"),
        ):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        t = line.strip()
                        if t and not t.startswith("#"):
                            terms.add(t.lower())
            except Exception:
                pass
        _protected_terms = terms
        return terms

def _keyword_relevance(query: str, text: str) -> float:
    """轻量级关键词相关度（不依赖语义模型）。
    中文用 bigram（二字组合）+ trigram（三字组合）重叠率，英文/混合用单词包含率。
    混合查询（中文+英文）分别计算，取最大值，避免因一方不匹配导致相关度为0。
    如果查询包含保护词典中的完整词，或3字以上中文连续短语，该词必须出现在结果中，否则相关度为0。
    返回 0.0~1.0。
    """
    if not query or not text:
        return 0.0
    q = query.lower().strip()
    t = text.lower().strip()
    if q in t:
        return 1.0
    protected = _load_protected_terms()
    for term in protected:
        if len(term) >= 3 and term in q and term not in t:
            return 0.0
    import re as _re_kr
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in q)
    has_english = any('a' <= c <= 'z' for c in q)

    # 计算英文相关度（如果有英文）
    en_score = 0.0
    if has_english:
        q_words = set(_re_kr.findall(r'[a-z0-9]+', q))
        # 过滤掉纯数字和太短的词
        q_words = {w for w in q_words if not w.isdigit() and len(w) >= 2}
        if q_words:
            t_words = set(_re_kr.findall(r'[a-z0-9]+', t))
            hit = len(q_words & t_words)
            en_score = hit / len(q_words)

    # 计算中文相关度（如果有中文）
    zh_score = 0.0
    if has_chinese:
        # 自动保护：3字以上中文连续串必须完整出现在结果中
        zh_phrases = _re_kr.findall(r'[\u4e00-\u9fff]{3,}', q)
        for phrase in zh_phrases:
            if phrase not in t:
                # 中文保护词不匹配，但如果英文匹配度高，仍保留
                if en_score < 0.5:
                    return 0.0
                break
        # bigram + trigram 混合，trigram 权重更高
        q_bi = set(q[i:i+2] for i in range(len(q)-1) if '\u4e00' <= q[i] <= '\u9fff' and '\u4e00' <= q[i+1] <= '\u9fff')
        q_tri = set(q[i:i+3] for i in range(len(q)-2) if all('\u4e00' <= q[i+j] <= '\u9fff' for j in range(3)))
        if q_bi:
            t_bi = set(t[i:i+2] for i in range(len(t)-1))
            t_tri = set(t[i:i+3] for i in range(len(t)-2))
            hit_bi = len(q_bi & t_bi) / len(q_bi)
            hit_tri = len(q_tri & t_tri) / len(q_tri) if q_tri else 0
            zh_score = hit_bi * 0.4 + hit_tri * 0.6

    # 混合查询：中英文两侧**都要达标**才算相关。
    # 原来取 max()：查"python requests 超时设置"，结果里只有 Python 官网/入门教程
    # （只命中 python 一个英文词 → en=0.5）也能拿到 0.5，直接越过中文阈值 0.45，
    # 于是大量只沾一个词的泛结果被留下 —— 这就是"搜索不准确"的主要来源。
    if has_chinese and has_english:
        if zh_score >= 0.45 and en_score >= 0.35:
            return max(zh_score, en_score)
        return 0.0
    elif has_chinese:
        return zh_score
    elif has_english:
        return en_score
    else:
        return 0.0

def _filter_irrelevant(query: str, results: List[Dict], threshold: float = 0.45) -> List[Dict]:
    """用关键词相关度过滤明显不相关的结果。全部不相关时返回空列表（触发换引擎重试）。
    中文查询阈值更高（0.45），英文 0.35。"""
    if not results or not query:
        return results
    has_chinese = any('\u4e00' <= c <= '\u9fff' for c in query)
    actual_threshold = 0.45 if has_chinese else threshold
    filtered = []
    for r in results:
        text = f"{r.get('title', '')} {r.get('snippet', '')} {r.get('url', '')}"
        if _keyword_relevance(query, text) >= actual_threshold:
            filtered.append(r)
    return filtered

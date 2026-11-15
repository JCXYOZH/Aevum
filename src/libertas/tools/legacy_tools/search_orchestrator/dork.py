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


def _filter_by_dork(dork_info: Dict[str, Any], results: List[Dict]) -> List[Dict]:
    """根据dork运算符对搜索结果进行二次过滤，确保site:/filetype:等语法真正生效。

    过滤规则（所有条件为"与"关系）：
    - site:example.com → URL域名包含example.com
    - filetype:pdf / ext:pdf → URL以.pdf结尾
    - inurl:keyword → URL包含keyword
    - intitle:keyword → 标题包含keyword
    - intext:keyword → 摘要包含keyword
    - "精确短语" → 标题或摘要包含精确短语
    - -排除词 → 标题或摘要不包含排除词

    如果过滤后结果少于3条，自动放宽：只保留site:/filetype:等硬条件，
    去掉intitle:/intext:/短语等软条件。
    """
    if not results or not dork_info or not dork_info.get("is_dork"):
        return results

    operators = dork_info.get("operators", {})
    phrases = dork_info.get("phrases", [])
    exclude = dork_info.get("exclude", [])

    def _matches_all(r: Dict) -> bool:
        url = (r.get("url", "") or "").lower()
        title = (r.get("title", "") or "").lower()
        snippet = (r.get("snippet", "") or "").lower()
        all_text = f"{title} {snippet}"

        for site_val in operators.get("site", []):
            site_val = site_val.lower()
            try:
                parsed = urlparse(url)
                domain = (parsed.netloc or "").lower()
                if site_val not in domain and site_val not in url:
                    return False
            except Exception:
                if site_val not in url:
                    return False

        for ext_val in operators.get("filetype", []) + operators.get("ext", []):
            ext_val = ext_val.lower().lstrip(".")
            if not url.endswith(f".{ext_val}") and f".{ext_val}?" not in url and f".{ext_val}#" not in url:
                return False

        for inurl_val in operators.get("inurl", []):
            if inurl_val.lower() not in url:
                return False

        for intitle_val in operators.get("intitle", []):
            if intitle_val.lower() not in title:
                return False

        for intext_val in operators.get("intext", []):
            if intext_val.lower() not in snippet:
                return False

        for phrase in phrases:
            if phrase.lower() not in all_text:
                return False

        for ex in exclude:
            if ex.lower() in all_text:
                return False

        return True

    strict_filtered = [r for r in results if _matches_all(r)]

    if len(strict_filtered) >= 3:
        return strict_filtered

    def _matches_hard_only(r: Dict) -> bool:
        url = (r.get("url", "") or "").lower()
        title = (r.get("title", "") or "").lower()
        snippet = (r.get("snippet", "") or "").lower()

        for site_val in operators.get("site", []):
            site_val = site_val.lower()
            try:
                parsed = urlparse(url)
                domain = (parsed.netloc or "").lower()
                if site_val not in domain and site_val not in url:
                    return False
            except Exception:
                if site_val not in url:
                    return False

        for ext_val in operators.get("filetype", []) + operators.get("ext", []):
            ext_val = ext_val.lower().lstrip(".")
            if not url.endswith(f".{ext_val}") and f".{ext_val}?" not in url and f".{ext_val}#" not in url:
                return False

        for inurl_val in operators.get("inurl", []):
            if inurl_val.lower() not in url:
                return False

        all_text = f"{title} {snippet}"
        for ex in exclude:
            if ex.lower() in all_text:
                return False

        return True

    relaxed_filtered = [r for r in results if _matches_hard_only(r)]

    if relaxed_filtered:
        return relaxed_filtered

    # 连"只按 site:/filetype:/inurl: 这些硬条件"过滤后都为空 —— 这时**不能**回退成
    # "未过滤的原始结果"：那会把明显违反语法的结果直接甩给用户（例如 site:example.com
    # 却返回一堆别的站点），反而让人以为高级搜索没用。返回空，由上层给出明确提示。
    logger.info(f"Dork二次过滤后无结果（原始 {len(results)} 条都不符合条件）")
    return []

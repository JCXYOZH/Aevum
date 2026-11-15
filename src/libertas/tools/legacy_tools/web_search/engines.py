# tools/web_search.py
"""
外部网页搜索与抓取工具 - 多后端支持，高可靠性
"""
import re
import time
import threading
import concurrent.futures
import urllib.parse
from typing import List, Dict, Optional

# 独立导入 requests，确保即使 BeautifulSoup 导入失败，requests 也能正常使用
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

HAS_DEPS = HAS_REQUESTS and HAS_BS4

# 禁用urllib3不安全HTTPS警告
if HAS_REQUESTS:
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
from .constants import *
from .session import *


def _search_bing(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://www.bing.com/search"
    params = {"q": query, "count": max_results, "setlang": "zh-CN"}
    resp = _safe_get(url, params=params, headers=get_browser_headers())
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for item in soup.select("li.b_algo"):
        title_el = item.select_one("h2 a")
        snippet_el = item.select_one(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href and href.startswith("http"):
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_duckduckgo(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://html.duckduckgo.com/html/"
    resp = _safe_post(url, data={"q": query}, headers=get_browser_headers())
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for result in soup.select(".result"):
        title_el = result.select_one(".result__title")
        snippet_el = result.select_one(".result__snippet")
        title = title_el.get_text(strip=True) if title_el else ""
        href = ""
        if title_el and title_el.find("a"):
            href = title_el.find("a").get("href", "")
        if href and "uddg=" in href:
            parsed = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(parsed.query)
            if "uddg" in qs:
                href = urllib.parse.unquote(qs["uddg"][0])
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href:
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_wikipedia(query: str, max_results: int = 5) -> List[Dict]:
    results = []
    for lang in ["zh", "en"]:
        url = f"https://{lang}.wikipedia.org/w/api.php"
        params = {
            "action": "query", "list": "search", "srsearch": query,
            "srlimit": max_results, "format": "json", "utf8": 1
        }
        try:
            resp = _safe_get(url, params=params, headers=get_browser_headers(), timeout=5)
            resp.raise_for_status()
            data = resp.json()
            for item in data.get("query", {}).get("search", []):
                title = item.get("title", "")
                snippet = re.sub(r'<[^>]+>', '', item.get("snippet", ""))
                page_url = f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title)}"
                results.append({"title": title, "url": page_url, "snippet": snippet})
            if results:
                break
        except Exception:
            continue
    return results

def _search_google(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://www.google.com/search"
    params = {"q": query, "num": max_results, "hl": "zh-CN"}
    resp = _safe_get(url, params=params, headers=get_browser_headers())
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for g in soup.select("div.g, div.tF2Cxc"):
        title_el = g.select_one("h3")
        link_el = g.select_one("a[href]")
        snippet_el = g.select_one("div.VwiC3b, span.aCOpRe, div.IsZvec")
        if not title_el or not link_el:
            continue
        title = title_el.get_text(strip=True)
        href = link_el.get("href", "")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href.startswith("http"):
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_baidu(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://www.baidu.com/s"
    params = {"wd": query, "rn": max_results}
    headers = get_browser_headers()
    headers["Accept-Language"] = "zh-CN,zh;q=0.9"
    resp = _safe_get(url, params=params, headers=headers)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    soup = BeautifulSoup(resp.text, "html.parser")
    for item in soup.select("div.result, div.c-container, div[mu]"):
        title_el = item.select_one("h3 a")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        # 过滤无效URL：只保留http/https开头的
        if not href or not href.startswith("http"):
            continue
        # 过滤百度内部链接（搜索设置、登录等）
        if any(x in href for x in ["baidu.com/link?url=", "baidu.com/s?", "baidu.com/from="]):
            if "baidu.com/link?url=" not in href:
                continue
        snippet_el = item.select_one(
            ".c-abstract, .content-right_8Zs40, span.content-right_2s-H4, "
            "div.c-span-last, span.content-right_8Zs40, [class*=content-right]"
        )
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title:
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    # 立即解析百度重定向链接（百度所有结果都是 /link?url= 跳转）
    if results:
        try:
            results = resolve_redirect_urls(results, timeout=2.5)
        except Exception:
            pass
    return results

def _search_brave(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://search.brave.com/search"
    params = {"q": query, "source": "web"}
    headers = get_browser_headers()
    resp = _safe_get(url, params=params, headers=headers)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for item in soup.select("div.snippet, div.fdb"):
        title_el = item.select_one("a.result-header, span.title")
        link_el = item.select_one("a[href]")
        snippet_el = item.select_one("p.snippet-description, div.snippet-content")
        if not link_el:
            continue
        title = title_el.get_text(strip=True) if title_el else link_el.get_text(strip=True)
        href = link_el.get("href", "")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href.startswith("http"):
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_yandex(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://yandex.com/search/"
    params = {"text": query}
    resp = _safe_get(url, params=params, headers=get_browser_headers())
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for item in soup.select("li.serp-item, div.Organic"):
        title_el = item.select_one("h2 a, a.OrganicTitle-Link")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        snippet_el = item.select_one("div.OrganicTextContentSpan, span.OrganicTextContent-Span")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href.startswith("http"):
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_startpage(query: str, max_results: int = 8) -> List[Dict]:
    results = []
    url = "https://www.startpage.com/sp/search"
    data = {"query": query, "language": "zh-CN"}
    resp = _safe_post(url, data=data, headers=get_browser_headers())
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for item in soup.select("div.result, div.w-gl__result"):
        title_el = item.select_one("h2 a, a.result-title")
        if not title_el:
            continue
        title = title_el.get_text(strip=True)
        href = title_el.get("href", "")
        snippet_el = item.select_one("p.result-description, span.w-gl__description")
        snippet = snippet_el.get_text(strip=True) if snippet_el else ""
        if title and href.startswith("http"):
            results.append({"title": title, "url": href, "snippet": snippet})
        if len(results) >= max_results:
            break
    return results

def _search_mojeek(query: str, max_results: int = 8) -> List[Dict]:
    """Mojeek: 独立搜索引擎，无追踪，过滤少"""
    results = []
    url = "https://www.mojeek.com/search"
    params = {"q": query, "fmt": max_results}
    try:
        resp = _safe_get(url, params=params, headers=get_browser_headers("chrome"), timeout=5)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("li.results-standard, ul.results-standard li"):
            title_el = item.select_one("a.title, h2 a")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            href = title_el.get("href", "")
            snippet_el = item.select_one("p.s, div.s")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            if title and href.startswith("http"):
                results.append({"title": title, "url": href, "snippet": snippet})
            if len(results) >= max_results:
                break
    except Exception:
        pass
    return results

def _search_qwant(query: str, max_results: int = 8) -> List[Dict]:
    """Qwant: 法国隐私搜索引擎，API接口，限制少"""
    results = []
    url = "https://api.qwant.com/v3/search/web"
    params = {"q": query, "count": max_results, "locale": "zh_CN", "offset": 0, "safesearch": 0}
    try:
        resp = _safe_get(url, params=params, headers=get_browser_headers("chrome"), timeout=5)
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data", {}).get("result", {}).get("items", {}).get("mainline", [])
        for group in items:
            for item in group.get("items", []):
                title = item.get("title", "")
                href = item.get("url", "")
                snippet = item.get("desc", "")
                if title and href:
                    results.append({"title": title, "url": href, "snippet": snippet})
                if len(results) >= max_results:
                    break
    except Exception:
        pass
    return results

def _search_ecosia(query: str, max_results: int = 8) -> List[Dict]:
    """Ecosia: 使用Bing结果但不同反爬策略"""
    results = []
    url = "https://www.ecosia.org/search"
    params = {"q": query}
    try:
        resp = _safe_get(url, params=params, headers=get_browser_headers("chrome"), timeout=5)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("div.result, div.js-result"):
            title_el = item.select_one("a.result-title, h2 a, a.result__link")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            href = title_el.get("href", "")
            snippet_el = item.select_one("p.result__snippet, div.result__snippet")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            if title and href.startswith("http"):
                results.append({"title": title, "url": href, "snippet": snippet})
            if len(results) >= max_results:
                break
    except Exception:
        pass
    return results

def _search_ddg_html(query: str, max_results: int = 8) -> List[Dict]:
    """DuckDuckGo HTML版: 直接HTML抓取，不依赖JS，限制少"""
    results = []
    url = "https://html.duckduckgo.com/html/"
    try:
        resp = _safe_post(url, data={"q": query, "kl": "wt-wt"}, headers=get_browser_headers("chrome"), timeout=5)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("div.result, div.web-result"):
            title_el = item.select_one("a.result__a, a.result__url, h2 a")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            href = title_el.get("href", "")
            # DDG HTML版本可能有重定向URL
            if href.startswith("//duckduckgo.com/l/?") or href.startswith("/l/?"):
                import urllib.parse as _up
                parsed = _up.urlparse(href if href.startswith("http") else "https:" + href)
                qs = _up.parse_qs(parsed.query)
                if "uddg" in qs:
                    href = qs["uddg"][0]
            snippet_el = item.select_one("a.result__snippet, td.result__snippet, .result__snippet")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            if title and href.startswith("http"):
                results.append({"title": title, "url": href, "snippet": snippet})
            if len(results) >= max_results:
                break
    except Exception:
        pass
    return results

def _search_yahoo(query: str, max_results: int = 8) -> List[Dict]:
    """Yahoo搜索: 不同反爬策略，结果质量较好"""
    results = []
    url = "https://search.yahoo.com/search"
    params = {"p": query, "n": max_results}
    try:
        resp = _safe_get(url, params=params, headers=get_browser_headers("chrome"), timeout=5)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select("div.algo, div.dd"):
            title_el = item.select_one("h3 a")
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            href = title_el.get("href", "")
            snippet_el = item.select_one("div.compText, p")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            if title and href.startswith("http"):
                results.append({"title": title, "url": href, "snippet": snippet})
            if len(results) >= max_results:
                break
    except Exception:
        pass
    return results

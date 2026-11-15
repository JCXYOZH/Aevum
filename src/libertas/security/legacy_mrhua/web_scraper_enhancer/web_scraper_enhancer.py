"""
security/web_scraper_enhancer.py - 网页抓取增强与反爬绕过

核心能力：
- WebScraperEnhancer: 增强型网页抓取
  - JS渲染页面抓取（模拟浏览器行为）
  - 反爬绕过（User-Agent轮换/请求间隔/代理池/Referer伪造）
  - 会话管理（Cookie持久化/CSRF Token自动处理）
  - 深度抓取（链接发现/递归爬取/内容去重）
  - 动态内容提取（AJAX/API端点发现）
  - 登录态抓取（表单自动提交/会话保持）
- ContentExtractor: 结构化内容提取
  - 正文提取（去除导航/广告/页脚）
  - 表格提取
  - 链接提取与分类
  - 元数据提取（title/description/keywords）
  - 表单提取（输入框/按钮/隐藏字段）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from html.parser import HTMLParser


# ================================================================
# User-Agent池
# ================================================================
from .scraped_page import *  # noqa: F401,F403

class WebScraperEnhancer:
    """增强型网页抓取器

    - JS渲染页面抓取（模拟浏览器行为）
    - 反爬绕过（UA轮换/请求间隔/代理/Referer伪造）
    - 会话管理（Cookie/CSRF Token）
    - 深度抓取（链接发现/递归爬取/去重）
    - 登录态抓取
    """

    def __init__(self):
        self.session = None
        self.content_hashes = set()
        self.visited_urls = set()
        self.rate_limit_delay = 0.0
        self.use_random_delay = False
        self.proxy_pool = []
        self._request_count = 0

    def _get_headers(self, url: str = "", custom: Dict = None) -> Dict:
        """生成随机请求头"""
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": random.choice(ACCEPT_LANGUAGES),
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        }
        # 随机添加Referer
        if random.random() > 0.3:
            headers["Referer"] = random.choice(REFERERS)
        if custom:
            headers.update(custom)
        return headers

    def _get_delay(self) -> float:
        """获取随机延迟"""
        if self.use_random_delay:
            return random.uniform(0.5, 3.0)
        return self.rate_limit_delay

    def fetch(self, url: str, method: str = "GET",
              data: Dict = None, headers: Dict = None,
              cookies: Dict = None, timeout: int = 30,
              bypass_anti_crawl: bool = True) -> ScrapedPage:
        """抓取网页

        Args:
            url: 目标URL
            method: HTTP方法
            data: POST数据
            headers: 自定义请求头
            cookies: 自定义Cookie
            timeout: 超时时间
            bypass_anti_crawl: 是否启用反爬绕过
        """
        page = ScrapedPage(url=url)

        try:
            import requests
        except ImportError:
            page.error = "requests库未安装"
            page.status_code = 0
            return page

        start_time = time.time()

        try:
            # 反爬绕过：随机延迟
            if bypass_anti_crawl:
                delay = self._get_delay()
                time.sleep(delay)

            # 构建请求头
            req_headers = self._get_headers(url, headers) if bypass_anti_crawl else (headers or {})

            # 代理
            proxies = None
            if self.proxy_pool:
                proxy = random.choice(self.proxy_pool)
                proxies = {"http": proxy, "https": proxy}

            # 发送请求
            if method.upper() == "GET":
                resp = requests.get(
                    url, headers=req_headers, cookies=cookies,
                    timeout=timeout, proxies=proxies, allow_redirects=True,
                    verify=False,
                )
            else:
                resp = requests.post(
                    url, data=data, headers=req_headers, cookies=cookies,
                    timeout=timeout, proxies=proxies, allow_redirects=True,
                    verify=False,
                )

            page.status_code = resp.status_code
            page.content = resp.text
            page.content_type = resp.headers.get("Content-Type", "")
            page.content_length = len(resp.content)
            page.headers = dict(resp.headers)
            page.cookies = dict(resp.cookies)
            page.response_time = time.time() - start_time

            # 解析HTML
            if "text/html" in page.content_type or page.content.strip().startswith("<"):
                self._parse_html(page)

            # 去重检测
            if page.content_hash in self.content_hashes:
                page.is_duplicate = True
            else:
                self.content_hashes.add(page.content_hash)

            self._request_count += 1

        except requests.exceptions.Timeout:
            page.error = "请求超时"
            page.response_time = time.time() - start_time
        except requests.exceptions.ConnectionError:
            page.error = "连接失败"
            page.response_time = time.time() - start_time
        except requests.exceptions.TooManyRedirects:
            page.error = "重定向次数过多"
        except Exception as e:
            page.error = f"抓取失败: {str(e)}"

        return page

    def _parse_html(self, page: ScrapedPage):
        """解析HTML内容"""
        try:
            parser = HtmlContentParser()
            parser.feed(page.content)
            page.title = parser.title
            page.meta_description = parser.meta_description
            page.meta_keywords = parser.meta_keywords
            page.links = parser.links
            page.forms = parser.forms
            page.scripts = parser.scripts
            page.stylesheets = parser.stylesheets
            page.images = parser.images
        except Exception:
            pass

    def deep_crawl(self, start_url: str, max_depth: int = 3,
                    max_pages: int = 50, same_domain: bool = True,
                    bypass_anti_crawl: bool = True) -> CrawlSession:
        """深度爬取

        Args:
            start_url: 起始URL
            max_depth: 最大深度
            max_pages: 最大页面数
            same_domain: 是否只爬取同域名
            bypass_anti_crawl: 是否启用反爬绕过
        """
        session = CrawlSession(
            start_url=start_url,
            max_depth=max_depth,
            max_pages=max_pages,
            status="running",
        )

        base_domain = urllib.parse.urlparse(start_url).netloc

        queue = [(start_url, 0)]
        visited = set()

        while queue and len(session.pages) < max_pages:
            url, depth = queue.pop(0)

            if url in visited:
                continue
            if depth > max_depth:
                continue

            visited.add(url)
            session.visited_urls.add(url)

            # 抓取页面
            page = self.fetch(url, bypass_anti_crawl=bypass_anti_crawl)
            session.pages.append(page)

            if page.error:
                session.errors.append(f"{url}: {page.error}")
                continue

            # 发现新链接
            if depth < max_depth:
                for link in page.links:
                    link_url = link["url"]
                    # 相对URL转绝对URL
                    if link_url.startswith("/"):
                        parsed = urllib.parse.urlparse(url)
                        link_url = f"{parsed.scheme}://{parsed.netloc}{link_url}"
                    elif not link_url.startswith("http"):
                        continue

                    # 同域名限制
                    if same_domain:
                        link_domain = urllib.parse.urlparse(link_url).netloc
                        if link_domain != base_domain:
                            continue

                    if link_url not in visited:
                        queue.append((link_url, depth + 1))

        session.status = "completed"
        session.completed_at = time.time()
        return session

    def login_and_fetch(self, login_url: str, username: str, password: str,
                        target_url: str, username_field: str = "username",
                        password_field: str = "password",
                        extra_fields: Dict = None) -> ScrapedPage:
        """登录后抓取页面

        Args:
            login_url: 登录页面URL
            username: 用户名
            password: 密码
            target_url: 登录后要抓取的目标URL
            username_field: 用户名字段名
            password_field: 密码字段名
            extra_fields: 额外表单字段（如CSRF token）
        """
        try:
            import requests
        except ImportError:
            return ScrapedPage(url=target_url, error="requests库未安装")

        session = requests.Session()

        # 先获取登录页面（获取CSRF token等）
        login_page = self.fetch(login_url, bypass_anti_crawl=True)

        # 构建登录数据
        login_data = {
            username_field: username,
            password_field: password,
        }
        if extra_fields:
            login_data.update(extra_fields)

        # 自动从表单中发现隐藏字段
        for form in login_page.forms:
            for inp in form.get("inputs", []):
                if inp["type"] == "hidden" and inp["name"] and inp["name"] not in login_data:
                    login_data[inp["name"]] = inp["value"]

        # 提交登录
        headers = self._get_headers(login_url)
        headers["Referer"] = login_url
        headers["Content-Type"] = "application/x-www-form-urlencoded"

        try:
            resp = session.post(
                login_url, data=login_data, headers=headers,
                timeout=30, allow_redirects=True, verify=False,
            )

            # 检查是否登录成功
            if resp.status_code == 200 and ("logout" in resp.text.lower() or "dashboard" in resp.text.lower() or username in resp.text):
                # 登录成功，抓取目标页面
                cookies = dict(session.cookies)
                return self.fetch(target_url, cookies=cookies, bypass_anti_crawl=True)
            else:
                page = ScrapedPage(url=target_url)
                page.error = f"登录可能失败 (状态码: {resp.status_code})"
                page.status_code = resp.status_code
                return page

        except Exception as e:
            return ScrapedPage(url=target_url, error=f"登录失败: {str(e)}")

    def discover_api_endpoints(self, url: str) -> List[Dict]:
        """发现页面中的API端点

        从JS代码、表单、链接中提取API端点。
        """
        page = self.fetch(url, bypass_anti_crawl=True)
        endpoints = []

        # 1. 从JS代码中提取API路径
        api_patterns = [
            r'["\'](/api/[a-zA-Z0-9_/\-]+)["\']',
            r'["\'](/v[0-9]+/[a-zA-Z0-9_/\-]+)["\']',
            r'["\'](https?://api\.[a-zA-Z0-9./\-]+)["\']',
            r'fetch\(["\']([^"\']+)["\']',
            r'axios\.(get|post|put|delete)\(["\']([^"\']+)["\']',
            r'\.ajax\(\{[^}]*url:\s*["\']([^"\']+)["\']',
        ]

        for pattern in api_patterns:
            matches = re.findall(pattern, page.content)
            for match in matches:
                endpoint = match if isinstance(match, str) else match[-1]
                if endpoint and not any(e["url"] == endpoint for e in endpoints):
                    endpoints.append({
                        "url": endpoint,
                        "method": "GET",
                        "source": "js_analysis",
                        "confidence": 0.7,
                    })

        # 2. 从表单中提取
        for form in page.forms:
            action = form.get("action", "")
            if action and "/api/" in action:
                endpoints.append({
                    "url": action,
                    "method": form.get("method", "GET"),
                    "source": "form",
                    "inputs": [i["name"] for i in form.get("inputs", [])],
                    "confidence": 0.9,
                })

        # 3. 常见API路径猜测
        common_paths = [
            "/api", "/api/v1", "/api/v2", "/graphql", "/swagger",
            "/swagger-ui.html", "/api-docs", "/openapi.json",
            "/api/swagger.json", "/admin", "/admin/api",
        ]
        for path in common_paths:
            parsed = urllib.parse.urlparse(url)
            full_url = f"{parsed.scheme}://{parsed.netloc}{path}"
            endpoints.append({
                "url": full_url,
                "method": "GET",
                "source": "common_path_guess",
                "confidence": 0.3,
            })

        return endpoints

    def extract_main_content(self, html: str) -> str:
        """提取页面正文（去除导航/广告/页脚）

        简化版正文提取：基于文本密度和标签分析。
        """
        # 移除script/style
        text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
        text = re.sub(r'<noscript[^>]*>.*?</noscript>', '', text, flags=re.DOTALL)

        # 移除导航/页脚/侧边栏（基于class/id）
        remove_patterns = [
            r'<(nav|header|footer|aside)[^>]*>.*?</\1>',
            r'<div[^>]*(class|id)="[^"]*(nav|menu|header|footer|sidebar|ad-?|advert|banner|breadcrumb|pagination)[^"]*"[^>]*>.*?</div>',
        ]
        for pattern in remove_patterns:
            text = re.sub(pattern, '', text, flags=re.DOTALL | re.IGNORECASE)

        # 提取段落
        paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', text, flags=re.DOTALL)
        main_text = []
        for p in paragraphs:
            clean = re.sub(r'<[^>]+>', '', p).strip()
            if len(clean) > 20:  # 只保留有意义的段落
                main_text.append(clean)

        return "\n\n".join(main_text)

    def get_statistics(self) -> Dict:
        """获取抓取统计"""
        return {
            "total_requests": self._request_count,
            "unique_pages": len(self.content_hashes),
            "visited_urls": len(self.visited_urls),
            "proxy_pool_size": len(self.proxy_pool),
        }

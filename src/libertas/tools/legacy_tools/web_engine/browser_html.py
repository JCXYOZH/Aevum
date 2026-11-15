"""
web_engine.py — 本地 Web 访问引擎（控制平面）

职责：
- 在模型调用之前完成所有网络访问（搜索、抓取）
- 模型只拿到结果，不参与"是否搜索"的决策
- 多层抓取策略：Playwright 真实浏览器 → requests 多引擎轮换 → Wayback Machine → 本地代理
- 永不返回空：即使所有页面抓取失败，也返回标题+摘要
- 进度回调：每个步骤都通知前端
- 结果缓存：避免重复搜索
"""

import os
import re
import json
import time
import hashlib
import logging
import urllib.parse
from typing import List, Dict, Optional, Callable

logger = logging.getLogger(__name__)

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

# Playwright 可选
try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False

from ..web_search import (
    web_search, fetch_page_content, search_and_summarize,
    get_browser_headers, set_browser_engine, set_search_engine,
    BROWSER_PRESETS, SEARCH_ENGINES, SEARCH_BACKENDS
)
from .constants import *
from .budget import *
from .cache import *


def fetch_html_with_playwright(url: str, timeout: int = 25000, cookies: list = None,
                                user_agent: str = None,
                                deadline: Optional[float] = None) -> Optional[Dict]:
    """使用 Playwright 真实浏览器渲染页面，返回完整HTML（供代理iframe显示）。
    cookies: 可选的cookie列表，格式为Playwright cookie dict。
    user_agent: 可选的User-Agent，默认使用Chrome 120。
    deadline: 可选的绝对截止时间戳；传锁等待与内部固定等待都按剩余预算收敛。"""
    if not HAS_PLAYWRIGHT:
        return None
    if deadline is not None and _remaining_budget(deadline) <= 0:
        logger.debug(f"Playwright 预算已耗尽，跳过HTML渲染: {url}")
        return None
    _lock_wait = 30 if deadline is None else max(1.0, _remaining_budget(deadline))
    if not _playwright_global_lock.acquire(timeout=_lock_wait):
        logger.warning("Playwright 忙，跳过HTML渲染")
        return None
    try:
        return _fetch_html_with_playwright_impl(url, timeout, cookies, user_agent, deadline)
    finally:
        _playwright_global_lock.release()

def _fetch_html_with_playwright_impl(url: str, timeout: int = 25000, cookies: list = None,
                                      user_agent: str = None,
                                      deadline: Optional[float] = None) -> Optional[Dict]:
    """Playwright HTML渲染实现（调用方必须持有锁）
    deadline: 可选的绝对截止时间戳；内部固定等待按剩余预算收敛。"""
    browser = _get_browser()
    if browser is None:
        return None
    page = None
    try:
        _ua = user_agent or "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        context = browser.new_context(
            user_agent=_ua,
            viewport={"width": 1920, "height": 1080},
            locale="zh-CN",
            color_scheme="light",
            extra_http_headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        )
        # 注入session cookie（cf_clearance等）
        if cookies:
            try:
                from urllib.parse import urlparse as _urlp
                _pu = _urlp(url)
                _pw_cookies = []
                for _ck in cookies:
                    _pw_cookies.append({
                        "name": _ck.name if hasattr(_ck, 'name') else str(_ck.get('name', '')),
                        "value": _ck.value if hasattr(_ck, 'value') else str(_ck.get('value', '')),
                        "domain": _ck.domain if hasattr(_ck, 'domain') and _ck.domain else _pu.hostname,
                        "path": _ck.path if hasattr(_ck, 'path') and _ck.path else "/",
                    })
                if _pw_cookies:
                    context.add_cookies(_pw_cookies)
            except Exception:
                pass
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
            Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh']});
            window.chrome = { runtime: {} };
        """)
        page = context.new_page()
        resp = page.goto(url, timeout=_within_timeout_ms(timeout, deadline),
                         wait_until="domcontentloaded")
        if resp is None:
            context.close()
            return None
        # 如果是404/403，多等一会看是否有JS重定向
        if resp.status in (404, 403, 503, 567):
            try:
                page.wait_for_load_state("networkidle",
                                         timeout=_within_timeout_ms(8000, deadline))
                _within_sleep(1.5, deadline)
            except Exception:
                pass
        else:
            # 等待JS渲染（短等待，networkidle最多等5秒）
            try:
                page.wait_for_load_state("networkidle",
                                         timeout=_within_timeout_ms(5000, deadline))
            except Exception:
                pass
            _within_sleep(0.8, deadline)
        title = page.title()
        html = page.content()
        final_url = page.url
        status = resp.status
        # 验证码自动识别填入（懒加载，默认关闭）
        try:
            try_solve_captcha_on_page(page)
        except Exception:
            pass
        # 收集Playwright上下文中的cookie（回写给session）
        _returned_cookies = []
        try:
            _returned_cookies = context.cookies()
        except Exception:
            pass
        # 视觉分析：截图 + OCR + 页面类型分类（懒加载，默认关闭）
        vision_analysis = None
        try:
            from mrhua.vision.engine import get_vision_engine
            _ve = get_vision_engine()
            if _ve.enabled and _ve.browser_analysis_enabled:
                _screenshot_bytes = page.screenshot(type="png", full_page=False)
                if _screenshot_bytes:
                    vision_analysis = _ve.analyze_screenshot(_screenshot_bytes, url=final_url)
        except Exception:
            pass
        context.close()
        if not html or len(html) < 200:
            return None
        # 如果最终页面还是404错误页，返回None让其他策略尝试
        if status == 404 and final_url == url:
            _combined = (title + " " + html[:1500]).lower()
            _error_markers = ["404", "not found", "页面不存在", "页面已被删除",
                              "访问的页面", "oops", "页面走丢了", "找不到页面"]
            if any(m in _combined for m in _error_markers) and len(html) < 8000:
                return None
        return {
            "title": title or url,
            "url": final_url,
            "html": html,
            "status": status,
            "engine": "playwright",
            "cookies": _returned_cookies,
            "vision": vision_analysis,
        }
    except Exception as e:
        logger.debug(f"Playwright HTML抓取失败 {url}: {e}")
        if page:
            try:
                page.context.close()
            except Exception:
                pass
        return None

def try_solve_captcha_on_page(page) -> bool:
    """在Playwright页面上检测并尝试自动填入文字验证码。
    返回True如果成功识别并填入。"""
    try:
        from mrhua.vision.engine import get_vision_engine
        ve = get_vision_engine()
        if not ve.enabled or not ve.captcha_enabled:
            return False

        captcha_info = page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            for (const img of imgs) {
                const src = (img.src || '').toLowerCase();
                const alt = (img.alt || '').toLowerCase();
                const id = (img.id || '').toLowerCase();
                const cls = (img.className || '').toLowerCase();
                const w = img.naturalWidth || img.width;
                const h = img.naturalHeight || img.height;
                const isCaptcha = src.includes('captcha') || src.includes('verify') ||
                    src.includes('vcode') || src.includes('checkcode') ||
                    alt.includes('captcha') || alt.includes('验证') ||
                    id.includes('captcha') || id.includes('vcode') ||
                    cls.includes('captcha') || cls.includes('vcode') ||
                    (w > 30 && w < 200 && h > 15 && h < 80 && src.includes('code'));
                if (isCaptcha && w > 0 && h > 0) {
                    const rect = img.getBoundingClientRect();
                    return {x: rect.x, y: rect.y, w: rect.width, h: rect.height, src: img.src};
                }
            }
            return null;
        }""")

        if not captcha_info:
            return False

        screenshot = page.screenshot(
            clip={"x": max(0, captcha_info["x"]), "y": max(0, captcha_info["y"]),
                  "width": captcha_info["w"], "height": captcha_info["h"]},
            type="png"
        )
        if not screenshot:
            return False

        result = ve.solve_captcha(screenshot)
        if not result or not result.get("text"):
            return False

        text = result["text"]
        page.evaluate("""(text) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            for (const inp of inputs) {
                const id = (inp.id || '').toLowerCase();
                const name = (inp.name || '').toLowerCase();
                const ph = (inp.placeholder || '').toLowerCase();
                const cls = (inp.className || '').toLowerCase();
                if (id.includes('captcha') || id.includes('vcode') || id.includes('verify') ||
                    name.includes('captcha') || name.includes('vcode') || name.includes('verify') ||
                    ph.includes('验证码') || ph.includes('captcha') ||
                    cls.includes('captcha') || cls.includes('vcode')) {
                    inp.value = text;
                    inp.dispatchEvent(new Event('input', {bubbles: true}));
                    inp.dispatchEvent(new Event('change', {bubbles: true}));
                    return true;
                }
            }
            for (const inp of inputs) {
                if (inp.type === 'text' && inp.offsetParent !== null &&
                    !inp.value && inp.name && !inp.name.includes('user') && !inp.name.includes('name') &&
                    !inp.name.includes('pass') && !inp.name.includes('mail') && !inp.name.includes('phone')) {
                    inp.value = text;
                    inp.dispatchEvent(new Event('input', {bubbles: true}));
                    inp.dispatchEvent(new Event('change', {bubbles: true}));
                    return true;
                }
            }
            return false;
        }""", text)
        logger.info(f"CAPTCHA自动识别填入: {text} (置信度: {result.get('confidence', 0):.2f})")
        return True
    except Exception as e:
        logger.debug(f"CAPTCHA自动识别失败: {e}")
        return False

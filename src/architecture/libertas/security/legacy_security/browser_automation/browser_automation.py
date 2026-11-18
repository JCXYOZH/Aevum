"""
security/browser_automation.py - 浏览器自动化与实战执行引擎

核心能力：
- BrowserAutomation: 浏览器自动化（Playwright/Selenium/requests三级降级）
  - JS渲染页面抓取
  - 页面截图（AI可"看见"渲染结果）
  - 表单自动填写与提交
  - Cookie/会话管理
  - 等待JS加载完成
  - 元素交互（点击/输入/滚动）
- CaptchaSolver: 验证码识别（OCR/AI模型/人工介入三级）
- ManualBypassHelper: 人工手动操作绕过辅助
- RealBypassExecutor: 绕过技术实际执行引擎（真实发送请求测试）
"""
import os
import re
import sys
import json
import time
import uuid
import random
import base64
import hashlib
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict, Counter
from enum import Enum
from .models import *  # noqa: F401,F403

class BrowserAutomation:
    """浏览器自动化

    三级降级：Playwright → Selenium → requests
    支持JS渲染、截图、表单填写、Cookie管理。
    """

    def __init__(self, headless: bool = True):
        self.headless = headless
        self.engine = self._detect_engine()
        self._playwright = None
        self._browser = None
        self._selenium_driver = None
        self._session = None

    def _detect_engine(self) -> str:
        """检测可用的浏览器引擎"""
        try:
            import playwright
            return BrowserEngine.PLAYWRIGHT.value
        except ImportError:
            pass
        try:
            import selenium
            return BrowserEngine.SELENIUM.value
        except ImportError:
            pass
        return BrowserEngine.REQUESTS.value

    def get_available_engines(self) -> List[str]:
        """获取可用引擎列表"""
        engines = []
        try:
            import playwright
            engines.append("playwright")
        except ImportError:
            pass
        try:
            import selenium
            engines.append("selenium")
        except ImportError:
            pass
        engines.append("requests")
        return engines

    def fetch(self, url: str, wait_for_selector: str = None,
              wait_time: int = 3, screenshot: bool = False,
              screenshot_path: str = None,
              engine: str = None) -> BrowserPage:
        """抓取页面（支持JS渲染）

        Args:
            url: 目标URL
            wait_for_selector: 等待的CSS选择器（等元素出现再抓取）
            wait_time: 额外等待时间（秒）
            screenshot: 是否截图
            screenshot_path: 截图保存路径
            engine: 指定引擎（playwright/selenium/requests）
        """
        use_engine = engine or self.engine

        if use_engine == BrowserEngine.PLAYWRIGHT.value:
            return self._fetch_playwright(url, wait_for_selector, wait_time, screenshot, screenshot_path)
        elif use_engine == BrowserEngine.SELENIUM.value:
            return self._fetch_selenium(url, wait_for_selector, wait_time, screenshot, screenshot_path)
        else:
            return self._fetch_requests(url, wait_time)

    def _fetch_playwright(self, url: str, wait_for_selector: str,
                           wait_time: int, screenshot: bool,
                           screenshot_path: str) -> BrowserPage:
        """使用Playwright抓取"""
        page_result = BrowserPage(url=url, engine_used="playwright")

        try:
            from playwright.sync_api import sync_playwright

            start_time = time.time()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self.headless)
                context = browser.new_context(
                    user_agent=random.choice([
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    ]),
                    viewport={"width": 1920, "height": 1080},
                )
                page = context.new_page()

                # 收集控制台日志和网络请求
                console_logs = []
                network_requests = []
                page.on("console", lambda msg: console_logs.append(f"{msg.type}: {msg.text}"))
                page.on("request", lambda req: network_requests.append({
                    "url": req.url, "method": req.method, "resource_type": req.resource_type
                }))

                response = page.goto(url, wait_until="networkidle", timeout=30000)
                page_result.status_code = response.status if response else 0

                # 等待特定元素
                if wait_for_selector:
                    try:
                        page.wait_for_selector(wait_for_selector, timeout=10000)
                    except Exception:
                        pass

                # 额外等待JS渲染
                if wait_time > 0:
                    page.wait_for_timeout(wait_time * 1000)

                page_result.title = page.title()
                page_result.html = page.content()
                page_result.text = page.inner_text("body") if page.query_selector("body") else ""
                page_result.cookies = context.cookies()
                page_result.console_logs = console_logs[:50]
                page_result.network_requests = network_requests[:100]

                # 截图
                if screenshot:
                    if not screenshot_path:
                        screenshot_path = f"screenshot_{uuid.uuid4().hex[:8]}.png"
                    page.screenshot(path=screenshot_path, full_page=True)
                    page_result.screenshot_path = screenshot_path
                    with open(screenshot_path, 'rb') as f:
                        page_result.screenshot_base64 = base64.b64encode(f.read()).decode()

                # 解析表单和链接
                page_result.forms = self._extract_forms_playwright(page)
                page_result.links = self._extract_links_playwright(page)
                page_result.images = self._extract_images_playwright(page)
                page_result.iframes = [frame.url for frame in page.frames if frame != page.main_frame]

                browser.close()

            page_result.response_time = time.time() - start_time

        except ImportError:
            page_result.error = "Playwright未安装，降级到requests"
            return self._fetch_requests(url, wait_time)
        except Exception as e:
            page_result.error = f"Playwright抓取失败: {str(e)}"

        return page_result

    def _fetch_selenium(self, url: str, wait_for_selector: str,
                        wait_time: int, screenshot: bool,
                        screenshot_path: str) -> BrowserPage:
        """使用Selenium抓取"""
        page_result = BrowserPage(url=url, engine_used="selenium")

        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.common.by import By

            start_time = time.time()
            options = Options()
            if self.headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--window-size=1920,1080")
            options.add_argument(f"user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

            driver = webdriver.Chrome(options=options)
            driver.get(url)

            if wait_for_selector:
                try:
                    WebDriverWait(driver, 10).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, wait_for_selector))
                    )
                except Exception:
                    pass

            if wait_time > 0:
                time.sleep(wait_time)

            page_result.title = driver.title
            page_result.html = driver.page_source
            page_result.text = driver.find_element(By.TAG_NAME, "body").text
            page_result.cookies = [{"name": c["name"], "value": c["value"]} for c in driver.get_cookies()]

            if screenshot:
                if not screenshot_path:
                    screenshot_path = f"screenshot_{uuid.uuid4().hex[:8]}.png"
                driver.save_screenshot(screenshot_path)
                page_result.screenshot_path = screenshot_path
                with open(screenshot_path, 'rb') as f:
                    page_result.screenshot_base64 = base64.b64encode(f.read()).decode()

            # 解析表单
            forms = driver.find_elements(By.TAG_NAME, "form")
            for form in forms:
                inputs = form.find_elements(By.TAG_NAME, "input")
                page_result.forms.append({
                    "action": form.get_attribute("action") or "",
                    "method": form.get_attribute("method") or "GET",
                    "inputs": [{"name": i.get_attribute("name") or "", "type": i.get_attribute("type") or "text"} for i in inputs],
                })

            driver.quit()
            page_result.response_time = time.time() - start_time

        except ImportError:
            page_result.error = "Selenium未安装，降级到requests"
            return self._fetch_requests(url, wait_time)
        except Exception as e:
            page_result.error = f"Selenium抓取失败: {str(e)}"

        return page_result

    def _fetch_requests(self, url: str, wait_time: int = 0) -> BrowserPage:
        """使用requests抓取（无JS渲染）"""
        page_result = BrowserPage(url=url, engine_used="requests")

        try:
            import requests
            start_time = time.time()

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }

            resp = requests.get(url, headers=headers, timeout=30, verify=False, allow_redirects=True)
            page_result.status_code = resp.status_code
            page_result.html = resp.text
            page_result.headers = dict(resp.headers)
            page_result.cookies = [{"name": k, "value": v} for k, v in resp.cookies.items()]

            # 简单解析
            title_match = re.search(r'<title[^>]*>(.*?)</title>', resp.text, re.DOTALL | re.IGNORECASE)
            page_result.title = title_match.group(1).strip() if title_match else ""

            # 提取文本
            text = re.sub(r'<script[^>]*>.*?</script>', '', resp.text, flags=re.DOTALL)
            text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
            text = re.sub(r'<[^>]+>', ' ', text)
            page_result.text = re.sub(r'\s+', ' ', text).strip()

            # 解析表单
            forms = re.findall(r'<form[^>]*action="([^"]*)"[^>]*method="([^"]*)"[^>]*>(.*?)</form>', resp.text, re.DOTALL | re.IGNORECASE)
            for action, method, form_content in forms:
                inputs = re.findall(r'<input[^>]*name="([^"]*)"[^>]*type="([^"]*)"', form_content, re.IGNORECASE)
                page_result.forms.append({
                    "action": action, "method": method.upper(),
                    "inputs": [{"name": n, "type": t} for n, t in inputs],
                })

            page_result.response_time = time.time() - start_time

        except Exception as e:
            page_result.error = f"requests抓取失败: {str(e)}"

        return page_result

    def fill_and_submit_form(self, url: str, form_data: Dict,
                              submit_button: str = None,
                              wait_time: int = 2) -> BrowserPage:
        """填写并提交表单

        Args:
            url: 页面URL
            form_data: 表单数据 {字段名: 值}
            submit_button: 提交按钮选择器
            wait_time: 提交后等待时间
        """
        if self.engine == BrowserEngine.PLAYWRIGHT.value:
            return self._fill_form_playwright(url, form_data, submit_button, wait_time)
        elif self.engine == BrowserEngine.SELENIUM.value:
            return self._fill_form_selenium(url, form_data, wait_time)
        else:
            # requests方式：直接POST
            return self._submit_form_requests(url, form_data)

    def _fill_form_playwright(self, url: str, form_data: Dict,
                               submit_button: str, wait_time: int) -> BrowserPage:
        """Playwright填写表单"""
        page_result = BrowserPage(url=url, engine_used="playwright")
        try:
            from playwright.sync_api import sync_playwright
            start_time = time.time()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=self.headless)
                page = browser.new_page()
                page.goto(url, wait_until="networkidle", timeout=30000)

                # 填写表单
                for name, value in form_data.items():
                    try:
                        page.fill(f'input[name="{name}"]', value)
                    except Exception:
                        try:
                            page.fill(f'#{name}', value)
                        except Exception:
                            pass

                # 提交
                if submit_button:
                    page.click(submit_button)
                else:
                    page.click('button[type="submit"]')

                page.wait_for_timeout(wait_time * 1000)

                page_result.url = page.url
                page_result.title = page.title()
                page_result.html = page.content()
                page_result.text = page.inner_text("body") if page.query_selector("body") else ""
                page_result.status_code = 200
                browser.close()
            page_result.response_time = time.time() - start_time
        except Exception as e:
            page_result.error = f"表单提交失败: {str(e)}"
        return page_result

    def _fill_form_selenium(self, url: str, form_data: Dict, wait_time: int) -> BrowserPage:
        """Selenium填写表单"""
        page_result = BrowserPage(url=url, engine_used="selenium")
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.common.by import By

            options = Options()
            if self.headless:
                options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            driver = webdriver.Chrome(options=options)
            driver.get(url)

            for name, value in form_data.items():
                try:
                    elem = driver.find_element(By.NAME, name)
                    elem.clear()
                    elem.send_keys(value)
                except Exception:
                    pass

            try:
                driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]').click()
            except Exception:
                driver.find_element(By.TAG_NAME, "form").submit()

            time.sleep(wait_time)
            page_result.url = driver.current_url
            page_result.title = driver.title
            page_result.html = driver.page_source
            driver.quit()
        except Exception as e:
            page_result.error = f"Selenium表单提交失败: {str(e)}"
        return page_result

    def _submit_form_requests(self, url: str, form_data: Dict) -> BrowserPage:
        """requests提交表单"""
        page_result = BrowserPage(url=url, engine_used="requests")
        try:
            import requests
            start_time = time.time()
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = requests.post(url, data=form_data, headers=headers, timeout=30, verify=False)
            page_result.status_code = resp.status_code
            page_result.html = resp.text
            page_result.response_time = time.time() - start_time
        except Exception as e:
            page_result.error = f"表单提交失败: {str(e)}"
        return page_result

    def _extract_forms_playwright(self, page) -> List[Dict]:
        """从Playwright页面提取表单"""
        forms = []
        try:
            form_elements = page.query_selector_all("form")
            for form in form_elements:
                inputs = form.query_selector_all("input")
                forms.append({
                    "action": form.get_attribute("action") or "",
                    "method": (form.get_attribute("method") or "GET").upper(),
                    "inputs": [{
                        "name": i.get_attribute("name") or "",
                        "type": i.get_attribute("type") or "text",
                        "value": i.get_attribute("value") or "",
                        "placeholder": i.get_attribute("placeholder") or "",
                    } for i in inputs],
                })
        except Exception:
            pass
        return forms

    def _extract_links_playwright(self, page) -> List[Dict]:
        links = []
        try:
            for a in page.query_selector_all("a[href]"):
                href = a.get_attribute("href")
                if href and not href.startswith(("#", "javascript:", "mailto:")):
                    links.append({"url": href, "text": a.inner_text()[:100]})
        except Exception:
            pass
        return links[:100]

    def _extract_images_playwright(self, page) -> List[Dict]:
        images = []
        try:
            for img in page.query_selector_all("img[src]"):
                images.append({
                    "src": img.get_attribute("src") or "",
                    "alt": img.get_attribute("alt") or "",
                })
        except Exception:
            pass
        return images[:50]

    def close(self):
        """关闭浏览器"""
        if self._browser:
            try:
                self._browser.close()
            except Exception:
                pass
        if self._selenium_driver:
            try:
                self._selenium_driver.quit()
            except Exception:
                pass

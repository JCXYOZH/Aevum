"""视觉引擎 - 统一入口，懒加载 OCR、验证码和感知哈希。"""

import os
import time
import threading

from . import perceptual_hash as phash_mod
from .paths import data_root


class VisionEngine:
    """视觉引擎，所有模型懒加载，不影响启动速度。"""

    def __init__(self):
        self._ocr = None
        self._lock = threading.Lock()
        self._config = None
        self._image_cache = {}
        self._cache_lock = threading.Lock()
        self._max_cache = 500

    def _get_config(self):
        if self._config is not None:
            return self._config
        self._config = {
            "enabled": False,
            "ocr_enabled": True,
            "browser_analysis": False,
            "captcha_solver": False,
        }
        try:
            import json, os
            cfg_path = os.path.join(str(data_root()), "vision_config.json")
            if os.path.isfile(cfg_path):
                with open(cfg_path, "r", encoding="utf-8") as f:
                    saved = json.load(f)
                    self._config.update(saved)
        except Exception:
            pass
        return self._config

    def save_config(self):
        try:
            import json, os
            cfg_dir = str(data_root())
            os.makedirs(cfg_dir, exist_ok=True)
            cfg_path = os.path.join(cfg_dir, "vision_config.json")
            with open(cfg_path, "w", encoding="utf-8") as f:
                json.dump(self._get_config(), f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def update_config(self, updates):
        cfg = self._get_config()
        cfg.update(updates)
        self._config = cfg
        self.save_config()

    @property
    def enabled(self):
        return self._get_config().get("enabled", False)

    @property
    def ocr_enabled(self):
        cfg = self._get_config()
        return cfg.get("ocr_enabled", True) and self.enabled

    @property
    def browser_analysis_enabled(self):
        cfg = self._get_config()
        return cfg.get("browser_analysis", False) and self.enabled

    @property
    def captcha_enabled(self):
        cfg = self._get_config()
        return cfg.get("captcha_solver", False) and self.enabled

    def _get_ocr(self):
        if self._ocr is not None:
            return self._ocr
        with self._lock:
            if self._ocr is None:
                from .ocr import get_ocr_engine
                self._ocr = get_ocr_engine()
        return self._ocr

    def ocr(self, image, min_confidence=0.5):
        """文字识别。"""
        if not self.ocr_enabled:
            return []
        engine = self._get_ocr()
        if not engine.available:
            return []
        return engine.recognize(image, min_confidence)

    def ocr_text(self, image, min_confidence=0.5):
        """文字识别，返回纯文本。"""
        results = self.ocr(image, min_confidence)
        return "\n".join(r["text"] for r in results)

    def solve_captcha(self, image, expected_length=None):
        """验证码识别。"""
        if not self.captcha_enabled:
            return None
        engine = self._get_ocr()
        if not engine.available:
            return None
        from .captcha import solve_captcha as _solve
        return _solve(image, ocr_engine=engine, expected_length=expected_length)

    def phash(self, image):
        """感知哈希。"""
        return phash_mod.phash(image)

    def dhash(self, image):
        return phash_mod.dhash(image)

    def compare_images(self, image1, image2, method="phash"):
        """对比两张图片。"""
        return phash_mod.compare(image1, image2, method)

    def is_page_changed(self, hash1, hash2, threshold=8):
        """判断页面是否变化。"""
        if not hash1 or not hash2:
            return True
        dist = phash_mod.hamming_distance(hash1, hash2)
        return dist > threshold

    def analyze_screenshot(self, image, url=""):
        """综合分析截图：OCR + 感知哈希 + 页面类型推断。

        返回结构化结果，可直接喂给云端模型。
        """
        result = {
            "url": url,
            "timestamp": time.time(),
            "phash": None,
            "text_blocks": [],
            "text": "",
            "page_type": None,
            "has_captcha": False,
            "captcha_hint": None,
        }

        if not self.enabled:
            return result

        try:
            result["phash"] = phash_mod.phash(image)
        except Exception:
            pass

        if self.ocr_enabled:
            try:
                blocks = self.ocr(image, min_confidence=0.4)
                result["text_blocks"] = blocks
                result["text"] = "\n".join(b["text"] for b in blocks)
                lower = result["text"].lower()
                captcha_keywords = ["captcha", "verify", "verification", "验证码", "人机验证", "安全验证"]
                if any(kw in lower for kw in captcha_keywords):
                    result["has_captcha"] = True
                    result["captcha_hint"] = "页面包含验证码/人机验证"
            except Exception:
                pass

        if not result["page_type"] and result["text"]:
            result["page_type"] = self._guess_page_type_from_text(result["text"])

        return result

    def _guess_page_type_from_text(self, text):
        """从 OCR 文字推断页面类型。"""
        lower = text.lower()
        if any(kw in lower for kw in ["checking your browser", "just a moment", "正在验证", "安全检查", "cf-chl", "ray id"]):
            return "WAF挑战页或浏览器验证页"
        if any(kw in lower for kw in ["captcha", "验证码", "人机验证"]):
            return "验证码页面"
        if any(kw in lower for kw in ["403", "forbidden", "禁止访问", "access denied", "网站防火墙"]):
            return "403禁止访问"
        if any(kw in lower for kw in ["404", "not found", "页面不存在"]):
            return "404页面不存在"
        if any(kw in lower for kw in ["login", "登录", "用户名", "密码", "sign in"]):
            return "登录页面"
        if any(kw in lower for kw in ["admin", "管理", "dashboard", "控制台", "后台"]):
            return "后台管理面板"
        if any(kw in lower for kw in ["index of", "目录列表", "parent directory"]):
            return "目录列表"
        if any(kw in lower for kw in ["hacked by", "被黑", "defaced"]):
            return "网站被篡改或黑页"
        return None

    def analyze_image_url(self, url, timeout=10):
        """下载并分析图片URL，返回OCR文字和哈希。"""
        if not self.enabled:
            return None
        cache_key = url
        with self._cache_lock:
            if cache_key in self._image_cache:
                return self._image_cache[cache_key]

        try:
            import urllib.request
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Libertas Vision"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
        except Exception:
            return None

        if not data or len(data) < 100:
            return None

        result = {
            "url": url,
            "size": len(data),
            "phash": None,
            "text": "",
            "text_blocks": [],
            "content_hash": phash_mod.content_hash(data),
        }
        try:
            result["phash"] = phash_mod.phash(data)
        except Exception:
            pass

        if self.ocr_enabled:
            try:
                blocks = self.ocr(data, min_confidence=0.4)
                result["text_blocks"] = blocks
                result["text"] = "\n".join(b["text"] for b in blocks)
            except Exception:
                pass

        with self._cache_lock:
            if len(self._image_cache) >= self._max_cache:
                oldest = next(iter(self._image_cache))
                del self._image_cache[oldest]
            self._image_cache[cache_key] = result

        return result

    def get_status(self):
        """获取视觉引擎状态。"""
        cfg = self._get_config()
        ocr_engine = self._get_ocr() if self.ocr_enabled else None
        return {
            "enabled": self.enabled,
            "ocr_enabled": self.ocr_enabled,
            "ocr_available": ocr_engine.available if ocr_engine else False,
            "browser_analysis": self.browser_analysis_enabled,
            "captcha_solver": self.captcha_enabled,
            "cached_images": len(self._image_cache),
            "config": cfg,
        }


_engine = None
_engine_lock = threading.Lock()


def get_vision_engine():
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = VisionEngine()
    return _engine

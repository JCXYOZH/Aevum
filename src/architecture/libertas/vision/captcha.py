"""验证码识别模块 - 图像预处理 + OCR，针对简单文字验证码优化。"""

import io
import re
from typing import Optional, Union, List, Dict, Any

try:
    from PIL import Image, ImageFilter, ImageOps
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def preprocess_captcha(image, mode="auto"):
    """验证码图像预处理，提高OCR识别率。

    Args:
        image: PIL Image / bytes / 文件路径
        mode: 预处理模式 auto/light/aggressive

    Returns:
        处理后的PIL Image
    """
    if not HAS_PIL:
        return None
    img = _load(image)
    if img is None:
        return None

    img = img.convert("L")

    if mode in ("auto", "light"):
        img = _otsu_binarize(img)
        img = img.filter(ImageFilter.MedianFilter(size=3))

    if mode == "aggressive":
        img = _otsu_binarize(img)
        img = img.filter(ImageFilter.MedianFilter(size=3))
        img = _remove_noise(img)
        img = _dilate(img)

    w, h = img.size
    if w < 100 or h < 30:
        scale = max(150 / w, 50 / h, 2)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    return img


def _load(image):
    if isinstance(image, Image.Image):
        return image
    if isinstance(image, bytes):
        return Image.open(io.BytesIO(image))
    if isinstance(image, str):
        return Image.open(image)
    return None


def _otsu_binarize(img):
    """Otsu自适应二值化。"""
    import numpy as np
    arr = np.array(img)
    hist, _ = np.histogram(arr.flatten(), bins=256, range=(0, 256))
    total = arr.size
    sum_total = np.sum(np.arange(256) * hist)
    sum_bg, w_bg, max_var, threshold = 0.0, 0, 0.0, 127
    for t in range(256):
        w_bg += hist[t]
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break
        sum_bg += t * hist[t]
        mean_bg = sum_bg / w_bg
        mean_fg = (sum_total - sum_bg) / w_fg
        var_between = w_bg * w_fg * (mean_bg - mean_fg) ** 2
        if var_between > max_var:
            max_var = var_between
            threshold = t
    result = (arr > threshold).astype(np.uint8) * 255
    return Image.fromarray(result, mode="L")


def _remove_noise(img, threshold=3):
    """去除小噪点：连通域面积小于threshold的像素块移除。"""
    import numpy as np
    arr = np.array(img)
    h, w = arr.shape
    visited = np.zeros_like(arr, dtype=bool)
    for y in range(h):
        for x in range(w):
            if arr[y, x] < 128 and not visited[y, x]:
                stack = [(x, y)]
                pixels = []
                while stack:
                    cx, cy = stack.pop()
                    if cx < 0 or cx >= w or cy < 0 or cy >= h:
                        continue
                    if visited[cy, cx] or arr[cy, cx] >= 128:
                        continue
                    visited[cy, cx] = True
                    pixels.append((cx, cy))
                    stack.extend([(cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)])
                if len(pixels) < threshold:
                    for px, py in pixels:
                        arr[py, px] = 255
    return Image.fromarray(arr, mode="L")


def _dilate(img):
    """简单膨胀，让字符笔画更粗。"""
    return img.filter(ImageFilter.MaxFilter(size=3))


def solve_captcha(image, ocr_engine=None, mode="auto", expected_length=None) -> Optional[Dict[str, Any]]:
    """识别验证码。

    Args:
        image: 图片
        ocr_engine: OCREngine实例（None则自动获取）
        mode: 预处理模式
        expected_length: 期望的字符长度，用于过滤结果

    Returns:
        {"text": str, "confidence": float, "raw_results": [...]} 或 None
    """
    if not HAS_PIL:
        return None

    if ocr_engine is None:
        from .ocr import get_ocr_engine
        ocr_engine = get_ocr_engine()

    all_candidates = []

    # 先尝试原图（干净验证码直接识别率更高）
    raw_results = ocr_engine.recognize(image, min_confidence=0.3)
    for r in raw_results:
        text = _clean_captcha_text(r["text"])
        if text:
            all_candidates.append({"text": text, "confidence": r["confidence"], "results": raw_results})

    # 再尝试预处理后的图（有噪点/干扰线的验证码）
    processed = preprocess_captcha(image, mode)
    if processed is not None:
        proc_results = ocr_engine.recognize(processed, min_confidence=0.3)
        for r in proc_results:
            text = _clean_captcha_text(r["text"])
            if text:
                all_candidates.append({"text": text, "confidence": r["confidence"], "results": proc_results})

    if not all_candidates:
        return None

    if expected_length:
        exact = [c for c in all_candidates if len(c["text"]) == expected_length]
        if exact:
            all_candidates = exact

    best = max(all_candidates, key=lambda c: c["confidence"])
    return {
        "text": best["text"],
        "confidence": best["confidence"],
        "raw_results": best["results"],
    }


def _clean_captcha_text(text):
    """清理OCR结果：去除空格和常见误识别字符。"""
    text = text.strip().replace(" ", "").replace("\n", "")
    text = re.sub(r"[^a-zA-Z0-9]", "", text)
    return text

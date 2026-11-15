"""OCR模块 - 基于RapidOCR(ONNX)的文字识别，懒加载。"""

import io
import threading
from typing import List, Dict, Any, Union, Optional

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


class OCREngine:
    """RapidOCR封装，懒加载，线程安全。"""

    def __init__(self):
        self._ocr = None
        self._lock = threading.Lock()
        self._available = None

    def _ensure_loaded(self):
        if self._ocr is not None:
            return True
        with self._lock:
            if self._ocr is not None:
                return True
            try:
                from rapidocr_onnxruntime import RapidOCR
                self._ocr = RapidOCR()
                self._available = True
            except ImportError:
                self._available = False
            except Exception:
                self._available = False
        return self._available

    @property
    def available(self):
        if self._available is None:
            self._ensure_loaded()
        return self._available

    def recognize(self, image: Union[str, bytes, "Image.Image"], min_confidence: float = 0.5) -> List[Dict[str, Any]]:
        """识别图片中的文字。

        Args:
            image: 文件路径、bytes或PIL Image
            min_confidence: 最低置信度

        Returns:
            [{"text": str, "confidence": float, "box": [[x,y],...]}, ...]
        """
        if not HAS_PIL:
            return []
        if not self._ensure_loaded():
            return []

        img_array = self._to_numpy(image)
        if img_array is None:
            return []

        try:
            result, _ = self._ocr(img_array)
        except Exception:
            return []

        if not result:
            return []

        texts = []
        for item in result:
            box, text, conf = item[0], item[1], item[2]
            try:
                conf_val = float(conf)
            except (TypeError, ValueError):
                conf_val = 0.0
            if conf_val >= min_confidence and text and str(text).strip():
                texts.append({
                    "text": str(text).strip(),
                    "confidence": round(conf_val, 4),
                    "box": [[float(p[0]), float(p[1])] for p in box],
                })
        return texts

    def recognize_text(self, image, min_confidence=0.5, separator="\n") -> str:
        """识别文字，返回纯文本。"""
        results = self.recognize(image, min_confidence)
        return separator.join(r["text"] for r in results)

    def _to_numpy(self, image):
        try:
            import numpy as np
        except ImportError:
            return None
        if isinstance(image, str):
            try:
                img = Image.open(image).convert("RGB")
                return np.array(img)
            except Exception:
                return None
        if isinstance(image, bytes):
            try:
                img = Image.open(io.BytesIO(image)).convert("RGB")
                return np.array(img)
            except Exception:
                return None
        if HAS_PIL and isinstance(image, Image.Image):
            return np.array(image.convert("RGB"))
        if isinstance(image, np.ndarray):
            return image
        return None


_ocr_engine = None
_ocr_lock = threading.Lock()


def get_ocr_engine() -> OCREngine:
    global _ocr_engine
    if _ocr_engine is None:
        with _ocr_lock:
            if _ocr_engine is None:
                _ocr_engine = OCREngine()
    return _ocr_engine

"""视觉模块：验证码预处理、OCR、感知哈希和统一视觉入口。"""

from .captcha import preprocess_captcha, solve_captcha
from .engine import VisionEngine, get_vision_engine
from .ocr import OCREngine, get_ocr_engine
from .perceptual_hash import (
    ahash,
    compare,
    content_hash,
    dhash,
    hamming_distance,
    is_similar,
    phash,
)

__all__ = [
    "VisionEngine",
    "get_vision_engine",
    "OCREngine",
    "get_ocr_engine",
    "preprocess_captcha",
    "solve_captcha",
    "ahash",
    "dhash",
    "phash",
    "compare",
    "hamming_distance",
    "is_similar",
    "content_hash",
]

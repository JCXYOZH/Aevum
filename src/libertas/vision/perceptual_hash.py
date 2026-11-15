"""感知哈希模块 - 纯Python实现，用于图片相似度对比和页面变化检测。"""

import io
import hashlib
from typing import Tuple, Optional, Union

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def _load_image(source):
    if not HAS_PIL:
        return None
    if isinstance(source, Image.Image):
        return source
    if isinstance(source, bytes):
        return Image.open(io.BytesIO(source))
    if isinstance(source, str):
        return Image.open(source)
    return None


def ahash(image, size=8):
    """均值哈希：缩放size*size，转灰度，均值二值化。"""
    img = _load_image(image)
    if img is None:
        return None
    img = img.convert("L").resize((size, size), Image.LANCZOS)
    pixels = list(img.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if p >= avg else "0" for p in pixels)
    return f"{int(bits, 2):0{size * size // 4}x}"


def dhash(image, size=8):
    """差异哈希：相邻像素比较，对亮度变化不敏感。"""
    img = _load_image(image)
    if img is None:
        return None
    img = img.convert("L").resize((size + 1, size), Image.LANCZOS)
    pixels = list(img.getdata())
    bits = []
    for row in range(size):
        for col in range(size):
            left = pixels[row * (size + 1) + col]
            right = pixels[row * (size + 1) + col + 1]
            bits.append("1" if left > right else "0")
    return f"{int(''.join(bits), 2):0{size * size // 4}x}"


def phash(image, size=8, highfreq_factor=4):
    """感知哈希：DCT变换取低频，抗压缩/缩放，最适合内容变化检测。"""
    img = _load_image(image)
    if img is None:
        return None
    import math
    import_size = size * highfreq_factor
    img = img.convert("L").resize((import_size, import_size), Image.LANCZOS)
    pixels = list(img.getdata())
    dct_low = _dct2d(pixels, import_size, size, math)
    median = sorted(dct_low)[len(dct_low) // 2]
    bits = "".join("1" if p > median else "0" for p in dct_low)
    return f"{int(bits, 2):0{size * size // 4}x}"


def _dct2d(pixels, n, keep, math):
    result = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            s = 0.0
            ci = math.cos
            pi2n = math.pi / (2 * n)
            for x in range(n):
                row_base = x * n
                cx = ci((2 * x + 1) * i * pi2n)
                for y in range(n):
                    s += pixels[row_base + y] * cx * ci((2 * y + 1) * j * pi2n)
            result[i][j] = s
    flat = []
    for i in range(keep):
        for j in range(keep):
            flat.append(result[i][j])
    return flat[1:]


def hamming_distance(hash1, hash2):
    if not hash1 or not hash2 or len(hash1) != len(hash2):
        return -1
    return bin(int(hash1, 16) ^ int(hash2, 16)).count("1")


def compare(image1, image2, method="phash"):
    """对比两张图片，返回(汉明距离, 相似度0-1)。"""
    funcs = {"ahash": ahash, "dhash": dhash, "phash": phash}
    fn = funcs.get(method, phash)
    h1 = fn(image1)
    h2 = fn(image2)
    if h1 is None or h2 is None:
        return (-1, 0.0)
    dist = hamming_distance(h1, h2)
    bits = len(h1) * 4
    similarity = 1.0 - dist / bits if bits > 0 else 0.0
    return (dist, round(similarity, 4))


def is_similar(hash1, hash2, threshold=5):
    dist = hamming_distance(hash1, hash2)
    return 0 <= dist <= threshold


def content_hash(data):
    return hashlib.md5(data).hexdigest()

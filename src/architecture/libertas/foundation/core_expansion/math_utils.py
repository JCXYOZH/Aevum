"""职责模块：math_utils。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
from collections import deque, Counter, defaultdict, OrderedDict
import math

class MathUtils:
    """数学计算工具"""

    @staticmethod
    def mean(values: List[float]) -> float:
        if not values:
            return 0.0
        return sum(values) / len(values)

    @staticmethod
    def median(values: List[float]) -> float:
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        if n % 2 == 0:
            return (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
        return sorted_vals[n // 2]

    @staticmethod
    def mode(values: List[Any]) -> Any:
        if not values:
            return None
        return Counter(values).most_common(1)[0][0]

    @staticmethod
    def variance(values: List[float]) -> float:
        if len(values) < 2:
            return 0.0
        mean = MathUtils.mean(values)
        return sum((x - mean) ** 2 for x in values) / (len(values) - 1)

    @staticmethod
    def std_dev(values: List[float]) -> float:
        return math.sqrt(MathUtils.variance(values))

    @staticmethod
    def percentile(values: List[float], p: float) -> float:
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        k = (len(sorted_vals) - 1) * (p / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return sorted_vals[int(k)]
        return sorted_vals[int(f)] * (c - k) + sorted_vals[int(c)] * (k - f)

    @staticmethod
    def min_max_normalize(values: List[float]) -> List[float]:
        if not values:
            return []
        min_val = min(values)
        max_val = max(values)
        if max_val == min_val:
            return [0.5] * len(values)
        return [(x - min_val) / (max_val - min_val) for x in values]

    @staticmethod
    def z_score_normalize(values: List[float]) -> List[float]:
        if not values:
            return []
        mean = MathUtils.mean(values)
        std = MathUtils.std_dev(values)
        if std == 0:
            return [0.0] * len(values)
        return [(x - mean) / std for x in values]

    @staticmethod
    def cosine_similarity(v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2) or not v1:
            return 0.0
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = math.sqrt(sum(a * a for a in v1))
        norm2 = math.sqrt(sum(b * b for b in v2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    @staticmethod
    def euclidean_distance(v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2):
            return float('inf')
        return math.sqrt(sum((a - b) ** 2 for a, b in zip(v1, v2)))

    @staticmethod
    def manhattan_distance(v1: List[float], v2: List[float]) -> float:
        if len(v1) != len(v2):
            return float('inf')
        return sum(abs(a - b) for a, b in zip(v1, v2))

    @staticmethod
    def jaccard_similarity(s1: set, s2: set) -> float:
        if not s1 and not s2:
            return 1.0
        intersection = len(s1 & s2)
        union = len(s1 | s2)
        return intersection / union if union > 0 else 0.0

    @staticmethod
    def clamp(value: float, min_val: float, max_val: float) -> float:
        return max(min_val, min(max_val, value))

    @staticmethod
    def lerp(a: float, b: float, t: float) -> float:
        return a + (b - a) * t

    @staticmethod
    def map_range(value: float, in_min: float, in_max: float,
                  out_min: float, out_max: float) -> float:
        if in_max == in_min:
            return out_min
        return (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min

    @staticmethod
    def factorial(n: int) -> int:
        if n < 0:
            raise ValueError("阶乘不支持负数")
        if n <= 1:
            return 1
        result = 1
        for i in range(2, n + 1):
            result *= i
        return result

    @staticmethod
    def gcd(a: int, b: int) -> int:
        while b:
            a, b = b, a % b
        return abs(a)

    @staticmethod
    def lcm(a: int, b: int) -> int:
        return abs(a * b) // MathUtils.gcd(a, b) if a and b else 0

    @staticmethod
    def is_prime(n: int) -> bool:
        if n < 2:
            return False
        if n == 2:
            return True
        if n % 2 == 0:
            return False
        for i in range(3, int(math.sqrt(n)) + 1, 2):
            if n % i == 0:
                return False
        return True

    @staticmethod
    def fibonacci(n: int) -> List[int]:
        if n <= 0:
            return []
        if n == 1:
            return [0]
        seq = [0, 1]
        for i in range(2, n):
            seq.append(seq[-1] + seq[-2])
        return seq

"""模型渲染工具职责：comparator。"""

from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .models import RenderComparisonResult

class RenderComparator:
    """渲染截图对比器

    对比参考图和当前渲染图，检测渲染异常。
    纯Python实现，支持BMP格式，不依赖外部库。
    如果有PIL/Pillow可用则支持更多格式。
    """

    def __init__(self, threshold: float = 0.9):
        self.threshold = threshold
        self.has_pil = self._check_pil()

    def _check_pil(self) -> bool:
        try:
            from PIL import Image
            return True
        except ImportError:
            return False

    def compare(self, reference_path: str, test_path: str,
                 threshold: float = None) -> RenderComparisonResult:
        """对比两张渲染截图

        Args:
            reference_path: 参考图路径（正确渲染结果）
            test_path: 测试图路径（当前渲染结果）
            threshold: 通过阈值（0-1），默认0.9
        """
        start_time = time.time()
        result = RenderComparisonResult(
            reference_image=reference_path,
            test_image=test_path,
            threshold=threshold or self.threshold,
        )

        try:
            ref_pixels, ref_size = self._load_image(reference_path)
            test_pixels, test_size = self._load_image(test_path)
        except Exception as e:
            result.issues.append({"type": "load_error", "message": str(e)})
            result.duration = time.time() - start_time
            return result

        if ref_size != test_size:
            result.issues.append({
                "type": "size_mismatch",
                "message": f"尺寸不一致: 参考{ref_size}, 测试{test_size}",
            })
            # 缩放到相同尺寸（简单裁剪）
            min_w = min(ref_size[0], test_size[0])
            min_h = min(ref_size[1], test_size[1])
            ref_pixels = self._crop(ref_pixels, ref_size, min_w, min_h)
            test_pixels = self._crop(test_pixels, test_size, min_w, min_h)

        # 1. 像素差异
        result.pixel_difference = self._pixel_difference(ref_pixels, test_pixels)

        # 2. SSIM结构相似性
        result.ssim_score = self._ssim(ref_pixels, test_pixels, ref_size)

        # 3. 直方图相似度
        result.histogram_similarity = self._histogram_similarity(ref_pixels, test_pixels)

        # 4. 边缘相似度
        result.edge_similarity = self._edge_similarity(ref_pixels, test_pixels, ref_size)

        # 5. 异常区域检测
        result.anomaly_regions = self._detect_anomaly_regions(
            ref_pixels, test_pixels, ref_size
        )

        # 6. 综合评分
        result.overall_score = (
            (1 - result.pixel_difference) * 0.3 +
            result.ssim_score * 0.3 +
            result.histogram_similarity * 0.2 +
            result.edge_similarity * 0.2
        )

        result.passed = result.overall_score >= result.threshold

        # 7. 检测渲染问题
        result.issues.extend(self._detect_render_issues(result))

        result.duration = time.time() - start_time
        return result

    def _load_image(self, path: str) -> Tuple[List[Tuple[int, int, int]], Tuple[int, int]]:
        """加载图像，返回像素列表和尺寸"""
        if self.has_pil:
            from PIL import Image
            img = Image.open(path).convert('RGB')
            pixels = list(img.getdata())
            return pixels, img.size
        else:
            # 纯BMP解析
            return self._load_bmp(path)

    def _load_bmp(self, path: str) -> Tuple[List[Tuple[int, int, int]], Tuple[int, int]]:
        """解析BMP文件（24位）"""
        with open(path, 'rb') as f:
            data = f.read()

        if data[:2] != b'BM':
            raise ValueError("不支持的图像格式（仅支持BMP，建议安装Pillow）")

        pixel_offset = struct.unpack_from('<I', data, 10)[0]
        width = struct.unpack_from('<i', data, 18)[0]
        height = struct.unpack_from('<i', data, 22)[0]
        bpp = struct.unpack_from('<H', data, 28)[0]

        if bpp != 24:
            raise ValueError(f"仅支持24位BMP，当前{bpp}位")

        pixels = []
        row_size = (width * 3 + 3) & ~3  # 行对齐到4字节

        for y in range(height - 1, -1, -1):  # BMP是倒序的
            row_offset = pixel_offset + y * row_size
            for x in range(width):
                offset = row_offset + x * 3
                b = data[offset]
                g = data[offset + 1]
                r = data[offset + 2]
                pixels.append((r, g, b))

        return pixels, (width, abs(height))

    def _crop(self, pixels: List, size: Tuple[int, int], w: int, h: int) -> List:
        """裁剪图像"""
        result = []
        for y in range(h):
            for x in range(w):
                result.append(pixels[y * size[0] + x])
        return result

    def _pixel_difference(self, ref: List, test: List) -> float:
        """计算平均像素差异（0-1）"""
        if not ref or not test:
            return 1.0
        total_diff = 0
        count = min(len(ref), len(test))
        for i in range(count):
            r1, g1, b1 = ref[i]
            r2, g2, b2 = test[i]
            diff = (abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)) / (255 * 3)
            total_diff += diff
        return total_diff / count

    def _ssim(self, ref: List, test: List, size: Tuple[int, int]) -> float:
        """简化版SSIM结构相似性（0-1）"""
        if not ref or not test:
            return 0.0

        # 计算均值
        count = min(len(ref), len(test))
        ref_mean = sum(sum(p) for p in ref[:count]) / (count * 3)
        test_mean = sum(sum(p) for p in test[:count]) / (count * 3)

        # 计算方差和协方差
        ref_var = sum((sum(p) / 3 - ref_mean) ** 2 for p in ref[:count]) / count
        test_var = sum((sum(p) / 3 - test_mean) ** 2 for p in test[:count]) / count
        covariance = sum(
            (sum(ref[i]) / 3 - ref_mean) * (sum(test[i]) / 3 - test_mean)
            for i in range(count)
        ) / count

        # SSIM公式
        c1 = (0.01 * 255) ** 2
        c2 = (0.03 * 255) ** 2
        numerator = (2 * ref_mean * test_mean + c1) * (2 * covariance + c2)
        denominator = (ref_mean ** 2 + test_mean ** 2 + c1) * (ref_var + test_var + c2)

        if denominator == 0:
            return 0.0
        return max(0, min(1, numerator / denominator))

    def _histogram_similarity(self, ref: List, test: List) -> float:
        """直方图相似度（0-1）"""
        if not ref or not test:
            return 0.0

        # 计算256级灰度直方图
        ref_hist = [0] * 256
        test_hist = [0] * 256
        count = min(len(ref), len(test))

        for i in range(count):
            ref_gray = sum(ref[i]) // 3
            test_gray = sum(test[i]) // 3
            ref_hist[ref_gray] += 1
            test_hist[test_gray] += 1

        # 直方图交集
        intersection = sum(min(ref_hist[i], test_hist[i]) for i in range(256))
        return intersection / count if count > 0 else 0.0

    def _edge_similarity(self, ref: List, test: List, size: Tuple[int, int]) -> float:
        """边缘检测相似度（简化Sobel）"""
        if not ref or not test or size[0] < 3 or size[1] < 3:
            return 0.5

        w, h = size
        ref_edges = self._detect_edges(ref, w, h)
        test_edges = self._detect_edges(test, w, h)

        # 边缘像素重合度
        match = 0
        total = 0
        for i in range(len(ref_edges)):
            if ref_edges[i] > 128 or test_edges[i] > 128:
                total += 1
                if abs(ref_edges[i] - test_edges[i]) < 64:
                    match += 1

        return match / total if total > 0 else 0.5

    def _detect_edges(self, pixels: List, w: int, h: int) -> List[int]:
        """简化Sobel边缘检测"""
        edges = [0] * len(pixels)
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                idx = y * w + x
                # 灰度值
                gx = abs(sum(pixels[idx - w - 1]) - sum(pixels[idx - w + 1]) +
                         2 * abs(sum(pixels[idx - 1]) - sum(pixels[idx + 1])) +
                         abs(sum(pixels[idx + w - 1]) - sum(pixels[idx + w + 1]))) / 12
                edges[idx] = min(255, gx)
        return edges

    def _detect_anomaly_regions(self, ref: List, test: List,
                                  size: Tuple[int, int]) -> List[Dict]:
        """检测异常区域（分块对比）"""
        if not ref or not test:
            return []

        w, h = size
        block_size = max(16, min(w, h) // 8)
        regions = []

        for by in range(0, h, block_size):
            for bx in range(0, w, block_size):
                block_diff = 0
                block_count = 0
                for y in range(by, min(by + block_size, h)):
                    for x in range(bx, min(bx + block_size, w)):
                        idx = y * w + x
                        if idx < len(ref) and idx < len(test):
                            r1, g1, b1 = ref[idx]
                            r2, g2, b2 = test[idx]
                            diff = (abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)) / (255 * 3)
                            block_diff += diff
                            block_count += 1

                if block_count > 0:
                    avg_diff = block_diff / block_count
                    if avg_diff > 0.3:  # 超过30%差异标记为异常
                        regions.append({
                            "x": bx, "y": by,
                            "width": min(block_size, w - bx),
                            "height": min(block_size, h - by),
                            "difference": round(avg_diff, 4),
                            "severity": "high" if avg_diff > 0.6 else "medium",
                        })

        return regions[:50]  # 限制数量

    def _detect_render_issues(self, result: RenderComparisonResult) -> List[Dict]:
        """根据对比结果检测渲染问题"""
        issues = []

        if result.pixel_difference > 0.5:
            issues.append({
                "type": "major_pixel_difference",
                "severity": "high",
                "message": f"像素差异过大({result.pixel_difference:.1%})，可能存在严重渲染错误",
            })

        if result.ssim_score < 0.5:
            issues.append({
                "type": "low_structural_similarity",
                "severity": "high",
                "message": f"结构相似性过低({result.ssim_score:.2f})，模型结构可能渲染错误",
            })

        if result.histogram_similarity < 0.5:
            issues.append({
                "type": "color_distribution_mismatch",
                "severity": "medium",
                "message": f"颜色分布差异大({result.histogram_similarity:.2f})，材质或光照可能错误",
            })

        if result.edge_similarity < 0.5:
            issues.append({
                "type": "edge_mismatch",
                "severity": "medium",
                "message": f"边缘差异大({result.edge_similarity:.2f})，模型轮廓或网格可能错误",
            })

        if len(result.anomaly_regions) > 10:
            issues.append({
                "type": "many_anomaly_regions",
                "severity": "high",
                "message": f"发现{len(result.anomaly_regions)}个异常区域，渲染可能存在大面积错误",
            })

        # 检测全黑/全白
        if result.pixel_difference < 0.01 and result.ssim_score > 0.99:
            issues.append({
                "type": "identical_images",
                "severity": "info",
                "message": "两张图像几乎完全相同，渲染引擎可能未应用变化",
            })

        return issues

    def generate_comparison_report(self, result: RenderComparisonResult) -> str:
        """生成对比报告"""
        data = result.to_dict()
        lines = ["# 渲染截图对比报告", ""]
        lines.append(f"**参考图**: {result.reference_image}")
        lines.append(f"**测试图**: {result.test_image}")
        lines.append(f"**综合评分**: {data['overall_score']:.2f} / 1.0")
        lines.append(f"**是否通过**: {'是' if data['passed'] else '否'} (阈值: {data['threshold']})")
        lines.append(f"**耗时**: {data['duration']}秒")
        lines.append("")
        lines.append("## 各项指标")
        lines.append("")
        lines.append(f"| 指标 | 分数 | 说明 |")
        lines.append(f"|------|------|------|")
        lines.append(f"| 像素差异 | {data['pixel_difference']:.2%} | 越低越好 |")
        lines.append(f"| SSIM结构相似性 | {data['ssim_score']:.2f} | 越高越好 |")
        lines.append(f"| 直方图相似度 | {data['histogram_similarity']:.2f} | 越高越好 |")
        lines.append(f"| 边缘相似度 | {data['edge_similarity']:.2f} | 越高越好 |")
        lines.append("")
        if data['anomaly_regions']:
            lines.append(f"## 异常区域 ({len(data['anomaly_regions'])}个)")
            lines.append("")
            for i, region in enumerate(data['anomaly_regions'][:20], 1):
                lines.append(f"{i}. 位置({region['x']},{region['y']}) "
                             f"大小{region['width']}x{region['height']} "
                             f"差异{region['difference']:.1%} [{region['severity']}]")
            lines.append("")
        if data['issues']:
            lines.append("## 检测到的问题")
            lines.append("")
            for issue in data['issues']:
                lines.append(f"- [{issue.get('severity', 'info')}] {issue['message']}")
            lines.append("")
        return "\n".join(lines)

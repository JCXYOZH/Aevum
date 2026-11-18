"""版本发布与分发系统：发布多平台安装包，通过WAN广播，用户检查更新并安装。

注意：版本发布只分发编译后的安装包（.exe/.app/.bin），不分发源代码。
源代码只能通过治理分叉（Fork）流程经社区投票后获取。
"""
import os
import sys
import glob
import json
import time
import shutil
import hashlib
import zipfile
import platform
import threading
import subprocess
import logging
from typing import Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode

logger = logging.getLogger(__name__)

from .constants import PLATFORM_EXT, PLATFORM_LABELS, current_platform
from .models import BuildCancelled


class ReleaseIconMixin:
    """图标检查、icns 生成与可用图标列表。"""

    def ensure_icons(self, custom_icon: str = None) -> Dict:
        """确保图标文件存在，不存在则自动生成
    
        Args:
            custom_icon: 用户自定义图标路径（PNG）。提供后自动转换为 ICO/ICNS。
        """
        assets_dir = os.path.join(self.project_root, "assets")
        os.makedirs(assets_dir, exist_ok=True)
        icon_png = os.path.join(assets_dir, "icon.png")
        icon_ico = os.path.join(assets_dir, "icon.ico")
    
        # 如果用户提供了自定义图标，复制并转换
        if custom_icon and os.path.isfile(custom_icon):
            try:
                from PIL import Image
                img = Image.open(custom_icon).convert("RGBA")
                # 居中裁剪为正方形（不拉伸）
                w, h = img.size
                if w != h:
                    s = min(w, h)
                    left = (w - s) // 2
                    top = (h - s) // 2
                    img = img.crop((left, top, left + s, top + s))
                # 保持原始尺寸，直接使用
                img.save(icon_png, "PNG")
                # 生成 ICO（从原图缩放各尺寸）
                ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64),
                             (128, 128), (256, 256)]
                img.save(icon_ico, format="ICO", sizes=ico_sizes)
                # macOS ICNS（从原图缩放各尺寸，不强制遮罩）
                if sys.platform == "darwin":
                    self._make_icns(img, os.path.join(assets_dir, "icon.icns"))
                return {"success": True, "message": f"自定义图标已设置: {os.path.basename(custom_icon)}"}
            except Exception as e:
                return {"success": False, "error": f"自定义图标处理失败: {e}"}
    
        icon_icns = os.path.join(assets_dir, "icon.icns")
        if os.path.isfile(icon_png) and os.path.isfile(icon_ico):
            # macOS 还需要 .icns
            if sys.platform == "darwin" and not os.path.isfile(icon_icns):
                try:
                    from PIL import Image
                    img = Image.open(icon_png).convert("RGBA")
                    self._make_icns(img, icon_icns)
                except Exception:
                    pass
            return {"success": True, "message": "图标已存在"}
        # 运行 generate_icon.py
        gen_script = os.path.join(self.project_root, "generate_icon.py")
        if not os.path.isfile(gen_script):
            return {"success": False, "error": "generate_icon.py 不存在"}
        try:
            result = subprocess.run(
                [sys.executable, gen_script],
                cwd=self.project_root, capture_output=True, timeout=120
            )
            if result.returncode == 0:
                return {"success": True, "message": "图标已自动生成"}
            return {"success": False, "error": safe_decode(result.stderr)[:200]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _make_icns(self, img, output_path: str):
        """从 PIL Image 生成带 macOS 圆角透明遮罩的 ICNS。"""
        import shutil
        from PIL import Image, ImageChops, ImageDraw
        img = img.convert("RGBA")
        # 确保正方形
        w, h = img.size
        if w != h:
            s = min(w, h)
            img = img.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2))
        # 确保至少 1024
        if img.size != (1024, 1024):
            img = img.resize((1024, 1024), Image.LANCZOS)
        scale = 4
        mask = Image.new("L", (1024 * scale, 1024 * scale), 0)
        draw = ImageDraw.Draw(mask)
        draw.rounded_rectangle(
            (0, 0, 1024 * scale - 1, 1024 * scale - 1),
            radius=int(1024 * scale * 0.2237),
            fill=255,
        )
        mask = mask.resize((1024, 1024), Image.LANCZOS)
        img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
        iconset = os.path.join(self.project_root, "assets", "icon.iconset")
        os.makedirs(iconset, exist_ok=True)
        sizes = {
            "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
            "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
            "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
            "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
            "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
        }
        for name, sz in sizes.items():
            img.resize((sz, sz), Image.LANCZOS).save(os.path.join(iconset, name))
        success = False
        try:
            result = subprocess.run(
                ["iconutil", "-c", "icns", iconset, "-o", output_path],
                capture_output=True, timeout=30)
            if result.returncode != 0:
                logger.warning(f"iconutil failed: {safe_decode(result.stderr)}")
            else:
                success = True
        except Exception as e:
            logger.warning(f"iconutil error: {e}")
        finally:
            shutil.rmtree(iconset, ignore_errors=True)
        return success

    def list_available_icons(self) -> List[Dict]:
        """列出 assets 目录中可用的图标文件（仅 512x512 以上的 PNG 可作为应用图标）"""
        icons = []
        assets_dir = os.path.join(self.project_root, "assets")
        if not os.path.isdir(assets_dir):
            return icons
        for f in sorted(os.listdir(assets_dir)):
            if not f.lower().endswith(".png"):
                continue
            path = os.path.join(assets_dir, f)
            try:
                from PIL import Image
                with Image.open(path) as img:
                    w, h = img.size
            except Exception:
                continue
            usable = w >= 512 and h >= 512
            icons.append({
                "name": f,
                "path": path,
                "size": os.path.getsize(path),
                "width": w,
                "height": h,
                "usable": usable,
                "is_default": f == "icon.png",
            })
        return icons

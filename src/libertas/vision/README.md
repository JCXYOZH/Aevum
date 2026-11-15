# Libertas 视觉模块

从 `mrhua/vision` 迁入的可独立运行视觉工具。保留图像预处理、OCR、感知哈希和统一入口，移除依赖缺失分类器的“图像分类”路径。

## 模块

| 文件 | 职责 |
| --- | --- |
| `captcha.py` | 验证码灰度、二值化、去噪、OCR 识别与文本清洗 |
| `ocr.py` | RapidOCR 懒加载封装，线程安全，缺少依赖时返回不可用 |
| `perceptual_hash.py` | 纯 Python aHash/dHash/pHash、汉明距离、相似度与内容哈希 |
| `engine.py` | `VisionEngine` 统一入口：OCR、验证码、哈希、截图分析 |
| `paths.py` | 统一运行目录 `runtime/vision`，支持 `LIBERTAS_VISION_DATA_DIR` |

## 使用

```python
from libertas.vision import get_vision_engine, phash, compare

engine = get_vision_engine()
print(engine.get_status())

print(phash("a.png"))
print(compare("a.png", "b.png"))
```

OCR 依赖可选包 `rapidocr_onnxruntime`，图像处理依赖 `Pillow`。未安装时相关函数返回 `None` 或空结果，不会阻断导入。

## 清理

- 删除 `engine.py` 对 `mrhua.vision.classifier` 的悬空依赖，以及 `classify`、`_get_classifier` 和 `classifier_enabled` 配置；页面类型改由 OCR 文本规则推断。
- 所有跨模块导入改为相对导入，不再依赖旧 `mrhua` 包路径。
- 配置目录统一到 `runtime/vision`，可通过 `LIBERTAS_VISION_DATA_DIR` 覆盖。
- 下载图片的 User-Agent 从旧项目标识改为 `Libertas Vision`。

## 有意未迁入

- `vision_expansion.py`：聚合式“图像质量评估、聚类、批量处理管线”等扩展，和现有模块职责重叠，完成度不足。

## 验证

在项目虚拟环境 `D:\venv` 中验证，依赖版本：

- Pillow 12.2.0
- rapidocr-onnxruntime 1.2.3

```powershell
D:\venv\Scripts\python.exe -m compileall -q src\libertas\vision
D:\venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'src'); import libertas.vision"
```

真实图像测试使用 Pillow 生成 900×240 的 `ABC123` 测试图，结果：

- `ahash`、`dhash`、`phash` 均返回有效哈希
- `compare(path, path)` 返回距离 `0`、相似度 `1.0`
- `preprocess_captcha` 返回有效的 900×240 预处理图
- `get_ocr_engine().available` 为 `True`
- OCR 识别为 `ABC123`，置信度约 `0.8564`
- `solve_captcha` 识别为 `ABC123`

这验证了感知哈希、验证码预处理、RapidOCR 加载和统一入口的真实图像路径。

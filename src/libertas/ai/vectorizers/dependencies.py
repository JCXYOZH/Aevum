"""向量化可选依赖适配。"""

import os
import sys as _sys

if _sys.platform == "win32":
    os.environ.setdefault("JOBLIB_START_METHOD", "spawn")
    os.environ.setdefault("LOKY_START_METHOD", "spawn")
else:
    os.environ.setdefault("JOBLIB_START_METHOD", "fork")
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False
    SentenceTransformer = None

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    requests = None

try:
    from sklearn.feature_extraction.text import TfidfVectorizer as SklearnTfidf
    from sklearn.metrics.pairwise import cosine_similarity as sk_cosine
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    SklearnTfidf = None
    sk_cosine = None

try:
    import jieba
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    np = None

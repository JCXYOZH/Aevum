"""向量化入口。"""

from .similarity import cosine_similarity, _tokenize
from .tag import TagVectorizer, TfidfTagVectorizer
from .semantic import SemanticVectorizer
from .cloud import CloudVectorizer
from .fallback import FallbackVectorizer
from .shared import _shared_lock, get_shared_semantic_vectorizer
from .manager import _vectorization_lock, get_vectorization_manager, rebuild_vectorization, reset_vectorization_manager
from .factory import create_vectorizer_from_config

__all__ = [
    "cosine_similarity",
    "_tokenize",
    "TagVectorizer",
    "TfidfTagVectorizer",
    "SemanticVectorizer",
    "CloudVectorizer",
    "FallbackVectorizer",
    "_shared_lock",
    "get_shared_semantic_vectorizer",
    "_vectorization_lock",
    "get_vectorization_manager",
    "rebuild_vectorization",
    "reset_vectorization_manager",
    "create_vectorizer_from_config",
]

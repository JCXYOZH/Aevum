from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================

from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .prompt_context import *  # noqa: F401,F403
from .prompt_settings import *  # noqa: F401,F403
from .message_safety import *  # noqa: F401,F403
from .cloud_api import *  # noqa: F401,F403
from .tool_retry import *  # noqa: F401,F403
from .cloud_stream import *  # noqa: F401,F403
from .model_lifecycle import *  # noqa: F401,F403
from .model_load_fallback import *  # noqa: F401,F403
from .generation import *  # noqa: F401,F403
from .generation_stream import *  # noqa: F401,F403
from .prompt_builder import *  # noqa: F401,F403
from .memory_retrieval import *  # noqa: F401,F403
from .search_helpers import *  # noqa: F401,F403
from .web_tools import *  # noqa: F401,F403
from .response_processing import *  # noqa: F401,F403


class ModelEngine(
    ModelEnginePromptContext,
    ModelEnginePromptSettings,
    ModelEngineMessageSafety,
    ModelEngineCloudAPI,
    ModelEngineToolRetry,
    ModelEngineCloudStream,
    ModelEngineModelLifecycle,
    ModelEngineModelLoadFallback,
    ModelEngineGeneration,
    ModelEngineGenerationStream,
    ModelEnginePromptBuilder,
    ModelEngineMemoryRetrieval,
    ModelEngineSearchHelpers,
    ModelEngineWebTools,
    ModelEngineResponseProcessing,
    ModelEngineBase,
):
    pass


# 让拆分后的模块共享包内全部函数、类与常量
import sys as _sys

_pkg = _sys.modules[__name__]
_MODULE_NAMES = (
    "model_cache",
    "core",
    "prompt_context",
    "prompt_settings",
    "message_safety",
    "cloud_api",
    "tool_retry",
    "cloud_stream",
    "model_lifecycle",
    "model_load_fallback",
    "generation",
    "generation_stream",
    "prompt_builder",
    "memory_retrieval",
    "search_helpers",
    "web_tools",
    "response_processing",
)
_modules = [
    _sys.modules[f"{__name__}.{_name}"]
    for _name in _MODULE_NAMES
]
for _m in _modules:
    for _k, _v in list(vars(_m).items()):
        if not _k.startswith('__'):
            _pkg.__dict__[_k] = _v
for _m in _modules:
    for _k, _v in list(_pkg.__dict__.items()):
        if not _k.startswith('__'):
            setattr(_m, _k, _v)

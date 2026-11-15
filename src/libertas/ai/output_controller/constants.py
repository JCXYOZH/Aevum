"""输出控制常量。"""

import logging



logger = logging.getLogger(__name__)

LENGTH_PRESETS = {
    "concise": {"max_tokens": 256, "max_chars": 1024, "target_sentences": 3},
    "short": {"max_tokens": 512, "max_chars": 2048, "target_sentences": 5},
    "medium": {"max_tokens": 1024, "max_chars": 4096, "target_sentences": 10},
    "long": {"max_tokens": 2048, "max_chars": 8192, "target_sentences": 20},
    "detailed": {"max_tokens": 4096, "max_chars": 16384, "target_sentences": 40},
    "comprehensive": {"max_tokens": 8192, "max_chars": 32768, "target_sentences": 80},
}

TASK_COMPLEXITY_MAP = {
    "simple_question": "concise",
    "definition": "short",
    "explanation": "medium",
    "analysis": "long",
    "code_generation": "detailed",
    "report": "comprehensive",
    "tutorial": "comprehensive",
    "debugging": "detailed",
    "translation": "medium",
    "summarization": "short",
    "creative_writing": "long",
}

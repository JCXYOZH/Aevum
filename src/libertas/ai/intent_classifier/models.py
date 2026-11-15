"""意图定义与分类结果。"""

import re
import time
import uuid
from typing import Any, Dict, List, Optional

class IntentDefinition:
    """意图定义"""

    def __init__(self, name: str = "", description: str = "",
                 keywords: Optional[List[str]] = None,
                 patterns: Optional[List[str]] = None,
                 examples: Optional[List[str]] = None,
                 priority: int = 0,
                 category: str = "general",
                 required_entities: Optional[List[str]] = None,
                 handler: str = ""):
        self.intent_id = f"intent_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.description = description
        self.keywords = keywords or []
        self.patterns = patterns or []
        self.examples = examples or []
        self.priority = priority
        self.category = category
        self.required_entities = required_entities or []
        self.handler = handler
        self.created_at = time.time()
        self.updated_at = time.time()
        self.match_count = 0
        self.compiled_patterns: List[re.Pattern] = []
        self._compile_patterns()

    def _compile_patterns(self):
        self.compiled_patterns = []
        for pattern in self.patterns:
            try:
                self.compiled_patterns.append(re.compile(pattern, re.IGNORECASE))
            except re.error:
                pass

    def add_example(self, example: str):
        self.examples.append(example)
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "intent_id": self.intent_id,
            "name": self.name,
            "description": self.description,
            "keywords": self.keywords,
            "patterns": self.patterns,
            "examples": self.examples,
            "priority": self.priority,
            "category": self.category,
            "required_entities": self.required_entities,
            "handler": self.handler,
            "match_count": self.match_count,
        }

class ClassificationResult:
    """分类结果"""

    def __init__(self, text: str = ""):
        self.text = text
        self.intent = ""
        self.confidence = 0.0
        self.category = ""
        self.matched_keywords: List[str] = []
        self.matched_patterns: List[str] = []
        self.entities: Dict[str, str] = {}
        self.alternatives: List[Dict[str, Any]] = []
        self.processing_time_ms = 0.0
        self.ambiguous = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "intent": self.intent,
            "confidence": self.confidence,
            "category": self.category,
            "matched_keywords": self.matched_keywords,
            "entities": self.entities,
            "alternatives": self.alternatives,
            "processing_time_ms": self.processing_time_ms,
            "ambiguous": self.ambiguous,
        }

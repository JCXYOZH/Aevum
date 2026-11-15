"""意图分类入口。"""

from .models import IntentDefinition, ClassificationResult
from .classifier import IntentClassifier
from .singleton import _intent_classifier, get_intent_classifier, classify_intent

__all__ = [
    "IntentDefinition", "ClassificationResult", "IntentClassifier",
    "_intent_classifier", "get_intent_classifier", "classify_intent",
]

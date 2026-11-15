"""意图分类器单例与模块级入口。"""

from .classifier import IntentClassifier
from .models import ClassificationResult

_intent_classifier = IntentClassifier()

def get_intent_classifier() -> IntentClassifier:
    return _intent_classifier

def classify_intent(text: str, **kwargs) -> ClassificationResult:
    return _intent_classifier.classify(text, **kwargs)

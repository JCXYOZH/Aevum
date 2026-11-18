"""认知网络公共入口。"""

from .models import ConceptNode, ConceptEdge
from .network import CognitiveNetwork
from .singleton import get_cognitive_network, relate_concepts

__all__ = ["ConceptNode", "ConceptEdge", "CognitiveNetwork", "get_cognitive_network", "relate_concepts"]

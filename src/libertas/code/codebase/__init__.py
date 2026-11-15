"""代码库统一入口。"""

from .models import SymbolType, ChangeType, IssueSeverity, CodeSymbol, CodeFile, ProjectStats
from .indexer import ProjectIndexer
from .analyzer import CodeAnalyzer
from .search import CodeSearch
from .modifier import CodeModifier
from .reviewer import CodeReviewer
from .testing import TestRunner, BuildVerifier
from .git import GitIntegration
from .impact import ImpactAnalyzer
from .core import Codebase
from .graph import CodeDependencyGraph
from .refactor import CrossFileRefactorer
from .quality import CodeQualityScorer
from .patch import CodePatchApplier
from .template import CodeTemplateGenerator
from .advisor import RefactoringAdvisor
from .singleton import get_codebase, init_codebase

__all__ = [
    "SymbolType",
    "ChangeType",
    "IssueSeverity",
    "CodeSymbol",
    "CodeFile",
    "ProjectStats",
    "ProjectIndexer",
    "CodeAnalyzer",
    "CodeSearch",
    "CodeModifier",
    "CodeReviewer",
    "TestRunner",
    "BuildVerifier",
    "GitIntegration",
    "ImpactAnalyzer",
    "Codebase",
    "CodeDependencyGraph",
    "CrossFileRefactorer",
    "CodeQualityScorer",
    "CodePatchApplier",
    "CodeTemplateGenerator",
    "RefactoringAdvisor",
    "get_codebase",
    "init_codebase",
]

"""输出校验入口。"""

from .constants import _EMPTY_PATTERNS, _REFUSAL_PATTERNS, _KNOWN_CONTROL_TAGS, _DSML_TAG_RE, _URL_RE, _TOOL_TAG_RE, _SEARCH_TAG_RE, _FILE_TAG_RE, _KNOWN_OFFICIAL_DOMAINS
from .models import ValidationRuleType, ValidationResult, ValidationRule
from .sanitizer import _domain_match, _is_known_official_url, strip_dsml_tags, clean_malformed_urls, extract_control_tags, build_fallback_prompt
from .core import OutputValidator
from .singleton import _output_validator, get_output_validator, validate_output

__all__ = [
    "_EMPTY_PATTERNS",
    "_REFUSAL_PATTERNS",
    "_KNOWN_CONTROL_TAGS",
    "_DSML_TAG_RE",
    "_URL_RE",
    "_TOOL_TAG_RE",
    "_SEARCH_TAG_RE",
    "_FILE_TAG_RE",
    "_KNOWN_OFFICIAL_DOMAINS",
    "ValidationRuleType",
    "ValidationResult",
    "ValidationRule",
    "_domain_match",
    "_is_known_official_url",
    "strip_dsml_tags",
    "clean_malformed_urls",
    "extract_control_tags",
    "build_fallback_prompt",
    "OutputValidator",
    "_output_validator",
    "get_output_validator",
    "validate_output",
]

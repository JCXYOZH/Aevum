"""职责模块：strings。"""

from __future__ import annotations

import re

class StringUtils:
    """字符串处理器"""

    @staticmethod
    def camel_to_snake(text: str) -> str:
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', text)
        return re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    @staticmethod
    def snake_to_camel(text: str) -> str:
        components = text.split('_')
        return components[0] + ''.join(x.title() for x in components[1:])

    @staticmethod
    def snake_to_pascal(text: str) -> str:
        return ''.join(x.title() for x in text.split('_'))

    @staticmethod
    def kebab_to_snake(text: str) -> str:
        return text.replace('-', '_')

    @staticmethod
    def snake_to_kebab(text: str) -> str:
        return text.replace('_', '-')

    @staticmethod
    def truncate(text: str, max_length: int, suffix: str = "...") -> str:
        if len(text) <= max_length:
            return text
        return text[:max_length - len(suffix)] + suffix

    @staticmethod
    def slugify(text: str, separator: str = "-") -> str:
        text = text.lower()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[-\s]+', separator, text)
        return text.strip(separator)

    @staticmethod
    def remove_html_tags(text: str) -> str:
        return re.sub(r'<[^>]+>', '', text)

    @staticmethod
    def strip_whitespace(text: str) -> str:
        return re.sub(r'\s+', ' ', text).strip()

    @staticmethod
    def count_words(text: str) -> int:
        return len(text.split())

    @staticmethod
    def count_chars(text: str, include_spaces: bool = True) -> int:
        if include_spaces:
            return len(text)
        return len(text.replace(' ', ''))

    @staticmethod
    def count_lines(text: str) -> int:
        return text.count('\n') + 1

    @staticmethod
    def reverse(text: str) -> str:
        return text[::-1]

    @staticmethod
    def is_palindrome(text: str) -> bool:
        cleaned = re.sub(r'[^a-zA-Z0-9]', '', text.lower())
        return cleaned == cleaned[::-1]

    @staticmethod
    def mask_sensitive(text: str, visible_start: int = 3,
                       visible_end: int = 2, mask_char: str = "*") -> str:
        if len(text) <= visible_start + visible_end:
            return mask_char * len(text)
        return (text[:visible_start] +
                mask_char * (len(text) - visible_start - visible_end) +
                text[-visible_end:])

    @staticmethod
    def levenshtein_distance(s1: str, s2: str) -> int:
        """编辑距离"""
        if len(s1) < len(s2):
            return StringUtils.levenshtein_distance(s2, s1)
        if len(s2) == 0:
            return len(s1)
        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row
        return previous_row[-1]

    @staticmethod
    def similarity(s1: str, s2: str) -> float:
        """字符串相似度 (0-1)"""
        if not s1 and not s2:
            return 1.0
        max_len = max(len(s1), len(s2))
        if max_len == 0:
            return 1.0
        distance = StringUtils.levenshtein_distance(s1, s2)
        return 1.0 - distance / max_len

"""职责模块：structures。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
from collections import deque, Counter, defaultdict, OrderedDict
import hashlib
import math
import threading
import time

class TrieNode:
    """Trie树节点"""
    __slots__ = ('children', 'is_end', 'value', 'count')

    def __init__(self):
        self.children: Dict[str, 'TrieNode'] = {}
        self.is_end = False
        self.value: Any = None
        self.count = 0

class Trie:
    """Trie树（前缀树）"""

    def __init__(self):
        self.root = TrieNode()
        self._size = 0
        self._lock = threading.RLock()

    def insert(self, word: str, value: Any = None):
        with self._lock:
            node = self.root
            for char in word:
                if char not in node.children:
                    node.children[char] = TrieNode()
                node = node.children[char]
                node.count += 1
            if not node.is_end:
                node.is_end = True
                self._size += 1
            node.value = value

    def search(self, word: str) -> Tuple[bool, Any]:
        node = self.root
        for char in word:
            if char not in node.children:
                return False, None
            node = node.children[char]
        return node.is_end, node.value

    def starts_with(self, prefix: str) -> bool:
        node = self.root
        for char in prefix:
            if char not in node.children:
                return False
            node = node.children[char]
        return True

    def autocomplete(self, prefix: str, limit: int = 10) -> List[str]:
        results = []
        node = self.root
        for char in prefix:
            if char not in node.children:
                return results
            node = node.children[char]

        def dfs(n: TrieNode, path: str):
            if n.is_end:
                results.append(path)
                if len(results) >= limit:
                    return
            for char, child in n.children.items():
                dfs(child, path + char)
                if len(results) >= limit:
                    return

        dfs(node, prefix)
        return results

    def delete(self, word: str) -> bool:
        with self._lock:
            nodes = []
            node = self.root
            for char in word:
                if char not in node.children:
                    return False
                nodes.append((char, node))
                node = node.children[char]
            if not node.is_end:
                return False
            node.is_end = False
            node.value = None
            self._size -= 1
            # 清理无用节点
            for char, parent in reversed(nodes):
                child = parent.children[char]
                child.count -= 1
                if child.count == 0 and not child.is_end:
                    del parent.children[char]
            return True

    def size(self) -> int:
        return self._size

    def clear(self):
        with self._lock:
            self.root = TrieNode()
            self._size = 0

class LRUCache:
    """LRU缓存"""

    def __init__(self, capacity: int = 100, ttl: float = 0.0):
        self.capacity = capacity
        self.ttl = ttl
        self._cache: OrderedDict[str, Tuple[Any, float]] = OrderedDict()
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                self.misses += 1
                return None
            value, timestamp = self._cache[key]
            if self.ttl > 0 and time.time() - timestamp > self.ttl:
                del self._cache[key]
                self.misses += 1
                return None
            self._cache.move_to_end(key)
            self.hits += 1
            return value

    def set(self, key: str, value: Any):
        with self._lock:
            self._cache[key] = (value, time.time())
            self._cache.move_to_end(key)
            if len(self._cache) > self.capacity:
                self._cache.popitem(last=False)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                return True
            return False

    def clear(self):
        with self._lock:
            self._cache.clear()

    def get_hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def __len__(self) -> int:
        return len(self._cache)

    def __contains__(self, key: str) -> bool:
        return key in self._cache

class BloomFilter:
    """布隆过滤器"""

    def __init__(self, size: int = 10000, num_hashes: int = 5):
        self.size = size
        self.num_hashes = num_hashes
        self._bits = [False] * size
        self._count = 0
        self._lock = threading.RLock()

    def _hashes(self, item: str) -> List[int]:
        hashes = []
        for i in range(self.num_hashes):
            h = hashlib.md5(f"{item}:{i}".encode()).hexdigest()
            hashes.append(int(h, 16) % self.size)
        return hashes

    def add(self, item: str):
        with self._lock:
            for h in self._hashes(item):
                self._bits[h] = True
            self._count += 1

    def contains(self, item: str) -> bool:
        for h in self._hashes(item):
            if not self._bits[h]:
                return False
        return True

    def false_positive_rate(self) -> float:
        if self._count == 0:
            return 0.0
        return (1 - math.exp(-self.num_hashes * self._count / self.size)) ** self.num_hashes

    def count(self) -> int:
        return self._count

    def clear(self):
        with self._lock:
            self._bits = [False] * self.size
            self._count = 0

class CircularBuffer:
    """环形缓冲区"""

    def __init__(self, capacity: int = 100):
        self.capacity = capacity
        self._buffer: List[Optional[Any]] = [None] * capacity
        self._head = 0
        self._tail = 0
        self._size = 0
        self._lock = threading.RLock()

    def push(self, item: Any):
        with self._lock:
            self._buffer[self._head] = item
            self._head = (self._head + 1) % self.capacity
            if self._size < self.capacity:
                self._size += 1
            else:
                self._tail = (self._tail + 1) % self.capacity

    def pop(self) -> Optional[Any]:
        with self._lock:
            if self._size == 0:
                return None
            item = self._buffer[self._tail]
            self._tail = (self._tail + 1) % self.capacity
            self._size -= 1
            return item

    def peek(self) -> Optional[Any]:
        if self._size == 0:
            return None
        return self._buffer[self._tail]

    def is_full(self) -> bool:
        return self._size == self.capacity

    def is_empty(self) -> bool:
        return self._size == 0

    def size(self) -> int:
        return self._size

    def clear(self):
        with self._lock:
            self._buffer = [None] * self.capacity
            self._head = 0
            self._tail = 0
            self._size = 0

    def to_list(self) -> List[Any]:
        with self._lock:
            result = []
            idx = self._tail
            for _ in range(self._size):
                result.append(self._buffer[idx])
                idx = (idx + 1) % self.capacity
            return result

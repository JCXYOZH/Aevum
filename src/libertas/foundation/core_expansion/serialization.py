"""职责模块：serialization。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable, TypeVar, Generic, Union
import copy
import json
import pickle
import zlib

from .paths import PathUtils

class SerializationUtils:
    """序列化工具"""

    @staticmethod
    def to_json(obj: Any, indent: int = 2, ensure_ascii: bool = False) -> str:
        return json.dumps(obj, indent=indent, ensure_ascii=ensure_ascii, default=str)

    @staticmethod
    def from_json(json_str: str) -> Any:
        return json.loads(json_str)

    @staticmethod
    def to_json_file(obj: Any, filepath: str, indent: int = 2):
        PathUtils.ensure_parent_dir(filepath)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(obj, f, indent=indent, ensure_ascii=False, default=str)

    @staticmethod
    def from_json_file(filepath: str) -> Any:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    @staticmethod
    def to_pickle(obj: Any) -> bytes:
        return pickle.dumps(obj)

    @staticmethod
    def from_pickle(data: bytes) -> Any:
        return pickle.loads(data)

    @staticmethod
    def compress(data: bytes, level: int = 6) -> bytes:
        return zlib.compress(data, level)

    @staticmethod
    def decompress(data: bytes) -> bytes:
        return zlib.decompress(data)

    @staticmethod
    def deep_copy(obj: Any) -> Any:
        return copy.deepcopy(obj)

    @staticmethod
    def shallow_copy(obj: Any) -> Any:
        return copy.copy(obj)

    @staticmethod
    def merge_dicts(dict1: Dict, dict2: Dict, deep: bool = True) -> Dict:
        if deep:
            result = copy.deepcopy(dict1)
            for key, value in dict2.items():
                if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                    result[key] = SerializationUtils.merge_dicts(result[key], value)
                else:
                    result[key] = copy.deepcopy(value)
            return result
        else:
            result = dict(dict1)
            result.update(dict2)
            return result

    @staticmethod
    def flatten_dict(d: Dict, parent_key: str = '', sep: str = '.') -> Dict:
        items = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, dict):
                items.extend(SerializationUtils.flatten_dict(v, new_key, sep).items())
            else:
                items.append((new_key, v))
        return dict(items)

    @staticmethod
    def unflatten_dict(d: Dict, sep: str = '.') -> Dict:
        result: Dict = {}
        for key, value in d.items():
            parts = key.split(sep)
            current = result
            for part in parts[:-1]:
                if part not in current:
                    current[part] = {}
                current = current[part]
            current[parts[-1]] = value
        return result

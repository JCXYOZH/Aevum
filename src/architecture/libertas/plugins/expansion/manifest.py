"""插件扩展模型: 插件清单。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Callable
from enum import Enum

class PluginManifest:
    """插件清单"""

    def __init__(self, plugin_id: str = "", name: str = "",
                 version: str = "1.0.0", description: str = "",
                 author: str = "", plugin_type: str = "generic",
                 entry_point: str = "", dependencies: Optional[List[str]] = None,
                 permissions: Optional[List[str]] = None,
                 tags: Optional[List[str]] = None,
                 min_engine_version: str = "1.0.0",
                 max_engine_version: str = ""):
        self.plugin_id = plugin_id or f"plugin_{uuid.uuid4().hex[:8]}"
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.plugin_type = plugin_type
        self.entry_point = entry_point
        self.dependencies = dependencies or []
        self.permissions = permissions or []
        self.tags = tags or []
        self.min_engine_version = min_engine_version
        self.max_engine_version = max_engine_version
        self.created_at = time.time()
        self.updated_at = time.time()
        self.homepage = ""
        self.repository = ""
        self.license = ""
        self.keywords = []
        self.categories = []
        self.screenshots = []
        self.changelog = []
        self.metadata: Dict[str, Any] = {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plugin_id": self.plugin_id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "plugin_type": self.plugin_type,
            "entry_point": self.entry_point,
            "dependencies": self.dependencies,
            "permissions": self.permissions,
            "tags": self.tags,
            "min_engine_version": self.min_engine_version,
            "max_engine_version": self.max_engine_version,
            "homepage": self.homepage,
            "repository": self.repository,
            "license": self.license,
            "keywords": self.keywords,
            "categories": self.categories,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "PluginManifest":
        manifest = cls(
            plugin_id=data.get("plugin_id", ""),
            name=data.get("name", ""),
            version=data.get("version", "1.0.0"),
            description=data.get("description", ""),
            author=data.get("author", ""),
            plugin_type=data.get("plugin_type", "generic"),
            entry_point=data.get("entry_point", ""),
            dependencies=data.get("dependencies", []),
            permissions=data.get("permissions", []),
            tags=data.get("tags", []),
            min_engine_version=data.get("min_engine_version", "1.0.0"),
            max_engine_version=data.get("max_engine_version", ""),
        )
        manifest.homepage = data.get("homepage", "")
        manifest.repository = data.get("repository", "")
        manifest.license = data.get("license", "")
        manifest.keywords = data.get("keywords", [])
        manifest.categories = data.get("categories", [])
        manifest.metadata = data.get("metadata", {})
        return manifest

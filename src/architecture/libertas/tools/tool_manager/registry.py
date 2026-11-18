"""
工具管理器

管理工具的生命周期：发现、注册、初始化、启用、调用、禁用、卸载。
支持依赖管理、配置、状态监控、分组、导入导出。
"""
import os
import json
import time
import uuid
import importlib
import threading
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal
from libertas.utils.text_decode import decode_output, describe_exception

from .models import MissingToolParams, ToolInstance, ToolMetadata, ToolStatus


class ToolRegistryMixin:
    """工具加载、保存、注册、注销、自动发现与发现路径。"""

    def _load_security_tools(self):
        """从 config.yaml 加载 security_tools 配置（兼容0.1.5版本行为）"""
        try:
            from libertas.foundation.config import config
            tools = config.get('security_tools', {})
            if tools and isinstance(tools, dict):
                self.tools.update(tools)
                print(f"[TOOL] 从 config.yaml 加载了 {len(tools)} 个安全工具")
                return
        except Exception as e:
            print(f"[WARN] 从 config 加载 security_tools 失败: {e}")
    
        # 尝试直接读取 config.yaml
        try:
            import yaml
        except ImportError:
            return
        try:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            config_path = os.path.join(base_dir, '..', 'config.yaml')
            if not os.path.exists(config_path):
                config_path = 'config.yaml'
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    data = yaml.safe_load(f)
                tools = data.get('security_tools', {})
                if tools and isinstance(tools, dict):
                    self.tools.update(tools)
                    print(f"[TOOL] 直接从 config.yaml 加载了 {len(tools)} 个安全工具")
        except Exception as e:
            print(f"[WARN] 直接读取 config.yaml 失败: {e}")

    def _load(self):
        config_file = os.path.join(self.data_dir, "tool_manager.json")
        try:
            if os.path.exists(config_file):
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._groups = data.get("groups", {"default": []})
                self._discovery_paths = data.get("discovery_paths", [])
        except Exception:
            pass

    def _save(self):
        config_file = os.path.join(self.data_dir, "tool_manager.json")
        try:
            data = {
                "version": "1.0", "updated_at": time.time(),
                "groups": self._groups,
                "discovery_paths": self._discovery_paths,
                "tools": {name: t.to_dict() for name, t in self._tools.items()},
            }
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    def register(self, metadata: ToolMetadata,
                 handler: Optional[Callable] = None,
                 init_handler: Optional[Callable] = None,
                 cleanup_handler: Optional[Callable] = None,
                 group: str = "default") -> str:
        """注册工具"""
        tool = ToolInstance(metadata, handler, init_handler, cleanup_handler)
        with self._lock:
            self._tools[metadata.name] = tool
            self._groups.setdefault(group, []).append(metadata.name)
            self._save()
        terminal.info(f"注册工具: {metadata.name} v{metadata.version}", "tool_manager")
        return metadata.name

    def unregister(self, name: str) -> bool:
        with self._lock:
            tool = self._tools.pop(name, None)
            if tool:
                tool.cleanup()
                for group_tools in self._groups.values():
                    if name in group_tools:
                        group_tools.remove(name)
                self._save()
                return True
            return False

    def auto_discover_and_save(self, scan_paths: list = None, save_to_config: bool = True) -> dict:
        """自动发现工具并保存路径到配置文件
    
        Args:
            scan_paths: 要扫描的目录列表，如果为None则使用配置的发现路径和常见目录
            save_to_config: 是否保存到配置文件
    
        Returns:
            发现结果字典，包含发现的工具数量、路径等信息
        """
        import shutil as _shutil
    
        # 确定扫描路径
        if scan_paths is None:
            scan_paths = []
            # 1. 从config.yaml中读取tool_discovery_paths配置
            try:
                from libertas.core.config import _get_config
                config = _get_config()
                config_paths = config.get('tool_discovery_paths', [])
                if config_paths:
                    for path in config_paths:
                        if path and path not in scan_paths:
                            scan_paths.append(path)
            except Exception:
                pass
            # 2. 使用ToolManager配置的发现路径
            for path in getattr(self, '_discovery_paths', []):
                if path not in scan_paths:
                    scan_paths.append(path)
            # 3. 添加常见工具目录
            scan_paths.extend(self._get_common_tool_dirs())
    
        # 获取所有工具名称
        tool_names = list(self.tools.keys())
    
        # 获取可执行文件扩展名
        exe_exts = self._get_executable_extensions()
    
        # 发现结果
        discovered = {}
        already_in_path = {}
        not_found = []
    
        print(f"[SEARCH] 开始自动发现工具，扫描 {len(scan_paths)} 个目录...")
        print(f"   待发现工具数量: {len(tool_names)}")
    
        # 遍历所有工具
        for tool_name in tool_names:
            tool_config = self.tools.get(tool_name, {})
            path_name = tool_config.get('path', tool_name)
    
            # 检查是否已经在系统PATH中
            system_path = _shutil.which(path_name)
            if system_path:
                already_in_path[tool_name] = system_path
                continue
    
            # 在扫描路径中查找
            found_path = None
            for scan_dir in scan_paths:
                if not os.path.isdir(scan_dir):
                    continue
    
                # 直接在目录中查找
                for ext in exe_exts:
                    candidate = os.path.join(scan_dir, path_name + ext)
                    if os.path.isfile(candidate):
                        found_path = candidate
                        break
                if found_path:
                    break
    
                # 递归查找两层子目录
                try:
                    for root, dirs, files in os.walk(scan_dir):
                        # 限制递归深度
                        depth = root.replace(scan_dir, '').count(os.sep)
                        if depth > 2:
                            dirs.clear()
                            continue
    
                        for ext in exe_exts:
                            candidate = os.path.join(root, path_name + ext)
                            if os.path.isfile(candidate):
                                found_path = candidate
                                break
                        if found_path:
                            break
                except Exception:
                    pass
                if found_path:
                    break
    
            if found_path:
                discovered[tool_name] = found_path
            else:
                not_found.append(tool_name)
    
        # 保存到配置文件
        if save_to_config and discovered:
            try:
                from libertas.core.config import _get_config
                config = _get_config()
    
                saved_count = 0
                for tool_name, tool_path in discovered.items():
                    config_key = f"{tool_name}_path"
                    config.set(config_key, tool_path, source="auto_discovery")
                    saved_count += 1
    
                # 保存到文件
                config.save()
                print(f"[SAVE] 已保存 {saved_count} 个工具路径到配置文件")
            except Exception as e:
                print(f"[WARN] 保存配置文件失败: {e}")
    
        # 输出结果
        print("\n[STAT] 自动发现结果:")
        print(f"   [OK] 已在系统PATH中: {len(already_in_path)} 个")
        print(f"   [SEARCH] 新发现工具: {len(discovered)} 个")
        print(f"   [FAIL] 未找到工具: {len(not_found)} 个")
    
        if discovered:
            print("\n[SEARCH] 新发现的工具:")
            for tool_name, tool_path in list(discovered.items())[:20]:
                print(f"   - {tool_name}: {tool_path}")
            if len(discovered) > 20:
                print(f"   ... 还有 {len(discovered) - 20} 个")
    
        return {
            'success': True,
            'scanned_paths': len(scan_paths),
            'total_tools': len(tool_names),
            'already_in_path': len(already_in_path),
            'discovered': len(discovered),
            'not_found': len(not_found),
            'discovered_tools': discovered,
            'already_in_path_tools': already_in_path,
            'not_found_tools': not_found,
        }

    def add_discovery_path(self, path: str):
        if path not in self._discovery_paths:
            self._discovery_paths.append(path)
            self._save()

    def discover_tools(self) -> int:
        """自动发现工具（从指定路径）"""
        discovered = 0
        for path in self._discovery_paths:
            if not os.path.isdir(path):
                continue
            for filename in os.listdir(path):
                if filename.endswith(".py") and not filename.startswith("_"):
                    module_name = filename[:-3]
                    try:
                        spec = importlib.util.spec_from_file_location(module_name, os.path.join(path, filename))
                        if spec and spec.loader:
                            module = importlib.util.module_from_spec(spec)
                            spec.loader.exec_module(module)
                            if hasattr(module, "TOOL_METADATA") and hasattr(module, "tool_handler"):
                                metadata = ToolMetadata(**module.TOOL_METADATA)
                                if metadata.name not in self._tools:
                                    self.register(metadata, handler=module.tool_handler,
                                                 init_handler=getattr(module, "tool_init", None),
                                                 cleanup_handler=getattr(module, "tool_cleanup", None))
                                    discovered += 1
                    except Exception as e:
                        terminal.warn(f"发现工具失败 [{filename}]: {e}", "tool_manager")
        return discovered

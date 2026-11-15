"""版本发布与分发系统：发布多平台安装包，通过WAN广播，用户检查更新并安装。

注意：版本发布只分发编译后的安装包（.exe/.app/.bin），不分发源代码。
源代码只能通过治理分叉（Fork）流程经社区投票后获取。
"""
import os
import sys
import glob
import json
import time
import shutil
import hashlib
import zipfile
import platform
import threading
import subprocess
import logging
from typing import Dict, List, Optional, Tuple
from libertas.foundation.config import get_data_dir
from libertas.foundation.byte_stream import safe_decode

logger = logging.getLogger(__name__)

from .constants import PLATFORM_EXT, PLATFORM_LABELS, current_platform
from .models import BuildCancelled


class ReleaseDependencyMixin:
    """依赖配置、导入扫描、依赖检测与排除规则。"""

    def _get_dep_config_path(self) -> str:
        return os.path.join(self.data_dir, "build_dependencies.json")

    def load_dep_config(self) -> Dict:
        """加载保存的依赖配置"""
        path = self._get_dep_config_path()
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def save_dep_config(self, config: Dict) -> bool:
        """保存依赖配置"""
        try:
            os.makedirs(self.data_dir, exist_ok=True)
            with open(self._get_dep_config_path(), "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def _parse_pyproject_deps(self, toml_path: str) -> List[str]:
        """解析 pyproject.toml 中的依赖列表"""
        deps = []
        try:
            if sys.version_info >= (3, 11):
                import tomllib
                with open(toml_path, "rb") as f:
                    data = tomllib.load(f)
            else:
                try:
                    import tomli as tomllib
                    with open(toml_path, "rb") as f:
                        data = tomllib.load(f)
                except ImportError:
                    # 降级：用正则解析
                    with open(toml_path, "r", encoding="utf-8") as f:
                        content = f.read()
                    return self._regex_parse_deps(content)
    
            # PEP 621 格式
            project = data.get("project", {})
            for dep in project.get("dependencies", []):
                name = self._normalize_dep(dep)
                if name:
                    deps.append(name)
            # Poetry 格式
            poetry = data.get("tool", {}).get("poetry", {})
            for dep in poetry.get("dependencies", {}):
                if dep.lower() != "python":
                    deps.append(self._normalize_dep(dep))
            # 可选依赖
            for group_deps in project.get("optional-dependencies", {}).values():
                for dep in group_deps:
                    name = self._normalize_dep(dep)
                    if name:
                        deps.append(name)
        except Exception as e:
            logger.warning(f"解析 pyproject.toml 失败: {e}")
        return list(dict.fromkeys(deps))  # 去重保序

    def _regex_parse_deps(self, content: str) -> List[str]:
        """正则降级解析 toml 依赖"""
        import re
        deps = []
        # 匹配 dependencies = [...] 格式
        m = re.search(r'dependencies\s*=\s*\[(.*?)\]', content, re.DOTALL)
        if m:
            for line in m.group(1).split('\n'):
                dm = re.search(r'["\']([A-Za-z0-9_\-\.]+)', line)
                if dm:
                    deps.append(dm.group(1))
        return list(dict.fromkeys(deps))

    @staticmethod
    def _normalize_dep(dep: str) -> str:
        """从依赖声明中提取包名（去掉版本约束）"""
        import re
        dep = dep.strip().strip('"\'')
        m = re.match(r'^([A-Za-z0-9_\-\.]+)', dep)
        return m.group(1) if m else ""

    def scan_imports(self, depth: str = "standard") -> Dict:
        """扫描项目代码中的 import 语句，自动识别依赖。
    
        depth 控制的是【扫描范围】：
          - minimal: 只扫描 libertas/ 顶层 .py 文件和各子包 __init__.py
          - standard: 扫描 libertas/ 全部 .py 文件（默认）
          - deep: 扫描 libertas/ + 测试/脚本 + 分析动态导入
    
        注意：depth 本身不做依赖取舍。真正裁剪打包内容的是 minimal 档配套的
        排除清单（见 _resolve_excludes / _MINIMAL_EXCLUDES）——只有 minimal 会
        生成 --exclude-module，standard 与 deep 始终按识别结果全量打包。
        """
        libertas_dir = os.path.join(self.project_root, "libertas")
        if not os.path.isdir(libertas_dir):
            return {"success": False, "error": "找不到 libertas 目录"}
    
        py_files = []
        if depth == "minimal":
            # 只扫描 libertas/ 顶层 .py 文件和各子包的 __init__.py
            for fn in os.listdir(libertas_dir):
                fp = os.path.join(libertas_dir, fn)
                if fn.endswith(".py") and os.path.isfile(fp):
                    py_files.append(fp)
            for root, dirs, files in os.walk(libertas_dir):
                dirs[:] = [d for d in dirs if d != "__pycache__"]
                if "__init__.py" in files:
                    py_files.append(os.path.join(root, "__init__.py"))
        else:
            for root, dirs, files in os.walk(libertas_dir):
                # 跳过 __pycache__
                dirs[:] = [d for d in dirs if d != "__pycache__"]
                for fn in files:
                    if fn.endswith(".py"):
                        py_files.append(os.path.join(root, fn))
    
        if depth == "deep":
            # 额外扫描项目根目录的脚本
            for fn in os.listdir(self.project_root):
                if fn.endswith(".py"):
                    py_files.append(os.path.join(self.project_root, fn))
    
        import ast
    
        class _ImportCollector(ast.NodeVisitor):
            """收集 import，区分必需导入和可选导入（try/except ImportError 内）"""
            def __init__(self):
                self.found = set()           # 必需导入
                self.optional = set()        # 可选导入（在 try/except ImportError 中）
                self.dynamic = set()         # 动态导入
                self._try_depth = 0          # 当前嵌套的 try/except ImportError 深度
    
            def _is_optional(self):
                return self._try_depth > 0
    
            def visit_Try(self, node):
                # 判断这个 try 是否捕获 ImportError
                catches_import_error = any(
                    h.type is None or
                    (isinstance(h.type, ast.Name) and h.type.id in ("ImportError", "ModuleNotFoundError"))
                    for h in node.handlers
                )
                old_depth = self._try_depth
                if catches_import_error:
                    self._try_depth += 1
                # 访问 try body 中的导入（可能为可选）
                for child in node.body:
                    self.visit(child)
                # handlers/orelse/finalbody 中的导入不算可选
                self._try_depth = old_depth
                for child in node.handlers:
                    self.visit(child)
                for child in node.orelse:
                    self.visit(child)
                for child in node.finalbody:
                    self.visit(child)
    
            def visit_Import(self, node):
                target = self.optional if self._is_optional() else self.found
                for alias in node.names:
                    target.add(alias.name.split(".")[0])
    
            def visit_ImportFrom(self, node):
                if node.module and node.level == 0:
                    target = self.optional if self._is_optional() else self.found
                    target.add(node.module.split(".")[0])
    
            def visit_Call(self, node):
                func = node.func
                func_name = ""
                if isinstance(func, ast.Name):
                    func_name = func.id
                elif isinstance(func, ast.Attribute):
                    func_name = func.attr
                if func_name in ("import_module", "__import__"):
                    if node.args and isinstance(node.args[0], ast.Constant):
                        val = node.args[0].value
                        if isinstance(val, str):
                            self.dynamic.add(val.split(".")[0])
                self.generic_visit(node)
    
        found_imports = set()
        optional_imports = set()
        dynamic_imports = set()
    
        for py_file in py_files:
            try:
                with open(py_file, "r", encoding="utf-8", errors="replace") as f:
                    source = f.read()
                tree = ast.parse(source, filename=py_file)
                collector = _ImportCollector()
                collector.visit(tree)
                found_imports.update(collector.found)
                optional_imports.update(collector.optional)
                if depth == "deep":
                    dynamic_imports.update(collector.dynamic)
            except Exception:
                continue
    
        # 合并动态导入
        found_imports.update(dynamic_imports)
    
        # 过滤掉标准库和本地模块
        local_modules = {"libertas"}
        for d in os.listdir(libertas_dir):
            full = os.path.join(libertas_dir, d)
            if os.path.isdir(full) and os.path.isfile(os.path.join(full, "__init__.py")):
                local_modules.add(d)
    
        third_party = set()
        optional_party = set()
        for mod in found_imports:
            if mod in self._STDLIB_MODULES or mod in local_modules:
                continue
            if mod.startswith("_"):
                continue
            third_party.add(mod)
        for mod in optional_imports:
            if mod in self._STDLIB_MODULES or mod in local_modules:
                continue
            if mod.startswith("_"):
                continue
            # 可选导入：如果不在必需集合中，标记为可选
            if mod not in third_party:
                optional_party.add(mod)
    
        # 读取已安装的包列表（用于验证和获取版本）
        installed = self._get_installed_packages()
    
        # 分类结果
        hidden_imports = []
        collect_all = []
        missing = []
        for mod in sorted(third_party | optional_party):
            pkg_name = self._IMPORT_TO_PACKAGE.get(mod, mod)
            ver = installed.get(pkg_name.lower(), installed.get(mod.lower(), ""))
            is_optional = mod in optional_party and mod not in third_party
            entry = {
                "module": mod,
                "package": pkg_name,
                "version": ver,
                "installed": bool(ver),
                "collect_all": pkg_name in self._COLLECT_ALL_PACKAGES,
                "optional": is_optional,
                "source": "import_scan",
            }
            if entry["collect_all"]:
                collect_all.append(entry)
            else:
                hidden_imports.append(entry)
            # 可选依赖缺失不算错误，只标记
            if not ver and not is_optional:
                missing.append(entry)
    
        # 读取 pyproject.toml 中声明但代码扫描可能遗漏的
        pyproject_path = os.path.join(self.project_root, "pyproject.toml")
        toml_deps = []
        if os.path.isfile(pyproject_path):
            toml_deps = self._parse_pyproject_deps(pyproject_path)
        for dep in toml_deps:
            pkg_lower = dep.lower()
            if pkg_lower not in {h["package"].lower() for h in hidden_imports} and \
               pkg_lower not in {c["package"].lower() for c in collect_all}:
                ver = installed.get(pkg_lower, "")
                entry = {
                    "module": dep.replace("-", "_"),
                    "package": dep,
                    "version": ver,
                    "installed": bool(ver),
                    "collect_all": dep in self._COLLECT_ALL_PACKAGES,
                    "source": "pyproject.toml",
                }
                if entry["collect_all"]:
                    collect_all.append(entry)
                else:
                    hidden_imports.append(entry)
    
        return {
            "success": True,
            "depth": depth,
            "scanned_files": len(py_files),
            "hidden_imports": hidden_imports,
            "collect_all": collect_all,
            "missing": missing,
            "toml_dependencies": toml_deps,
        }

    @staticmethod
    def _get_installed_packages() -> Dict[str, str]:
        """获取已安装的包名→版本映射"""
        result = {}
        try:
            from importlib.metadata import distributions
            for dist in distributions():
                name = (dist.metadata.get("Name") or "").lower()
                ver = dist.version or ""
                if name:
                    result[name] = ver
        except Exception:
            pass
        return result

    def detect_dependencies(self, depth: str = "standard",
                            custom_toml: str = "") -> Dict:
        """综合依赖检测：代码扫描 + pyproject.toml + 自定义toml + 已保存配置
    
        Args:
            depth: minimal / standard / deep
            custom_toml: 自定义 toml 文件路径（上传的）
        """
        # 1. 代码扫描
        scan = self.scan_imports(depth)
    
        # 2. 自定义 toml
        custom_deps = []
        if custom_toml and os.path.isfile(custom_toml):
            custom_deps = self._parse_pyproject_deps(custom_toml)
    
        # 3. 合并所有来源
        all_packages = {}  # package_lower -> entry
        for entry in scan.get("hidden_imports", []) + scan.get("collect_all", []):
            all_packages[entry["package"].lower()] = entry
        for dep in custom_deps:
            key = dep.lower()
            if key not in all_packages:
                installed = self._get_installed_packages()
                all_packages[key] = {
                    "module": dep.replace("-", "_"),
                    "package": dep,
                    "version": installed.get(key, ""),
                    "installed": key in installed,
                    "collect_all": dep in self._COLLECT_ALL_PACKAGES,
                    "source": "custom_toml",
                }
            else:
                all_packages[key]["source"] += "+custom_toml"
    
        # 4. 已保存的选择状态
        saved = self.load_dep_config()
        selected = saved.get("selected", {})
        for key, entry in all_packages.items():
            if key in selected:
                entry["enabled"] = selected[key]
            else:
                entry["enabled"] = True  # 默认启用
    
        # 5. 分类
        hidden = [e for e in all_packages.values() if not e["collect_all"]]
        collect = [e for e in all_packages.values() if e["collect_all"]]
        missing = [e for e in all_packages.values() if not e["installed"]]
    
        # 6. minimal 档裁剪预览（仅用于前端展示，传副本避免污染构建清单）
        preview_hidden = [e["module"] for e in hidden if e.get("enabled", True)]
        preview_collect = [e["package"] for e in collect if e.get("enabled", True)]
        excludes = self._resolve_excludes(depth, preview_hidden, preview_collect)
    
        return {
            "success": True,
            "depth": depth,
            "scanned_files": scan.get("scanned_files", 0),
            "hidden_imports": sorted(hidden, key=lambda x: x["package"].lower()),
            "collect_all": sorted(collect, key=lambda x: x["package"].lower()),
            "missing": sorted(missing, key=lambda x: x["package"].lower()),
            "excludes": excludes,
            "trim_enabled": bool(excludes),
            "custom_toml": custom_toml,
            "custom_toml_deps": custom_deps,
            "total": len(all_packages),
        }

    def get_build_dependencies(self, depth: str = "standard",
                               custom_toml: str = "") -> Tuple[List[str], List[str], List[str]]:
        """获取最终用于 PyInstaller 的 (hidden_imports, collect_all, excludes) 列表
    
        excludes 仅在 depth == "minimal" 时非空；standard/deep 保持原有全量行为。
        """
        deps = self.detect_dependencies(depth, custom_toml)
        hidden = [e["module"] for e in deps["hidden_imports"] if e.get("enabled", True)]
        collect = [e["package"] for e in deps["collect_all"] if e.get("enabled", True)]
        excludes = self._resolve_excludes(depth, hidden, collect)
        return hidden, collect, excludes

    def _resolve_excludes(self, depth: str,
                          hidden: List[str], collect: List[str]) -> List[str]:
        """计算 PyInstaller --exclude-module 清单。
    
        规则：
          1. 只有 minimal 档才裁剪，standard/deep 返回空（行为与改动前完全一致）；
          2. _MINIMAL_KEEP 里的运行时底座永不排除，即使被用户取消勾选；
          3. 只排除 _MINIMAL_EXCLUDES 中已核实的 0 引用包与 try 软依赖包，
             不做「按名字猜」的激进裁剪，避免产出启动即崩的构建；
          4. 用户在依赖面板显式取消勾选（enabled=False）的包，只要不在 KEEP 白名单，
             一并纳入排除——这才让界面上的勾选真正影响产物。
        """
        if depth != "minimal":
            return []
    
        # 注意：--exclude-module 匹配真实模块名，大小写敏感（如 PIL._tkinter_finder）。
        # 因此输出必须保留原始写法，只在做白名单/去重比对时才转小写。
        keep_lower = {k.lower() for k in self._MINIMAL_KEEP}
    
        wanted = {}  # lower -> 原始写法
        for m in self._MINIMAL_EXCLUDES:
            wanted[m.lower()] = m
    
        # 用户显式取消勾选的包
        saved = self.load_dep_config()
        for key, on in (saved.get("selected") or {}).items():
            if on is False:
                wanted.setdefault(str(key).lower(), str(key))
    
        excludes = sorted(orig for low, orig in wanted.items() if low not in keep_lower)
    
        # 排除项不应同时出现在收集/隐藏清单里，否则 PyInstaller 会自相矛盾
        self._prune_excluded(hidden, excludes)
        self._prune_excluded(collect, excludes)
        return excludes

    @staticmethod
    def _is_excluded(name: str, excludes_lower: set) -> bool:
        """判断模块名是否被排除。
    
        规则是「自身被排除」或「它是被排除包的子模块」，方向不可反：
          - 排除 jieba          → jieba、jieba.analyse 都剔除
          - 排除 PIL._tkinter_finder → 只剔除该子模块，PIL 本体必须保留
        若按包名首段比对，排除 PIL 的子模块会误伤 PIL（16 处顶层硬 import）。
        """
        low = str(name).lower()
        if low in excludes_lower:
            return True
        return any(low.startswith(e + ".") for e in excludes_lower)

    @classmethod
    def _prune_excluded(cls, names: List[str], excludes: List[str]) -> None:
        """就地移除与排除清单冲突的条目。"""
        if not excludes:
            return
        excl_lower = {str(e).lower() for e in excludes}
        for i in range(len(names) - 1, -1, -1):
            if cls._is_excluded(names[i], excl_lower):
                del names[i]

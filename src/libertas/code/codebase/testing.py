"""代码库模块职责：testing。"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Type, Union

from libertas.foundation.byte_stream import safe_decode
from libertas.foundation.terminal import terminal

class TestRunner:
    """测试生成与运行 - 单元测试生成、测试运行、覆盖率"""

    def __init__(self, project_root: str = ""):
        self.runner_id = f"test_{uuid.uuid4().hex[:8]}"
        self.project_root = project_root
        self.test_results: List[Dict[str, Any]] = []
        self._lock = threading.RLock()

    def run_tests(self, test_path: str = "", test_pattern: str = "test_*.py",
                  timeout: int = 300) -> Dict[str, Any]:
        """运行测试

        环境里没装 pytest 时自动回退到标准库 unittest —— 否则「运行测试」在用户
        机器上只会返回 "No module named pytest"，什么都做不了。
        另外 -k 是「用例名表达式」，不能拿 test_*.py 这种文件通配当表达式用。
        """
        import importlib.util as _ilu
        _has_pytest = _ilu.find_spec("pytest") is not None
        _path = test_path or "."
        start_time = time.time()
        # 路径与通配都要加引号：shell=True 下 cwd 正好是项目目录时，
        # `-p test_*.py` 会被 shell 展开成多个文件名，第二个被当成 start dir →
        # "Start directory is not importable" 直接崩掉。
        _q = lambda v: "'" + str(v).replace("'", "'\\''") + "'"
        if _has_pytest:
            cmd = f"python -m pytest {_q(_path)} -v --tb=short"
            if test_pattern and "*" not in test_pattern:
                cmd += f" -k {_q(test_pattern)}"
        else:
            cmd = f"python -m unittest discover -s {_q(_path)} -v"
            cmd += f" -p {_q(test_pattern or 'test_*.py')}"

        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                cwd=self.project_root or ".", timeout=timeout + 60,
                encoding='utf-8', errors='replace'
            )
            output = proc.stdout + proc.stderr
            if _has_pytest:
                passed, failed, errors = self._parse_pytest_output(output)
            else:
                # unittest 汇总行：Ran N test(s)  +  OK / FAILED (failures=N, errors=M)
                _ran = re.search(r"Ran (\d+) test", output)
                _total = int(_ran.group(1)) if _ran else 0
                _fm = re.search(r"failures=(\d+)", output)
                _em = re.search(r"errors=(\d+)", output)
                failed = int(_fm.group(1)) if _fm else 0
                errors = int(_em.group(1)) if _em else 0
                passed = max(0, _total - failed - errors)

            result = {
                "command": cmd,
                "runner": "pytest" if _has_pytest else "unittest",
                "return_code": proc.returncode,
                "passed": passed,
                "failed": failed,
                "errors": errors,
                "total": passed + failed + errors,
                "output": output[-5000:],
                "duration_ms": (time.time() - start_time) * 1000,
                "success": proc.returncode == 0,
            }
            if not _has_pytest:
                result["note"] = ("环境未安装 pytest，已回退到标准库 unittest；"
                                  "unittest 只识别 TestCase 子类，pytest 风格的裸 test_ 函数不会被发现。")
            if _has_pytest is False and (result.get("total") or 0) == 0:
                result["note"] += " 本次未发现任何用例，请确认测试文件或安装 pytest。"

        except subprocess.TimeoutExpired:
            result = {
                "command": cmd,
                "return_code": -1,
                "passed": 0, "failed": 0, "errors": 0, "total": 0,
                "output": "测试执行超时",
                "duration_ms": (time.time() - start_time) * 1000,
                "success": False,
                "timeout": True,
            }
        except Exception as e:
            result = {
                "command": cmd,
                "return_code": -1,
                "passed": 0, "failed": 0, "errors": 0, "total": 0,
                "output": str(e),
                "duration_ms": (time.time() - start_time) * 1000,
                "success": False,
            }

        with self._lock:
            self.test_results.append(result)
        return result

    def run_unittest(self, test_module: str = "") -> Dict[str, Any]:
        """运行unittest"""
        cmd = f"python -m unittest {test_module} -v"
        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                cwd=self.project_root or ".", timeout=120,
                encoding='utf-8', errors='replace'
            )
            return {
                "command": cmd,
                "return_code": proc.returncode,
                "output": proc.stdout + proc.stderr,
                "success": proc.returncode == 0,
            }
        except Exception as e:
            return {"command": cmd, "return_code": -1, "output": str(e), "success": False}

    def generate_test_template(self, module_path: str,
                                class_name: str = "") -> str:
        """生成测试模板"""
        test_code = f'''"""
测试模块: {module_path}
自动生成测试模板
"""
import sys
import os
import unittest
from unittest.mock import Mock, patch, MagicMock

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Test{class_name or 'Module'}(unittest.TestCase):
    """{class_name or '模块'}测试类"""

    def setUp(self):
        """测试前准备"""
        pass

    def tearDown(self):
        """测试后清理"""
        pass

    def test_import(self):
        """测试模块导入"""
        try:
            import {module_path.replace('/', '.').replace('.py', '')}
            self.assertTrue(True)
        except ImportError as e:
            self.fail(f"模块导入失败: {{e}}")

    def test_basic_functionality(self):
        """测试基本功能"""
        # TODO: 添加具体测试
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
'''
        return test_code

    def _parse_pytest_output(self, output: str) -> Tuple[int, int, int]:
        """解析pytest输出"""
        passed = failed = errors = 0
        # 匹配结果行
        match = re.search(r'(\d+)\s+passed', output)
        if match:
            passed = int(match.group(1))
        match = re.search(r'(\d+)\s+failed', output)
        if match:
            failed = int(match.group(1))
        match = re.search(r'(\d+)\s+error', output)
        if match:
            errors = int(match.group(1))
        return passed, failed, errors

    def get_test_history(self, limit: int = 10) -> List[Dict]:
        return list(reversed(self.test_results))[-limit:]

class BuildVerifier:
    """构建与运行验证 - make/cmake/pip/npm/直接运行"""

    def __init__(self, project_root: str = ""):
        self.verifier_id = f"build_{uuid.uuid4().hex[:8]}"
        self.project_root = project_root
        self.build_results: List[Dict[str, Any]] = []

    def detect_build_system(self) -> List[str]:
        """检测项目使用的构建系统"""
        systems = []
        indicators = {
            "Makefile": "make",
            "CMakeLists.txt": "cmake",
            "setup.py": "python_setup",
            "pyproject.toml": "python_poetry",
            "package.json": "npm",
            "go.mod": "go",
            "Cargo.toml": "rust",
            "pom.xml": "maven",
            "build.gradle": "gradle",
        }
        for filename, system in indicators.items():
            if os.path.exists(os.path.join(self.project_root or ".", filename)):
                systems.append(system)
        return systems

    def build(self, build_system: str = "", target: str = "") -> Dict[str, Any]:
        """执行构建"""
        if not build_system:
            systems = self.detect_build_system()
            if not systems:
                return {"success": False, "error": "未检测到构建系统"}
            build_system = systems[0]

        commands = {
            "make": f"make {target}",
            "cmake": f"cmake -B build && cmake --build build {target}",
            "python_setup": "python setup.py build",
            "python_poetry": "poetry build",
            "npm": "npm run build",
            "go": "go build ./...",
            "rust": "cargo build",
            "maven": "mvn clean package",
            "gradle": "gradle build",
        }
        cmd = commands.get(build_system, "")
        if not cmd:
            return {"success": False, "error": f"不支持的构建系统: {build_system}"}

        return self._run_command(cmd, "build")

    def run(self, entry_point: str = "", args: str = "",
            timeout: int = 30) -> Dict[str, Any]:
        """运行项目"""
        if not entry_point:
            # 自动检测入口
            entry_point = self._detect_entry_point()
        if not entry_point:
            return {"success": False, "error": "未找到入口点"}

        cmd = f"python {entry_point} {args}".strip()
        return self._run_command(cmd, "run", timeout)

    def check_syntax(self, file_path: str = "") -> Dict[str, Any]:
        """检查Python语法"""
        if file_path:
            cmd = f"python -m py_compile {file_path}"
            return self._run_command(cmd, "syntax_check")
        else:
            # 检查整个项目
            cmd = 'python -c "import py_compile, os; [py_compile.compile(os.path.join(r,f), doraise=True) for r,d,fs in os.walk(\'.\') for f in fs if f.endswith(\'.py\') and \'__pycache__\' not in r]"'
            return self._run_command(cmd, "syntax_check_all")

    def check_imports(self, module_path: str = "") -> Dict[str, Any]:
        """检查模块导入"""
        if module_path:
            cmd = f"python -c \"import {module_path}\""
        else:
            cmd = 'python -c "import libertas"'
        return self._run_command(cmd, "import_check")

    def _detect_entry_point(self) -> str:
        """检测项目入口点"""
        candidates = ["main.py", "app.py", "run.py", "server.py",
                      "libertas/main.py", "libertas/app.py"]
        for candidate in candidates:
            path = os.path.join(self.project_root or ".", candidate)
            if os.path.exists(path):
                return candidate
        return ""

    def _run_command(self, cmd: str, action: str,
                     timeout: int = 120) -> Dict[str, Any]:
        start_time = time.time()
        try:
            proc = subprocess.run(
                cmd, shell=True, capture_output=True, text=True,
                cwd=self.project_root or ".", timeout=timeout,
                encoding='utf-8', errors='replace'
            )
            result = {
                "action": action,
                "command": cmd,
                "return_code": proc.returncode,
                "stdout": proc.stdout[-3000:],
                "stderr": proc.stderr[-3000:],
                "success": proc.returncode == 0,
                "duration_ms": (time.time() - start_time) * 1000,
            }
        except subprocess.TimeoutExpired:
            result = {
                "action": action,
                "command": cmd,
                "return_code": -1,
                "stdout": "",
                "stderr": "命令执行超时",
                "success": False,
                "timeout": True,
                "duration_ms": (time.time() - start_time) * 1000,
            }
        except Exception as e:
            result = {
                "action": action,
                "command": cmd,
                "return_code": -1,
                "stdout": "",
                "stderr": str(e),
                "success": False,
                "duration_ms": (time.time() - start_time) * 1000,
            }
        self.build_results.append(result)
        return result

    def get_build_history(self, limit: int = 10) -> List[Dict]:
        return list(reversed(self.build_results))[-limit:]

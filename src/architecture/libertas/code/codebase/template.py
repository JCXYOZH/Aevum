"""代码库模块职责：template。"""

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

class CodeTemplateGenerator:
    """代码模板生成器 - 生成常用代码结构模板"""

    def __init__(self):
        self.templates = {}
        self._init_templates()

    def _init_templates(self):
        self.templates["python_class"] = (
            "class {class_name}:\n"
            '    """{description}"""\n\n'
            "    def __init__(self, {init_params}):\n"
            "        {init_body}\n\n"
            "    def {method_name}(self, {method_params}):\n"
            '        """{method_description}"""\n'
            "        {method_body}\n"
        )
        self.templates["python_function"] = (
            "def {function_name}({params}) -> {return_type}:\n"
            '    """{description}\n\n'
            "    Args:\n"
            "        {args_doc}\n\n"
            "    Returns:\n"
            "        {returns_doc}\n"
            '    """\n'
            "    {body}\n"
        )
        self.templates["python_module"] = (
            '"""\n'
            "{module_name}.py - {description}\n"
            '"""\n'
            "import os\nimport sys\nimport json\nimport time\n"
            "from typing import Any, Dict, List, Optional, Tuple\n\n\n"
            "class {main_class}:\n"
            '    """{main_class_description}"""\n\n'
            "    def __init__(self):\n"
            "        pass\n\n"
            "    def run(self):\n"
            '        """主入口"""\n'
            "        pass\n\n\n"
            "def main():\n"
            '    """主函数"""\n'
            "    app = {main_class}()\n"
            "    app.run()\n\n\n"
            'if __name__ == "__main__":\n'
            "    main()\n"
        )
        self.templates["python_dataclass"] = (
            "from dataclasses import dataclass, field\n"
            "from typing import List, Dict, Optional\n\n\n"
            "@dataclass\n"
            "class {class_name}:\n"
            '    """{description}"""\n'
            "    {fields}\n"
        )
        self.templates["python_cli"] = (
            "import argparse\nimport sys\n\n\n"
            "def main():\n"
            '    parser = argparse.ArgumentParser(description="{description}")\n'
            '    parser.add_argument("--input", "-i", required=True, help="输入文件")\n'
            '    parser.add_argument("--output", "-o", help="输出文件")\n'
            '    parser.add_argument("--verbose", "-v", action="store_true", help="详细输出")\n'
            "    args = parser.parse_args()\n"
            "    {body}\n\n\n"
            'if __name__ == "__main__":\n'
            "    main()\n"
        )

    def generate(self, template_name, **kwargs):
        template = self.templates.get(template_name)
        if not template:
            return f"# 错误: 未找到模板 '{template_name}'\n# 可用模板: {', '.join(self.list_templates())}"
        try:
            return template.format(**kwargs)
        except KeyError as e:
            return f"# 错误: 缺少参数 {e}\n# 请提供所需参数"

    def list_templates(self):
        return list(self.templates.keys())

    def generate_class(self, class_name, description="", methods=None):
        methods = methods or ["method1", "method2"]
        method_code = ""
        for m in methods:
            method_code += (
                f"\n    def {m}(self):\n"
                f'        """{m}方法"""\n'
                "        pass\n"
            )
        return (
            f"class {class_name}:\n"
            f'    """{description or class_name}"""\n\n'
            "    def __init__(self):\n"
            "        pass\n"
            f"{method_code}\n"
        )

    def add_custom_template(self, name, template):
        self.templates[name] = template

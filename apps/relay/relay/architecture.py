# ============================================================
# relay/architecture.py — 依赖方向与导入风格的机器校验
#
# 两条方法论在这里落成可执行的检查：
#   一、锚点定标：只允许 `from relay.x import ...`，禁止相对导入，
#       禁止 sys.path.append('../../') 这类补丁。
#   二、单向依赖：每个模块有唯一层级，只能导入层级更低的模块。
#
# 构建期：python -m relay.architecture   （违规 → 0x070303，退出码 1）
# 启动期：bootstrap 调用 assert_clean()  （违规 → 直接拒绝启动）
#
# 依赖：codes（0 层）、errors（1 层）；本模块属第 2 层。
# ============================================================
from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

from relay.codes import ERR_R7_DEPENDENCY_UNMET, error_hex
from relay.errors import RelayFault

# 层号越小越底层。同一层之间不允许互相导入（避免平级耦合）。
LAYERS = {
    "relay.codes": 0,
    "relay.errors": 1,
    "relay.architecture": 2,
    "relay.contract_export": 2,
    "relay.memory": 2,
    "relay.transfer": 2,
    "relay.server": 3,
    "relay.engine": 4,
    "relay.bootstrap": 5,
    "relay.__main__": 6,
    "relay.__init__": 0,
}

LAYER_NAMES = {
    0: "契约",
    1: "失败表示",
    2: "域层（记忆/传输/架构校验）",
    3: "服务层（HTTP）",
    4: "装配层",
    5: "启动自检",
    6: "进程入口",
}


@dataclass(frozen=True)
class Violation:
    module: str
    line: int
    kind: str
    detail: str

    def render(self) -> str:
        return f"{error_hex(ERR_R7_DEPENDENCY_UNMET)} {self.kind} {self.module}:{self.line} {self.detail}"


def imports_from_source(source: str, filename: str = "<synthetic>") -> List[tuple]:
    """返回 [(目标模块, 行号, 是否相对)]。"""
    tree = ast.parse(source, filename=filename)
    found: List[tuple] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.append((alias.name, node.lineno, False))
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                found.append(("." * node.level + (node.module or ""), node.lineno, True))
            elif node.module:
                found.append((node.module, node.lineno, False))
    return found


def _imports(path: Path) -> List[tuple]:
    """读文件版的 imports_from_source，供外层工具与测试复用。"""
    return imports_from_source(path.read_text(encoding="utf-8"), filename=str(path))


def sys_path_patches(source: str) -> List[int]:
    """抓 sys.path.append / insert 这类绕过锚点的写法。"""
    tree = ast.parse(source)
    hits: List[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr not in ("append", "insert"):
            continue
        if not isinstance(func.value, ast.Attribute) or func.value.attr != "path":
            continue
        if isinstance(func.value.value, ast.Name) and func.value.value.id == "sys":
            hits.append(node.lineno)
    return hits


def check_source(module: str, source: str) -> List[Violation]:
    violations: List[Violation] = []
    own_layer = LAYERS.get(module)
    if own_layer is None:
        violations.append(Violation(module, 0, "未登记层级", f"{module} 不在 LAYERS 表里"))

    for lineno in sys_path_patches(source):
        violations.append(Violation(module, lineno, "锚点被绕过", "sys.path 被改写"))

    for target, lineno, relative in imports_from_source(source):
        if relative:
            violations.append(Violation(module, lineno, "相对导入", f"{target} 必须改成 from relay.* 绝对导入"))
            continue
        if not target.startswith("relay."):
            continue  # 标准库与第三方不参与分层
        target_layer = LAYERS.get(target)
        if target_layer is None:
            violations.append(Violation(module, lineno, "未知包内模块", f"{target} 没有登记层级"))
            continue
        if own_layer is not None and target_layer >= own_layer:
            violations.append(
                Violation(
                    module, lineno, "依赖方向违规",
                    f"{module}(L{own_layer}) 导入了 {target}(L{target_layer})；只允许导入更低层",
                )
            )
    return violations


def check(root: Path | None = None, extra: Iterable[tuple] = ()) -> List[Violation]:
    """扫描包内所有 .py；extra 可传入 (module, source) 做反向验证。"""
    root = root or Path(__file__).resolve().parent
    violations: List[Violation] = []
    for path in sorted(root.glob("*.py")):
        violations.extend(check_source("relay." + path.stem, path.read_text(encoding="utf-8")))
    for module, source in extra:
        violations.extend(check_source(module, source))
    return violations


def assert_clean() -> None:
    violations = check()
    if not violations:
        return
    detail = "；".join(v.render() for v in violations[:6])
    if len(violations) > 6:
        detail += f"；另有 {len(violations) - 6} 条"
    raise RelayFault(ERR_R7_DEPENDENCY_UNMET, detail, subject="relay.architecture")


def report() -> str:
    violations = check()
    if not violations:
        total = len(list(Path(__file__).resolve().parent.glob("*.py")))
        return f"OK {total} 个模块，层级与导入风格均符合契约"
    return "\n".join(v.render() for v in violations)


def main() -> int:
    violations = check()
    if not violations:
        print(report())
        return 0
    for v in violations:
        print(v.render())
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

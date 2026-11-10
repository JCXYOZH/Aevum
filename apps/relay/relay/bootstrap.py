# ============================================================
# relay/bootstrap.py — 启动自检（DAG 第 5 层）
#
# 方法论四的落点：装载失败必须可定位、带 0xRRFFTT，而不是黑盒崩溃。
#
#   0x070101  R7 模块缺失      —— 声明的模块根本不存在
#   0x070202  R7 契约冲突      —— 两份契约 magic/version 不一致，或同名重复
#   0x070303  R7 依赖未满足    —— 层级违规，或某个依赖（含第三方）缺失
#   0x070404  R7 运行时失败    —— 解释器/环境问题，模块代码执行期抛异常
#
# 顺序也是契约：契约 → 模块 → 层级 → 装配。前面一步失败就不进入下一步。
# ============================================================
from __future__ import annotations

import importlib
import json
import logging
from pathlib import Path
from typing import Dict, List

from relay.architecture import assert_clean
from relay.codes import (
    CONTRACT_SHA256,
    ERR_R7_CONTRACT_CONFLICT,
    ERR_R7_DEPENDENCY_UNMET,
    ERR_R7_MODULE_MISSING,
    ERR_R7_RUNTIME_FAILED,
    MAGIC,
    VERSION,
)
from relay.errors import RelayFault

logger = logging.getLogger(__name__)

API_CONTRACT = Path(__file__).resolve().parents[1] / "contracts" / "api.json"

# 加载顺序 = 依赖顺序，从底到顶
EXPECTED_MODULES = (
    "relay.codes",
    "relay.errors",
    "relay.architecture",
    "relay.memory",
    "relay.transfer",
    "relay.server",
    "relay.engine",
)


def load_api_contract() -> dict:
    if not API_CONTRACT.is_file():
        raise RelayFault(ERR_R7_MODULE_MISSING, f"契约文件缺失: {API_CONTRACT}", subject="contracts/api.json")
    try:
        raw = json.loads(API_CONTRACT.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RelayFault(ERR_R7_RUNTIME_FAILED, f"契约无法解析: {exc}", subject="contracts/api.json") from exc
    if not isinstance(raw, dict):
        raise RelayFault(ERR_R7_RUNTIME_FAILED, "契约顶层必须是对象", subject="contracts/api.json")
    return raw


def check_contract_conflict(api: dict) -> None:
    api_magic = str(api.get("magic", ""))
    api_version = int(api.get("version", 0) or 0)
    if api_magic != MAGIC or api_version != VERSION:
        raise RelayFault(
            ERR_R7_CONTRACT_CONFLICT,
            f"errors.json={MAGIC}/{VERSION}  api.json={api_magic}/{api_version}  sha256={CONTRACT_SHA256[:12]}",
            subject="contracts",
        )


def import_modules() -> Dict[str, object]:
    loaded: Dict[str, object] = {}
    for name in EXPECTED_MODULES:
        try:
            loaded[name] = importlib.import_module(name)
        except ModuleNotFoundError as exc:
            # missing.name == name：声明的模块本身不存在（0x01）
            # 否则是它的某个依赖缺失（0x03）
            if getattr(exc, "name", "") == name:
                raise RelayFault(ERR_R7_MODULE_MISSING, f"模块不存在: {name}", subject=name) from exc
            raise RelayFault(
                ERR_R7_DEPENDENCY_UNMET,
                f"{name} 的依赖缺失: {getattr(exc, 'name', exc)}",
                subject=name,
            ) from exc
        except ImportError as exc:  # 循环导入、版本不符等
            raise RelayFault(ERR_R7_DEPENDENCY_UNMET, f"{name}: {exc}", subject=name) from exc
        except Exception as exc:  # 模块顶层代码执行失败
            raise RelayFault(ERR_R7_RUNTIME_FAILED, f"{name}: {exc!r}", subject=name) from exc
    return loaded


def verify_layers() -> None:
    assert_clean()  # 违规时抛 ERR_R7_DEPENDENCY_UNMET


def describe() -> List[str]:
    return [
        f"contract {MAGIC}/{VERSION} sha256={CONTRACT_SHA256[:12]}",
        f"modules {len(EXPECTED_MODULES)} -> {', '.join(EXPECTED_MODULES)}",
        "layers: 0 契约 / 1 失败表示 / 2 域层 / 3 服务层 / 4 装配 / 5 自检 / 6 入口",
    ]


def start(
    *,
    session_ttl: int = 600,
    max_turns: int = 20,
    max_sessions: int = 2000,
    transfer_ttl: int = 120,
    max_transfers: int = 128,
    token: str = "",
    selfcheck: bool = True,
):
    """完成自检并装配出一个 RelayEngine；任一步失败都抛带码的 RelayFault。"""
    api = load_api_contract()
    check_contract_conflict(api)
    loaded = import_modules()
    if selfcheck:
        verify_layers()
        logger.info("启动自检通过：%s", " | ".join(describe()))

    engine_module = loaded.get("relay.engine")
    if engine_module is None:  # 理论上不可达，保留显式失败
        raise RelayFault(ERR_R7_MODULE_MISSING, "装配层未加载", subject="relay.engine")

    try:
        return engine_module.RelayEngine(  # type: ignore[attr-defined]
            session_ttl=session_ttl,
            max_turns=max_turns,
            max_sessions=max_sessions,
            transfer_ttl=transfer_ttl,
            max_transfers=max_transfers,
            token=token,
        )
    except RelayFault:
        raise
    except Exception as exc:
        raise RelayFault(ERR_R7_RUNTIME_FAILED, f"装配失败: {exc!r}", subject="relay.engine") from exc


def main() -> int:
    """python -m relay.bootstrap 只做自检，不启服务。"""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        api = load_api_contract()
        check_contract_conflict(api)
        import_modules()
        verify_layers()
    except RelayFault as exc:
        print(exc.render())
        return 1
    print("自检通过")
    for line in describe():
        print("  " + line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

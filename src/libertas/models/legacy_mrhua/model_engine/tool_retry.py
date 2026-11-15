from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .prompt_context import *  # noqa: F401,F403
from .prompt_settings import *  # noqa: F401,F403
from .message_safety import *  # noqa: F401,F403
from .cloud_api import *  # noqa: F401,F403
from .cloud_api import ModelEngineCloudAPI  # noqa: F401

class ModelEngineToolRetry(object):
    @staticmethod
    def should_retry_after_tool_failure(fail_state: dict, round_tool_calls,
                                        round_error, total_calls: int,
                                        max_calls: int = 0, max_retries: int = 0) -> bool:
        """工具失败后是否应该让模型「调整并重试」而不是收尾。

        判据（全部满足）：
          - 本轮模型没有再发起工具调用（它打算给结论了）；
          - 本轮请求本身没出错；
          - 最近一次工具调用是失败的；
          - 这个「工具 + 错误原因」组合还没重试过（同一失败不反复催）；
          - 本轮的失败重试次数还没到上限（默认不设次数上限，允许 curl→wget→内置 这种连续换招）；
          - 还有工具调用预算（预算为 0 表示不限制）。
        抽成独立函数是为了让这条产品逻辑可被单测直接验证（不必跑真实模型）。
        """
        state = fail_state or {}
        if round_tool_calls or round_error:
            return False
        if not state.get("failed"):
            return False
        try:
            if max_calls and int(total_calls) >= int(max_calls):
                return False
            if max_retries and int(state.get("retries", 0)) >= int(max_retries):
                return False
        except (TypeError, ValueError):
            return False
        sig = (str(state.get("tool") or ""), str(state.get("error") or "")[:120])
        attempts = state.get("attempts") or {}
        return sig not in attempts
    @staticmethod
    def _neutralize_control_blocks(text: str) -> str:
        """保留原文本；不再改写系统提示词或绕过安全策略。"""
        return text
    @staticmethod
    def _neutralize_messages(messages):
        """只对 system 消息做中性化，其余消息原样返回。"""
        out = []
        for _m in messages or []:
            if (isinstance(_m, dict) and _m.get("role") == "system"
                    and isinstance(_m.get("content"), str)):
                _m = dict(_m)
                _m["content"] = ModelEngineToolRetry._neutralize_control_blocks(_m["content"])
            out.append(_m)
        return out
    @staticmethod
    def _strip_control_blocks_from_messages(messages):
        """对 system 消息剥离控制块，其余消息原样返回。"""
        out = []
        for _m in messages or []:
            if (isinstance(_m, dict) and _m.get("role") == "system"
                    and isinstance(_m.get("content"), str)):
                _m = dict(_m)
                _m["content"] = ModelEngineCloudAPI._strip_control_blocks(_m["content"])
            out.append(_m)
        return out
    @staticmethod
    def _coerce_model_list(value: Any) -> List[str]:
        """把字符串/列表/元组统一成模型名列表，支持 JSON 列表与逗号分隔。"""
        if value is None:
            return []
        if isinstance(value, (list, tuple, set)):
            items = []
            for item in value:
                items.extend(ModelEngineToolRetry._coerce_model_list(item))
            return items
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("[") and text.endswith("]"):
                try:
                    parsed = json.loads(text)
                    return ModelEngineToolRetry._coerce_model_list(parsed)
                except Exception:
                    pass
            parts = re.split(r"[,;|\n]+", text)
            result = []
            for part in parts:
                item = part.strip().strip("'\"")
                if item:
                    result.append(item)
            return result
        return [str(value).strip()]
    def _resolve_local_model_candidates(self) -> List[str]:
        """解析本地模型候选列表，支持单路径 / 多路径 / 逗号分隔。"""
        candidates: List[str] = []
        seen = set()
        raw_candidates = []

        model_config = self.configuration.get("模型", {}) if self.configuration else {}
        raw_candidates.extend(self._coerce_model_list(self.model_path))
        raw_candidates.extend(self._coerce_model_list(model_config.get("主模型路径", "")))
        from libertas.foundation.config import config as global_config
        raw_candidates.extend(self._coerce_model_list(global_config.get("model_path", "")))

        for value in raw_candidates:
            expanded = os.path.expanduser(value).strip()
            if not expanded:
                continue
            if os.path.isdir(expanded):
                normalized = os.path.normpath(expanded)
            else:
                normalized = os.path.normpath(expanded)
            if normalized not in seen:
                seen.add(normalized)
                candidates.append(normalized)

        if not candidates:
            base_path = os.path.expanduser((self.model_path or "").strip())
            if base_path:
                candidates = [os.path.normpath(base_path)]
        return candidates
    def _get_cloud_providers(self):
        """获取可用的云端API提供商列表（按优先级排序）。
        支持云端多模型并发池：单个模型、列表模型或多端点配置都能统一管理。
        严格模式下，允许列表会锁定到本地配置的模型，不允许自动切到其他英语或备用模型。
        """
        from libertas.foundation.config import config as global_config
        providers = []
        seen = set()

        model_config = self.configuration.get("模型", {}) if self.configuration else {}
        endpoint_candidates = self._coerce_model_list(model_config.get("云端接口地址", ""))
        api_key_candidates = self._coerce_model_list(model_config.get("云端API密钥", ""))
        model_candidates = self._coerce_model_list(model_config.get("云端模型名称", ""))
        allowed_models = self._coerce_model_list(model_config.get("云端允许模型列表", ""))
        blocked_models = self._coerce_model_list(model_config.get("云端禁止模型列表", ""))

        # 运行时临时密钥优先级最高（从设置界面输入，不持久化）
        if self._runtime_api_key and len(self._runtime_api_key) >= 10:
            api_key_candidates = [self._runtime_api_key]

        if not endpoint_candidates:
            endpoint_candidates = self._coerce_model_list(global_config.get('cloud_endpoint', ''))
        # 回退判据不能只看长度：sk-xxxx… 这类占位符长度也 >=10，
        # 会让顶层真正有效的 cloud_api_key 永远读不到。
        if not api_key_candidates or not any(
            k and not is_placeholder_key(k) for k in api_key_candidates
        ):
            global_key = self._coerce_model_list(global_config.get('cloud_api_key', ''))
            if global_key and any(
                k and not is_placeholder_key(k) for k in global_key
            ):
                api_key_candidates = global_key
            elif global_key and not api_key_candidates:
                api_key_candidates = global_key
        if not model_candidates:
            model_candidates = self._coerce_model_list(global_config.get('cloud_model_name', ''))
        if not allowed_models:
            allowed_models = self._coerce_model_list(global_config.get('cloud_allowed_models', ''))
        if not blocked_models:
            blocked_models = self._coerce_model_list(global_config.get('cloud_blocked_models', ''))

        lock_enabled = bool(global_config.get('cloud_model_lock', True) or model_config.get('云端模型锁定', True))
        if not allowed_models and lock_enabled:
            allowed_models = model_candidates

        # 统一去重与大小写归一化，避免“中文模型/英文模型”被混用。
        normalized_blocked = {str(m).strip().lower() for m in blocked_models}
        normalized_allowed = {str(m).strip().lower() for m in allowed_models}
        if allowed_models:
            model_candidates = [m for m in model_candidates if str(m).strip().lower() in normalized_allowed]
        if normalized_allowed and not model_candidates:
            model_candidates = list(allowed_models)
        model_candidates = [m for m in model_candidates if str(m).strip().lower() not in normalized_blocked]
        if lock_enabled and normalized_allowed:
            model_candidates = [m for m in model_candidates if str(m).strip().lower() in normalized_allowed]

        if not endpoint_candidates:
            endpoint_candidates = ["https://api.deepseek.com/v1/chat/completions"]
        if not model_candidates:
            model_candidates = ["deepseek-chat"]
        if not api_key_candidates:
            api_key_candidates = [""]

        # 先按用户配置的模型池全量加载，保证多模型统一控制
        for idx, endpoint in enumerate(endpoint_candidates):
            api_key = api_key_candidates[idx] if idx < len(api_key_candidates) else api_key_candidates[0]
            # 原条件 (api_key and len(api_key) < 10 and not api_key.strip()) 恒为假
            # （_coerce_model_list 已 strip 过），这里等价改写为可读形式。
            if not endpoint:
                continue
            if not str(api_key).strip():
                logger.debug(f"端点 {endpoint} 未配置密钥，将以匿名方式请求")
            for model_idx, model_name in enumerate(model_candidates):
                model_name = str(model_name).strip()
                if not model_name:
                    continue
                if lock_enabled and allowed_models and model_name.lower() not in normalized_allowed:
                    continue
                if model_name.lower() in normalized_blocked:
                    continue
                provider_key = f"{endpoint}|{model_name}"
                if provider_key in seen:
                    continue
                seen.add(provider_key)
                _nonchat = self._non_chat_model_kind(model_name)
                if _nonchat:
                    logger.warning(
                        "模型 %r 看起来是「%s」模型，但当前端点是对话补全接口（%s）。"
                        "非对话模型不在这个接口上，请求会返回 url error。"
                        "对话请用文本模型；%s请配置到 config.yaml 的 video_generation 段。",
                        model_name, _nonchat, endpoint, _nonchat,
                    )
                providers.append({
                    "endpoint": endpoint,
                    "api_key": api_key,
                    "model": model_name,
                    "name": f"primary-{idx + 1}-{model_idx + 1}"
                })

        if not providers:
            for model_name in model_candidates:
                model_name = str(model_name).strip()
                if not model_name:
                    continue
                providers.append({
                    "endpoint": endpoint_candidates[0],
                    "api_key": api_key_candidates[0] if api_key_candidates else "",
                    "model": model_name,
                    "name": f"primary-default-{model_name}"
                })

        # 仅在未锁定时才允许备用提供商自动插入英文模型，锁定模式下必须拒绝。
        if not lock_enabled:
            for prov_name, preset in self.PROVIDER_PRESETS.items():
                if preset["endpoint"] in {p["endpoint"] for p in providers}:
                    continue
                env_key = f"MRHUA_{prov_name.upper()}_API_KEY"
                backup_key = os.environ.get(env_key, "").strip()
                if backup_key and len(backup_key) >= 10:
                    providers.append({
                        "endpoint": preset["endpoint"],
                        "api_key": backup_key,
                        "model": preset["model"],
                        "name": prov_name
                    })

        if not providers:
            providers.append({
                "endpoint": "https://api.deepseek.com/v1/chat/completions",
                "api_key": "",
                "model": "deepseek-chat",
                "name": "deepseek"
            })

        return providers

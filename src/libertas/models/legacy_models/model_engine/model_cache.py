from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================

class ModelCache:
    """模型LRU缓存，支持多个模型同时驻留显存，切换模型不用重新加载。
    缓存满时自动淘汰最久未使用的模型。根据显存大小自动决定缓存数量。"""

    def __init__(self, max_size: int = None, max_vram_gb: float = None):
        self._cache = OrderedDict()  # model_path -> {model, tokenizer, info, is_gguf, gguf_llm, last_used}
        self._max_size = max_size  # None表示自动根据显存决定
        self._max_vram_gb = max_vram_gb  # None表示自动检测
        self._lock = __import__('threading').Lock()

    def _get_auto_max_size(self) -> int:
        """根据显存大小自动决定最大缓存数量。"""
        try:
            import torch
            if torch.cuda.is_available():
                total_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                # 预留6GB给系统和推理，其余用于缓存
                usable_vram = max(0, total_vram - 6)
                # 假设平均每个模型4GB（7B 4bit）
                auto_size = max(1, int(usable_vram / 4))
                return min(auto_size, 8)  # 最多缓存8个
        except Exception:
            pass
        return 2  # 默认缓存2个

    def _get_current_vram_gb(self) -> float:
        """获取当前显存占用。"""
        try:
            import torch
            if torch.cuda.is_available():
                return torch.cuda.memory_allocated() / (1024**3)
        except Exception:
            pass
        return 0

    def _estimate_model_vram_gb(self, model_info: dict) -> float:
        """估算模型显存占用。"""
        # 从模型信息估算，默认4GB
        return model_info.get("estimated_vram_gb", 4.0)

    def _evict_if_needed(self, new_model_info: dict = None):
        """缓存满时淘汰最久未使用的模型。"""
        max_size = self._max_size or self._get_auto_max_size()

        while len(self._cache) >= max_size:
            # 淘汰最久未使用的（OrderedDict的第一个）
            oldest_path, oldest_data = self._cache.popitem(last=False)
            print(f" 模型缓存淘汰: {oldest_path}")
            self._unload_model(oldest_data)

        # 如果指定了最大显存，检查显存是否超限
        if self._max_vram_gb and new_model_info:
            current_vram = self._get_current_vram_gb()
            new_vram = self._estimate_model_vram_gb(new_model_info)
            while current_vram + new_vram > self._max_vram_gb and len(self._cache) > 0:
                oldest_path, oldest_data = self._cache.popitem(last=False)
                print(f" 显存不足，淘汰模型: {oldest_path}")
                self._unload_model(oldest_data)
                current_vram = self._get_current_vram_gb()

    def _unload_model(self, model_data: dict):
        """卸载模型，释放显存。"""
        try:
            model = model_data.get("model")
            if model is not None:
                # GGUF模型和transformers模型的卸载方式不同
                if model_data.get("is_gguf"):
                    # llama-cpp-python模型，删除引用即可
                    pass
                else:
                    # transformers模型，移到CPU再删除
                    try:
                        model.to("cpu")
                    except Exception:
                        pass
                del model
            if model_data.get("tokenizer") is not None:
                del model_data["tokenizer"]
            # 清空显存
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        except Exception as e:
            print(f" 模型卸载时出错: {e}")

    def get(self, model_path: str):
        """从缓存获取模型。命中则更新访问时间，返回模型数据；未命中返回None。"""
        with self._lock:
            if model_path in self._cache:
                # 移到末尾（最近使用）
                self._cache.move_to_end(model_path)
                self._cache[model_path]["last_used"] = time.time()
                print(f" 模型缓存命中: {model_path}")
                return self._cache[model_path]
            return None

    def put(self, model_path: str, model, tokenizer, model_info: dict,
            is_gguf: bool = False, gguf_llm=None):
        """将模型放入缓存。如果已存在则更新。"""
        with self._lock:
            # 如果已存在，先卸载旧的
            if model_path in self._cache:
                old_data = self._cache.pop(model_path)
                self._unload_model(old_data)

            # 淘汰旧模型
            self._evict_if_needed(model_info)

            self._cache[model_path] = {
                "model": model,
                "tokenizer": tokenizer,
                "info": model_info,
                "is_gguf": is_gguf,
                "gguf_llm": gguf_llm,
                "last_used": time.time(),
            }
            print(f" 模型已放入缓存: {model_path} (当前缓存: {len(self._cache)}/{self._max_size or 'auto'})")

    def remove(self, model_path: str):
        """从缓存移除指定模型。"""
        with self._lock:
            if model_path in self._cache:
                data = self._cache.pop(model_path)
                self._unload_model(data)
                print(f" 模型已从缓存移除: {model_path}")

    def clear(self):
        """清空缓存。"""
        with self._lock:
            for path, data in self._cache.items():
                self._unload_model(data)
            self._cache.clear()
            print(" 模型缓存已清空")

    def list_cached(self) -> list:
        """列出当前缓存的模型。"""
        with self._lock:
            return [
                {
                    "path": path,
                    "model_type": data["info"].get("model_type", "unknown"),
                    "is_gguf": data["is_gguf"],
                    "last_used": time.strftime("%H:%M:%S", time.localtime(data["last_used"])),
                }
                for path, data in self._cache.items()
            ]

    def __len__(self):
        return len(self._cache)

def build_orb_sse_payload(command: dict) -> dict:
    """把灵体指令包装成 SSE 事件，保证信封的 `type` 一定是 `orb_command`。

    历史 bug：命令字典里也带 `type`（emote 子类型，如 finding/pulse/glow），
    `{'type': 'orb_command', **command}` 会让命令的 `type` **覆盖**信封，
    于是前端收到的 `type` 是 `finding`，命中不到 `orb_command` 分支 ——
    灵体指令的实时通道整条失效（只剩 2 秒轮询兜底），表现为「指令发出去了但没反应」。

    这里统一：丢掉命令自带的 `type`（子类型改放 `emote` 字段），再把信封补回去。
    """
    payload = dict(command or {})
    payload.pop("type", None)
    payload["type"] = "orb_command"
    return payload

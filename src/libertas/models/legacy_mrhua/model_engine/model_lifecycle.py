from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .prompt_context import *  # noqa: F401,F403
from .prompt_settings import *  # noqa: F401,F403
from .message_safety import *  # noqa: F401,F403
from .cloud_api import *  # noqa: F401,F403
from .tool_retry import *  # noqa: F401,F403
from .cloud_stream import *  # noqa: F401,F403

class ModelEngineModelLifecycle(object):
    def _cuda_usable(self) -> bool:
        cached = getattr(self, "_cuda_probe_ok", None)
        if cached is not None:
            return cached
        ok = False
        try:
            import torch as _t
            if _t.cuda.is_available():
                _x = _t.zeros(1, device="cuda")
                del _x
                _t.cuda.synchronize()
                ok = True
        except Exception as e:
            self._cuda_probe_error = str(e)
            logger.warning(f"CUDA 探测失败，本次将不使用 GPU: {e}")
        self._cuda_probe_ok = ok
        return ok
    def get_cuda_diagnosis(self) -> str:
        """把 CUDA 报错翻译成可操作的建议。"""
        err = getattr(self, "_cuda_probe_error", "") or ""
        low = err.lower()
        if "busy or unavailable" in low:
            return ("GPU 被占用或不可用。常见原因：\n"
                    "  1) 另一个进程（另一个 MrHua 实例 / 别的推理程序）正独占该显卡 —— 先关掉它；\n"
                    "  2) 显卡处于独占计算模式（Windows 的 TCC 模式 / nvidia-smi compute mode），其他进程无法使用；\n"
                    "  3) CUDA_VISIBLE_DEVICES 指向了不存在的设备；\n"
                    "  4) 显存被占满，新进程拿不到上下文。\n"
                    "可用 `nvidia-smi` 确认占用情况。本次已自动改用 CPU 加载。")
        if "out of memory" in low:
            return "显存不足。可改用更小的量化（4bit/8bit）或换小模型；本次已自动改用 CPU 加载。"
        if err:
            return f"CUDA 不可用（{err.splitlines()[0] if err else '未知原因'}）；本次已自动改用 CPU 加载。"
        return "未检测到可用 CUDA 设备；本次使用 CPU 加载。"
    def _load_model_with_current_path(self) -> bool:
        """对单个本地模型路径执行真正的加载策略。"""
        if not self.model_path:
            return False
        # 先确认 GPU 真能用。不可用就直接走 CPU，避免在 5 级 GPU 策略上反复撞
        # 同一个粘性 CUDA 错误（既浪费时间，也掩盖真正原因）。
        if not self._cuda_usable():
            logger.warning("  跳过全部 GPU 加载策略，直接使用 CPU：" + self.get_cuda_diagnosis())
            if self._attempt_CPU_mode():
                print(" 模型已用 CPU 加载成功（GPU 不可用，自动降级）")
                return True
            print(" CPU 加载也失败了，请检查模型文件是否完整")
            return False
        # 优化：预读取模型config，提前知道架构信息和文件格式
        self._current_model_info = self._pre_read_model_config(self.model_path)
        quant_mode = (self.configuration.get("模型", {}).get("量化模式", "") or
                      self.configuration.get("local_model_quantization", "") or
                      "auto")

        # 尝试 MPS（Apple Silicon）
        if torch and hasattr(torch, "backends") and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            device = "mps"
            print(" 尝试使用 Apple MPS 加速加载...")
            try:
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_path,
                    torch_dtype=torch.float16,
                    low_cpu_mem_usage=True,
                    trust_remote_code=True
                )
                self.device = device
                self.model = self.model.to(device)
                self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
                if self.tokenizer.pad_token is None:
                    self.tokenizer.pad_token = self.tokenizer.eos_token
                self.model.eval()
                self.model_loading_status = "已加载"
                print(f" 模型加载成功，设备: {device}")
                return True
            except Exception as e:
                print(f" MPS 加载失败: {e}")

        if quant_mode == "4bit":
            print(" 配置指定 4-bit 量化加载")
            if self._attempt_4bit_quantization():
                return True
            print(" 4-bit 量化加载失败")
            return False
        elif quant_mode == "8bit":
            print(" 配置指定 8-bit 量化加载")
            if self._attempt_8bit_quantization():
                return True
            print(" 8-bit 量化加载失败")
            return False
        elif quant_mode == "none":
            print(" 配置指定不使用量化，原生精度加载")
            if self._attempt_original_mixed_loading():
                return True
            print(" 原生精度加载失败")
            return False

        print(" 自动量化模式，按优先级尝试加载")
        # GGUF格式优先（加载快3-5倍，显存小）
        strategies = []
        if self._current_model_info.get("is_gguf"):
            strategies.append(self._attempt_gguf_loading)
        strategies.extend([
            self._attempt_original_mixed_loading,
            self._attempt_reduce_number_of_GPU_layers,
            self._attempt_8bit_quantization,
            self._attempt_4bit_quantization,
            self._attempt_CPU_mode,
        ])
        for strategy in strategies:
            if strategy():
                return True
        return False
    def load_model(self) -> bool:
        """尝试加载本地模型（支持多模型候选池、多策略降级、LRU缓存）。
        先查缓存，命中直接用；没命中就加载，加载完放入缓存。"""
        # 先查缓存
        if self._model_cache_enabled:
            candidate_paths = self._resolve_local_model_candidates()
            for candidate_path in candidate_paths:
                cached = self._model_cache.get(candidate_path)
                if cached is not None:
                    # 缓存命中，直接恢复模型状态
                    self.model = cached["model"]
                    self.tokenizer = cached["tokenizer"]
                    self.model_path = candidate_path
                    self._current_model_info = cached["info"]
                    self._is_gguf_model = cached["is_gguf"]
                    self._gguf_llm = cached["gguf_llm"]
                    self.model_loading_status = "已加载"
                    print(f" 从缓存加载模型: {candidate_path}")
                    return True

        if self.model is not None:
            self.model_loading_status = "已加载"
            return True
        if self.model_loading_status == "已加载" and self.model is not None and self.tokenizer is not None:
            return True

        with self._load_lock:
            if self.model is not None:
                self.model_loading_status = "已加载"
                return True
            if self._loading_in_progress:
                return False
            self._loading_in_progress = True
            self.model_loading_status = "加载中"

        try:
            candidate_paths = self._resolve_local_model_candidates()
            if not candidate_paths:
                self.model_loading_status = "加载失败"
                return False

            last_error = None
            for candidate_path in candidate_paths:
                # 再次检查缓存（可能在等待锁的过程中被其他线程加载了）
                if self._model_cache_enabled:
                    cached = self._model_cache.get(candidate_path)
                    if cached is not None:
                        self.model = cached["model"]
                        self.tokenizer = cached["tokenizer"]
                        self.model_path = candidate_path
                        self._current_model_info = cached["info"]
                        self._is_gguf_model = cached["is_gguf"]
                        self._gguf_llm = cached["gguf_llm"]
                        self.model_loading_status = "已加载"
                        return True

                self.model_path = candidate_path
                self.model = None
                self.tokenizer = None
                try:
                    if self._load_model_with_current_path():
                        # 加载成功，放入缓存
                        if self._model_cache_enabled:
                            self._model_cache.put(
                                candidate_path,
                                self.model,
                                self.tokenizer,
                                self._current_model_info,
                                self._is_gguf_model,
                                self._gguf_llm,
                            )
                        self.model_loading_status = "已加载"
                        return True
                except Exception as exc:
                    last_error = exc
                    print(f" 模型路径 {candidate_path} 加载失败: {exc}")
                self.model = None
                self.tokenizer = None

            self.model_loading_status = "加载失败"
            if last_error is not None:
                print(f" 所有本地模型候选路径均失败，最后错误: {last_error}")
            return False
        finally:
            with self._load_lock:
                self._loading_in_progress = False
    def switch_model(self, model_path: str) -> bool:
        """切换到指定模型。先查缓存，没命中就加载。旧模型保留在缓存中。"""
        if not model_path:
            return False
        # 如果已经是当前模型，直接返回
        if self.model_path == model_path and self.model is not None:
            return True
        print(f" 切换模型: {model_path}")
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self._is_gguf_model = False
        self._gguf_llm = None
        self.model_loading_status = "未加载"
        return self.load_model()
    def list_cached_models(self) -> list:
        """列出当前缓存的模型。"""
        return self._model_cache.list_cached()
    def clear_model_cache(self):
        """清空模型缓存。"""
        self._model_cache.clear()
    def remove_from_cache(self, model_path: str):
        """从缓存移除指定模型。"""
        self._model_cache.remove(model_path)
    def _record_quantization_status(self, requested_mode: str, effective: bool, success: bool, detail: str):
        self.quantization_status = {
            "requested_mode": requested_mode,
            "effective": effective,
            "success": success,
            "detail": detail,
        }
    def get_quantization_status(self) -> Dict[str, Any]:
        if self.model is not None:
            if getattr(self.model, "is_loaded_in_4bit", False):
                return {
                    "requested_mode": self.quantization_status.get("requested_mode", self.configuration.get("模型", {}).get("量化模式", "auto")),
                    "effective": True,
                    "success": True,
                    "detail": "检测到 4-bit 量化标记"
                }
            if getattr(self.model, "is_loaded_in_8bit", False):
                return {
                    "requested_mode": self.quantization_status.get("requested_mode", self.configuration.get("模型", {}).get("量化模式", "auto")),
                    "effective": True,
                    "success": True,
                    "detail": "检测到 8-bit 量化标记"
                }
        return self.quantization_status.copy()
    def _pre_read_model_config(self, model_path: str) -> Dict[str, Any]:
        """预读取模型config.json，提前知道架构、层数、是否支持safetensors等信息。
        避免加载失败后才知道不兼容，提升加载速度。"""
        try:
            # 情况1：路径本身就是一个.gguf文件
            if os.path.isfile(model_path) and model_path.lower().endswith(".gguf"):
                gguf_filename = os.path.basename(model_path)
                file_size_gb = round(os.path.getsize(model_path) / (1024**3), 2)
                info = {
                    "model_type": "gguf",
                    "num_hidden_layers": 0,
                    "hidden_size": 0,
                    "vocab_size": 0,
                    "torch_dtype": "gguf",
                    "architectures": ["gguf"],
                    "has_safetensors": False,
                    "has_bin": False,
                    "preferred_format": "gguf",
                    "total_size_gb": file_size_gb,
                    "gguf_files": [gguf_filename],
                    "is_gguf": True,
                    "gguf_file": gguf_filename,
                    "gguf_is_file_path": True,
                }
                for qtype in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q5_K_S", "Q6_K", "Q8_0", "Q2_K", "Q3_K_M"]:
                    if qtype.lower() in gguf_filename.lower():
                        info["gguf_quant_type"] = qtype
                        break
                logger.info(f" 模型预读取(GGUF文件): {gguf_filename}, {file_size_gb}GB, 量化={info.get('gguf_quant_type', 'unknown')}")
                return info
            # 情况2：路径是目录，读取config.json
            config_file = os.path.join(model_path, "config.json")
            if not os.path.exists(config_file):
                return {}
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            # 提取关键信息
            info = {
                "model_type": config.get("model_type", "unknown"),
                "num_hidden_layers": config.get("num_hidden_layers", config.get("n_layer", 0)),
                "hidden_size": config.get("hidden_size", config.get("n_embd", 0)),
                "vocab_size": config.get("vocab_size", 0),
                "torch_dtype": config.get("torch_dtype", "float32"),
                "architectures": config.get("architectures", []),
            }
            # 检测是否有safetensors格式
            has_safetensors = any(f.endswith(".safetensors") for f in os.listdir(model_path))
            has_bin = any(f.endswith(".bin") for f in os.listdir(model_path))
            info["has_safetensors"] = has_safetensors
            info["has_bin"] = has_bin
            info["preferred_format"] = "safetensors" if has_safetensors else ("bin" if has_bin else "unknown")
            # 估算模型大小
            total_size = 0
            for f in os.listdir(model_path):
                fp = os.path.join(model_path, f)
                if os.path.isfile(fp):
                    total_size += os.path.getsize(fp)
            info["total_size_gb"] = round(total_size / (1024**3), 2)
            # 检测GGUF格式
            gguf_files = [f for f in os.listdir(model_path) if f.endswith(".gguf")]
            info["gguf_files"] = gguf_files
            info["is_gguf"] = len(gguf_files) > 0
            if gguf_files:
                info["preferred_format"] = "gguf"
                info["gguf_file"] = gguf_files[0]
                # GGUF文件名通常包含量化信息，如 Q4_K_M, Q5_K_M, Q8_0
                for qtype in ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q5_K_S", "Q6_K", "Q8_0", "Q2_K", "Q3_K_M"]:
                    if qtype.lower() in gguf_files[0].lower():
                        info["gguf_quant_type"] = qtype
                        break
            logger.info(f" 模型预读取: {info['model_type']}, {info['num_hidden_layers']}层, "
                       f"{info['total_size_gb']}GB, 格式={info['preferred_format']}"
                       + (f", GGUF量化={info.get('gguf_quant_type', 'unknown')}" if info.get('is_gguf') else ""))
            return info
        except Exception as e:
            logger.warning(f"模型config预读取失败: {e}")
            return {}
    def _start_background_preload(self):
        """后台线程预加载模型，不阻塞主线程。程序启动后调用。"""
        def _preload_worker():
            try:
                time.sleep(2)  # 等2秒，让程序先启动完成
                if self.model is None and not self._loading_in_progress:
                    logger.info(" 后台预加载模型启动...")
                    self.load_model()
                    if self.model is not None:
                        logger.info(" 后台预加载模型完成")
            except Exception as e:
                logger.warning(f"后台预加载失败: {e}")
        thread = threading.Thread(target=_preload_worker, daemon=True, name="model_preload")
        thread.start()

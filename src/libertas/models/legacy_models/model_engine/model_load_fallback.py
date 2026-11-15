from ._shared import *  # noqa: F401,F403
from ._shared import _llama_cpp_available  # noqa: F401

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403
from .prompt_context import *  # noqa: F401,F403
from .prompt_settings import *  # noqa: F401,F403
from .message_safety import *  # noqa: F401,F403
from .cloud_api import *  # noqa: F401,F403
from .tool_retry import *  # noqa: F401,F403
from .cloud_stream import *  # noqa: F401,F403
from .model_lifecycle import *  # noqa: F401,F403

class ModelEngineModelLoadFallback(object):
    def _attempt_gguf_loading(self) -> bool:
        """尝试加载GGUF格式模型（llama-cpp-python）。
        优势：加载速度快3-5倍，显存占用小，支持CPU/GPU混合。
        V100支持CUDA加速，n_gpu_layers=-1表示全部层放GPU。"""
        if not _llama_cpp_available:
            logger.warning("llama-cpp-python 未安装，跳过 GGUF 加载")
            self._record_quantization_status("gguf", False, False, "llama-cpp-python 未安装")
            return False
        if not self._current_model_info.get("is_gguf"):
            return False
        try:
            gguf_file = self._current_model_info.get("gguf_file")
            if not gguf_file:
                return False
            # 判断model_path是文件还是目录
            if self._current_model_info.get("gguf_is_file_path") or (os.path.isfile(self.model_path) and self.model_path.lower().endswith(".gguf")):
                gguf_path = self.model_path  # 路径本身就是.gguf文件
            else:
                gguf_path = os.path.join(self.model_path, gguf_file)
            logger.info(f" 尝试 GGUF 加载: {gguf_file}")

            # 解析配置
            model_config = self.configuration.get("模型", {}) or {}
            n_ctx = int(model_config.get("上下文长度", model_config.get("max_context", 8192)))
            n_threads = int(model_config.get("线程数", os.cpu_count() or 8))
            # V100 32GB，全部层放GPU
            n_gpu_layers = -1 if (torch and self._cuda_usable()) else 0
            # 检测GPU显存，决定是否全部放GPU
            if torch and torch.cuda.is_available():
                try:
                    total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
                    model_size = self._current_model_info.get("total_size_gb", 4)
                    # 如果模型大小超过显存的70%，只放部分层到GPU
                    if model_size > total_vram * 0.7:
                        n_gpu_layers = 20  # 放20层到GPU，其余CPU
                        logger.info(f" 模型较大({model_size}GB)，仅放{n_gpu_layers}层到GPU")
                except Exception:
                    pass

            print(f" GGUF加载参数: n_ctx={n_ctx}, n_threads={n_threads}, n_gpu_layers={n_gpu_layers}")

            # 加载模型
            self._gguf_llm = LlamaCpp(
                model_path=gguf_path,
                n_ctx=n_ctx,
                n_threads=n_threads,
                n_gpu_layers=n_gpu_layers,
                verbose=False,
                use_mmap=True,  # 内存映射，加载更快
                use_mlock=False,
            )

            # GGUF模型不需要transformers的tokenizer，用llama-cpp自带的
            self.tokenizer = None  # 标记为None，生成时用GGUF自带的tokenizer
            self.model = self._gguf_llm  # 统一用self.model访问
            self._is_gguf_model = True
            self._gguf_n_ctx = n_ctx  # 保存上下文窗口大小，用于生成时检查
            self.device = "cuda" if n_gpu_layers != 0 else "cpu"

            quant_type = self._current_model_info.get("gguf_quant_type", "unknown")
            self._record_quantization_status("gguf", True, True,
                                              f"GGUF({quant_type})加载成功, GPU层数={n_gpu_layers}")
            print(f" GGUF模型加载成功: {gguf_file}, 量化={quant_type}, 设备={self.device}")
            return True
        except Exception as e:
            import traceback as _tb
            _err_detail = f"{type(e).__name__}: {e}"
            print(f" GGUF加载失败: {_err_detail}")
            print(f"   详细错误:\n{_tb.format_exc()}")
            logger.warning(f"GGUF加载失败: {_err_detail}")
            self._gguf_llm = None
            self._is_gguf_model = False
            self._record_quantization_status("gguf", False, False, f"GGUF加载失败: {_err_detail}")
            return False
    def _load_with_device_map(self, device_map: Dict, detail_prefix: str) -> bool:
        """
        修复：通用的 device_map 加载方法，支持自定义 device_map 失败时自动回退到 "auto"。
        解决硬编码 Llama 架构键名（model.embed_tokens / model.layers.{i}）导致
        GPT-2 等其他架构加载失败的问题。
        """
        try:
            # 优化：优先加载safetensors格式，使用SDPA注意力加速
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_path, torch_dtype=torch.float16, device_map=device_map,
                trust_remote_code=True, low_cpu_mem_usage=True,
                use_safetensors=True, attn_implementation="sdpa",
            )
        except Exception as e:
            # 自定义 device_map 可能因模型架构不同而失败，回退到自动分配
            logger.warning(f"{detail_prefix} 自定义 device_map 失败，回退到 auto: {e}")
            try:
                # 优化：优先加载safetensors格式，使用SDPA注意力加速
                self.model = AutoModelForCausalLM.from_pretrained(
                    self.model_path, torch_dtype=torch.float16, device_map="auto",
                    trust_remote_code=True, low_cpu_mem_usage=True,
                    use_safetensors=True, attn_implementation="sdpa",
                )
            except Exception as e2:
                logger.warning(f"{detail_prefix} auto device_map 也失败: {e2}")
                return False
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model.eval()
        return True
    def _attempt_original_mixed_loading(self) -> bool:
        if not torch or not torch.cuda.is_available():
            return False
        try:
            logger.info(" 尝试原始混合加载...")
            total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
            used = torch.cuda.memory_allocated() / 1024**3
            available = total_vram - used
            safe = available * 0.8
            layer_size = self.mixed_loading_configuration["每层大小_GB"]
            total_layers = self.mixed_loading_configuration["总层数"]
            gpu_layers = int(safe / layer_size)
            gpu_layers = min(max(self.mixed_loading_configuration["最小GPU层数"], gpu_layers),
                             self.mixed_loading_configuration["最大GPU层数"])
            gpu_layers = min(gpu_layers, total_layers - 2)
            # 注意：此 device_map 仅适用于 Llama/Qwen 架构，其他架构会自动回退到 auto
            device_map = {}
            device_map["model.embed_tokens"] = "cuda:0"
            device_map["model.norm"] = "cuda:0"
            device_map["lm_head"] = "cuda:0"
            for i in range(gpu_layers):
                device_map[f"model.layers.{i}"] = "cuda:0"
            for i in range(gpu_layers, total_layers):
                device_map[f"model.layers.{i}"] = "cpu"
            logger.info(f" 分配策略: {gpu_layers}层GPU, {total_layers - gpu_layers}层CPU")
            if self._load_with_device_map(device_map, "原始混合加载"):
                self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, True, "原生精度/混合加载成功")
                return True
            self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, False, "原生精度/混合加载失败")
            return False
        except Exception as e:
            logger.warning(f"原始混合加载失败: {e}")
            self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, False, f"原生精度/混合加载失败: {e}")
            return False
    def _attempt_reduce_number_of_GPU_layers(self) -> bool:
        if not torch or not torch.cuda.is_available():
            return False
        try:
            total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
            used = torch.cuda.memory_allocated() / 1024**3
            available = total_vram - used
            safe = available * 0.8
            layer_size = self.mixed_loading_configuration["每层大小_GB"]
            total_layers = self.mixed_loading_configuration["总层数"]
            original = int(safe / layer_size)
            original = min(max(self.mixed_loading_configuration["最小GPU层数"], original),
                           self.mixed_loading_configuration["最大GPU层数"])
            candidates = [original // 2, original // 4, 8, 4, 2]
            for gpu_layers in candidates:
                if gpu_layers < self.mixed_loading_configuration["最小GPU层数"]:
                    continue
                try:
                    logger.info(f" 尝试减少GPU层数到 {gpu_layers} ...")
                    # 注意：此 device_map 仅适用于 Llama/Qwen 架构，其他架构会自动回退到 auto
                    device_map = {}
                    device_map["model.embed_tokens"] = "cuda:0"
                    device_map["model.norm"] = "cuda:0"
                    device_map["lm_head"] = "cuda:0"
                    for i in range(gpu_layers):
                        device_map[f"model.layers.{i}"] = "cuda:0"
                    for i in range(gpu_layers, total_layers):
                        device_map[f"model.layers.{i}"] = "cpu"
                    if self._load_with_device_map(device_map, f"减少GPU层数到{gpu_layers}"):
                        self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, True, f"减少GPU层数到 {gpu_layers} 成功")
                        return True
                except Exception as e:
                    logger.warning(f"减少GPU层数到 {gpu_layers} 失败: {e}")
                    continue
            return False
        except Exception as e:
            logger.warning(f"减少GPU层数策略异常: {e}")
            self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, False, f"减少GPU层数策略异常: {e}")
            return False
    def _attempt_8bit_quantization(self) -> bool:
        # 清除 transformers 的 lru_cache，避免程序启动时过早调用导致缓存错误结果
        try:
            from transformers.utils import is_accelerate_available
            is_accelerate_available.cache_clear()
        except Exception:
            pass
        if bitsandbytes is None:
            logger.warning("bitsandbytes 未安装，跳过 8-bit 量化")
            self._record_quantization_status("8bit", False, False, "bitsandbytes 未安装，跳过 8-bit 量化")
            return False
        try:
            logger.info(" 尝试 8-bit 量化加载...")
            from transformers import BitsAndBytesConfig
            _quant_config = BitsAndBytesConfig(load_in_8bit=True)
            # 优化：优先加载safetensors格式，使用SDPA注意力加速
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_path,
                quantization_config=_quant_config,
                device_map="auto",
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                use_safetensors=True,
                attn_implementation="sdpa",
            )
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            self.model.eval()
            self._record_quantization_status("8bit", True, True, "8-bit 量化加载成功")
            return True
        except Exception as e:
            import traceback as _tb
            _err_detail = f"{type(e).__name__}: {e}"
            print(f" 8-bit 量化加载失败: {_err_detail}")
            print(f"   详细错误:\n{_tb.format_exc()}")
            logger.warning(f"8-bit 量化加载失败: {_err_detail}")
            self._record_quantization_status("8bit", False, False, f"8-bit 量化加载失败: {_err_detail}")
            return False
    def _attempt_4bit_quantization(self) -> bool:
        # 清除 transformers 的 lru_cache，避免程序启动时过早调用导致缓存错误结果
        try:
            from transformers.utils import is_accelerate_available
            is_accelerate_available.cache_clear()
        except Exception:
            pass
        if bitsandbytes is None:
            logger.warning("bitsandbytes 未安装，跳过 4-bit 量化")
            self._record_quantization_status("4bit", False, False, "bitsandbytes 未安装，跳过 4-bit 量化")
            return False
        try:
            logger.info(" 尝试 4-bit 量化加载（NF4+双重量化+FP16计算）...")
            from transformers import BitsAndBytesConfig
            # 优化：NF4量化精度更好，双重量化进一步减显存，FP16计算速度更快
            _quant_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
            )
            # 优化：优先加载safetensors格式（比bin快30%），使用SDPA注意力加速
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_path,
                quantization_config=_quant_config,
                device_map="auto",
                trust_remote_code=True,
                low_cpu_mem_usage=True,
                use_safetensors=True,
                attn_implementation="sdpa",
            )
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            self.model.eval()
            self._record_quantization_status("4bit", True, True, "4-bit 量化加载成功")
            return True
        except Exception as e:
            import traceback as _tb
            _err_detail = f"{type(e).__name__}: {e}"
            print(f" 4-bit 量化加载失败: {_err_detail}")
            print(f"   详细错误:\n{_tb.format_exc()}")
            logger.warning(f"4-bit 量化加载失败: {_err_detail}")
            self._record_quantization_status("4bit", False, False, f"4-bit 量化加载失败: {_err_detail}")
            return False
    def _attempt_CPU_mode(self) -> bool:
        try:
            logger.info(" 尝试 CPU 模式加载...")
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_path,
                torch_dtype=torch.float32,
                device_map="cpu",
                trust_remote_code=True,
                low_cpu_mem_usage=True
            )
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            self.model.eval()
            self.device = "cpu"
            self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, True, "CPU 模式加载成功")
            return True
        except Exception as e:
            logger.warning(f"CPU 模式加载失败: {e}")
            self._record_quantization_status(self.configuration.get("模型", {}).get("量化模式", "auto"), False, False, f"CPU 模式加载失败: {e}")
            return False

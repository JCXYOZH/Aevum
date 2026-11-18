from ._shared import *  # noqa: F401,F403

# ==================== 模型LRU缓存 ====================
from .model_cache import *  # noqa: F401,F403

class ModelEngineBase:
    _instance = None
    _instance_lock = threading.Lock()

    THINKING_INSTRUCTION = """【重要：回答格式要求】
你必须在每次回答前先输出思考过程，格式如下：

<thinking>
（在这里写下你的思考：分析用户的问题、回忆相关信息、构思回答方向。3-5句话即可。）
</thinking>

（然后在这里输出你的正式回答，必须有实际内容，不能为空）

规则：
1. <thinking> 标签必须出现在正式回答之前
2. 思考内容用第一人称，像内心独白
3. 不要省略思考过程，不要只输出标签不写内容
4. 正式回答中不要包含 <thinking> 标签
5. </thinking> 之后必须紧跟正式回答，不能只思考不回答
6. 即使是简单的问候，也必须在</thinking>后给出回复"""
    DEFAULT_MAX_LENGTH = 4096
    _MAX_LENGTH_KEYS = ("最大长度", "max_length", "最大生成长度", "默认最大长度")
    _KIND_VIDEO_HINTS = ("t2v", "i2v", "s2v", "video", "cogvideo",
                         "hunyuanvideo", "animatediff", "svd")
    _KIND_IMAGE_HINTS = ("t2i", "i2i", "flux", "sdxl", "stable-diffusion")
    _KIND_IMAGE_GENERIC = ("image", "diffusion")
    _KIND_AUDIO_HINTS = ("tts", "speech", "voice", "audio", "whisper", "asr")
    _KIND_EMBED_HINTS = ("embedding", "rerank")
    _KIND_WAN_BRAND = ("wanx", "wan2", "wan3")   # 万相：无强特征时按文生图算
    PROVIDER_PRESETS = {
        "deepseek": {
            "endpoint": "https://api.deepseek.com/v1/chat/completions",
            "model": "deepseek-chat",
        },
        "moonshot": {
            "endpoint": "https://api.moonshot.cn/v1/chat/completions",
            "model": "moonshot-v1-8k",
        },
        "zhipu": {
            "endpoint": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
            "model": "glm-4-flash",
        },
        "qwen": {
            "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            "model": "qwen-turbo",
        },
        "yi": {
            "endpoint": "https://api.lingyiwanwu.com/v1/chat/completions",
            "model": "yi-lightning",
        },
        "minimax": {
            "endpoint": "https://api.minimax.chat/v1/text/chatcompletion_v2",
            "model": "MiniMax-Text-01",
        },
        "baichuan": {
            "endpoint": "https://api.baichuan-ai.com/v1/chat/completions",
            "model": "Baichuan4",
        },
        "openai": {
            "endpoint": "https://api.openai.com/v1/chat/completions",
            "model": "gpt-4o-mini",
        },
    }
    _TASK_HINTS = (
        "扫描", "扫一下", "扫下", "扫一遍", "检测", "测一下", "探测", "枚举", "爆破",
        "信息收集", "收集信息", "指纹", "端口", "子域", "目录扫描", "漏洞", "渗透",
        "跑一下", "跑个", "执行一下", "调用工具",
        # 「找漏洞」类说法：这些请求必须真的去调工具，而不是给一份方案清单
        "找漏洞", "查漏洞", "挖洞", "漏扫", "扫漏", "漏洞验证", "验证漏洞",
        "复现", "资产", "侦察", "打点", "全量", "地毯式", "深入检测",
        "帮我查", "帮我扫", "帮我检测",
        "nmap", "masscan", "nuclei", "sqlmap", "xray", "fscan", "nikto", "hydra",
        "dirsearch", "ffuf", "whois", "nslookup", "traceroute",
    )

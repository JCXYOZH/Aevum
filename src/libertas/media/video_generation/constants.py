"""职责模块：constants。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from libertas.foundation.config import get_data_dir, config as global_config

DEFAULT_CONFIG: Dict[str, Any] = {
    "enabled": False,                 # 可控：默认关闭
    "mode": "async_submit_poll",      # async_submit_poll | sync_json
    "endpoint": "",                   # 提交端点
    "query_endpoint": "",             # 查询端点模板，可用 {task_id}
    "api_key": "",
    "model": "",
    "timeout": 60,
    "poll_interval": 5,
    "poll_max_seconds": 600,
    # 请求/响应字段映射，方便适配不同厂商
    "submit_body_template": {},
    "result_url_path": "output.video_url",
    "task_id_path": "output.task_id",
    "status_path": "output.task_status",
    "error_path": "output.message",
    "extra_headers": {},              # 附加请求头（如 DashScope 必需的 X-DashScope-Async）
    "proxy": "",                      # 显式代理；留空=不使用代理（不继承环境变量）
    "prompt_enhance": True,           # 由文本模型把口语描述改写成生成模型适用的提示词
    "privacy": {
        "sanitize_prompt": True,      # 发送前脱敏
        "allow_categories": [],       # 额外允许的隐私类别（留空=按全局策略）
        "block_on_denied": True,      # 隐私策略拒绝时直接失败，而不是降级发送
    },
}

_SENTENCE_END = "。！？.!?…\"\'）)】」”"

GEN_PROMPT_SYSTEM = (
    "你是文生视频与文生图的提示词工程师。把用户的口语描述改写成一条"
    "适合生成模型的提示词，依次交代：主体与动作、环境与场景、光线与色调、"
    "镜头与运镜、画面风格、画质要求。"
    "只输出提示词本身：不要解释、不要引号、不要编号、不要换行、不要分点。"
    "长度不超过 120 个字，使用中文。"
)

_PROMPT_STRIP_PREFIX = ("提示词：", "提示词:", "生成提示词：", "生成提示词:", "Prompt:", "prompt:")

MEDIA_TOOL_NAME = "generate_media"

MEDIA_TOOL_DEF = {
    "type": "function",
    "function": {
        "name": MEDIA_TOOL_NAME,
        "description": (
            "生成视频或图片。当用户想做视频、要一段动画、要一张图或一张海报时调用。"
            "调用前请先结合对话上下文把用户意图整理成清晰的画面描述"
            "（主体与动作、环境场景、光线色调、镜头运镜、画面风格、画质要求），"
            "不要把「帮我做个视频」这类指令原话直接当作 prompt。"
            "调用本工具只是向用户发起生成请求，不会立即产生费用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["video", "image"],
                    "description": "生成类型：视频用 video，图片用 image",
                },
                "prompt": {
                    "type": "string",
                    "description": "整理好的画面描述，中文。要求是**完整的一句话或一段**，宁可稍长也不要写到一半停下（不要以顿号或「和/与」结尾）。",
                },
                "reason": {
                    "type": "string",
                    "description": "判断用户需要生成的理由（一句话，会展示给用户）",
                },
            },
            "required": ["kind", "prompt"],
        },
    },
}

_MODERATION_MARKERS = (
    "green net", "green_net", "datainspection", "data inspection",
    "inspection failed", "绿网", "内容审核", "审核不通过", "涉敏",
)

_MEDIA_EXT = {
    "video": (".mp4", ".webm", ".mov", ".mkv"),
    "image": (".png", ".jpg", ".jpeg", ".webp", ".gif"),
}

"""职责模块：transport。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import urllib.request
from libertas.foundation.config import get_data_dir, config as global_config

def _is_dashscope_endpoint(url: str) -> bool:
    """判断是否阿里云百炼（DashScope）端点。

    百炼的异步任务接口有两个硬性约定，缺一个都调不通：
      1. 必须带请求头 X-DashScope-Async: enable（否则报
         "current user api does not support synchronous calls"）；
      2. 请求体用 input/parameters 结构，不接受顶层 prompt。
    默认端点形如 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/...
    本项目的 task_id_path/result_url_path 默认值即为百炼响应结构。
    """
    u = str(url or "").lower()
    if "dashscope" in u or ".maas.aliyuncs.com" in u:
        return True
    return "/api/v1/services/aigc/" in u

def _build_opener(cfg: Dict[str, Any]):
    """构造**不继承环境变量代理**的 urllib opener。

    urllib 默认会自动读取 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY 等环境变量
    并绕道使用；而这类变量常被其它程序（办公客户端等）污染。一旦指向不可达
    的代理，请求会一直挂到超时 —— 表现为「提交生成任务…」长时间不动。

    本模块因此默认**显式禁用**环境代理（与项目中 web_search 对 requests
    的处理保持一致）；确有需要时用 video_generation.proxy 显式指定。
    """
    proxy = str((cfg or {}).get("proxy") or "").strip()
    handler = urllib.request.ProxyHandler(
        {"http": proxy, "https": proxy} if proxy else {}
    )
    return urllib.request.build_opener(handler)

def _dig(data: Any, path: str) -> Any:
    """按 "a.b.c" 取嵌套字段，取不到返回 None。"""
    if not path:
        return None
    cur = data
    for part in str(path).split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur

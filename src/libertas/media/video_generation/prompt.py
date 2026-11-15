"""职责模块：prompt。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import math
from libertas.foundation.config import get_data_dir, config as global_config

from .constants import GEN_PROMPT_SYSTEM
from .constants import _MODERATION_MARKERS
from .constants import _PROMPT_STRIP_PREFIX
from .constants import _SENTENCE_END

def _creep(elapsed: int, max_wait: int) -> int:
    """按等待时长给出一个「持续推进但从不宣称完成」的进度提示值。

    异步生成接口只返回 PENDING/RUNNING/SUCCEEDED，**不提供百分比**，
    因此这里的数值是按时间估算的提示值，真正的完成由 SUCCEEDED 决定。

    采用渐近曲线而非线性封顶：进度会一直缓慢推进，不会在中途停住 ——
    线性封顶的做法会在短时间内冲到上限然后长时间不动，看起来像卡死。
    """
    span = max(60.0, min(float(max_wait or 600), 1800.0)) / 3.0
    try:
        ratio = 1.0 - math.exp(-float(elapsed) / span)
    except Exception:
        ratio = 0.0
    return max(10, min(95, 10 + int(85 * ratio)))

def _looks_complete(text: str) -> bool:
    """判断一段提示词是否「写完整了」，用来挡住被切断的半句话。

    **这个判定本身是有边界的，不要高估它**：中文画面描述经常以名词收尾、
    且不加句号，所以「以名词戛然而止」与「完整但没加句号」在本地无法区分。
    可靠可测的只有一种：以连接词/顿号结尾（"…和"、"…、"）—— 那是模型被
    max_length 切断时最常见的收尾方式。

    因此长且不以连接词结尾的一律放行，宁可漏放也不误杀；
    真正消除截断靠的是不去做二次改写（见 web.py _execute_video_task）。
    """
    t = str(text or "").strip()
    if not t:
        return False
    if t[-1] in _SENTENCE_END:
        return True
    # 中文提示词常以名词短语收尾而不加句号，所以再放一个宽松条件：
    # 结尾不是连接词、且总长度够长，就当作完整。
    if t[-1] in "、，,和与及并而且但或":
        return False
    return len(t) >= 24

def build_gen_prompt(kind: str, raw: str, call_model) -> tuple:
    """用文本模型把口语描述改写成生成模型适用的提示词。

    生成模型的提示词写法与对话差别很大（需要交代主体/动作/环境/光线/镜头/
    风格/画质），用户口语化的描述直接送去往往效果很差。

    ``call_model(system, user) -> str`` 由调用方注入，便于替换与测试。

    返回 ``(实际使用的提示词, 是否改写成功)``。
    **任何失败都退回原描述** —— 改写只是增益，不该成为生成的前置条件：
    模型不可用、超时、返回为空/换行/过长时一律走原描述。
    """
    raw = str(raw or "").strip()
    if not raw:
        return raw, False
    try:
        hint = "视频" if kind == "video" else "图片"
        out = call_model(GEN_PROMPT_SYSTEM, "生成目标：%s\n用户描述：%s" % (hint, raw))
        out = str(out or "").strip()
        # 模型偶尔会加引号或「提示词：」之类的抬头，清掉
        out = out.strip("\"'`\u2018\u2019\u201c\u201d\u300c\u300d \t\r\n")
        for _p in _PROMPT_STRIP_PREFIX:
            if out.startswith(_p):
                out = out[len(_p):].strip()
                break
        # 只接受「像一条提示词」的结果：非空、单行、长度合理。
        # 光看长度不够 —— 改写请求的 max_length 有限，模型可能写到一半被切断，
        # 结果不足 400 字却语义残缺，照样能通过长度检查被送进生成模型。
        # （这正是「提示词不全、有截断」的来源。）
        if not out or len(out) > 400 or "\n" in out:
            return raw, False
        # 模型原样退回原描述：内容没变，不存在「引入截断」的风险，直接接受。
        # 完整性检查针对的是**改写结果被切断**，不该误伤这种无损情况。
        if out == raw:
            return out, True
        if not _looks_complete(out):
            return raw, False
        return out, True
    except Exception:
        return raw, False

def check_media_prompt(prompt: str):
    """校验模型给出的生成提示词。返回 (是否合格, 不合格原因)。

    不完整时不是硬拒，而是把原因回给模型让它重写一次 —— 模型自己写完再自检，
    比后端猜测补全靠谱。
    """
    t = str(prompt or "").strip()
    if not t:
        return False, "提示词为空"
    if len(t) < 12:
        return False, "描述只有 %d 字，信息量不足以生成" % len(t)
    if t[-1] in "、，,和与及并而且但或":
        return False, "结尾停在连接词上（如「和」「、」），明显是写到一半被截断"
    if not _looks_complete(t):
        return False, "读起来不像一条完整的画面描述"
    return True, ""

def build_media_proposal(kind: str, prompt: str, reason: str = "",
                         need_confirm: bool = True) -> Dict[str, Any]:
    """把模型的工具调用整理成前端可直接渲染的生成提案。

    ``need_confirm=True``（默认）→ 前端渲染卡片，等用户点「开始生成」；
    ``need_confirm=False``      → 前端直接走已有生成流程（全自动）。

    两种模式的机制完全相同，只有前端那一个分支不同 —— 这样「流畅」和
    「可控」不用维护两套代码。

    ``tool_result`` 是回给模型看的工具结果。它必须让模型确信
    **请求已经发起**，否则模型会在同一轮里反复调用本工具。
    """
    kind = "image" if str(kind or "").strip().lower() == "image" else "video"
    prompt = str(prompt or "").strip()
    reason = str(reason or "").strip()
    label = "图片" if kind == "image" else "视频"
    if need_confirm:
        tool_result = (
            "已向用户发起%s生成确认，正在等待用户点击「开始生成」。"
            "请不要再调用本工具，就当前内容回复用户即可。" % label
        )
    else:
        tool_result = (
            "已发起%s生成。请不要再调用本工具，告知用户正在生成即可。" % label
        )
    return {
        "kind": kind,
        "label": label,
        "prompt": prompt,
        "reason": reason,
        "need_confirm": bool(need_confirm),
        "tool_result": tool_result,
    }

def _is_output_moderation(code: str, msg: str) -> bool:
    blob = ("%s %s" % (code or "", msg or "")).lower()
    return any(m in blob for m in _MODERATION_MARKERS)

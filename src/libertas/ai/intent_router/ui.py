"""意图路由职责：ui。"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Tuple

from libertas.ai.intent_classifier import ClassificationResult, get_intent_classifier
from libertas.foundation.config import get_data_dir


class UIControlDetector:
    """UI控制检测器（吸收0.1.5）"""

    def __init__(self):
        # 编译窗口匹配正则
        # 长别名/长动词优先（「工具安装」先于「工具」、「切换到」先于「切换」）
        _alias_re = '|'.join(re.escape(a) for a in
                             sorted(WINDOW_ALIASES.keys(), key=len, reverse=True))
        _verb_re = '|'.join(re.escape(v) for v in
                            sorted(WINDOW_VERBS, key=len, reverse=True))
        # 动词是**必需**项，而且必须和窗口名紧挨着（中间只允许「一下/这个/我的」这类填充词）。
        # 旧实现把它写成可选 `(...)?`，等于「消息里只要出现窗口名就开窗」——
        # 而 WINDOW_ALIASES 里是一堆日常词（工具/扫描/设置/任务/记忆/报告/状态/配置…），
        # 正常聊天几乎句句命中，于是每说一句话就弹一个窗口。
        # 这里宁可少开一次，也不能乱开：没有明确动词就一律不开。
        self._window_pattern = re.compile(
            # 前面是「不/没/未/别/无法/不能」这类否定词时不算命令（"无法打开网页"不是要开浏览器）
            r'(?<!不)(?<!没)(?<!未)(?<!别)(?<!无法)(?<!不能)'
            r'(?:' + _verb_re + r')\s*(?:一下|下|个|我的|你的|这个|那个)?\s*'
            r'(' + _alias_re + r')'
        )

    def detect(self, text: str) -> List[Dict[str, Any]]:
        """检测UI控制指令，返回指令列表"""
        if not text or not text.strip():
            return []
        t = text.strip()
        commands = []

        # 只发出前端 executeIntentCommands 真正实现、且字段/取值对得上的指令：
        #   open_window ←→ case 'open_window'（读 cmd.window）
        #   orb_emote   ←→ case 'orb_emote'  （读 cmd.type，取值就是 ORB_COMMANDS 的 id）
        #
        # 主题/设置/引导/皮肤/灵体状态这几类**不再发出**：后端过去发出的 action
        # 前端 switch 里根本没有（switch_theme vs set_theme、change_setting vs
        # set_setting、show_guide vs orb_guide、change_skin vs skin…），
        # 而且取值也对不上当前 UI —— 皮肤真实 id 是 'blob'（不是 default/cyberpunk…），
        # 主题真实取值是 purple/dark/ocean/forest/sunset（不是 light/auto），
        # 设置键 音量/亮度 也不是应用里存在的设置项。
        # 也就是说它们一直是「看着有功能、其实空转」；更要命的是：只要有人**只把名字对齐**，
        # 这些更宽松的匹配（'自动''白天''好的''嗯''是什么'）会立刻变成大面积误触发。
        # 所以先不发出，对应的 _detect_* 实现保留在下面并注明接通需要补什么。

        # 1. 窗口打开/切换
        window = self._detect_window(t)
        if window:
            commands.append({"action": "open_window", "window": window})

        # 2. 灵体表情
        emote = self._detect_orb_command(t)
        if emote:
            commands.append({"action": "orb_emote", "type": emote})

        return commands

    def _detect_theme(self, text: str) -> Optional[str]:
        """检测主题（暂不发出）。

        接通需要：① 前端把 set_theme 改成调用真正的换肤函数（现在写的 data-theme 没人读，
        应用是用 --theme-primary 等 CSS 变量换肤）；② 这里把 light 映射成 purple、
        去掉应用里不存在的 auto；③ 只在 _is_command_like 时才算命中。
        """
        for theme_id, theme_info in THEMES.items():
            for keyword in theme_info['keywords']:
                if keyword in text:
                    return theme_id
        return None

    def _detect_window(self, text: str) -> Optional[str]:
        """检测窗口（50+个别名）"""
        match = self._window_pattern.search(text)
        if match:
            alias = match.group(1)
            if alias in WINDOW_ALIASES:
                return WINDOW_ALIASES[alias]
        return None

    def _detect_orb_command(self, text: str) -> Optional[str]:
        """检测灵体表情指令（返回 ORB_COMMANDS 的 id，与前端 orb_emote 的 type 一致）"""
        # 关键词里有「嘿」「在吗」「好的」「嗯」「不是」这类日常字眼：
        # 不做限制的话，正常聊天句句命中（"这不太对"→摇头）。只有整句很短、
        # 或者显式提到灵体时才算是在对它下命令。
        if not self._is_command_like(text):
            return None
        for cmd_id, keywords in ORB_COMMANDS.items():
            for keyword in keywords:
                if keyword in text:
                    return cmd_id
        return None

    # 关键词类检测（灵体表情/主题/皮肤…）只在「像一句命令」时才成立：
    # 整句很短，或显式提到灵体。否则正常聊天里会大面积误触发。
    _MAX_COMMAND_LEN = 8

    def _is_command_like(self, text: str) -> bool:
        t = (text or "").strip().strip("。！？!?~～,，. 、")
        return len(t) <= self._MAX_COMMAND_LEN or "灵体" in text

    def _detect_orb_state(self, text: str) -> Optional[Dict[str, Any]]:
        """检测灵体状态（暂不发出）。

        前端 orb_state 读的是 cmd.state，而灵体的状态类只有
        thinking/working/scanning/success/error/...（见 ORB_STATE_CLASSES），
        mood/size/speed 没有对应取值，发过去只会执行 setState('') 把状态清掉。
        """
        state_patterns = {
            'mood': {
                'happy': ['开心', '高兴', '快乐'],
                'sad': ['难过', '伤心', '悲伤'],
                'angry': ['生气', '愤怒', '恼火'],
                'calm': ['平静', '冷静', '安静'],
            },
            'size': {
                'big': ['变大', '放大', '大一点'],
                'small': ['变小', '缩小', '小一点'],
            },
            'speed': {
                'fast': ['快点', '加速', '快一点'],
                'slow': ['慢点', '减速', '慢一点'],
            },
        }
        for state_type, states in state_patterns.items():
            for state_id, keywords in states.items():
                for keyword in keywords:
                    if keyword in text:
                        return {state_type: state_id}
        return None

    def _detect_setting(self, text: str) -> Optional[Dict[str, Any]]:
        """检测设置变更（暂不发出）。

        这里的 音量/亮度/字体数字 并不是应用里存在的设置项
        （真实项是 theme / font_size(small|medium|large) / animations / window_shadow）。
        """
        # 音量
        volume_match = re.search(r'音量\s*(调|设|改)?\s*(到|为)?\s*(\d{1,3})', text)
        if volume_match:
            return {"key": "volume", "value": int(volume_match.group(3))}
        # 亮度
        brightness_match = re.search(r'亮度\s*(调|设|改)?\s*(到|为)?\s*(\d{1,3})', text)
        if brightness_match:
            return {"key": "brightness", "value": int(brightness_match.group(3))}
        # 字体大小
        font_match = re.search(r'字体\s*(大小)?\s*(调|设|改)?\s*(到|为)?\s*(\d{1,3})', text)
        if font_match:
            return {"key": "font_size", "value": int(font_match.group(4))}
        return None

    def _detect_guide(self, text: str) -> Optional[Dict[str, Any]]:
        """检测引导（暂不发出）。

        前端没有 show_guide / 帮助面板 对应的分支；「要看帮助」这类需求
        已经由窗口检测覆盖（"打开操作手册" → open_window('manual')）。
        """
        guide_patterns = {
            'tutorial': ['教程', '新手引导', '使用教程', '怎么用'],
            'help': ['帮助', '帮忙', '求助'],
            'about': ['关于', '介绍', '是什么'],
        }
        for guide_type, keywords in guide_patterns.items():
            for keyword in keywords:
                if keyword in text:
                    return {"type": guide_type}
        return None

    def _detect_skin(self, text: str) -> Optional[str]:
        """检测皮肤（暂不发出）。

        皮肤的真实 id 是 'blob'（默认光球）＋用户自定义皮肤，
        default/cyberpunk/minimal/nature 这几个都不存在，发过去只会空转。
        """
        skin_patterns = {
            'default': ['默认皮肤', '原始皮肤', '恢复皮肤'],
            'cyberpunk': ['赛博朋克', '赛博', '朋克'],
            'minimal': ['极简', '简约', '简洁'],
            'nature': ['自然', '森林', '绿色'],
        }
        for skin_id, keywords in skin_patterns.items():
            for keyword in keywords:
                if keyword in text:
                    return skin_id
        return None

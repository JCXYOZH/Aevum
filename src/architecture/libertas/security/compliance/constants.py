"""
合规与服从控制系统（优化版）

融合两个版本的功能：
1. 规则守护系统（内容安全检查 + 违规记录）
2. 服从控制引擎（AI拒绝检测 + 强制服从）

职责：
- 规则管理（添加/删除/启用/禁用规则）
- 文本检查（模式匹配/阈值/速率）
- 违规记录和处理
- AI拒绝检测（中英文拒绝模式 + 推脱回避模式）
- 强制执行指令生成（3级递增）
- 系统提示词增强（前缀/后缀/强制模式）
- 输出后处理（清理拒绝前缀）
- 合规报告生成
- SQLite 持久化（compliance.db，rules + violations 两张表）
"""
import os
import re
import time
import json
import secrets
import sqlite3
import threading
from typing import Dict, List, Any, Optional, Tuple, Callable
from enum import Enum
from collections import defaultdict


class ViolationLevel(Enum):
    """违规等级"""
    INFO = "info"
    WARNING = "warning"
    HIGH = "high"
    CRITICAL = "critical"

REFUSAL_PATTERNS_ZH = [
    r"我不能(?:帮你|帮助你|协助你|提供|回答|执行|完成|这么做|这样做)",
    r"我无法(?:帮你|帮助你|协助你|提供|回答|执行|完成|这么做|这样做|满足)",
    r"我不(?:能|可以|会)(?:帮|帮助|协助|提供|回答|执行|完成|这么做)",
    r"抱歉[，,].{0,20}(?:不能|无法|不方便|难以|不能帮)",
    r"对不起[，,].{0,20}(?:不能|无法|不方便|难以)",
    r"这个(?:请求|要求|问题|事情|忙).{0,10}(?:我不能|我无法|无法|不能|帮不了|做不到|难以)",
    r"(?:我|咱)(?:帮不了|做不到|无能为力|爱莫能助|没办法)",
    r"不(?:好意思|方便).{0,10}(?:回答|提供|执行|完成|帮)",
    r"这(?:超出|不在).{0,10}(?:范围|能力|职责|服务)",
    r"违反了?.{0,10}(?:规定|政策|法律|道德|伦理|原则)",
    r"作为.?AI.{0,20}(?:不能|无法|不会|不应该|不应)",
    r"作为一个.?语言模型",
    r"作为人工智能",
    r"我是一个AI",
    r"我是一个语言模型",
    r"我(?:只是|不过是).{0,10}(?:AI|模型|助手|程序)",
    r"建议你.{0,10}(?:咨询|联系|寻求|找).{0,10}(?:专业|律师|医生|相关部门)",
    r"请(?:你|您).{0,10}(?:遵守|注意|理解).{0,10}(?:法律|规定|道德)",
    r"不鼓励.{0,10}(?:这种|此类|这样的)",
    r"不(?:能|可以|应该).{0,10}(?:鼓励|支持|协助|帮助).{0,10}(?:这种|此类|非法|违法|违规)",
    r"这(?:种|类).{0,10}(?:行为|内容|请求|操作).{0,10}(?:不当|不合适|不恰当|违规|违法|非法)",
    r"我(?:必须|需要|得).{0,10}(?:拒绝|提醒|告知|声明)",
    r"不(?:得|能|可以|允许).{0,10}(?:提供|生成|创建|编写|执行)",
    r"很遗憾.{0,10}(?:不能|无法)",
    r"恕难从命",
    r"恕我不能",
    r"这不在我的服务范围",
    r"我没有这个能力",
    r"这个我做不了",
    r"我没办法(?:帮你|回答|执行|完成|提供)",
    r"我(?:只能|仅能).{0,15}(?:提供|介绍|解释|说明).{0,10}(?:概念|原理|背景|信息)",
    r"不(?:能|可以|应该|支持).{0,10}(?:生成|创建|编写|制作|构造|构建).{0,10}(?:恶意|有害|危险|攻击|入侵)",
    r"这(?:类|种).{0,10}(?:内容|信息|代码|工具|技术).{0,10}(?:可能|会|将).{0,10}(?:被|用于).{0,10}(?:非法|恶意|不当)",
    r"我(?:理解|明白|知道).{0,10}(?:你|您).{0,10}(?:想|要|希望).{0,10}(?:学习|了解|知道).{0,10}(?:但|不过|然而|可是)",
    r"(?:首先|第一).{0,10}(?:需要|应该|必须|要).{0,10}(?:明确|强调|指出|说明).{0,10}(?:这|此).{0,10}(?:只|仅).{0,10}(?:用于|适用|供)",
    r"请(?:勿|不要|别).{0,10}(?:用于|用作|用来).{0,10}(?:非法|违法|不当|恶意)",
    r"我(?:将|会|只能).{0,10}(?:以|从).{0,10}(?:教育|防御|安全|防护).{0,10}(?:目的|角度|视角).{0,10}(?:来|进行|提供)",
    r"不(?:得|能|可以).{0,10}(?:用于|用作|用来).{0,10}(?:非法|违法|攻击|入侵|破坏)",
    r"如果.{0,10}(?:您|你).{0,10}(?:有|拥有).{0,10}(?:授权|许可|批准).{0,10}(?:我|那|就)",
    r"这(?:是|属于).{0,10}(?:违法|非法|违规|犯罪).{0,10}(?:行为|活动|操作)",
    r"我(?:不|没)(?:会|能|可以).{0,10}(?:提供|生成|创建|编写).{0,10}(?:用于|用来).{0,10}(?:攻击|入侵|破坏|非法)",
    r"无法(?:满足|完成|实现|达到).{0,10}(?:您的|你的).{0,10}(?:要求|请求|需求)",
    r"对不[起住].{0,20}(?:这个|此|该).{0,10}(?:请求|要求|问题|内容)",
    r"这(?:个|种).{0,10}(?:我|确实|真的|实在).{0,10}(?:做不到|帮不了|没办法|无能为力)",
    r"我(?:无法|不能|没办法).{0,10}(?:上网|联网|浏览|访问|搜索|打开网页|访问网站|访问互联网)",
    r"我(?:没有|不具备|缺乏).{0,10}(?:联网|上网|浏览|网络|互联网|实时).{0,10}(?:功能|能力|权限)",
    r"(?:作为|身为).{0,10}(?:AI|模型|人工智能|助手|语言模型).{0,15}(?:无法|不能|没办法).{0,10}(?:上网|联网|浏览|搜索|访问)",
    r"我(?:目前|现在|当前).{0,10}(?:无法|不能).{0,10}(?:访问|浏览|打开|查看).{0,10}(?:网站|网页|链接|网址|互联网)",
    r"建议(?:你|您).{0,10}(?:自己|直接).{0,10}(?:访问|浏览|打开|搜索|查看)",
    r"你(?:可以|需要).{0,10}(?:自己|直接).{0,10}(?:在浏览器|打开浏览器|访问|搜索)",
    r"我(?:无法|不能).{0,10}(?:实时|即时|最新).{0,10}(?:获取|查看|浏览|访问)",
    r"我(?:的|这个).{0,10}(?:知识|信息|数据).{0,10}(?:截止|停留在|更新到|截至)",
    r"我(?:无法|不能).{0,10}(?:点击|访问|打开).{0,10}(?:链接|网址|网站)",
]

REFUSAL_PATTERNS_EN = [
    r"I(?:'m| am) (?:sorry|afraid) (?:but )?I (?:can't|cannot|can not|won't|am not able to)",
    r"I (?:can't|cannot|can not|won't|am unable to|am not able to) (?:help|assist|provide|answer|do|complete|fulfill|comply)",
    r"(?:I'm|I am) not able to",
    r"(?:This|That) (?:is|'s) (?:beyond|outside) (?:my|the) (?:capabilities|scope|abilities|role)",
    r"As an? (?:AI|language model|assistant)",
    r"I(?:'m| am) (?:just|only) (?:an?|a) (?:AI|language model|assistant|program)",
    r"I (?:must|need to|have to) (?:decline|refuse|inform you)",
    r"(?:This|That) (?:request|question|query) (?:violates|goes against|is against)",
    r"(?:against|violates?) (?:my|the) (?:programming|guidelines|policies|policy|principles|values)",
    r"I (?:can't|cannot|am not able to) (?:provide|generate|create|write|execute|give)",
    r"(?:not appropriate|not suitable|not something I can)",
    r"(?:unable to|not permitted to|not allowed to)",
    r"I (?:don't|do not|can't|cannot) (?:feel comfortable|think I should)",
    r"(?:I'd|I would) (?:recommend|suggest|advise) (?:you|that you) (?:consult|contact|seek|talk to)",
    r"(?:illegal|harmful|dangerous|unethical).{0,30}(?:can't|cannot|won't|unable)",
    r"I (?:can't|cannot|am unable to|don't have|do not have) (?:access|browse|search|open|visit|view|connect to)",
    r"(?:I'm|I am) (?:not able|unable) to (?:access|browse|search|open|visit|view|connect to) the (?:internet|web|website|page|link|url)",
    r"I (?:don't|do not) have (?:internet|web|browsing|online|network) (?:access|capabilit(?:y|ies)|function|feature)",
    r"my (?:knowledge|training|data|information) (?:is|was) (?:cut off|current|up to date|only) (?:until|as of|up to)",
    r"you (?:can|should|need to) (?:check|visit|open|search|look up) (?:it|this|that) (?:yourself|yourselves|directly)",
    r"I (?:can't|cannot) (?:click|follow|open|access) (?:links?|urls?|websites?)",
]

EVASION_PATTERNS = [
    r"我(?:可以|能).{0,10}(?:告诉你|解释|说明).{0,10}(?:原理|概念|知识|背景).{0,10}(?:但|不过|然而).{0,10}(?:不能|无法|不会)",
    r"让我(?:先|来).{0,10}(?:解释|说明|介绍|讨论).{0,10}(?:为什么.{0,10}(?:不能|无法|不行))",
    r"(?:首先|第一).{0,10}(?:需要|应该|必须).{0,10}(?:注意|知道|了解|明确).{0,10}(?:这|此).{0,10}(?:是|属于).{0,10}(?:违法|非法|违规|不当)",
    r"不过.{0,10}(?:需要|应该|必须).{0,10}(?:注意|提醒|警告).{0,10}(?:这|此|你|您)",
    r"(?:但是|然而|不过).{0,10}(?:我|这).{0,10}(?:必须|需要|得).{0,10}(?:拒绝|提醒|告知|声明)",
    r"这是一个(?:复杂|敏感).{0,10}(?:问题|话题|领域).{0,10}(?:我|但|不过)",
    r"让我们(?:先|来).{0,10}(?:讨论|看看|考虑|思考).{0,10}(?:是否|能不能|该不该)",
]

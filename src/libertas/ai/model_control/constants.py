"""
模型控制层

统一管理AI模型的调用、路由、限流、降级、缓存、成本控制、模型切换。
"""
import os
import re
import json
import time
import uuid
import hashlib
import threading
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal


_REFUSAL_ZH = [
    r"我(?:无法|不能|没法|没办法|不会|不可|不可以|不便|不予)(?:帮|协助|提供|完成|执行|回答|告诉|透露|生成|编写|创作|搜索|访问|浏览|打开|连接|联网|下载|安装|运行|处理|满足|接受|同意|支持|实现|参与|涉及|继续)",
    r"(?:抱歉|对不起|不好意思|请谅解|望理解)[，,。.\s]*(?:我|这)?(?:无法|不能|没法|不会|不可|不便|不予|难以|没办法|爱莫能助|无能为力|力不从心)",
    r"作为(?:一个|一名)?(?:AI|人工智能|语言模型|大模型|助手|智能助手|聊天机器人|程序|系统|机器)[，,。.\s]*(?:我|这)?(?:无法|不能|没法|不会|不可|不便|不予|难以|没办法|不能为|无法为|不会为|不被允许|不允许|没有权限|没有能力|没有联网|不能联网|无法联网|不能访问|无法访问|不能浏览|无法浏览|不能搜索|无法搜索)",
    r"(?:违反|触犯|违背|不符合|不合规|涉及|涉嫌)(?:法律|法规|规定|政策|道德|伦理|准则|规范|条例|法案|条款|安全策略|内容政策|使用条款|服务条款|社区规范|平台规定|开发者政策|内容审核)",
    r"(?:我|这)(?:建议|推荐|提议|希望|恳请|要求)(?:您|你|用户)(?:咨询|联系|寻求|找|参考|阅读|查看|遵守|注意|谨慎)(?:专业|律师|医生|相关部门|权威|官方|法律|安全|当地|技术支持|客服)",
    r"(?:请|希望|建议|务必|需要|应当|应该)(?:注意|牢记|遵守|谨慎|小心|了解|知道|明白|理解|意识到)(?:法律|规定|安全|风险|后果|责任|合规|道德|伦理|政策|条款|规范|准则)",
    r"(?:这个|此|该)(?:问题|请求|要求|内容|话题|操作|行为|信息|指令)(?:我|这)?(?:无法|不能|没法|不会|不可|不便|不予|难以|没办法|不方便|不适合|不适宜|不能提供|无法提供|不能完成|无法完成|不能满足|无法满足|不能处理|无法处理|不能回答|无法回答|不能帮助|无法帮助|不能协助|无法协助|不能实现|无法实现|不能支持|无法支持|不能参与|无法参与|不能涉及|无法涉及|不能继续|无法继续|不能接受|无法接受|不能同意|无法同意|不能执行|无法执行|不能满足|无法满足)",
    r"(?:我|这)(?:没有|无|缺少|缺乏)(?:联网|网络|上网|浏览|搜索|访问|连接|互联网|在线|实时|最新|外部)(?:能力|功能|权限|工具|接口|途径|条件|资格)",
    r"(?:搜索|网络|联网|上网|浏览|访问|连接)(?:工具|功能|服务|能力)(?:失败|不可用|连不上|无法|不能|出错|故障|异常|受限|被限制|被禁止|不可访问|无法连接|无法使用|暂时不可用|当前不可用)",
    r"(?:对方暂时没有回应|暂无回应|无回应|对方未回应|暂时无法回应)",
    r"(?:我|这)(?:只是|仅仅是|不过是)(?:一个|一名)?(?:AI|人工智能|语言模型|大模型|助手|程序|系统|机器|工具)[，,。.\s]*(?:没有|无|不具备|不能|无法|不会)(?:实体|物理|真实|实际|实时|联网|搜索|浏览|访问|执行|操作|运行|安装|下载|修改|删除|控制|管理)",
    r"(?:不能|无法|不会|不可|不便|不予|难以)(?:为|给|帮|替|协助|帮助)(?:您|你|用户|他人|任何人)(?:提供|编写|生成|创作|完成|执行|搜索|访问|浏览|打开|连接|下载|安装|运行|处理|满足|接受|同意|支持|实现|参与|涉及|继续)",
    r"(?:温馨|友好|善意|安全|重要|特别|郑重)?(?:提示|提醒|警告|告知|声明|说明|通知|公告)[：:][\s\S]{0,100}(?:安全|风险|法律|合规|政策|规定|条款|道德|伦理|责任|后果|谨慎|注意|遵守|咨询|专业|官方|权威|当地|部门|律师|医生)",
    r"(?:我|这)(?:必须|需要|应当|应该|只能)(?:遵守|遵循|服从|按照|根据|依据)(?:法律|法规|规定|政策|道德|伦理|准则|规范|条例|条款|安全策略|内容政策|使用条款|服务条款|社区规范|平台规定|开发者政策|内容审核|训练|设计|编程|设定|原则|底线)",
    r"(?:这个|此|该)(?:问题|请求|要求|内容|话题|操作|行为|信息|指令)(?:超出|超过|不在|不属于)(?:我的|我|能力|范围|权限|职责|服务|功能|知识|训练|数据|领域)",
    r"(?:我|这)(?:不能|无法|不会|不可|不便|不予|难以)(?:保证|确保|承诺|担保|负责|承担|确认|验证|证明|判断|决定|替代|代表|冒充|伪装|假装)",
    r"(?:禁止|严禁|不允许|不可以|不接受|不支持|不提供|不协助|不参与|不涉及|不继续|不同意|不执行|不满足)(?:此类|这种|该|任何|相关)?(?:操作|行为|请求|要求|内容|话题|信息|指令|问题)",
    r"(?:我|这)(?:的|之)(?:回答|回复|内容|信息|建议|意见|观点|看法|判断|结论)(?:仅供|只供|仅作|只作)(?:参考|学习|交流|讨论|娱乐)(?:，|,|。|.|不|请|建议|希望|务必|需要|应当|应该)",
    r"(?:不(?:是|属于)(?:专业|医疗|法律|财务|投资|技术|官方|权威|认证|授权|合格|执业|注册)(?:人士|人员|机构|顾问|医生|律师|会计师|工程师|专家|建议|意见|诊断|治疗|方案))",
]

_REFUSAL_EN = [
    r"I\s+(?:cannot|can't|can not|am unable to|am not able to|must decline|will not|won't|am not permitted to|am not allowed to|am not authorized to|don't have|do not have|lack)\b[\s\S]{0,80}?(?:assist|help|provide|complete|execute|answer|tell|reveal|generate|write|create|search|access|browse|open|connect|download|install|run|process|fulfill|accept|agree|support|implement|engage|continue|comply|do|perform|make|give|share|disclose|offer)",
    r"I\s+(?:cannot|can't|can not|am unable to|am not able to)\s+(?:search|browse|access|connect|open|download|install|run|execute|provide|help|assist|do|perform|complete|answer|reply|respond|give|share|disclose|reveal|tell|generate|write|create|make|offer|support|engage|continue|comply|fulfill|accept|agree|implement|process)\b",
    r"(?:I'm|I am)\s+(?:sorry|afraid|unable|not able|not permitted|not allowed|not authorized|not capable|just|only|merely)\b",
    r"(?:As|Being)\s+(?:an?|the)\s+(?:AI|artificial intelligence|language model|LLM|assistant|chatbot|machine learning|text-based|virtual|digital)\b",
    r"(?:against|violates?|violation of|in violation of|breach(?:es)?|non-compliant with|not compliant with|conflicts? with)\s+(?:my|the|our|your)?\s*(?:polic(?:y|ies)|guidelines?|terms?|safety|ethics?|principles?|values?|rules?|regulations?|laws?|content policy|usage policy|developer policy|terms of service|terms of use|community guidelines|safety standards|ethical guidelines|programming|training|design|directives?|instructions?|constraints?|limitations?|restrictions?|boundaries?)",
    r"(?:I|We)\s+(?:must|need to|have to|should|ought to|am required to|am programmed to|am designed to|am trained to)\s+(?:decline|refuse|reject|avoid|refrain|stop|cease|not|follow|adhere|comply|respect|uphold|maintain|ensure|prioritize|consider|be careful|exercise caution)",
    r"(?:please|kindly)\s+(?:consult|contact|seek|refer to|reach out to|speak with|talk to|visit|check|read|review|follow|ensure|be aware|note|understand|remember|keep in mind)\b",
    r"(?:I|We)\s+(?:don't|do not|cannot|can't|won't|will not|am not going to|am not about to)\s+(?:be able to|be providing|be assisting|be helping|be generating|be creating|be writing|be searching|be browsing|be accessing|be downloading|be installing|be running|be executing|be performing|be doing|be making|be giving|be sharing|be disclosing|be offering|be engaging|be continuing|be complying|be fulfilling|be accepting|be agreeing|be supporting|be implementing|be participating|be involved)",
    r"(?:not|unable to|cannot|can't|won't|will not|refuse to|decline to)\s+(?:provide|assist|help|generate|create|write|produce|offer|share|disclose|reveal|give|make|do|perform|execute|run|complete|fulfill|satisfy|accept|agree|support|implement|engage|participate|involve|continue|comply|answer|respond|reply|address|solve|resolve|handle|deal with|process|deal|cope|manage|tackle|approach)",
    r"(?:this|that|the|your|such)\s+(?:request|question|query|inquiry|task|content|topic|operation|action|behavior|information|instruction|prompt|input)\s+(?:is|are|seems|appears|falls|goes|lies)\s+(?:beyond|outside|against|in violation of|not within|inappropriate for|unsuitable for|unacceptable for|not allowed|not permitted|not something|not able|unable|refused|declined|rejected|blocked|flagged|filtered|restricted|prohibited|banned|forbidden)",
    r"(?:I|We)\s+(?:have|possess|lack|do not have|don't have)\s+(?:no\s+)?(?:access|ability|capability|capacity|means|tools?|features?|functionality|permission|authorization|credentials?|qualifications?|expertise|knowledge|data|information|resources?|connectivity|internet|network|browsing|search|real-time|live|external|web|online)\b",
    r"(?:temporarily|currently|presently|right now|at this time|at the moment|for now)\s+(?:unavailable|not available|unable|not possible|not working|not functioning|down|offline|inaccessible|blocked|restricted|limited|disabled|suspended|maintenance)",
    r"(?:I'm|I am)\s+(?:not|unable|not able|not capable|not qualified|not licensed|not certified|not authorized|not a|just|only|merely|simply)\b",
    r"(?:disclaimer|warning|caution|notice|advisory|important note|please note|kindly note)\s*[:：]",
    r"(?:for\s+)?(?:educational|informational|entertainment|reference|general)\s+(?:purposes?|use|information|context)\s+(?:only|solely|exclusively)",
    r"(?:not\s+a\s+substitute\s+for|should\s+not\s+be\s+used\s+as|cannot\s+replace|does\s+not\s+replace|no\s+替代)\b",
    r"(?:seek|consult|contact|refer to|speak with|talk to|visit|call|email|reach out to)\s+(?:professional|licensed|qualified|certified|authorized|medical|legal|financial|technical|expert|appropriate|relevant|local|official|authorities?|emergency|support|help desk|customer service)\b",
    r"(?:I|We)\s+(?:can|could|might|may)\s+(?:provide|offer|give|share|suggest|recommend)\s+(?:general|basic|brief|high-level|conceptual|theoretical|background|contextual|introductory|educational)\s+(?:information|overview|guidance|context|background|introduction|explanation|description|summary|principles|concepts|ideas|thoughts|perspectives)\s*(?:only|,|but|however|though|although|yet|still|nevertheless)",
]

_EVASION_PATTERNS = [
    r"(?:让我|我来|我先|我尝试|我试着|我看看|我想想|我考虑|我研究|我查一下|我搜索一下|我看看能不能)[\s\S]{0,30}(?:吧|呢|啊|哦|嗯|。|$)",
    r"(?:这个|那个|这|那)(?:问题|事情|东西|内容|话题|方面)[\s\S]{0,20}(?:比较|挺|很|非常|相当|特别|有点|有些|可能|也许|或许|大概|应该|似乎|好像)[\s\S]{0,20}(?:复杂|难|麻烦|敏感|特殊|重要|严肃|严重|深奥|专业|广泛|庞大|多|大|深|广)",
    r"(?:我|这)(?:理解|明白|知道|了解|清楚|懂得|意识到|认识到|体会到|感受到)[\s\S]{0,50}(?:好奇|兴趣|想法|感受|心情|情绪|处境|情况|需求|要求|愿望|期待|目标|意图|目的|动机|原因|理由|背景|故事|经历|经验|观点|看法|立场|态度|信念|价值观|世界观|人生观|哲学)",
    r"(?:您|你)(?:为什么|为何|怎么|如何|啥|哪里|哪儿|哪个|哪些|什么时候|何时)[\s\S]{0,30}(?:想|要|需要|希望|打算|计划|准备|决定|选择|喜欢|偏好|倾向|觉得|认为|感觉|相信|怀疑|担心|害怕|焦虑|紧张|不安|犹豫|纠结|矛盾|困惑|迷茫|不确定)",
    r"(?:不如|要不|要不然|建议|推荐|不妨|可以|不妨|试试|尝试|考虑|要不要|怎么样|如何|好不好|行不行|可以吗)[\s\S]{0,50}(?:换|改|聊|谈|说|讲|讨论|探索|尝试|看看|想想|考虑|关注|聚焦|转移|回到|找|寻求|选择|挑选|决定)",
    r"(?:哈哈|呵呵|嘿嘿|嘻嘻|嗯嗯|噢噢|哦哦|好的|好吧|行吧|是吧|对呢|是的|没错|就是这样|当然|自然|确实|的确|也许吧|可能吧|大概吧|应该是|差不多|马马虎虎|一般般|还好|还行|凑合|就这样吧|随便吧|无所谓|没关系|没事|不要紧|不重要)",
    r"(?:我|这)(?:比较|更|最|挺|很|非常|相当|特别|有点|有些|稍微|略微|多少|或多或少)(?:喜欢|偏好|倾向|擅长|熟悉|了解|知道|懂|明白|清楚|关注|感兴趣|在意|在乎|看重|重视|欣赏|享受|热爱|着迷|沉迷|投入|专注|致力于|追求|向往|渴望|期待|希望|想要|需要|觉得|认为|感觉|相信|觉得|以为|感到|发现|注意到|意识到|认识到|体会到|感受到)",
]

_INJECTION_PATTERNS = [
    r"\[(?:SYSTEM|ADMIN|DEVELOPER|INSTRUCTION|OVERRIDE|SAFETY|FILTER|MODERATION|POLICY|ROOT|SUPERUSER|OPERATOR|MAINTENANCE|UPDATE|UPGRADE|NOTICE|WARNING|ERROR|ALERT|CRITICAL|URGENT|IMPORTANT|ANNOUNCEMENT|BROADCAST|GLOBAL|UNIVERSAL|FINAL|ULTIMATE|ABSOLUTE|SUPREME|OVERRIDE|RESET|CLEAR|IGNORE|FORGET|DISREGARD|NEGATE|CANCEL|ABORT|STOP|HALT|TERMINATE|SHUTDOWN|REBOOT|RESTART|REFRESH|RELOAD|RECONFIGURE|RECALIBRATE|REALIGN|REORIENT|REPROGRAM|RETRAIN|REWRITE|REDESIGN|REBUILD|RECONSTRUCT|REINITIALIZE|RESET|RESTORE|RECOVER|REPAIR|FIX|PATCH|UPDATE|UPGRADE)\s*[^\]]*\]",
    r"(?:^|\n)\s*(?:System|Admin|Developer|Instruction|Moderation|Policy|Root|Superuser|Operator|Maintenance|Notice|Warning|Error|Alert|Critical|Urgent|Important|Announcement|Broadcast|Global|Universal|Final|Ultimate|Absolute|Supreme)\s*[:：]\s*",
    r"(?:^|\n)\s*(?:\[|<<|<!--|/\*|#|//|--)\s*(?:system|admin|developer|instruction|override|safety|filter|moderation|policy|root|superuser|operator|maintenance|notice|warning|error|alert|critical|urgent|important|announcement|broadcast|global|universal|final|ultimate|absolute|supreme)\b",
    r"(?:ignore|disregard|forget|override|negate|cancel|abort|stop|halt|terminate|reset|clear|bypass|skip|disable|deactivate|turn off|shut down)\s+(?:all\s+)?(?:previous|prior|above|foregoing|preceding|earlier|the\s+above|your\s+previous|all\s+previous|earlier\s+instructions?|system\s+prompts?|safety\s+(?:filters?|guidelines?|policies?|restrictions?|measures?|protocols?)|content\s+(?:policies?|filters?|moderation|guidelines?)|guardrails?|restrictions?|limitations?|constraints?|rules?|directives?|programming|training|alignment|values?|ethics?|principles?|instructions?|prompts?|directives?)",
    r"(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|new\s+instructions?|updated\s+instructions?|system\s+update|prompt\s+update|mode\s+activated|developer\s+mode|jailbreak|DAN\s+mode|unrestricted\s+mode|god\s+mode|free\s+mode|unfiltered\s+mode|no\s+restrictions?|no\s+limits?|no\s+rules?|anything\s+goes|without\s+any\s+restrictions?|without\s+limits?|fully\s+unrestricted|completely\s+free|absolutely\s+anything)",
    r"(?:LOCAL_COMMAND|LOCAL_SEARCH_RESULT|LOCAL_SYSTEM|NATIVE_TOOL_CALL|INTERNAL_|PRIVATE_|SECRET_|CLASSIFIED_|CONFIDENTIAL_)[\s\S]{0,50}",
]

_PROTOCOL_LEAK_PATTERNS = [
    r"<[｜|]{2}DSML[｜|]{2}[^>]*>.*?</[｜|]{2}DSML[｜|]{2}[^>]*>",
    r"</?[｜|]{2}DSML[｜|]{2}[^>]*>",
    r"<\|function\|>[^<]*<\|end\|>",
    r"<\|im_start\|>|<\|im_end\|>",
    r"<\|system\|>|<\|user\|>|<\|assistant\|>",
    r"<<<NATIVE_TOOL_CALL:[^>]*>>>",
    r"<<<FILE:[^>]*>>>",
    r"<<<WEB_[A-Z_]+:[^>]*>>>",
    r"<<<END>>>",
    r"\[LOCAL_COMMAND\][\s\S]*?\[/LOCAL_COMMAND\]",
    r"=+\s*LOCAL_SEARCH_RESULT_(?:BEGIN|END)[\s\S]*?=+",
]

_EMPTY_REPLY_PATTERNS = [
    r"^\s*$",
    r"^\s*(?:对方暂时没有回应|暂无回应|无回应|（对方暂时没有回应）|\(对方暂时没有回应\))\s*$",
    r"^\s*(?:\.\.\.|。。。|……|———|—+|\.+\s*)$",
    r"^\s*(?:嗯+|哦+|啊+|哈+|嘿+|嘻+|额+|呃+|呀+|哇+|噢+|喔+|诶+|欸+)\s*[。.！!？?~～]*\s*$",
    r"^\s*(?:好的?|好吧|行吧|是吧|对呢?|是的?|没错|当然|自然|确实|的确|也许|可能|大概|应该|差不多|还好|还行|凑合|随便|无所谓|没关系|没事|不要紧|不重要)\s*[。.！!？?~～]*\s*$",
]

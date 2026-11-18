"""
治理模块
- 角色与权限：5种角色，9项权限，角色带过期日期
- 提案与投票：社区发起提案，达到共识度即可通过
- 分叉机制：共识达成后可导出完整规则+代码快照，形成独立平台
- 全局统计：通过 MQTT 广播聚合在线用户数
"""
import os
import json
import time
import uuid
import sqlite3
import threading
import shutil
import zipfile
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from pathlib import Path
from libertas.foundation.config import get_data_dir


ROLE_PERMISSIONS = {
    "owner": {"label": "所有者", "weight": 5, "desc": "平台创建者，拥有最高决策权，可修改治理规则、分配所有角色、发起分叉", "permissions": {}},
    "admin": {"label": "管理员", "weight": 4, "desc": "系统管理者，可分配角色、封禁用户、管理房间、发布版本，但不可修改治理规则", "permissions": {}},
    "arbitrator": {"label": "仲裁者", "weight": 3, "desc": "纠纷仲裁人，可处理违规申诉、否决不当提案、仲裁争议，独立于管理链", "permissions": {}},
    "moderator": {"label": "版主", "weight": 3, "desc": "日常管理者，可删除消息、置顶话题、踢出用户、警告违规，不可封禁或改角色", "permissions": {}},
    "maintainer": {"label": "维护者", "weight": 3, "desc": "代码维护者，可发布版本、审核代码合并、管理工具更新，由贡献者晋升", "permissions": {}},
    "reviewer": {"label": "审核员", "weight": 2, "desc": "内容审核员，可审核内容、标记违规、参与提案评审，无管理处罚权", "permissions": {}},
    "contributor": {"label": "贡献者", "weight": 2, "desc": "有实质贡献的成员（代码/文档/帮助），可对提案投票、发布版本候选", "permissions": {}},
    "member": {"label": "成员", "weight": 1, "desc": "已注册并激活的正式成员，可聊天、发文件、参与讨论、提交提案", "permissions": {}},
    "guest": {"label": "访客", "weight": 0, "desc": "未注册或未激活的访客，仅可查看公开信息和接收更新，不可发言和投票", "permissions": {}},
    "muted": {"label": "禁言", "weight": 0, "desc": "因违规被限制发言的用户，可查看但不可发送消息，到期自动恢复", "permissions": {}},
}

ROLE_DEFAULT_PERMS = {
    "owner": {"can_send": True, "can_send_files": True, "can_invite": True, "can_kick": True,
              "can_ban": True, "can_change_roles": True, "can_view_history": True, "can_delete": True,
              "can_change_room": True, "can_vote": True, "can_fork": True, "can_review_content": True,
              "can_arbitrate": True, "can_pin": True, "can_publish": True, "can_download_code": True},
    "admin": {"can_send": True, "can_send_files": True, "can_invite": True, "can_kick": True,
              "can_ban": True, "can_change_roles": True, "can_view_history": True, "can_delete": True,
              "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
              "can_arbitrate": False, "can_pin": True, "can_publish": True, "can_download_code": True},
    "arbitrator": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
                   "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
                   "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
                   "can_arbitrate": True, "can_pin": False, "can_publish": False, "can_download_code": True},
    "moderator": {"can_send": True, "can_send_files": True, "can_invite": True, "can_kick": True,
                  "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": True,
                  "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
                  "can_arbitrate": False, "can_pin": True, "can_publish": False, "can_download_code": False},
    "maintainer": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
                   "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
                   "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
                   "can_arbitrate": False, "can_pin": False, "can_publish": True, "can_download_code": False},
    "reviewer": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
                 "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
                 "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
                 "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
    "contributor": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
                    "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
                    "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": False,
                    "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
    "member": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
               "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
               "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": False,
               "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
    "guest": {"can_send": True, "can_send_files": False, "can_invite": False, "can_kick": False,
              "can_ban": False, "can_change_roles": False, "can_view_history": False, "can_delete": False,
              "can_change_room": False, "can_vote": False, "can_fork": True, "can_review_content": False,
              "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
    "muted": {"can_send": False, "can_send_files": False, "can_invite": False, "can_kick": False,
              "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
              "can_change_room": False, "can_vote": False, "can_fork": True, "can_review_content": False,
              "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
    # 兼容旧角色名
    "auditor": {"can_send": True, "can_send_files": True, "can_invite": False, "can_kick": False,
                "can_ban": False, "can_change_roles": False, "can_view_history": True, "can_delete": False,
                "can_change_room": False, "can_vote": True, "can_fork": True, "can_review_content": True,
                "can_arbitrate": False, "can_pin": False, "can_publish": False, "can_download_code": False},
}

PROPOSAL_TYPES = {
    "technical": {"label": "技术提案", "threshold": 0.60, "min_voters": 50, "duration_days": 14,
                  "min_contribution": 10, "cooldown_days": 7,
                  "desc": "代码改进、架构变更、功能新增"},
    "governance": {"label": "治理提案", "threshold": 0.75, "min_voters": 100, "duration_days": 30,
                   "min_contribution": 50, "cooldown_days": 14,
                   "desc": "规则修改、角色变更、权限调整"},
    "resource": {"label": "资源分配", "threshold": 0.67, "min_voters": 80, "duration_days": 21,
                 "min_contribution": 30, "cooldown_days": 10,
                 "desc": "存储、带宽、算力等资源分配"},
    "violation": {"label": "违规申诉", "threshold": 0.51, "min_voters": 10, "duration_days": 7,
                  "min_contribution": 0, "cooldown_days": 3,
                  "desc": "封禁申诉、违规处理仲裁"},
    "fork": {"label": "分叉提案", "threshold": 0.80, "min_voters": 1000, "duration_days": 60,
             "min_contribution": 200, "cooldown_days": 180,
             "desc": "社区分叉、独立平台创建（需1000人以上社区、贡献分200+）"},
}

DEFAULT_ROLE_EXPIRY_DAYS = 365 * 5
CONSENSUS_THRESHOLD = 0.67
FORK_THRESHOLD = 0.80
FORK_MIN_COMMUNITY = 1000
FORK_MIN_CONTRIBUTION = 200
FORK_COOLDOWN_DAYS = 180
PROPOSAL_COOLDOWN_DAYS = 7

WARNINGS = {
    "proposal": "⚠️ 提案是严肃的社区行为，请确保您已充分讨论并理解后果。提案一旦发起不可撤回，将进入公示和投票期。",
    "fork": "⚠️ 分叉是极其严肃的决定！这将复制整个平台的规则和代码，创建一个独立的新平台。分叉需要社区1000人以上参与、80%以上共识、贡献分200+，且180天内只能发起一次。请谨慎决定，这关系到整个社区的走向。",
    "vote": "您的投票将被记录且不可更改，请基于事实和社区利益审慎投票。",
}

SLOGAN = "这里，创造高于消费，心法高于功能，自由高于归属。"



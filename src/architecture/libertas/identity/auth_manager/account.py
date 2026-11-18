"""
统一认证与授权管理器

集中管理认证策略、权限矩阵、角色继承、访问控制列表、审计。
"""
import os
import json
import sqlite3
import time
import uuid
import hashlib
import hmac
import secrets
import threading
from typing import Any, Dict, List, Optional, Set, Tuple
import base64
import hmac
import hashlib
import secrets

LICENSE_SECRET = b"Libertas-License-Secret-2026-DoNotShare"
LICENSE_VERSION = 1
from datetime import datetime
from enum import Enum
from libertas.foundation.config import get_data_dir
from libertas.foundation.terminal import terminal

from .constants import LICENSE_SECRET, LICENSE_VERSION
from .crypto import generate_identity_id, generate_license_key, hash_password, validate_email, validate_phone, verify_license_key, verify_password
from .models import PermissionAction, Role, ACLItem


class AuthAccountMixin:
    """验证码、激活、许可证、找回与重置。"""

    def send_verification_code(self, email: str = "", phone: str = "",
                                purpose: str = "register") -> Dict[str, Any]:
        """发送验证码（开发模式下返回验证码，生产环境应接入邮件/短信服务）"""
        target = email or phone
        if not target:
            return {"success": False, "message": "邮箱或手机号不能为空"}
        if email and not validate_email(email):
            return {"success": False, "message": "邮箱格式不正确"}
        if phone and not validate_phone(phone):
            return {"success": False, "message": "手机号格式不正确"}
    
        code = str(secrets.randbelow(900000) + 100000)
        with self._lock:
            self._verification_codes[target] = {
                "code": code,
                "purpose": purpose,
                "created_at": time.time(),
                "expires_at": time.time() + 600,  # 10分钟有效
                "attempts": 0,
            }
        self._audit("send_code", target, purpose, "success")
        # 开发模式：返回验证码便于测试；生产环境移除 code 字段
        return {
            "success": True,
            "message": f"验证码已发送至 {target}",
            "code": code,  # 开发模式保留
            "expires_in": 600,
        }

    def verify_code(self, email: str = "", phone: str = "",
                    code: str = "", purpose: str = "register") -> Dict[str, Any]:
        """校验验证码"""
        target = email or phone
        if not target or not code:
            return {"success": False, "message": "验证码不能为空"}
        with self._lock:
            record = self._verification_codes.get(target)
            if not record:
                return {"success": False, "message": "请先获取验证码"}
            if time.time() > record["expires_at"]:
                del self._verification_codes[target]
                return {"success": False, "message": "验证码已过期"}
            if record["purpose"] != purpose:
                return {"success": False, "message": "验证码用途不匹配"}
            record["attempts"] += 1
            if record["attempts"] > 5:
                del self._verification_codes[target]
                return {"success": False, "message": "尝试次数过多，请重新获取"}
            if record["code"] != code:
                return {"success": False, "message": "验证码错误"}
            # 验证成功，删除验证码（一次性使用）
            del self._verification_codes[target]
        self._audit("verify_code", target, purpose, "success")
        return {"success": True, "message": "验证通过"}

    def activate(self, license_key: str = "", activation_code: str = "",
                 code: str = "") -> Dict[str, Any]:
        """激活账户：必须同时提供许可证密钥和激活码，两者都正确才生效。
        匹配0.1.5版本的验证逻辑：
        1. 必须同时提供许可证和激活码
        2. 验证许可证与注册时存储的一致（hmac.compare_digest防时序攻击）
        3. 验证激活码与注册时存储的一致
        4. 验证许可证签名（verify_license_key）
        5. 更新已有许可证为已激活
        """
        if code and not activation_code:
            activation_code = code
        if not license_key or not activation_code:
            return {"success": False, "error": "必须同时提供许可证密钥和激活码",
                    "message": "必须同时提供许可证密钥和激活码"}
        with self._lock:
            # 指定许可证优先：多账户/多次注册时不能用“第一个未激活”的许可证代替。
            target_lic = self._licenses.get(license_key.strip())
            if target_lic is None:
                return {"success": False, "error": "许可证密钥不存在，请检查输入",
                        "message": "许可证密钥不存在，请检查输入"}
            if target_lic.get("activated"):
                return {"success": True, "message": "账户已激活", "tier": target_lic.get("tier", "activated"),
                        "license_key": license_key, "already_activated": True}
            # 验证许可证密钥
            stored_license = target_lic.get("license_key", "")
            if not hmac.compare_digest(license_key.strip(), stored_license):
                self._audit("activate", license_key, "validation", "failed", "许可证密钥无效")
                return {"success": False, "error": "许可证密钥无效", "message": "许可证密钥无效"}
            # 验证激活码
            stored_code = target_lic.get("activation_code", "")
            if not hmac.compare_digest(activation_code.strip().upper(), stored_code.upper()):
                self._audit("activate", license_key, "validation", "failed", "激活码无效")
                return {"success": False, "error": "激活码无效", "message": "激活码无效"}
            # 验证许可证签名
            sig_result = verify_license_key(license_key)
            if not sig_result["valid"]:
                self._audit("activate", license_key, "signature", "failed", sig_result.get("error", ""))
                return {"success": False, "error": sig_result.get("error", "许可证签名验证失败"),
                        "message": sig_result.get("error", "许可证签名验证失败")}
            # 从签名payload中获取层级，更新许可证为已激活
            tier = sig_result["payload"].get("t", "activated")
            target_lic["activated"] = True
            target_lic["tier"] = tier
            target_lic["activated_at"] = time.time()
            self._save()
        self._audit("activate", license_key, tier, "success")
        return {
            "success": True,
            "message": "激活成功！许可证和激活码验证通过。",
            "tier": tier,
            "license_key": license_key,
            "identity_id": target_lic.get("identity_id", ""),
        }

    def generate_license(self, email: str = "", phone: str = "", username: str = "", tier: str = "registered") -> Dict[str, Any]:
        """注册时自动生成许可证和激活码（历史格式：LIBERTAS-xxx.xxx）
        注意：用户名始终由系统自动生成（MH+8位hex），不接受用户自定义。
        """
        gen = generate_license_key(email or "unknown@unknown.com", phone or "00000000000", tier=tier)
        license_key = gen["license_key"]
        activation_code = gen["activation_code"]
        # 历史版本行为：用户名始终由系统自动生成，忽略用户传入的username
        final_username = gen["username"]
        identity_id = generate_identity_id()
        with self._lock:
            self._licenses[license_key] = {
                "license_key": license_key,
                "activation_code": activation_code,
                "tier": tier,
                "activated": False,
                "created_at": time.time(),
                "identity_id": identity_id,
                "username": final_username,
                "email": email,
                "phone": phone,
            }
            self._save()
        self._audit("generate_license", final_username, tier, "success", f"license={license_key}")
        return {
            "success": True,
            "license_key": license_key,
            "activation_code": activation_code,
            "identity_id": identity_id,
            "username": final_username,
            "tier": tier,
        }

    def recover_account(self, email: str = "", phone: str = "") -> Dict[str, Any]:
        """账户恢复：发送重置验证码"""
        return self.send_verification_code(email, phone, purpose="reset")

    def reset_account(self, email: str = "", phone: str = "",
                      password: str = "", verify_password_cb=None) -> Dict[str, Any]:
        """重置账户（匹配0.1.5版本行为）：
        验证邮箱+手机号+当前密码后，删除整个账户（许可证+子用户），允许重新注册。
        不是密码重置，而是完全删除账户。
    
        Args:
            email: 注册邮箱
            phone: 注册手机号
            password: 当前密码
            verify_password_cb: 密码验证回调函数(password) -> bool，由web.py传入user_manager的验证逻辑
        """
        if not email or not phone or not password:
            return {"success": False, "error": "需要同时提供邮箱、手机号和密码",
                    "message": "需要同时提供邮箱、手机号和密码"}
        # 查找注册时的许可证
        target_lic = None
        for key, lic in self._licenses.items():
            if lic.get("email") == email.strip() or lic.get("phone") == phone.strip():
                target_lic = lic
                break
        if not target_lic:
            return {"success": False, "error": "本地没有注册过任何账户，可直接注册",
                    "message": "本地没有注册过任何账户，可直接注册"}
        # 验证邮箱匹配
        if target_lic.get("email", "").strip() != email.strip():
            return {"success": False, "error": "邮箱与注册时不匹配",
                    "message": "邮箱与注册时不匹配"}
        # 验证手机号匹配
        if target_lic.get("phone", "").strip() != phone.strip():
            return {"success": False, "error": "手机号与注册时不匹配",
                    "message": "手机号与注册时不匹配"}
        # 验证密码（通过回调，由web.py调用user_manager验证）
        if verify_password_cb is not None:
            try:
                if not verify_password_cb(password):
                    return {"success": False, "error": "密码不正确",
                            "message": "密码不正确"}
            except Exception as e:
                return {"success": False, "error": f"密码验证失败: {e}",
                        "message": f"密码验证失败: {e}"}
        old_username = target_lic.get("username", "unknown")
        old_license_key = target_lic.get("license_key", "")
        with self._lock:
            # 删除许可证
            if old_license_key in self._licenses:
                del self._licenses[old_license_key]
            # 删除所有子用户
            self._sub_users = {}
            self._active_sub_user = None
            # 清除所有会话
            self._sessions = {}
            self._save()
        self._audit("reset_account", old_username, "account", "success",
                    f"账户已删除, license={old_license_key}")
        return {
            "success": True,
            "message": f"账户 {old_username} 已重置，现在可以重新注册。",
            "old_username": old_username,
        }

"""通知渠道实现。"""

import json
import os
import shlex
import sys
import time
from typing import Any, Callable, Dict, List, Optional

from libertas.foundation.terminal import terminal
from .models import Notification, NotificationLevel

class NotificationChannel:
    """通知渠道基类"""

    def __init__(self, name: str, enabled: bool = True, min_level: str = "info"):
        self.name = name
        self.enabled = enabled
        self.min_level = min_level
        self.sent_count = 0
        self.failed_count = 0

    def send(self, notification: "Notification") -> bool:
        if not self.enabled:
            return False
        try:
            result = self._send(notification)
            if result:
                self.sent_count += 1
            else:
                self.failed_count += 1
            return result
        except Exception as e:
            self.failed_count += 1
            terminal.error(f"通知渠道 [{self.name}] 发送失败: {e}", "notifications")
            return False

    def _send(self, notification: "Notification") -> bool:
        raise NotImplementedError

    def get_stats(self) -> Dict[str, Any]:
        return {
            "name": self.name, "enabled": self.enabled,
            "min_level": self.min_level, "sent": self.sent_count,
            "failed": self.failed_count,
        }

class ConsoleChannel(NotificationChannel):
    """控制台通知渠道"""

    def __init__(self):
        super().__init__("console", enabled=True, min_level="info")

    def _send(self, notification: "Notification") -> bool:
        level = notification.level
        if level == NotificationLevel.CRITICAL:
            terminal.error(f"[CRITICAL] [严重] {notification.title}: {notification.message}", "notification")
        elif level == NotificationLevel.ERROR:
            terminal.error(f"[FAIL] [错误] {notification.title}: {notification.message}", "notification")
        elif level == NotificationLevel.WARNING:
            terminal.warn(f"[WARN] [警告] {notification.title}: {notification.message}", "notification")
        elif level == NotificationLevel.SUCCESS:
            terminal.success(f"[OK] [成功] {notification.title}: {notification.message}", "notification")
        else:
            terminal.info(f"[INFO] [通知] {notification.title}: {notification.message}", "notification")
        return True

class DesktopChannel(NotificationChannel):
    """桌面通知渠道"""

    def __init__(self):
        super().__init__("desktop", enabled=True, min_level="warning")

    def _send(self, notification: "Notification") -> bool:
        # 用字典映射代替 if-elif，避免编辑器类型窄化误报
        platform_handlers = {
            "win32": self._send_windows,
            "darwin": self._send_macos,
            "linux": self._send_linux,
            "linux2": self._send_linux,
        }
        handler = platform_handlers.get(sys.platform)
        if handler:
            try:
                return handler(notification)
            except Exception:
                pass
        return False

    def _send_windows(self, notification: "Notification") -> bool:
        """Windows 桌面通知"""
        try:
            from win10toast import ToastNotifier
            toaster = ToastNotifier()
            toaster.show_toast(notification.title, notification.message, duration=5)
            return True
        except ImportError:
            return False

    def _send_macos(self, notification: "Notification") -> bool:
        """macOS 桌面通知"""
        script = 'display notification "{}" with title "{}"'.format(
            notification.message,
            notification.title
        )
        os.system("osascript -e " + shlex.quote(script))
        return True

    def _send_linux(self, notification: "Notification") -> bool:
        """Linux 桌面通知"""
        cmd = "notify-send " + shlex.quote(notification.title) + " " + shlex.quote(notification.message)
        os.system(cmd)
        return True

class WebhookChannel(NotificationChannel):
    """Webhook 通知渠道"""

    def __init__(self, url: str = "", headers: Optional[Dict[str, str]] = None):
        super().__init__("webhook", enabled=bool(url), min_level="warning")
        self.url = url
        self.headers = headers or {"Content-Type": "application/json"}

    def _send(self, notification: "Notification") -> bool:
        if not self.url:
            return False
        try:
            import urllib.request
            payload = json.dumps(notification.to_dict(), ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(self.url, data=payload, headers=self.headers)
            with urllib.request.urlopen(req, timeout=10) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False

class EmailChannel(NotificationChannel):
    """邮件通知渠道"""

    def __init__(self, smtp_server: str = "", smtp_port: int = 587,
                 username: str = "", password: str = "", from_addr: str = "",
                 to_addrs: Optional[List[str]] = None, use_ssl: bool = False):
        super().__init__("email", enabled=bool(smtp_server and to_addrs), min_level="error")
        self.smtp_server = smtp_server
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.from_addr = from_addr or username
        self.to_addrs = to_addrs or []
        # 465 通常是隐式 SSL；587 走 STARTTLS。兼容企业邮箱两种常见配置。
        self.use_ssl = bool(use_ssl or int(smtp_port or 0) == 465)

    def _send(self, notification: "Notification") -> bool:
        if not self.smtp_server or not self.to_addrs:
            return False
        try:
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            msg = MIMEMultipart()
            msg["From"] = self.from_addr
            msg["To"] = ", ".join(self.to_addrs)
            msg["Subject"] = f"[{notification.level.upper()}] {notification.title}"
            body = f"{notification.message}\n\n时间: {notification.time}\n来源: {notification.source}"
            msg.attach(MIMEText(body, "plain", "utf-8"))

            if self.use_ssl:
                with smtplib.SMTP_SSL(self.smtp_server, self.smtp_port, timeout=15) as server:
                    if self.username:
                        server.login(self.username, self.password)
                    server.sendmail(self.from_addr, self.to_addrs, msg.as_string())
            else:
                with smtplib.SMTP(self.smtp_server, self.smtp_port, timeout=15) as server:
                    server.starttls()
                    if self.username:
                        server.login(self.username, self.password)
                    server.sendmail(self.from_addr, self.to_addrs, msg.as_string())
            return True
        except Exception:
            return False

class FeishuChannel(NotificationChannel):
    """飞书机器人通知渠道"""

    def __init__(self, webhook_url: str = "", secret: str = ""):
        super().__init__("feishu", enabled=bool(webhook_url), min_level="warning")
        self.webhook_url = webhook_url
        self.secret = secret

    def _send(self, notification: "Notification") -> bool:
        if not self.webhook_url:
            return False
        try:
            import urllib.request
            import hashlib
            import hmac
            import base64

            timestamp = str(int(time.time()))
            payload = {
                "msg_type": "text",
                "content": {"text": f"[{notification.level.upper()}] {notification.title}\n{notification.message}"},
            }
            if self.secret:
                string_to_sign = f"{timestamp}\n{self.secret}"
                hmac_code = hmac.new(self.secret.encode(), string_to_sign.encode(), hashlib.sha256).digest()
                sign = base64.b64encode(hmac_code).decode()
                payload["timestamp"] = timestamp
                payload["sign"] = sign

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(self.webhook_url, data=data,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return 200 <= resp.status < 300
        except Exception:
            return False

class SoundChannel(NotificationChannel):
    """声音通知渠道"""

    def __init__(self):
        super().__init__("sound", enabled=False, min_level="critical")

    def _send(self, notification: "Notification") -> bool:
        try:
            if sys.platform == "win32":
                import winsound
                if notification.level == NotificationLevel.CRITICAL:
                    winsound.MessageBeep(winsound.MB_ICONHAND)
                else:
                    winsound.MessageBeep()
                return True
            elif sys.platform == "darwin":
                os.system('afplay /System/Library/Sounds/Glass.aiff &')
                return True
        except Exception:
            pass
        return False

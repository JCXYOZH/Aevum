import re
import threading
import json
from typing import Dict, List, Tuple, Any, Optional


class PrivacySanitizer:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, '_initialized'):
            return
        self._initialized = True
        self._session_map: Dict[str, str] = {}
        self._counter: Dict[str, int] = {}
        self._map_lock = threading.RLock()
        self._enabled = True
        self._rules = self._default_rules()
        self._custom_patterns: List[Tuple[str, re.Pattern]] = []
        self._load_config()

    def _default_rules(self) -> Dict[str, bool]:
        return {
            "ipv4": True,
            "domain": True,
            "email": True,
            "url": True,
            "phone": True,
            "mac": True,
            "api_key": True,
            "file_path": True,
            "port_scan": True,
        }

    def _load_config(self):
        try:
            from libertas.foundation.config import config as global_config
            privacy_cfg = global_config.get("privacy_sanitizer", {})
            if isinstance(privacy_cfg, dict):
                self._enabled = privacy_cfg.get("enabled", True)
                for k, v in privacy_cfg.get("rules", {}).items():
                    if k in self._rules:
                        self._rules[k] = bool(v)
                for pat in privacy_cfg.get("custom_patterns", []):
                    try:
                        self._custom_patterns.append((pat.get("name", "CUSTOM"), re.compile(pat.get("pattern", ""))))
                    except Exception:
                        pass
        except Exception:
            pass

    def configure(self, enabled: bool = None, rules: Dict[str, bool] = None):
        if enabled is not None:
            self._enabled = bool(enabled)
        if rules:
            for k, v in rules.items():
                if k in self._rules:
                    self._rules[k] = bool(v)

    def _next_token(self, category: str) -> str:
        with self._map_lock:
            self._counter[category] = self._counter.get(category, 0) + 1
            return f"[{category}_{self._counter[category]}]"

    def _register(self, token: str, value: str):
        with self._map_lock:
            self._session_map[token] = value

    def reset_session(self):
        with self._map_lock:
            self._session_map.clear()
            self._counter.clear()

    def get_mapping(self) -> Dict[str, str]:
        with self._map_lock:
            return dict(self._session_map)

    def get_stats(self) -> Dict[str, Any]:
        with self._map_lock:
            counts: Dict[str, int] = {}
            for token in self._session_map:
                cat = token.split('_')[0].strip('[]')
                counts[cat] = counts.get(cat, 0) + 1
            return {
                "enabled": self._enabled,
                "rules": dict(self._rules),
                "total_sanitized": len(self._session_map),
                "by_category": counts,
            }

    def sanitize(self, text: str) -> str:
        if not self._enabled or not text:
            return text
        result = text

        # 保护工具调用标签不被脱敏破坏
        tool_tags = []
        def _protect_tool_tags(m):
            token = f"\x00TOOL{len(tool_tags)}\x00"
            tool_tags.append((token, m.group(0)))
            return token
        result = re.sub(r'<<<(?:WEB_SEARCH|WEB_FETCH|WEB_TO_RAG|WEB_DEEP_SEARCH|FILE|TOOL|BATCH)\s*:.+?>>>', _protect_tool_tags, result, flags=re.DOTALL)
        result = re.sub(r'<<<BATCH>>>.*?<<<END>>>', _protect_tool_tags, result, flags=re.DOTALL)
        result = re.sub(r'<<<END>>>', _protect_tool_tags, result)

        # 保护【工具调用结果】段落不被脱敏（模型需要看到真实域名/IP来执行后续工具调用）
        def _protect_tool_results(text):
            parts = []
            last_end = 0
            for m in re.finditer(r'【工具调用结果】\n(.*?)(?=\n【重要指令】|\n【强制指令】|$)', text, re.DOTALL):
                parts.append(text[last_end:m.start()])
                token = f'\x00TOOLR{len(tool_tags)}\x00'
                tool_tags.append((token, m.group(1)))  # 只存内容，不存标题
                parts.append('【工具调用结果】\n' + token)
                last_end = m.end(1)
            parts.append(text[last_end:])
            return ''.join(parts)
        result = _protect_tool_results(result)

        if self._rules.get("api_key"):
            result = self._sanitize_api_keys(result)
        if self._rules.get("email"):
            result = self._sanitize_emails(result)
        if self._rules.get("url"):
            result = self._sanitize_urls(result)
        if self._rules.get("mac"):
            result = self._sanitize_mac(result)
        if self._rules.get("ipv4"):
            result = self._sanitize_ipv4(result)
        if self._rules.get("domain"):
            result = self._sanitize_domains(result)
        if self._rules.get("phone"):
            result = self._sanitize_phones(result)
        if self._rules.get("file_path"):
            result = self._sanitize_paths(result)
        if self._rules.get("port_scan"):
            result = self._sanitize_port_scan(result)

        for name, pattern in self._custom_patterns:
            result = self._sanitize_by_pattern(result, pattern, name.upper())

        # 恢复工具调用标签
        for token, original in tool_tags:
            result = result.replace(token, original)

        return result

    def restore(self, text: str) -> str:
        if not text:
            return text
        with self._map_lock:
            for token, value in self._session_map.items():
                text = text.replace(token, value)
        return text

    def _sanitize_by_pattern(self, text: str, pattern: re.Pattern, category: str) -> str:
        def replacer(m):
            value = m.group(0)
            with self._map_lock:
                for token, v in self._session_map.items():
                    if v == value:
                        return token
            token = self._next_token(category)
            self._register(token, value)
            return token
        return pattern.sub(replacer, text)

    def _sanitize_ipv4(self, text: str) -> str:
        pattern = re.compile(r'(?<![0-9.])(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?::\d{1,5})?(?![0-9.])')
        return self._sanitize_by_pattern(text, pattern, "IP")

    def _sanitize_domains(self, text: str) -> str:
        pattern = re.compile(r'(?<![a-zA-Z0-9-])((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(?![a-zA-Z0-9-])')
        def replacer(m):
            value = m.group(1)
            if re.match(r'^\d+\.\d+', value):
                return value
            if value.endswith(('.py', '.js', '.json', '.yaml', '.yml', '.txt', '.md', '.html', '.css', '.sh', '.conf', '.cfg', '.log')):
                return value
            with self._map_lock:
                for token, v in self._session_map.items():
                    if v == value:
                        return token
            token = self._next_token("DOMAIN")
            self._register(token, value)
            return token
        return pattern.sub(replacer, text)

    def _sanitize_emails(self, text: str) -> str:
        pattern = re.compile(r'(?<![a-zA-Z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}(?![a-zA-Z0-9.-])')
        return self._sanitize_by_pattern(text, pattern, "EMAIL")

    def _sanitize_urls(self, text: str) -> str:
        pattern = re.compile(r'https?://[^\s<>"\'{}|\\^`\[\]，。！？、；：]+')
        return self._sanitize_by_pattern(text, pattern, "URL")

    def _sanitize_phones(self, text: str) -> str:
        pattern = re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)')
        return self._sanitize_by_pattern(text, pattern, "PHONE")
    def _sanitize_mac(self, text: str) -> str:
        pattern = re.compile(r'(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])')
        return self._sanitize_by_pattern(text, pattern, "MAC")

    def _sanitize_api_keys(self, text: str) -> str:
        patterns = [
            # 阈值从 20 降到 12：不同厂商的密钥长度不一，20 位会漏掉较短的。
            # 另补上常见厂商前缀，避免只认 sk- 一种写法。
            (re.compile(r'sk-[A-Za-z0-9]{12,}'), "SECRET"),
            (re.compile(r'(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}'), "SECRET"),
            (re.compile(r'gsk_[A-Za-z0-9]{20,}'), "SECRET"),
            (re.compile(r'xai-[A-Za-z0-9]{20,}'), "SECRET"),
            (re.compile(r'AKIA[0-9A-Z]{16}'), "SECRET"),
            (re.compile(r'AIza[0-9A-Za-z_\-]{30,}'), "SECRET"),
            (re.compile(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', re.IGNORECASE), "SECRET"),
            (re.compile(r'(?:api[_-]?key|token|secret|password)["\']?\s*[:=]\s*["\']?[A-Za-z0-9\-._~+/]{16,}["\']?', re.IGNORECASE), "SECRET"),
            (re.compile(r'-----BEGIN [A-Z ]+PRIVATE KEY-----[^-]*-----END [A-Z ]+PRIVATE KEY-----'), "SECRET"),
        ]
        for pat, cat in patterns:
            text = self._sanitize_by_pattern(text, pat, cat)
        return text

    def _sanitize_paths(self, text: str) -> str:
        pattern = re.compile(r'(?:/[a-zA-Z0-9._\-]+){2,}/?')
        def replacer(m):
            value = m.group(0)
            if value.startswith('//'):
                return value
            if len(value) < 5:
                return value
            with self._map_lock:
                for token, v in self._session_map.items():
                    if v == value:
                        return token
            token = self._next_token("PATH")
            self._register(token, value)
            return token
        return pattern.sub(replacer, text)

    def _sanitize_port_scan(self, text: str) -> str:
        pattern = re.compile(r'\b(\d{1,5})/(tcp|udp|sctp)\s+(open|closed|filtered|open\|filtered)', re.IGNORECASE)
        def replacer(m):
            port = m.group(1)
            proto = m.group(2)
            state = m.group(3)
            value = m.group(0)
            with self._map_lock:
                for token, v in self._session_map.items():
                    if v == value:
                        return token
            token = self._next_token("PORT")
            self._register(token, value)
            return token
        return pattern.sub(replacer, text)

    def sanitize_messages(self, messages: List[Dict[str, str]], protect_system: bool = True,
                          protect_last_user: bool = True) -> List[Dict[str, str]]:
        """脱敏消息列表。

        - protect_system: 不脱敏 system 消息（包含工具指令，不是用户隐私）
        - protect_last_user: 不脱敏最后一条 user 消息（用户当前请求，其中的URL/IP可能是任务目标）
        """
        sanitized = []
        last_user_idx = -1
        if protect_last_user:
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    last_user_idx = i
                    break
        for i, msg in enumerate(messages):
            new_msg = dict(msg)
            if new_msg.get("content"):
                # system 消息和当前用户消息不脱敏
                if protect_system and msg.get("role") == "system":
                    sanitized.append(new_msg)
                    continue
                if protect_last_user and i == last_user_idx:
                    sanitized.append(new_msg)
                    continue
                new_msg["content"] = self.sanitize(new_msg["content"])
            sanitized.append(new_msg)
        return sanitized

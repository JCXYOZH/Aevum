"""职责模块：service。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
import json
import os
import threading
import time
import urllib.request
from libertas.foundation.config import get_data_dir, config as global_config

from .constants import DEFAULT_CONFIG
from .constants import _MEDIA_EXT
from .transport import _build_opener
from .prompt import _creep
from .transport import _dig
from .transport import _is_dashscope_endpoint
from .prompt import _is_output_moderation

class VideoGenerationService:
    """云端视频（及图片）生成服务。"""

    def __init__(self, data_dir: Optional[str] = None, privacy_sanitizer=None):
        self._lock = threading.RLock()
        self._data_dir = data_dir
        self._privacy = privacy_sanitizer
        self._cfg: Dict[str, Any] = dict(DEFAULT_CONFIG)
        self._audit: List[Dict[str, Any]] = []
        self.reload_config()

    # ---------------- 配置（可控） ----------------

    def _config_path(self) -> str:
        base = self._data_dir or (get_data_dir() if get_data_dir else os.getcwd())
        return os.path.join(base, "video_generation.json")

    def reload_config(self) -> Dict[str, Any]:
        """从 config.yaml 的 video_generation 段 + 本地覆盖文件加载配置。"""
        cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # 深拷贝
        try:
            if global_config is not None:
                user = global_config.get("video_generation") or {}
                if isinstance(user, dict):
                    for k, v in user.items():
                        if k == "privacy" and isinstance(v, dict):
                            cfg["privacy"].update(v)
                        else:
                            cfg[k] = v
        except Exception:
            pass
        # 本地覆盖（通过界面改的，优先级更高）
        try:
            p = self._config_path()
            if os.path.isfile(p):
                with open(p, "r", encoding="utf-8") as fh:
                    local = json.load(fh)
                if isinstance(local, dict):
                    for k, v in local.items():
                        if k == "privacy" and isinstance(v, dict):
                            cfg["privacy"].update(v)
                        else:
                            cfg[k] = v
        except Exception:
            pass
        with self._lock:
            self._cfg = cfg
        return cfg

    def get_config(self, reveal_key: bool = False) -> Dict[str, Any]:
        with self._lock:
            cfg = json.loads(json.dumps(self._cfg))
        own_key = str(cfg.get("api_key") or "").strip()
        key = self._api_key(cfg)
        cfg["api_key_from_global"] = bool(key and not own_key)
        if key and not reveal_key:
            cfg["api_key"] = (key[:4] + "…" + key[-4:]) if len(key) > 12 else "已设置"
        cfg["api_key_set"] = bool(key)
        return cfg

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """局部更新配置并落盘。"""
        if not isinstance(patch, dict):
            return self.get_config()
        with self._lock:
            current = self._cfg
        merged = json.loads(json.dumps(current))
        for k, v in patch.items():
            if k == "privacy" and isinstance(v, dict):
                merged.setdefault("privacy", {}).update(v)
            elif k == "api_key" and (v == "" or v is None):
                continue  # 空值不覆盖已有关键字
            else:
                merged[k] = v
        try:
            p = self._config_path()
            os.makedirs(os.path.dirname(p), exist_ok=True)
            tmp = p + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(merged, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, p)
        except Exception:
            pass
        with self._lock:
            self._cfg = merged
        return self.get_config()

    def is_enabled(self) -> bool:
        with self._lock:
            cfg = self._cfg
        return bool(cfg.get("enabled")) and bool(cfg.get("endpoint"))

    def disabled_reason(self) -> str:
        with self._lock:
            cfg = self._cfg
        if not cfg.get("enabled"):
            return "云端生成未开启（video_generation.enabled = false）。这是默认状态，避免误发。"
        if not cfg.get("endpoint"):
            return "未配置 video_generation.endpoint。"
        return ""

    def _api_key(self, cfg: Dict[str, Any]) -> str:
        """取生效的 API Key。

        未单独配置 video_generation.api_key 时，回退到全局 cloud_api_key。
        视频生成与对话通常同属一个百炼账号、同一把 Key，
        这样用户不必在多处重复填写密钥。
        """
        key = str(cfg.get("api_key") or "").strip()
        if key:
            return key
        try:
            if global_config is not None:
                return str(global_config.get("cloud_api_key") or "").strip()
        except Exception:
            pass
        return ""

    def _opener(self):
        """每次请求构造一次（开销远小于网络往返），确保即时反映配置变更。"""
        return _build_opener(self._cfg)

    # ---------------- 隐私 ----------------

    def sanitize_prompt(self, prompt: str) -> Dict[str, Any]:
        """发送前脱敏。返回 {sent, changed, replacements}。"""
        with self._lock:
            priv_cfg = dict((self._cfg.get("privacy") or {}))
        raw = prompt or ""
        if not priv_cfg.get("sanitize_prompt", True):
            return {"sent": raw, "changed": False, "note": "脱敏已关闭"}
        cleaner = self._privacy
        if cleaner is None:
            try:
                from libertas.security.privacy import PrivacySanitizer
                cleaner = PrivacySanitizer()
                self._privacy = cleaner
            except Exception:
                return {"sent": raw, "changed": False, "note": "脱敏器不可用"}
        try:
            cleaned = cleaner.sanitize(raw)
        except Exception as e:
            return {"sent": raw, "changed": False, "note": "脱敏失败: " + str(e)}
        return {"sent": cleaned, "changed": cleaned != raw}

    def privacy_decision(self) -> Dict[str, Any]:
        """是否允许把生成请求发往云端。"""
        with self._lock:
            priv_cfg = dict((self._cfg.get("privacy") or {}))
        extra = priv_cfg.get("allow_categories") or []
        if extra:
            return {"allowed": True, "reason": "配置里显式允许: " + ",".join(map(str, extra))}
        return {"allowed": True, "reason": "未额外限制（提示词已按全局隐私规则脱敏）"}

    # ---------------- 审计 ----------------

    def _audit_add(self, entry: Dict[str, Any]):
        entry["at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        with self._lock:
            self._audit.append(entry)
            if len(self._audit) > 200:
                self._audit = self._audit[-200:]

    def list_audit(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._audit[-limit:])

    # ---------------- HTTP ----------------

    def _post_json(self, url: str, body: Dict[str, Any], headers: Dict[str, str],
                   timeout: int) -> Dict[str, Any]:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        with self._opener().open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw}

    def _get_json(self, url: str, headers: Dict[str, str], timeout: int) -> Dict[str, Any]:
        req = urllib.request.Request(url, method="GET")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        with self._opener().open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"_raw": raw}

    def _download(self, url: str, out_dir: str, kind: str, timeout: int = 300) -> str:
        exts = _MEDIA_EXT.get(kind, _MEDIA_EXT["video"])
        ext = ".mp4" if kind == "video" else ".png"
        low = url.split("?")[0].lower()
        for e in exts:
            if low.endswith(e):
                ext = e
                break
        os.makedirs(out_dir, exist_ok=True)
        name = "%s-%s%s" % (kind, time.strftime("%Y%m%d-%H%M%S"), ext)
        path = os.path.join(out_dir, name)
        tmp = path + ".part"
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "Libertas/1.0")
        with self._opener().open(req, timeout=timeout) as resp, open(tmp, "wb") as fh:
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                fh.write(chunk)
        os.replace(tmp, path)
        return path

    # ---------------- 生成 ----------------

    def generate(self, prompt: str, kind: str = "video",
                 options: Optional[Dict[str, Any]] = None,
                 on_progress=None) -> Dict[str, Any]:
        """同步执行一次生成（调用方负责放进任务队列）。

        返回 {success, path, url, kind, sent_prompt, task_id, error}
        """
        options = options or {}
        if not self.is_enabled():
            return {"success": False, "error": self.disabled_reason()}

        decision = self.privacy_decision()
        if not decision.get("allowed"):
            with self._lock:
                block = bool((self._cfg.get("privacy") or {}).get("block_on_denied", True))
            if block:
                return {"success": False, "error": "隐私策略拒绝了这次发送：" + decision.get("reason", "")}

        san = self.sanitize_prompt(prompt)
        sent_prompt = san.get("sent", prompt)

        with self._lock:
            cfg = json.loads(json.dumps(self._cfg))

        endpoint = cfg.get("endpoint", "")
        is_dashscope = _is_dashscope_endpoint(endpoint)
        # 公共头：鉴权 + 用户自定义附加头
        base_headers = {}
        _key = self._api_key(cfg)
        if _key:
            base_headers["Authorization"] = "Bearer " + _key
        base_headers.update(cfg.get("extra_headers") or {})
        # 提交专用头：百炼只支持异步调用，缺此头会报
        # "current user api does not support synchronous calls"。
        # 查询接口（GET /api/v1/tasks/{task_id}）按官方文档**只需要 Authorization**，
        # 因此异步开关只加在提交上、不带到查询，避免被网关判为非法请求而永久查询失败。
        headers = dict(base_headers)
        if is_dashscope:
            headers.setdefault("X-DashScope-Async", "enable")
        query_headers = dict(base_headers)
        timeout = int(cfg.get("timeout") or 60)
        mode = cfg.get("mode") or "async_submit_poll"

        body = dict(cfg.get("submit_body_template") or {})
        body.setdefault("model", cfg.get("model", ""))
        body.setdefault("input", {"prompt": sent_prompt})
        opts = dict(options or {})
        opts.pop("kind", None)
        if is_dashscope:
            # 百炼请求体只认 model/input/parameters，多余的顶层字段会被判为非法参数
            if opts:
                params = dict(body.get("parameters") or {})
                params.update(opts)
                body["parameters"] = params
        else:
            body.setdefault("prompt", sent_prompt)
            body.update(opts)

        self._audit_add({
            "action": "submit", "kind": kind, "endpoint": endpoint,
            "prompt_original": prompt,
            "prompt_sent": sent_prompt,
            "sanitized": bool(san.get("changed")),
            "privacy": decision.get("reason", ""),
        })

        def _progress(pct, msg):
            if on_progress:
                try:
                    on_progress(pct, msg)
                except Exception:
                    pass

        try:
            _progress(5, "提交生成任务…")
            resp = self._post_json(endpoint, body, headers, timeout)
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", errors="replace")[:400]
            except Exception:
                pass
            self._audit_add({"action": "error", "kind": kind, "error": "HTTP %s %s" % (e.code, detail)})
            return {"success": False, "error": "提交失败 HTTP %s: %s" % (e.code, detail),
                    "sent_prompt": sent_prompt}
        except Exception as e:
            self._audit_add({"action": "error", "kind": kind, "error": str(e)})
            return {"success": False, "error": "提交失败: %s" % e, "sent_prompt": sent_prompt}

        # 同步模式：响应里直接给 URL
        direct = _dig(resp, cfg.get("result_url_path", ""))
        if mode == "sync_json" or (not _dig(resp, cfg.get("task_id_path", "")) and direct):
            if not direct:
                return {"success": False, "error": "响应里没有找到结果地址：%s" % json.dumps(resp)[:300],
                        "sent_prompt": sent_prompt}
            _progress(70, "下载产出…")
            return self._finish_from_url(direct, kind, sent_prompt, cfg, on_progress=_progress)

        task_id = _dig(resp, cfg.get("task_id_path", ""))
        if not task_id:
            return {"success": False,
                    "error": "响应里没有找到任务 ID（%s）：%s" % (cfg.get("task_id_path"), json.dumps(resp)[:300]),
                    "sent_prompt": sent_prompt}

        query_tpl = cfg.get("query_endpoint") or ""
        if not query_tpl:
            return {"success": False, "error": "异步模式需要配置 query_endpoint", "sent_prompt": sent_prompt}
        query_url = query_tpl.replace("{task_id}", str(task_id))
        # 提交已成功，立刻给一次反馈，避免用户盯着「提交生成任务…」干等
        _progress(10, "任务已提交（%s），等待生成…" % str(task_id)[:16])

        interval = int(cfg.get("poll_interval") or 5)
        max_wait = int(cfg.get("poll_max_seconds") or 600)
        poll_start = time.time()
        deadline = poll_start + max_wait
        last_err = ""
        while time.time() < deadline:
            time.sleep(interval)
            elapsed = int(time.time() - poll_start)
            try:
                st = self._get_json(query_url, query_headers, timeout)
            except Exception as e:
                # 查询失败不能静默跳过：早先这里直接 continue，导致进度永远停在
                # 「提交生成任务…」不再更新，看起来像卡死，而错误信息被完全吞掉
                # （原代码把异常存进 last 却从未读取）。现在记录并继续上报进度。
                last_err = "%s: %s" % (type(e).__name__, e)
                _progress(_creep(elapsed, max_wait),
                          "查询中…（已等待 %d 秒；最近一次查询失败：%s）"
                          % (elapsed, last_err[:140]))
                continue
            status = str(_dig(st, cfg.get("status_path", "output.task_status")) or "").upper()
            if status in ("SUCCEEDED", "SUCCESS", "COMPLETED", "DONE"):
                url = _dig(st, cfg.get("result_url_path", "output.video_url"))
                if not url:
                    return {"success": False, "error": "任务成功但没拿到结果地址", "sent_prompt": sent_prompt}
                _progress(85, "下载产出…")
                return self._finish_from_url(url, kind, sent_prompt, cfg, task_id, on_progress=_progress)
            if status in ("FAILED", "ERROR", "CANCELED", "CANCELLED"):
                msg = _dig(st, cfg.get("error_path", "output.message")) or json.dumps(st)[:300]
                # 错误码要一起带出来：绿网拦截、参数非法、超时 都是 FAILED，
                # 只给一句文案无法判断该改提示词还是该改参数。
                code = _dig(st, "output.code") or _dig(st, "code") or ""
                err = "生成失败（%s）: %s" % (status, msg)
                if code:
                    err += "  [code=%s]" % code
                return {"success": False, "error": err, "error_code": str(code),
                        "moderation": _is_output_moderation(code, msg),
                        "sent_prompt": sent_prompt}
            _progress(_creep(elapsed, max_wait),
                      "生成中…（%s，已等待 %d 秒）" % (status or "排队", elapsed))
        tail = ("；最近一次查询失败：%s" % last_err) if last_err else ""
        return {"success": False,
                "error": "等待超时（%s 秒）%s" % (max_wait, tail),
                "sent_prompt": sent_prompt, "task_id": str(task_id)}

    def _finish_from_url(self, url: str, kind: str, sent_prompt: str,
                         cfg: Dict[str, Any], task_id: Any = None,
                         on_progress=None) -> Dict[str, Any]:
        out_dir = os.path.join(self._data_dir or (get_data_dir() or os.getcwd()),
                               "video" if kind == "video" else "image")
        try:
            path = self._download(url, out_dir, kind)
        except Exception as e:
            self._audit_add({"action": "error", "kind": kind, "error": "下载失败: %s" % e})
            return {"success": False, "error": "下载产出失败: %s" % e, "url": url,
                    "sent_prompt": sent_prompt}
        self._audit_add({"action": "done", "kind": kind, "path": path, "url": url,
                         "task_id": str(task_id or "")})
        if on_progress:
            try:
                on_progress(100, "完成")
            except Exception:
                pass
        return {"success": True, "path": path, "url": url, "kind": kind,
                "sent_prompt": sent_prompt, "task_id": str(task_id or "")}

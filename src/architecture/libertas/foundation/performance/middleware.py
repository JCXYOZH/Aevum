"""职责模块：middleware。"""

from __future__ import annotations

import gzip
import io

class GzipMiddleware:
    """WSGI 中间件：对文本响应启用 gzip 压缩。

    重要：SSE 流式响应（text/event-stream）和无 Content-Length 的流式响应
    直接透传，不缓冲、不压缩，否则会破坏流式输出。
    """
    def __init__(self, app, min_size: int = 1024, level: int = 6):
        self.app = app
        self.min_size = min_size
        self.level = level

    def __call__(self, environ, start_response):
        accept_encoding = environ.get("HTTP_ACCEPT_ENCODING", "")
        if "gzip" not in accept_encoding:
            return self.app(environ, start_response)

        response_info = {}

        def capturing_start_response(status, headers, exc_info=None):
            response_info["status"] = status
            response_info["headers"] = headers
            response_info["exc_info"] = exc_info
            # 判断是否为流式响应：SSE 或无 Content-Length
            content_type = ""
            has_content_length = False
            for name, value in headers:
                if name.lower() == "content-type":
                    content_type = value.lower()
                elif name.lower() == "content-length":
                    has_content_length = True
            # SSE / 分块传输 / 无 Content-Length → 直接透传，不压缩
            if ("text/event-stream" in content_type or
                    "multipart/" in content_type or
                    not has_content_length):
                response_info["passthrough"] = True
                return start_response(status, headers, exc_info)
            response_info["passthrough"] = False
            buffer = io.BytesIO()
            response_info["buffer"] = buffer
            return buffer.write

        app_iter = self.app(environ, capturing_start_response)

        # 流式响应直接透传
        if response_info.get("passthrough"):
            return app_iter

        # 普通响应：缓冲后压缩
        try:
            body = b"".join(app_iter)
        finally:
            if hasattr(app_iter, "close"):
                app_iter.close()

        status = response_info.get("status", "200 OK")
        headers = response_info.get("headers", [])
        exc_info = response_info.get("exc_info")

        content_type = ""
        for name, value in headers:
            if name.lower() == "content-type":
                content_type = value.lower()
                break

        compressible = any(ct in content_type for ct in (
            "text/", "application/json", "application/javascript",
            "application/xml", "image/svg+xml",
        ))

        if not compressible or len(body) < self.min_size:
            start_response(status, headers, exc_info)
            return iter([body])

        compressed = gzip.compress(body, compresslevel=self.level)
        new_headers = [(n, v) for n, v in headers
                       if n.lower() not in ("content-length", "content-encoding")]
        new_headers.append(("Content-Encoding", "gzip"))
        new_headers.append(("Content-Length", str(len(compressed))))
        start_response(status, new_headers, exc_info)
        return iter([compressed])

def add_cache_headers(response, max_age: int = 86400):
    """给 Flask 响应添加缓存头。"""
    try:
        response.headers["Cache-Control"] = f"public, max-age={max_age}"
        response.headers["X-Content-Type-Options"] = "nosniff"
    except Exception:
        pass
    return response

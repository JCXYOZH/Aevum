"""API 网关职责：docs。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
import uuid
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse


class APIDocumentGenerator:
    """API文档自动生成器

    自动扫描后端API端点，生成OpenAPI 3.0规范文档和前端SDK。
    """

    def __init__(self):
        self.endpoints: List[Dict] = []
        self.schemas: Dict[str, Dict] = {}
        self.title = "花先生后端引擎 API"
        self.version = "2.5"
        self.base_url = "/api/v1"

    def register_endpoint(self, method: str, path: str, summary: str,
                           description: str = "", parameters: List[Dict] = None,
                           request_body: Dict = None, responses: Dict = None,
                           tags: List[str] = None):
        """注册API端点"""
        self.endpoints.append({
            "method": method.upper(),
            "path": path,
            "summary": summary,
            "description": description,
            "parameters": parameters or [],
            "requestBody": request_body,
            "responses": responses or self._default_responses(),
            "tags": tags or ["default"],
        })

    def register_schema(self, name: str, schema: Dict):
        """注册数据模型"""
        self.schemas[name] = schema

    def generate_openapi(self) -> Dict:
        """生成OpenAPI 3.0规范"""
        paths = defaultdict(dict)
        for ep in self.endpoints:
            paths[ep["path"]][ep["method"].lower()] = {
                "summary": ep["summary"],
                "description": ep["description"],
                "tags": ep["tags"],
                "parameters": ep["parameters"],
                "requestBody": ep["requestBody"],
                "responses": ep["responses"],
            }

        return {
            "openapi": "3.0.3",
            "info": {
                "title": self.title,
                "version": self.version,
                "description": "花先生(Libertas)后端引擎完整API文档",
            },
            "servers": [{"url": self.base_url}],
            "paths": dict(paths),
            "components": {
                "schemas": self.schemas,
                "securitySchemes": {
                    "bearerAuth": {
                        "type": "http",
                        "scheme": "bearer",
                        "bearerFormat": "JWT",
                    }
                },
            },
        }

    def generate_markdown(self) -> str:
        """生成Markdown格式API文档"""
        lines = [f"# {self.title}", ""]
        lines.append(f"**版本**: {self.version}")
        lines.append(f"**基础URL**: `{self.base_url}`")
        lines.append("")

        # 按标签分组
        by_tag = defaultdict(list)
        for ep in self.endpoints:
            for tag in ep["tags"]:
                by_tag[tag].append(ep)

        for tag, eps in by_tag.items():
            lines.append(f"## {tag}")
            lines.append("")
            for ep in eps:
                lines.append(f"### {ep['method']} {ep['path']}")
                lines.append("")
                lines.append(f"**{ep['summary']}**")
                if ep["description"]:
                    lines.append(f"\n{ep['description']}")
                lines.append("")
                if ep["parameters"]:
                    lines.append("**参数**:")
                    lines.append("")
                    lines.append("| 名称 | 位置 | 类型 | 必填 | 描述 |")
                    lines.append("|------|------|------|------|------|")
                    for p in ep["parameters"]:
                        lines.append(f"| {p.get('name','')} | {p.get('in','')} | "
                                     f"{p.get('schema',{}).get('type','')} | "
                                     f"{'是' if p.get('required') else '否'} | "
                                     f"{p.get('description','')} |")
                    lines.append("")
                lines.append("---")
                lines.append("")

        return "\n".join(lines)

    def _default_responses(self) -> Dict:
        return {
            "200": {"description": "成功", "content": {"application/json": {}}},
            "400": {"description": "请求错误"},
            "401": {"description": "未授权"},
            "403": {"description": "禁止访问"},
            "404": {"description": "未找到"},
            "429": {"description": "请求限流"},
            "500": {"description": "服务器错误"},
        }

class FrontendSDKGenerator:
    """前端SDK代码生成器

    根据API端点自动生成TypeScript/JavaScript前端调用代码，
    保持前后端分离的同时提供类型安全的集成。
    """

    def __init__(self, api_doc: APIDocumentGenerator = None):
        self.api_doc = api_doc or APIDocumentGenerator()

    def generate_typescript_sdk(self) -> str:
        """生成TypeScript SDK"""
        lines = [
            "// 花先生后端引擎 TypeScript SDK",
            f"// 版本: {self.api_doc.version}",
            "// 自动生成，请勿手动修改",
            "",
            "export interface UnifiedResponse<T = any> {",
            "  status: 'success' | 'error' | 'partial' | 'pending' | 'cancelled';",
            "  code: number;",
            "  message: string;",
            "  data: T;",
            "  errors: Array<{ field: string; message: string }>;",
            "  warnings: Array<{ message: string }>;",
            "  pagination?: {",
            "    page: number;",
            "    page_size: number;",
            "    total: number;",
            "    total_pages: number;",
            "    has_next: boolean;",
            "    has_prev: boolean;",
            "  };",
            "  metadata: Record<string, any>;",
            "  request_id: string;",
            "  timestamp: number;",
            "  duration_ms: number;",
            "}",
            "",
            "export interface APIClientOptions {",
            "  baseUrl?: string;",
            "  token?: string;",
            "  timeout?: number;",
            "  onError?: (error: UnifiedResponse) => void;",
            "}",
            "",
            "export class LibertasAPIClient {",
            "  private baseUrl: string;",
            "  private token?: string;",
            "  private timeout: number;",
            "  private onError?: (error: UnifiedResponse) => void;",
            "",
            "  constructor(options: APIClientOptions = {}) {",
            f"    this.baseUrl = options.baseUrl || '{self.api_doc.base_url}';",
            "    this.token = options.token;",
            "    this.timeout = options.timeout || 30000;",
            "    this.onError = options.onError;",
            "  }",
            "",
            "  setToken(token: string) {",
            "    this.token = token;",
            "  }",
            "",
            "  private async request<T>(",
            "    method: string,",
            "    path: string,",
            "    data?: any,",
            "    params?: Record<string, any>",
            "  ): Promise<UnifiedResponse<T>> {",
            "    const url = new URL(this.baseUrl + path);",
            "    if (params) {",
            "      Object.entries(params).forEach(([key, value]) => {",
            "        if (value !== undefined) url.searchParams.set(key, String(value));",
            "      });",
            "    }",
            "",
            "    const headers: Record<string, string> {",
            "      'Content-Type': 'application/json',",
            "    };",
            "    if (this.token) {",
            "      headers['Authorization'] = `Bearer ${this.token}`;",
            "    }",
            "",
            "    const controller = new AbortController();",
            "    const timeoutId = setTimeout(() => controller.abort(), this.timeout);",
            "",
            "    try {",
            "      const response = await fetch(url.toString(), {",
            "        method,",
            "        headers,",
            "        body: data ? JSON.stringify(data) : undefined,",
            "        signal: controller.signal,",
            "      });",
            "      const result = await response.json() as UnifiedResponse<T>;",
            "      if (result.status === 'error' && this.onError) {",
            "        this.onError(result);",
            "      }",
            "      return result;",
            "    } finally {",
            "      clearTimeout(timeoutId);",
            "    }",
            "  }",
            "",
        ]

        # 为每个端点生成方法
        for ep in self.api_doc.endpoints:
            method_name = self._path_to_method_name(ep["path"], ep["method"])
            param_names = [p["name"] for p in ep.get("parameters", []) if p.get("in") == "query"]
            has_body = ep.get("requestBody") is not None

            lines.append(f"  // {ep['summary']}")
            if has_body and param_names:
                lines.append(f"  async {method_name}(body: any, params?: Record<string, any>) {{")
                lines.append(f"    return this.request('{ep['method']}', '{ep['path']}', body, params);")
            elif has_body:
                lines.append(f"  async {method_name}(body: any) {{")
                lines.append(f"    return this.request('{ep['method']}', '{ep['path']}', body);")
            elif param_names:
                lines.append(f"  async {method_name}(params?: Record<string, any>) {{")
                lines.append(f"    return this.request('{ep['method']}', '{ep['path']}', undefined, params);")
            else:
                lines.append(f"  async {method_name}() {{")
                lines.append(f"    return this.request('{ep['method']}', '{ep['path']}');")
            lines.append("  }")
            lines.append("")

        # WebSocket和SSE客户端
        lines.extend([
            "  // WebSocket实时通信",
            "  connectWebSocket(path: string = '/ws'): WebSocket {",
            "    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + path;",
            "    const ws = new WebSocket(wsUrl);",
            "    if (this.token) {",
            "      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.token }));",
            "    }",
            "    return ws;",
            "  }",
            "",
            "  // SSE流式输出",
            "  connectSSE(path: string, onEvent: (event: string, data: any) => void): EventSource {",
            "    const es = new EventSource(this.baseUrl + path);",
            "    es.onmessage = (e) => {",
            "      try {",
            "        const data = JSON.parse(e.data);",
            "        onEvent('message', data);",
            "      } catch {",
            "        onEvent('message', e.data);",
            "      }",
            "    };",
            "    return es;",
            "  }",
            "}",
            "",
            "export default LibertasAPIClient;",
        ])

        return "\n".join(lines)

    def generate_javascript_sdk(self) -> str:
        """生成JavaScript SDK（简化版）"""
        ts_code = self.generate_typescript_sdk()
        # 移除类型注解
        js_code = re.sub(r':\s*[A-Za-z<>\[\]\|, ]+(?=[\)=,{])', '', ts_code)
        js_code = re.sub(r'interface\s+\w+\s*\{[^}]*\}', '', js_code)
        js_code = js_code.replace('export ', '')
        return js_code

    def _path_to_method_name(self, path: str, method: str) -> str:
        """将API路径转换为方法名"""
        # 移除路径参数
        clean = re.sub(r'\{[^}]+\}', '', path)
        clean = re.sub(r'[^a-zA-Z0-9]+', '_', clean).strip('_')
        prefix = {"GET": "get", "POST": "create", "PUT": "update",
                  "DELETE": "delete", "PATCH": "patch"}.get(method, "request")
        return f"{prefix}_{clean}" if clean else prefix

    def save_sdk(self, output_path: str, language: str = "typescript"):
        """保存SDK到文件"""
        if language == "typescript":
            code = self.generate_typescript_sdk()
        else:
            code = self.generate_javascript_sdk()
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(code)
        return output_path

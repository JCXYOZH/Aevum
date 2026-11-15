"""插件系统职责：manager。"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from libertas.foundation.config import get_data_dir

from .template import PLUGIN_TEMPLATE
from .registry import PluginRegistry

class PluginManager:
    def __init__(self, plugins_dir: str = "", data_dir: str = ""):
        self.data_dir = data_dir or get_data_dir()
        self.plugins_dir = plugins_dir or os.path.join(self.data_dir, "plugins")
        # 内置插件目录（随Libertas分发）
        self.builtin_dir = os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), "plugins")
        self.index_file = os.path.join(self.data_dir, "plugins_index.json")
        self.market_file = os.path.join(self.data_dir, "plugins_market.json")
        os.makedirs(self.plugins_dir, exist_ok=True)
        self.registry = PluginRegistry()
        self.loaded: Dict[str, Dict] = {}
        self._lock = threading.Lock()
        self._wan = None
        self._index = self._load_json(self.index_file, {"plugins": {}})
        self._market = self._load_json(self.market_file, {"plugins": {}})
        # 首次运行时复制内置插件到用户目录
        self._sync_builtin_plugins()

    def set_wan(self, wan):
        self._wan = wan

    def _sync_builtin_plugins(self):
        """把内置插件同步到用户插件目录。

        - 用户目录没有该文件 → 直接复制
        - 用户没改过（内容仍等于上次同步的内置版本）→ 随版本升级一起更新
          （旧实现「只在不存在时复制」会让内置插件的修复**永远到不了**老安装）
        - 用户改过 → 保留不动
        - 老安装没有同步记录（首次引入本机制）→ 覆盖前先备份到 .builtin_backup_*/
        """
        if not os.path.isdir(self.builtin_dir):
            return
        import hashlib
        import shutil
        import time as _time
        builtin_set = self._index.setdefault("builtin", {})
        synced = self._index.setdefault("builtin_hash", {})

        def _sha(path):
            try:
                with open(path, "rb") as f:
                    return hashlib.sha256(f.read()).hexdigest()
            except Exception:
                return ""

        backup_dir = None
        for fn in sorted(os.listdir(self.builtin_dir)):
            if not fn.endswith(".py") or fn.startswith("_"):
                continue
            src = os.path.join(self.builtin_dir, fn)
            dst = os.path.join(self.plugins_dir, fn)
            # 标记为内置插件（即使已存在也标记）
            builtin_set[fn] = True
            src_hash = _sha(src)
            if not src_hash:
                continue
            if not os.path.isfile(dst):
                try:
                    shutil.copy2(src, dst)
                    synced[fn] = src_hash
                except Exception:
                    pass
                continue
            dst_hash = _sha(dst)
            if dst_hash == src_hash:
                synced[fn] = src_hash          # 已是最新
                continue
            known = synced.get(fn)
            if known is not None and dst_hash != known:
                continue                       # 用户改过 → 保留
            # 老安装没有记录：先备份再刷新，避免升级时丢掉改动
            if known is None and backup_dir is None:
                backup_dir = os.path.join(
                    self.plugins_dir, ".builtin_backup_" + _time.strftime("%Y%m%d%H%M%S"))
                try:
                    os.makedirs(backup_dir, exist_ok=True)
                except Exception:
                    backup_dir = ""
            try:
                if backup_dir:
                    shutil.copy2(dst, os.path.join(backup_dir, fn))
                shutil.copy2(src, dst)
                synced[fn] = src_hash
            except Exception:
                pass
        self._save_json(self.index_file, self._index)

    def is_builtin(self, filename: str) -> bool:
        """检查插件是否为内置插件（不可重复发布）"""
        return filename in self._index.get("builtin", {})

    @staticmethod
    def _load_json(path: str, default: Dict) -> Dict:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return default.copy() if isinstance(default, dict) else default

    @staticmethod
    def _save_json(path: str, data: Dict):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------
    # 本地插件管理
    # ------------------------------------------------------------------

    def load_all(self) -> List[Dict]:
        """加载所有已启用的插件"""
        loaded = []
        with self._lock:
            self.loaded.clear()
            self.registry.tools.clear()
            self.registry.tool_params.clear()
            self.registry.search_backends.clear()
            self.registry.hooks.clear()
            self.registry.menus.clear()
            if hasattr(self.registry, '_tool_meta'):
                self.registry._tool_meta.clear()
            for fn in sorted(os.listdir(self.plugins_dir)):
                if fn.endswith(".py") and not fn.startswith("_"):
                    # 检查是否被禁用
                    meta = self._index.get("plugins", {}).get(fn, {})
                    if meta.get("disabled"):
                        self.loaded[fn] = {"name": fn, "status": "disabled",
                                           "desc": meta.get("description", ""),
                                           "is_builtin": self.is_builtin(fn)}
                        loaded.append(self.loaded[fn])
                        continue
                    info = self._load_plugin(fn)
                    loaded.append(info)
                    self.loaded[fn] = info
        return loaded

    def _load_plugin(self, filename: str) -> Dict:
        path = os.path.join(self.plugins_dir, filename)
        try:
            spec = importlib.util.spec_from_file_location(
                f"libertas_plugin_{filename[:-3]}", path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            if hasattr(mod, "register"):
                mod.register(self.registry)
            meta = self._index.get("plugins", {}).get(filename, {})
            return {
                "name": filename,
                "status": "loaded",
                "tools": len(self.registry.tools),
                "desc": meta.get("description", (mod.__doc__ or "").strip().split("\n")[0]),
                "version": meta.get("version", "1.0.0"),
                "author": meta.get("author", "未知"),
                "category": meta.get("category", "未分类"),
                "enabled": True,
                "is_builtin": self.is_builtin(filename),
            }
        except Exception as e:
            return {"name": filename, "status": "error", "error": str(e),
                    "enabled": False, "is_builtin": self.is_builtin(filename)}

    def list_plugins(self) -> List[Dict]:
        if not self.loaded:
            self.load_all()
        return list(self.loaded.values())

    def list_registered_tools(self) -> List[Dict]:
        """列出所有插件注册的工具"""
        if not self.loaded:
            self.load_all()
        tools = []
        meta = getattr(self.registry, '_tool_meta', {})
        for name, func in self.registry.tools.items():
            m = meta.get(name, {})
            tools.append({
                "name": name,
                "desc": m.get("desc", ""),
                "category": m.get("category", "自定义"),
                "params": self.registry.tool_params.get(name, {}),
            })
        return tools

    def create_plugin(self, name: str, description: str = "", author: str = "",
                      category: str = "未分类", version: str = "1.0.0") -> Dict:
        """从模板创建新插件"""
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-").rstrip(".py")
        if not safe_name:
            return {"success": False, "error": "插件名不合法"}
        if not safe_name.endswith(".py"):
            safe_name += ".py"
        path = os.path.join(self.plugins_dir, safe_name)
        if os.path.isfile(path):
            return {"success": False, "error": "插件已存在"}
        func_name = "".join(c for c in safe_name[:-3] if c.isalnum() or c == "_")
        if not func_name or func_name[0].isdigit():
            func_name = "plugin_" + func_name
        code = PLUGIN_TEMPLATE.format(
            name=safe_name[:-3], author=author or "本地用户",
            version=version, category=category,
            description=description or "自定义插件",
            func_name=func_name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        self._index.setdefault("plugins", {})[safe_name] = {
            "description": description, "author": author or "本地用户",
            "version": version, "category": category,
            "created_at": time.time(), "disabled": False,
        }
        self._save_json(self.index_file, self._index)
        return {"success": True, "path": path, "name": safe_name, "code": code}

    def save_plugin(self, name: str, code: str) -> Dict:
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-.").rstrip(".py")
        if not safe_name.endswith(".py"):
            safe_name += ".py"
        path = os.path.join(self.plugins_dir, safe_name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        return {"success": True, "path": path}

    def read_plugin(self, name: str) -> Dict:
        path = os.path.join(self.plugins_dir, name)
        if not os.path.isfile(path):
            return {"success": False, "error": "文件不存在"}
        with open(path, "r", encoding="utf-8") as f:
            return {"success": True, "code": f.read(), "name": name}

    def delete_plugin(self, name: str) -> Dict:
        path = os.path.join(self.plugins_dir, name)
        if os.path.isfile(path):
            os.remove(path)
        self._index.get("plugins", {}).pop(name, None)
        self._save_json(self.index_file, self._index)
        return {"success": True}

    def toggle_plugin(self, name: str) -> Dict:
        """启用/禁用插件"""
        meta = self._index.setdefault("plugins", {}).setdefault(name, {})
        meta["disabled"] = not meta.get("disabled", False)
        self._save_json(self.index_file, self._index)
        self.load_all()
        return {"success": True, "disabled": meta["disabled"]}

    def call_tool(self, name: str, **kwargs) -> Dict:
        """调用插件注册的工具"""
        if not self.loaded:
            self.load_all()
        result = self.registry.call_tool(name, **kwargs)
        # registry.call_tool 在插件里抛异常时返回 {"success": False, "error": ...}。
        # 不能再包一层 success=True，否则上层只看到"成功"、工具其实根本没跑，
        # 模型会拿到一个假成功（历史上 target 参数名不匹配就是这么被吞掉的）。
        if isinstance(result, dict) and result.get("success") is False:
            return result
        return {"success": True, "result": result}

    # ------------------------------------------------------------------
    # WAN 插件市场
    # ------------------------------------------------------------------

    def publish_to_wan(self, filename: str, author: str = "") -> Dict:
        """发布插件到WAN插件市场"""
        path = os.path.join(self.plugins_dir, filename)
        if not os.path.isfile(path):
            return {"success": False, "error": "插件文件不存在"}
        if self.is_builtin(filename):
            return {"success": False, "error": "内置插件随软件分发，不可重复发布。可复制后修改为新插件再发布。"}
        with open(path, "r", encoding="utf-8") as f:
            code = f.read()
        meta = self._index.get("plugins", {}).get(filename, {})
        plugin_id = hashlib.sha256(
            f"{filename}:{author}:{time.time()}".encode()).hexdigest()[:16]
        # 计算代码hash
        code_hash = hashlib.sha256(code.encode()).hexdigest()
        # 本地记录
        pub_info = {
            "id": plugin_id,
            "filename": filename,
            "author": author or meta.get("author", "匿名"),
            "description": meta.get("description", ""),
            "version": meta.get("version", "1.0.0"),
            "category": meta.get("category", "未分类"),
            "code_hash": code_hash,
            "code_size": len(code),
            "published_at": time.time(),
            "time_str": time.strftime("%Y-%m-%d %H:%M:%S"),
            "downloads": 0,
        }
        self._market.setdefault("plugins", {})[plugin_id] = pub_info
        self._save_json(self.market_file, self._market)
        # 广播到WAN（元信息+代码，代码通过chunk传输）
        if self._wan and getattr(self._wan, '_running', False):
            try:
                # 先广播元信息
                announce = dict(pub_info)
                announce["type"] = "plugin_announce"
                self._wan.client.publish(
                    f"{self._wan.topic_base}/plugin",
                    json.dumps(announce, ensure_ascii=False))
                # 分块发送代码（每块4KB）
                chunk_size = 4096
                chunks = [code[i:i+chunk_size]
                          for i in range(0, len(code), chunk_size)]
                total = len(chunks)
                for idx, chunk in enumerate(chunks):
                    payload = {
                        "type": "plugin_chunk",
                        "id": plugin_id,
                        "idx": idx,
                        "total": total,
                        "data": chunk,
                    }
                    self._wan.client.publish(
                        f"{self._wan.topic_base}/plugin_data",
                        json.dumps(payload, ensure_ascii=False))
                    time.sleep(0.05)  # 避免发送过快
                return {"success": True, "id": plugin_id,
                        "message": f"插件 {filename} 已发布到WAN，共{total}个分块"}
            except Exception as e:
                return {"success": True, "id": plugin_id,
                        "message": f"插件已记录本地，WAN广播失败: {e}"}
        return {"success": True, "id": plugin_id,
                "message": "插件已记录本地（WAN未连接，其他用户暂不可见）"}

    def receive_plugin_announce(self, payload: Dict):
        """接收WAN中的插件发布公告"""
        plugin_id = str(payload.get("id", ""))
        # 公告来自WAN，未经认证：id 会同时作为市场键与落盘文件名使用，必须限定字符集与长度
        if not plugin_id or len(plugin_id) > 64 or not all(
                c.isalnum() or c in "_-" for c in plugin_id):
            return
        # 文件名只允许纯文件名（丢弃任何目录成分），且必须是 .py
        filename = os.path.basename(str(payload.get("filename") or f"{plugin_id}.py"))
        if not filename.endswith(".py") or filename.startswith("."):
            return
        entry = {k: v for k, v in payload.items() if k != "type"}
        entry["filename"] = filename
        with self._lock:
            self._market.setdefault("plugins", {})[plugin_id] = entry
            self._save_json(self.market_file, self._market)

    def receive_plugin_chunk(self, payload: Dict):
        """接收WAN中的插件代码分块"""
        # 分块缓存文件名由 id 与 idx 拼成，两者都直接来自WAN，先过滤再落盘
        plugin_id = "".join(c for c in str(payload.get("id", ""))
                            if c.isalnum() or c in "_-")[:64]
        try:
            idx = int(payload.get("idx", 0))
            total = int(payload.get("total", 1))
        except (TypeError, ValueError):
            return
        data = payload.get("data", "")
        if not plugin_id or total < 1:
            return
        # 临时存储分块
        cache_dir = os.path.join(self.data_dir, "plugins_cache")
        os.makedirs(cache_dir, exist_ok=True)
        chunk_file = os.path.join(cache_dir, f"{plugin_id}_{idx}")
        with open(chunk_file, "w", encoding="utf-8") as f:
            f.write(data)
        # 检查是否所有分块都已接收
        chunks_received = len([f for f in os.listdir(cache_dir)
                               if f.startswith(plugin_id + "_")])
        if chunks_received >= total:
            self._assemble_plugin(plugin_id, total)

    def _assemble_plugin(self, plugin_id: str, total: int):
        """组装插件分块"""
        cache_dir = os.path.join(self.data_dir, "plugins_cache")
        code_parts = []
        for idx in range(total):
            chunk_file = os.path.join(cache_dir, f"{plugin_id}_{idx}")
            if os.path.isfile(chunk_file):
                with open(chunk_file, "r", encoding="utf-8") as f:
                    code_parts.append(f.read())
                try:
                    os.remove(chunk_file)
                except Exception:
                    pass
        code = "".join(code_parts)
        info = self._market.get("plugins", {}).get(plugin_id, {})
        if not info:
            return
        # 校验hash
        code_hash = hashlib.sha256(code.encode()).hexdigest()
        if info.get("code_hash") and code_hash != info["code_hash"]:
            return  # hash不匹配，丢弃
        # 保存到待安装目录
        pending_dir = os.path.join(self.data_dir, "plugins_pending")
        os.makedirs(pending_dir, exist_ok=True)
        # 落盘前再次收敛文件名：即使市场条目来自旧数据或其它写入路径，也不允许写出 pending 目录
        filename = os.path.basename(str(info.get("filename") or f"{plugin_id}.py"))
        if not filename.endswith(".py") or filename.startswith("."):
            return
        pending_path = os.path.join(pending_dir, filename)
        with open(pending_path, "w", encoding="utf-8") as f:
            f.write(code)
        info["pending_install"] = True
        self._save_json(self.market_file, self._market)

    def list_market(self) -> List[Dict]:
        """列出WAN插件市场中的插件"""
        return list(self._market.get("plugins", {}).values())

    def install_from_market(self, plugin_id: str) -> Dict:
        """从插件市场安装插件"""
        info = self._market.get("plugins", {}).get(plugin_id)
        if not info:
            return {"success": False, "error": "插件不存在于市场"}
        filename = info.get("filename", f"{plugin_id}.py")
        # 优先从待安装目录取
        pending_path = os.path.join(self.data_dir, "plugins_pending", filename)
        if os.path.isfile(pending_path):
            import shutil
            dest = os.path.join(self.plugins_dir, filename)
            shutil.copy2(pending_path, dest)
            try:
                os.remove(pending_path)
            except Exception:
                pass
        else:
            # 可能是本地发布的插件
            local_path = os.path.join(self.plugins_dir, filename)
            if not os.path.isfile(local_path):
                return {"success": False, "error": "插件代码尚未接收完成，请等待WAN传输"}
        # 记录元数据
        self._index.setdefault("plugins", {})[filename] = {
            "description": info.get("description", ""),
            "author": info.get("author", "未知"),
            "version": info.get("version", "1.0.0"),
            "category": info.get("category", "未分类"),
            "installed_from_market": True,
            "installed_at": time.time(),
            "disabled": False,
        }
        self._save_json(self.index_file, self._index)
        info["downloads"] = info.get("downloads", 0) + 1
        info["pending_install"] = False
        self._save_json(self.market_file, self._market)
        # 重新加载
        self.load_all()
        return {"success": True, "message": f"插件 {filename} 安装成功",
                "name": filename}

    def request_plugin(self, plugin_id: str) -> Dict:
        """向WAN请求插件代码（如果分块未接收完整）"""
        if self._wan and getattr(self._wan, '_running', False):
            try:
                payload = {"type": "plugin_request", "id": plugin_id,
                           "requester": self._wan.peer_id}
                self._wan.client.publish(
                    f"{self._wan.topic_base}/plugin_req",
                    json.dumps(payload, ensure_ascii=False))
                return {"success": True, "message": "已向房间请求插件代码，请等待传输"}
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": False, "error": "WAN未连接"}

    def handle_plugin_request(self, payload: Dict):
        """处理其他节点的插件代码请求"""
        plugin_id = payload.get("id", "")
        info = self._market.get("plugins", {}).get(plugin_id)
        if not info or not self._wan or not getattr(self._wan, '_running', False):
            return
        filename = info.get("filename", "")
        path = os.path.join(self.plugins_dir, filename)
        if not os.path.isfile(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            code = f.read()
        chunk_size = 4096
        chunks = [code[i:i+chunk_size]
                  for i in range(0, len(code), chunk_size)]
        for idx, chunk in enumerate(chunks):
            data = {"type": "plugin_chunk", "id": plugin_id,
                    "idx": idx, "total": len(chunks), "data": chunk}
            self._wan.client.publish(
                f"{self._wan.topic_base}/plugin_data",
                json.dumps(data, ensure_ascii=False))
            time.sleep(0.05)

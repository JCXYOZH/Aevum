# tools/file_ops.py
"""
本地文件操作工具 - 供云端模型安全地读写本地文件
支持：读取、写入、追加、列出目录、文件搜索
路径限制在允许的根目录内（项目目录、数据目录、桌面、下载、文档、临时目录）
"""
import os
import glob
from typing import Dict, List, Optional
from libertas.foundation.config import get_data_dir


_DEFAULT_ALLOWED_ROOTS = None


def _get_default_roots() -> List[str]:
    """获取默认允许的根目录"""
    global _DEFAULT_ALLOWED_ROOTS
    if _DEFAULT_ALLOWED_ROOTS is not None:
        return _DEFAULT_ALLOWED_ROOTS
    roots = []
    try:
        from libertas.foundation.config import config
        project_root = config._project_root
        roots.append(project_root)
        roots.append(get_data_dir())
    except Exception:
        roots.append(os.getcwd())
    roots.append('/tmp')
    for p in ['~/Desktop', '~/Downloads', '~/Documents', '~/MrHuaWorkspace']:
        expanded = os.path.expanduser(p)
        roots.append(expanded)
    _DEFAULT_ALLOWED_ROOTS = [os.path.realpath(r) for r in roots if os.path.exists(os.path.realpath(r))]
    return _DEFAULT_ALLOWED_ROOTS


class FileOperator:
    """安全的本地文件操作器，限制在允许的根目录内"""

    def __init__(self, workspace: str = None, allowed_roots: List[str] = None):
        if allowed_roots:
            self.allowed_roots = [os.path.realpath(r) for r in allowed_roots]
        elif workspace:
            self.workspace = os.path.abspath(workspace)
            os.makedirs(self.workspace, exist_ok=True)
            self.allowed_roots = [self.workspace]
        else:
            self.workspace = os.path.expanduser('~/MrHuaWorkspace')
            os.makedirs(self.workspace, exist_ok=True)
            self.allowed_roots = list(set(_get_default_roots() + [self.workspace]))

    def _resolve(self, path: str) -> str:
        """将路径解析为绝对路径，并检查是否在允许的根目录内"""
        if os.path.isabs(path):
            abs_path = os.path.abspath(path)
        else:
            # 相对路径默认相对于工作目录
            abs_path = os.path.abspath(os.path.join(self.workspace, path))
        real = os.path.realpath(abs_path)
        for root in self.allowed_roots:
            if real == root or real.startswith(root + os.sep):
                return abs_path
        raise PermissionError(f"路径不在允许的目录内: {path}")

    def read_file(self, path: str, max_chars: int = 10000) -> Dict:
        try:
            abs_path = self._resolve(path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"文件不存在: {path}"}
            if os.path.isdir(abs_path):
                return {"success": False, "error": f"是目录不是文件: {path}"}
            with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read(max_chars)
            stat = os.stat(abs_path)
            return {
                "success": True,
                "path": path,
                "content": content,
                "size": stat.st_size,
                "truncated": stat.st_size > max_chars,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def write_file(self, path: str, content: str, append: bool = False) -> Dict:
        try:
            abs_path = self._resolve(path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            mode = 'a' if append else 'w'
            with open(abs_path, mode, encoding='utf-8') as f:
                f.write(content)
            return {"success": True, "path": path, "bytes_written": len(content.encode('utf-8')), "mode": mode}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_dir(self, path: str = ".") -> Dict:
        try:
            abs_path = self._resolve(path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"目录不存在: {path}"}
            entries = []
            for name in sorted(os.listdir(abs_path)):
                full = os.path.join(abs_path, name)
                entries.append({
                    "name": name,
                    "type": "dir" if os.path.isdir(full) else "file",
                    "size": os.path.getsize(full) if os.path.isfile(full) else 0,
                })
            return {"success": True, "path": path, "entries": entries, "count": len(entries)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def search_files(self, pattern: str, path: str = ".") -> Dict:
        try:
            abs_path = self._resolve(path)
            matches = glob.glob(os.path.join(abs_path, pattern), recursive=True)
            results = []
            for m in matches[:50]:
                rel = os.path.relpath(m, abs_path)
                results.append({
                    "path": rel,
                    "type": "dir" if os.path.isdir(m) else "file",
                    "size": os.path.getsize(m) if os.path.isfile(m) else 0,
                })
            return {"success": True, "pattern": pattern, "results": results, "count": len(results)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_file(self, path: str) -> Dict:
        try:
            abs_path = self._resolve(path)
            if not os.path.exists(abs_path):
                return {"success": False, "error": f"不存在: {path}"}
            if os.path.isdir(abs_path):
                os.rmdir(abs_path)
            else:
                os.remove(abs_path)
            return {"success": True, "path": path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_workspace(self) -> str:
        return self.workspace

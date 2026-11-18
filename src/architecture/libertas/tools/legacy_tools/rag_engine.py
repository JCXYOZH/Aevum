# tools/rag_engine.py
"""
RAG 知识库引擎 - 基于 TF-IDF 的本地知识库
支持：添加文档、分块、索引、检索、删除、导入文件
文档持久化为 JSON，索引在内存中构建
"""
import os
import sys
import json
import time
import hashlib
import re
import threading
from typing import List, Dict, Optional, Tuple
from collections import defaultdict

# 防止joblib/loky泄漏信号量；Windows不支持fork，必须用spawn
_default_mp_method = "spawn" if sys.platform == "win32" else "fork"
os.environ.setdefault("JOBLIB_START_METHOD", _default_mp_method)
os.environ.setdefault("LOKY_MAX_CPU_COUNT", "1")

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    import numpy as np
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

try:
    import jieba
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False


def tokenize_zh(text: str) -> str:
    """中文分词：用 jieba 切词后用空格连接，供 TF-IDF 使用"""
    if HAS_JIEBA:
        return " ".join(jieba.cut(text))
    return text


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 80) -> List[str]:
    """将文本按段落+长度分块，带重叠"""
    paragraphs = re.split(r'\n{2,}|(?<=[。！？.!?])\s*', text)
    chunks = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) <= chunk_size:
            current += para + "\n"
        else:
            if current:
                chunks.append(current.strip())
            if len(para) > chunk_size:
                # 超长段落硬切
                for i in range(0, len(para), chunk_size - overlap):
                    chunks.append(para[i:i + chunk_size])
                current = ""
            else:
                current = para + "\n"
    if current.strip():
        chunks.append(current.strip())
    return chunks if chunks else [text[:chunk_size]]


class RAGKnowledgeBase:
    """本地 RAG 知识库"""

    def __init__(self, storage_dir: str):
        self.storage_dir = os.path.abspath(storage_dir)
        self.docs_dir = os.path.join(self.storage_dir, "documents")
        self.index_path = os.path.join(self.storage_dir, "rag_index.json")
        os.makedirs(self.docs_dir, exist_ok=True)

        self._lock = threading.RLock()
        self.chunks: List[Dict] = []       # [{id, doc_id, text, tokens, metadata}]
        self.vectorizer = None
        self.tfidf_matrix = None
        self.documents: Dict[str, Dict] = {}  # doc_id -> {title, source, created_at, chunk_count}

        self._load()

    def _load(self):
        """从磁盘加载索引和文档块"""
        if os.path.exists(self.index_path):
            try:
                with open(self.index_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.chunks = data.get("chunks", [])
                self.documents = data.get("documents", {})
            except Exception:
                self.chunks = []
                self.documents = {}
        self._rebuild_index()

    def _save(self):
        """持久化索引"""
        with self._lock:
            data = {
                "chunks": self.chunks,
                "documents": self.documents,
                "saved_at": time.time(),
            }
            tmp = self.index_path + ".tmp"
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.index_path)

    def _rebuild_index(self):
        """重建 TF-IDF 索引"""
        if not HAS_SKLEARN or not self.chunks:
            self.vectorizer = None
            self.tfidf_matrix = None
            return
        corpus = [c.get("tokens", c["text"]) for c in self.chunks]
        self.vectorizer = TfidfVectorizer(max_features=10000, ngram_range=(1, 2))
        try:
            self.tfidf_matrix = self.vectorizer.fit_transform(corpus)
        except ValueError:
            self.vectorizer = None
            self.tfidf_matrix = None

    def add_document(self, title: str, content: str, source: str = "manual",
                     metadata: Dict = None, chunk_size: int = 500) -> Dict:
        """添加文档到知识库，自动分块和索引"""
        with self._lock:
            doc_id = hashlib.md5(f"{title}:{time.time()}".encode()).hexdigest()[:12]
            text_chunks = chunk_text(content, chunk_size=chunk_size)

            chunk_records = []
            for i, chunk in enumerate(text_chunks):
                chunk_id = f"{doc_id}_{i}"
                chunk_records.append({
                    "id": chunk_id,
                    "doc_id": doc_id,
                    "text": chunk,
                    "tokens": tokenize_zh(chunk),
                    "chunk_index": i,
                })

            self.chunks.extend(chunk_records)
            self.documents[doc_id] = {
                "id": doc_id,
                "title": title,
                "source": source,
                "chunk_count": len(chunk_records),
                "created_at": time.time(),
                "metadata": metadata or {},
            }

            self._rebuild_index()
            self._save()
            return {"doc_id": doc_id, "title": title, "chunks": len(chunk_records)}

    def add_file(self, file_path: str, title: str = None) -> Dict:
        """从文件导入文档（支持 .txt, .md, .py, .json, .csv, .log 等文本文件）"""
        if not os.path.exists(file_path):
            return {"error": f"文件不存在: {file_path}"}
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception as e:
            return {"error": f"读取文件失败: {e}"}

        if not title:
            title = os.path.basename(file_path)
        return self.add_document(
            title=title,
            content=content,
            source=f"file:{file_path}",
            metadata={"file_path": file_path, "size": len(content)}
        )

    def add_web_search(self, query: str, max_results: int = 5) -> Dict:
        """从网页搜索结果导入知识库

        search_and_summarize 默认会抓取前若干个结果页的正文（fetch_top=3）。
        本方法对任何失败只返回带 error 的结构，不向上抛异常。
        """
        from .web_search import search_and_summarize
        try:
            # 注意：不要传 fetch_content——search_and_summarize 没有这个形参，
            # 传了会直接抛 TypeError（曾导致 /api/rag/add_web 恒 500）
            # 总预算 45s：3 页正文抓取若各用默认 20s，最坏会把"网页导入"卡到约 60s；
            # 给整次导入一个 45s 上限，超预算的页面按"因预算截断"跳过。
            result = search_and_summarize(query, max_results=max_results, total_timeout=45)
        except Exception as e:
            return {"query": query, "added": [], "count": 0,
                    "error": f"搜索抓取失败: {e}"}

        added = []
        skipped = []
        for r in result.get("results", []):
            if "error" in r or not r.get("url"):
                continue
            try:
                title = r.get("title") or r["url"]
                content = f"标题: {title}\nURL: {r['url']}\n摘要: {r.get('snippet', '')}\n"
                if r.get("page_content"):
                    content += f"正文:\n{r['page_content']}"
                res = self.add_document(
                    title=title[:100],
                    content=content,
                    source=f"web:{r['url']}",
                    metadata={"query": query, "url": r["url"]}
                )
                if "doc_id" in res:
                    added.append(res)
            except Exception as e:
                # 单条结果入库失败不影响其余结果，失败原因带回给调用方
                skipped.append({"url": r.get("url", ""), "error": str(e)})
                continue
        out = {"query": query, "added": added, "count": len(added)}
        if skipped:
            out["skipped"] = skipped
        if not added:
            # 一条都没入库就不能算成功：调用方（/api/rag/add_web）据此提示用户，
            # 否则前端会把"搜索/抓取失败、0 条入库"显示成"已存入知识库"
            out["error"] = ("搜索结果全部入库失败" if skipped
                            else "没有可导入的搜索结果（搜索或抓取失败）")
        return out

    def search(self, query: str, top_k: int = 5, min_score: float = 0.05) -> List[Dict]:
        """检索最相关的文档块"""
        with self._lock:
            if not self.chunks or self.vectorizer is None or self.tfidf_matrix is None:
                return []

            query_tokens = tokenize_zh(query)
            try:
                query_vec = self.vectorizer.transform([query_tokens])
                scores = cosine_similarity(query_vec, self.tfidf_matrix).flatten()
            except Exception:
                return []

            top_indices = np.argsort(scores)[::-1][:top_k]
            results = []
            for idx in top_indices:
                score = float(scores[idx])
                if score < min_score:
                    continue
                chunk = self.chunks[idx]
                doc = self.documents.get(chunk["doc_id"], {})
                results.append({
                    "chunk_id": chunk["id"],
                    "doc_id": chunk["doc_id"],
                    "title": doc.get("title", "未知"),
                    "source": doc.get("source", ""),
                    "text": chunk["text"],
                    "score": round(score, 4),
                })
            return results

    def get_context(self, query: str, top_k: int = 3) -> str:
        """检索并格式化为上下文字符串，供模型使用"""
        results = self.search(query, top_k=top_k)
        if not results:
            return ""
        parts = [f"【知识库检索结果】(查询: {query})"]
        for i, r in enumerate(results, 1):
            source_info = ""
            if r.get('source'):
                source_info = f"\n   来源: {r['source']}"
                if r['source'].startswith('http'):
                    source_info += "（可用 <<<WEB_FETCH:" + r['source'] + ">>> 读取完整内容）"
            parts.append(f"[{i}] {r['title']} (相关度: {r['score']}){source_info}\n{r['text']}")
        return "\n\n".join(parts)

    def list_documents(self) -> List[Dict]:
        """列出所有文档"""
        with self._lock:
            return [
                {
                    "id": doc["id"],
                    "title": doc["title"],
                    "source": doc["source"],
                    "chunk_count": doc["chunk_count"],
                    "created_at": doc.get("created_at", 0),
                }
                for doc in self.documents.values()
            ]

    def delete_document(self, doc_id: str) -> bool:
        """删除文档及其所有块"""
        with self._lock:
            if doc_id not in self.documents:
                return False
            del self.documents[doc_id]
            self.chunks = [c for c in self.chunks if c["doc_id"] != doc_id]
            self._rebuild_index()
            self._save()
            return True

    def clear(self) -> int:
        """清空知识库，返回删除的文档数"""
        with self._lock:
            count = len(self.documents)
            self.chunks = []
            self.documents = {}
            self.vectorizer = None
            self.tfidf_matrix = None
            self._save()
            return count

    def stats(self) -> Dict:
        """知识库统计"""
        with self._lock:
            return {
                "documents": len(self.documents),
                "chunks": len(self.chunks),
                "indexed": self.vectorizer is not None,
                "storage_dir": self.storage_dir,
            }

# 工具语义匹配器 - 两层筛选：类别 → 工具
# 根据用户消息向量匹配最相关的安全工具，只注册 Top-K 给模型
import os
import re
import json
import shutil
import threading
import subprocess
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path

from libertas.ai.vectorizers import SemanticVectorizer, TfidfTagVectorizer, TagVectorizer, cosine_similarity, get_shared_semantic_vectorizer
from libertas.foundation.config import config as global_config


# ============================================================
# 12+ 工具类别定义（与 config.yaml 中的 category 对齐，补充原生/HTTP工具）
# ============================================================
CATEGORY_DESCRIPTIONS = {
    "信息收集": "端口扫描 服务探测 子域名枚举 WHOIS DNS查询 指纹识别 资产发现 nmap masscan rustscan naabu subfinder amass whois",
    "Web安全": "目录爆破 Web漏洞扫描 参数发现 爬虫 WAF检测 ffuf gobuster dirsearch feroxbuster arjun wpscan",
    "漏洞检测": "漏洞扫描 CVE检测 配置审计 CMS漏洞 自动化漏洞验证 nuclei nikto xray wpscan searchsploit",
    "密码破解": "暴力破解 密码喷洒 哈希破解 凭证攻击 SSH FTP HTTP登录爆破 hydra medusa ncrack hashcat john",
    "流量分析": "抓包 网络流量监控 协议分析 中间人攻击 数据包注入 tcpdump tshark wireshark mitmproxy bettercap ngrep",
    "网络诊断": "连通性测试 路由跟踪 网络调试 端口监听 代理转发 ping traceroute mtr socat netcat scapy",
    "DNS工具": "DNS枚举 DNS记录查询 区域传送 子域名爆破 DNS反向解析 dnsx dig nslookup dnsrecon fierce",
    "SSL/TLS": "SSL证书检测 TLS配置审计 加密套件分析 证书透明度 openssl testssl sslyze",
    "系统审计": "系统安全审计 配置检查 恶意软件扫描 漏洞加固 lynis osquery clamav ssh-audit",
    "取证分析": "内存取证 磁盘分析 文件提取 时间线分析 恶意样本 volatility sleuthkit binwalk exiftool",
    "逆向分析": "二进制逆向 反汇编 ROP链构造 漏洞利用开发 调试 radare2 rizin ROPgadget pwntools",
    "代码安全": "密钥泄露扫描 依赖漏洞 静态代码分析 规则匹配 gitleaks trufflehog semgrep bandit yara",
    "HTTP专业": "HTTP请求重放 Intruder爆破 请求历史 响应分析 自定义请求 GET POST PUT DELETE headers body",
    "字典资源": "密码字典 目录字典 子域名字典 用户名字典 Payload列表 wordlist",
    "漏洞情报": "漏洞情报 CVE CVSS 漏洞库 漏洞公告 补丁 利用 已知被利用 CISA KEV NVD OSV GHSA PYSEC 安全公告 检索 查询 编号查询 单条详情 查一下",
}

# 原生 Python 工具（不依赖外部安装）
# 名称使用治理注册表的短名（不带native_前缀），执行器会自动映射到native_xxx函数
NATIVE_TOOLS = [
    {"name": "port_scan", "category": "信息收集", "description": "TCP端口扫描，检测开放端口和服务", "native": True},
    {"name": "dns_lookup", "category": "DNS工具", "description": "DNS记录查询，支持A/AAAA/MX/NS/TXT记录", "native": True},
    {"name": "whois", "category": "信息收集", "description": "WHOIS域名注册信息查询", "native": True},
    {"name": "http_fingerprint", "category": "Web安全", "description": "HTTP指纹识别，获取服务器、框架、技术栈", "native": True},
    {"name": "ssl_info", "category": "SSL/TLS", "description": "SSL证书信息获取，证书链、有效期、颁发者", "native": True},
    {"name": "ping", "category": "网络诊断", "description": "ICMP Ping连通性测试", "native": True},
    {"name": "subdomain_enum", "category": "信息收集", "description": "子域名枚举，DNS爆破", "native": True},
    {"name": "vuln_intel", "category": "漏洞情报", "description": "按编号（CVE/GHSA/OSV）直查漏洞完整情报，也支持关键词/产品/严重程度/CVSS/时间检索", "native": True},
]

# HTTP 专业工具
HTTP_TOOLS = [
    {"name": "http_repeater", "category": "HTTP专业", "description": "HTTP请求重放器，自定义Method/Headers/Body，发送并查看完整响应", "native": True},
    {"name": "http_intruder", "category": "HTTP专业", "description": "HTTP批量爆破，对URL参数进行Payload爆破攻击", "native": True},
    {"name": "http_scanner", "category": "HTTP专业", "description": "HTTP安全扫描，自动检测目录、Header安全配置、常见漏洞", "native": True},
]


class ToolMatcher:
    """工具语义匹配器：两层向量筛选。"""

    def __init__(self, config: Dict[str, Any] = None):
        self._config = config or global_config.get("tool_matcher", {})
        self._vectorizer = None
        self._category_vecs: Dict[str, List[float]] = {}
        self._tool_vecs: Dict[str, List[float]] = {}
        self._tools: Dict[str, Dict] = {}
        self._lock = threading.Lock()
        self._loaded = False

        # 设置（可被config覆盖）
        self.top_k = int(self._config.get("top_k", 5))
        self.category_threshold = float(self._config.get("category_threshold", 0.35))
        self.tool_threshold = float(self._config.get("tool_threshold", 0.30))
        self.include_native = True
        self.include_http = True

    def _ensure_loaded(self):
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            self._init_vectorizer()
            self._load_tools()
            self._build_vectors()
            self._loaded = True

    def _init_vectorizer(self):
        """初始化向量化器（使用共享语义模型）。"""
        shared = get_shared_semantic_vectorizer()
        # 共享语义模型对象可能已经创建、但模型权重还没加载好（返回 None）。
        # 这种「对象在、能力不在」的状态必须先探一次：否则所有向量都是 None，
        # 后面的 cosine_similarity 直接把意图匹配打崩（模型一个工具都选不到）。
        if shared is not None and self._probe_vectorizer(shared):
            self._vectorizer = shared
            return

        try:
            self._vectorizer = TfidfTagVectorizer(dimension=512)
            return
        except Exception:
            pass
        self._vectorizer = TagVectorizer(dimension=256)

    @staticmethod
    def _probe_vectorizer(vectorizer) -> bool:
        """试算一次，确认这个后端现在真的能出向量。"""
        try:
            probe = vectorizer.vectorize(["漏洞情报 CVE"])
            return probe is not None and len(probe) > 0
        except Exception:
            return False

    def _vec(self, text: str) -> List[float]:
        """取向量；语义后端不可用时降级到轻量 Tag 向量。

        语义模型没下载/加载失败时 ``SemanticVectorizer.vectorize()`` 会返回 None，
        直接进 ``cosine_similarity`` 就是 ``TypeError: object of type 'NoneType'
        has no len()`` —— 整个意图匹配会崩，模型连一个工具都选不到。
        这里统一兜底，保证 match() 永远有可用的向量。
        """
        vec = None
        try:
            vec = self._vectorizer.vectorize([text])
        except Exception:
            vec = None
        if vec is not None and len(vec) > 0:
            return vec
        # 注意：_vec 也会在 _ensure_loaded 持锁期间被调用，这里不能再取 self._lock，
        # 否则自锁死。降级实例重复创建无副作用，因此不上锁。
        fallback = getattr(self, "_fallback_vectorizer", None)
        if fallback is None:
            # 优先 TF-IDF：它会分词，能把「查询」和「类别描述」的公共词对上；
            # TagVectorizer 是把整串做一个哈希桶，对不同字符串几乎必然正交（相似度 0），
            # 只作为最后兜底。
            try:
                fallback = TfidfTagVectorizer(dimension=512)
            except Exception:
                try:
                    fallback = TagVectorizer(dimension=256)
                except Exception:
                    fallback = None
            self._fallback_vectorizer = fallback
        if fallback is None:
            return []
        try:
            out = fallback.vectorize([text])
            return out if out is not None else []
        except Exception:
            return []

    def _load_tools(self):
        """从 config.yaml 加载安全工具 + 原生工具 + HTTP工具。"""
        # 1. config.yaml 中的安全工具
        security_tools = global_config.get("security_tools", {})
        for name, t in security_tools.items():
            self._tools[name] = {
                "name": name,
                "category": t.get("category", "未分类"),
                "description": t.get("description", name),
                "path": t.get("path", name),
                "native": False,
                "installed": self._check_installed(t.get("path", name)),
            }

        # 2. 原生 Python 工具
        if self.include_native:
            for t in NATIVE_TOOLS:
                self._tools[t["name"]] = {**t, "path": t["name"], "installed": True}

        # 3. HTTP 专业工具
        if self.include_http:
            for t in HTTP_TOOLS:
                self._tools[t["name"]] = {**t, "path": t["name"], "installed": True}

    def _check_installed(self, path: str) -> bool:
        """检查工具是否已安装。"""
        if not path:
            return False
        # 如果是绝对路径且存在
        if os.path.isabs(path) and os.path.isfile(path):
            return True
        # 从PATH查找
        return shutil.which(path) is not None

    def _build_vectors(self):
        """构建类别和工具的向量索引。"""
        # 类别向量
        for cat, desc in CATEGORY_DESCRIPTIONS.items():
            self._category_vecs[cat] = self._vec(f"{cat}：{desc}")

        # 工具向量（用 名称+类别+描述 拼接）
        for name, t in self._tools.items():
            text = f"{name} {t['category']} {t['description']}"
            self._tool_vecs[name] = self._vec(text)

    def match(self, query: str, top_k: int = None) -> List[Dict]:
        """两层匹配：先匹配类别，再在类别内匹配工具。

        返回: [{"name", "category", "description", "installed", "score", "native"}]
        """
        self._ensure_loaded()
        if not query or not query.strip():
            return []

        top_k = top_k or self.top_k
        query_vec = self._vec(query)
        query_lower = query.lower()

        # 第0层：直接工具名匹配（如果用户消息中包含工具名，直接命中）
        direct_hits = set()
        for name in self._tools:
            # 工具名作为独立词出现
            if re.search(r'(?<![a-z0-9])' + re.escape(name.lower()) + r'(?![a-z0-9])', query_lower):
                direct_hits.add(name)

        # 第0层补充：查询里出现漏洞编号（CVE/GHSA/OSV/PYSEC）时，按编号查情报
        # 是唯一合理意图，直接命中 vuln_intel。
        # 纯向量匹配对这种「编号 + 自然语言」的短句不稳（编号 token 权重高、
        # 语义部分被稀释），"帮我查一下 CVE-2021-44228 的漏洞情报" 会掉到阈值外，
        # 模型于是根本看不到这个工具。
        if "vuln_intel" in self._tools and re.search(
                r'(?<![a-z0-9])(?:cve-\d{4}-\d{4,}|ghsa-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}'
                r'|osv-\d{4}-\d+|pysec-\d{4}-\d+)(?![a-z0-9])', query_lower):
            direct_hits.add("vuln_intel")

        # 第1层：匹配类别
        category_scores = []
        for cat, cat_vec in self._category_vecs.items():
            sim = cosine_similarity(query_vec, cat_vec)
            # 如果该类别有直接命中的工具，加分
            if any(self._tools[n]["category"] == cat for n in direct_hits):
                sim += 0.3
            if sim >= self.category_threshold:
                category_scores.append((cat, sim))
        category_scores.sort(key=lambda x: -x[1])

        # 如果没有类别超过阈值，取Top-2类别
        if not category_scores:
            all_cats = [(cat, cosine_similarity(query_vec, v)) for cat, v in self._category_vecs.items()]
            all_cats.sort(key=lambda x: -x[1])
            category_scores = all_cats[:2]

        # 第2层：在命中类别内匹配工具
        hit_categories = {cat for cat, _ in category_scores}
        candidates = []
        for name, t in self._tools.items():
            # 直接命中的工具不管类别是否匹配都加入
            if name not in direct_hits and t["category"] not in hit_categories:
                continue
            sim = cosine_similarity(query_vec, self._tool_vecs[name])
            # 直接命中加分
            if name in direct_hits:
                sim += 0.5
            if sim >= self.tool_threshold:
                candidates.append({
                    "name": name,
                    "category": t["category"],
                    "description": t["description"],
                    "installed": t["installed"],
                    "native": t.get("native", False),
                    "score": round(sim, 3),
                })

        candidates.sort(key=lambda x: -x["score"])
        return candidates[:top_k]

    def get_all_categories(self) -> Dict[str, int]:
        """返回所有类别及其工具数量。"""
        self._ensure_loaded()
        cats = {}
        for t in self._tools.values():
            cats[t["category"]] = cats.get(t["category"], 0) + 1
        return cats

    def get_tools_in_category(self, category: str) -> List[Dict]:
        """返回指定类别下的所有工具。"""
        self._ensure_loaded()
        return [t for t in self._tools.values() if t["category"] == category]


# 全局单例
_matcher: Optional[ToolMatcher] = None
_matcher_lock = threading.Lock()


def get_tool_matcher() -> ToolMatcher:
    global _matcher
    if _matcher is None:
        with _matcher_lock:
            if _matcher is None:
                _matcher = ToolMatcher()
    return _matcher

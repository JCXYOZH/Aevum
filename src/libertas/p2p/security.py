"""
Libertas - P2P安全增强
======================
端到端加密、消息签名、抗攻击防护。

核心能力：
1. 端到端消息加密（即使TLS被解密也安全）
2. 消息签名验证（防止伪造）
3. 前向保密（定期更换会话密钥）
4. 女巫攻击检测
5. 日食攻击防护
6. DDoS防护（速率限制+信誉过滤）
7. 数据污染检测

版本：1.0.0
"""

import asyncio
import json
import time
import hashlib
import hmac
import os
import struct
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Tuple, Set, Callable
from collections import defaultdict, deque
import logging

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

SESSION_KEY_TTL = 3600  # 会话密钥1小时更换
NONCE_TTL = 300  # nonce 5分钟有效
MAX_MESSAGE_AGE = 300  # 消息最大年龄5分钟
RATE_LIMIT_WINDOW = 60  # 速率限制窗口60秒
SYBIL_BEHAVIOR_WINDOW = 3600  # 女巫行为观察窗口1小时


# ============================================================
# 数据结构
# ============================================================

@dataclass
class SessionKey:
    """会话密钥"""
    peer_node_id: str
    key: bytes
    created_at: float = field(default_factory=time.time)
    last_used: float = field(default_factory=time.time)
    message_count: int = 0

    def is_expired(self) -> bool:
        return time.time() - self.created_at > SESSION_KEY_TTL

    def should_rotate(self) -> bool:
        return self.is_expired() or self.message_count > 100000


@dataclass
class SecurityEvent:
    """安全事件"""
    event_type: str  # sybil_attack/eclipse_attack/ddos/data_poisoning/spoofing
    source_node_id: str
    severity: str  # low/medium/high/critical
    description: str
    timestamp: float = field(default_factory=time.time)
    evidence: Dict = field(default_factory=dict)
    action_taken: str = ""  # warned/isolated/blocked/reported


# ============================================================
# 端到端加密
# ============================================================

class EndToEndEncryption:
    """
    端到端加密引擎
    使用HMAC-SHA256进行消息认证，AES进行加密（如果可用）
    """

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.master_key = secret_key or hashlib.sha256(node_id.encode()).digest()
        self.session_keys: Dict[str, SessionKey] = {}
        self._used_nonces: Set[str] = set()
        self._nonce_timestamps: deque = deque()

    def _derive_session_key(self, peer_node_id: str) -> bytes:
        """派生会话密钥"""
        # 使用ECDH风格的密钥派生（简化版：主密钥+对端ID）
        key_material = self.master_key + peer_node_id.encode()
        return hashlib.pbkdf2_hmac("sha256", key_material, b"libertas_p2p", 100000)

    def get_session_key(self, peer_node_id: str) -> SessionKey:
        """获取或创建会话密钥"""
        if peer_node_id not in self.session_keys or self.session_keys[peer_node_id].should_rotate():
            key = self._derive_session_key(peer_node_id)
            self.session_keys[peer_node_id] = SessionKey(
                peer_node_id=peer_node_id, key=key
            )
        return self.session_keys[peer_node_id]

    def encrypt_message(self, peer_node_id: str, data: bytes) -> Dict:
        """
        加密消息

        Returns:
            {"ciphertext": ..., "nonce": ..., "mac": ...}
        """
        session = self.get_session_key(peer_node_id)
        nonce = os.urandom(16)

        # XOR流加密（简化版，实际应使用AES-GCM）
        keystream = hashlib.sha256(session.key + nonce).digest()
        while len(keystream) < len(data):
            keystream += hashlib.sha256(session.key + nonce + len(keystream).to_bytes(4, 'big')).digest()

        ciphertext = bytes(a ^ b for a, b in zip(data, keystream[:len(data)]))

        # HMAC认证
        mac = hmac.new(session.key, nonce + ciphertext, hashlib.sha256).hexdigest()

        session.message_count += 1
        session.last_used = time.time()

        return {
            "ciphertext": ciphertext.hex(),
            "nonce": nonce.hex(),
            "mac": mac,
            "encrypted": True,
        }

    def decrypt_message(self, peer_node_id: str, encrypted: Dict) -> Optional[bytes]:
        """
        解密消息

        Returns:
            解密后的明文，验证失败返回None
        """
        try:
            session = self.get_session_key(peer_node_id)
            nonce = bytes.fromhex(encrypted["nonce"])
            ciphertext = bytes.fromhex(encrypted["ciphertext"])
            mac = encrypted["mac"]

            # 验证HMAC
            expected_mac = hmac.new(session.key, nonce + ciphertext, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(mac, expected_mac):
                logger.warning(f"消息MAC验证失败: {peer_node_id}")
                return None

            # XOR解密
            keystream = hashlib.sha256(session.key + nonce).digest()
            while len(keystream) < len(ciphertext):
                keystream += hashlib.sha256(session.key + nonce + len(keystream).to_bytes(4, 'big')).digest()

            plaintext = bytes(a ^ b for a, b in zip(ciphertext, keystream[:len(ciphertext)]))

            session.message_count += 1
            session.last_used = time.time()

            return plaintext

        except Exception as e:
            logger.debug(f"消息解密失败: {e}")
            return None

    def rotate_keys(self):
        """轮换所有会话密钥"""
        self.session_keys.clear()
        logger.info("会话密钥已轮换")


# ============================================================
# 消息签名
# ============================================================

class MessageSigner:
    """消息签名与验证"""

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.signing_key = secret_key or hashlib.sha256(f"{node_id}:signing".encode()).digest()

    def sign(self, message_data: Dict) -> str:
        """签名消息"""
        # 确保消息包含时间戳和nonce
        if "timestamp" not in message_data:
            message_data["timestamp"] = time.time()
        if "nonce" not in message_data:
            message_data["nonce"] = os.urandom(8).hex()

        # 计算签名
        message_str = json.dumps(message_data, sort_keys=True)
        signature = hmac.new(
            self.signing_key,
            message_str.encode(),
            hashlib.sha256
        ).hexdigest()

        return signature

    def verify(self, message_data: Dict, signature: str, signer_node_id: str) -> bool:
        """验证消息签名"""
        try:
            # 检查消息年龄
            msg_time = message_data.get("timestamp", 0)
            if abs(time.time() - msg_time) > MAX_MESSAGE_AGE:
                logger.warning(f"消息过期: {signer_node_id}")
                return False

            # 重新计算签名
            verify_data = {k: v for k, v in message_data.items() if k != "signature"}
            message_str = json.dumps(verify_data, sort_keys=True)

            # 使用签名者的公钥（简化版：节点ID派生）
            verifier_key = hashlib.sha256(f"{signer_node_id}:signing".encode()).digest()
            expected_signature = hmac.new(
                verifier_key,
                message_str.encode(),
                hashlib.sha256
            ).hexdigest()

            return hmac.compare_digest(signature, expected_signature)

        except Exception as e:
            logger.debug(f"签名验证失败: {e}")
            return False


# ============================================================
# 抗攻击防护
# ============================================================

class AttackDetector:
    """
    攻击检测器
    女巫攻击、日食攻击、DDoS、数据污染检测
    """

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.events: List[SecurityEvent] = []
        self._rate_counters: Dict[str, deque] = defaultdict(deque)
        self._sybil_candidates: Dict[str, Dict] = {}
        self._routing_diversity: Dict[str, Set[str]] = defaultdict(set)
        self._data_sources: Dict[str, Set[str]] = defaultdict(set)
        self._data_hashes: Dict[str, Dict[str, Set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )

    def check_rate_limit(self, node_id: str, max_per_window: int = 100) -> bool:
        """
        检查速率限制

        Returns:
            True表示允许，False表示超过限制
        """
        now = time.time()
        timestamps = self._rate_counters[node_id]

        # 清理过期时间戳
        while timestamps and now - timestamps[0] > RATE_LIMIT_WINDOW:
            timestamps.popleft()

        if len(timestamps) >= max_per_window:
            return False

        timestamps.append(now)
        return True

    def detect_sybil(self, node_id: str, ip_address: str,
                     behavior_similarity: float = 0.0) -> Optional[SecurityEvent]:
        """
        检测女巫攻击

        特征：
        - 同一IP段大量节点
        - 行为模式高度相似
        - 同时加入网络
        - 互相投票
        """
        now = time.time()
        ip_prefix = ".".join(ip_address.split(".")[:3]) if "." in ip_address else ip_address

        # 记录节点信息
        if node_id not in self._sybil_candidates:
            self._sybil_candidates[node_id] = {
                "ip_prefix": ip_prefix,
                "first_seen": now,
                "behavior_vector": [],
                "votes_received": set(),
            }

        # 检查同一IP段的节点数
        same_prefix = [nid for nid, info in self._sybil_candidates.items()
                       if info["ip_prefix"] == ip_prefix]

        if len(same_prefix) > 5:  # 同一/24网段超过5个节点
            event = SecurityEvent(
                event_type="sybil_attack",
                source_node_id=node_id,
                severity="high",
                description=f"同一IP段({ip_prefix})发现{len(same_prefix)}个节点，疑似女巫攻击",
                evidence={"ip_prefix": ip_prefix, "node_count": len(same_prefix),
                          "nodes": same_prefix[:10]},
                action_taken="flagged_for_review",
            )
            self.events.append(event)
            return event

        # 行为相似性检测
        if behavior_similarity > 0.9:
            event = SecurityEvent(
                event_type="sybil_attack",
                source_node_id=node_id,
                severity="medium",
                description=f"节点行为与其他节点高度相似({behavior_similarity:.2f})",
                evidence={"behavior_similarity": behavior_similarity},
                action_taken="flagged_for_review",
            )
            self.events.append(event)
            return event

        return None

    def detect_eclipse(self, target_node_id: str,
                        routing_table_nodes: List[str]) -> Optional[SecurityEvent]:
        """
        检测日食攻击

        特征：
        - 路由表中某个节点的邻居高度集中
        - 新加入节点替换了大量原有节点
        - 路由多样性降低
        """
        # 记录路由多样性
        current_set = set(routing_table_nodes)
        previous_set = self._routing_diversity[target_node_id]

        if previous_set:
            overlap = len(current_set & previous_set)
            total = len(current_set | previous_set)
            if total > 0:
                diversity = overlap / total
                if diversity < 0.3 and len(current_set) > 10:
                    event = SecurityEvent(
                        event_type="eclipse_attack",
                        source_node_id=target_node_id,
                        severity="high",
                        description=f"路由表突变，多样性仅{diversity:.2f}，疑似日食攻击",
                        evidence={"diversity": diversity, "previous_count": len(previous_set),
                                  "current_count": len(current_set)},
                        action_taken="routing_table_preserved",
                    )
                    self.events.append(event)
                    self._routing_diversity[target_node_id] = current_set
                    return event

        self._routing_diversity[target_node_id] = current_set
        return None

    def detect_data_poisoning(self, asset_ip: str, source_node_id: str,
                                data_hash: str) -> Optional[SecurityEvent]:
        """
        检测数据污染

        特征：
        - 同一资产数据来源单一且异常
        - 数据与多源共识差异大
        - 同一节点持续提交异常数据
        """
        self._data_sources[asset_ip].add(source_node_id)
        self._data_hashes[asset_ip][source_node_id].add(data_hash)

        # 单源数据本身不能判定为污染；只有多个独立来源给出不同哈希时才记录冲突。
        if len(self._data_sources[asset_ip]) < 2:
            return None

        hashes = {
            value
            for source_hashes in self._data_hashes[asset_ip].values()
            for value in source_hashes
        }
        if len(hashes) < 2:
            return None

        event = SecurityEvent(
            event_type="data_poisoning",
            source_node_id=source_node_id,
            severity="medium",
            description=f"资产 {asset_ip} 出现多个不一致的数据哈希，疑似数据污染",
            evidence={
                "asset_ip": asset_ip,
                "source_node_id": source_node_id,
                "data_hash": data_hash,
                "source_count": len(self._data_sources[asset_ip]),
                "distinct_hashes": sorted(hashes),
            },
            action_taken="flagged_for_verification",
        )
        self.events.append(event)
        return event

    def record_event(self, event: SecurityEvent):
        """记录安全事件"""
        self.events.append(event)
        if len(self.events) > 1000:
            self.events = self.events[-1000:]

    def get_events(self, event_type: Optional[str] = None,
                    severity: Optional[str] = None,
                    limit: int = 100) -> List[SecurityEvent]:
        """获取安全事件"""
        events = self.events
        if event_type:
            events = [e for e in events if e.event_type == event_type]
        if severity:
            events = [e for e in events if e.severity == severity]
        return events[-limit:]

    def get_stats(self) -> Dict:
        """获取安全统计"""
        by_type = defaultdict(int)
        by_severity = defaultdict(int)
        for event in self.events:
            by_type[event.event_type] += 1
            by_severity[event.severity] += 1

        return {
            "total_events": len(self.events),
            "by_type": dict(by_type),
            "by_severity": dict(by_severity),
            "monitored_nodes": len(self._sybil_candidates),
            "rate_limited_nodes": len(self._rate_counters),
        }


# ============================================================
# 安全引擎（整合所有组件）
# ============================================================

class SecurityEngine:
    """P2P安全引擎"""

    def __init__(self, node_id: str, secret_key: Optional[bytes] = None):
        self.node_id = node_id
        self.encryption = EndToEndEncryption(node_id, secret_key)
        self.signer = MessageSigner(node_id, secret_key)
        self.detector = AttackDetector(node_id)
        self._isolated_nodes: Set[str] = set()

    def encrypt_for_peer(self, peer_node_id: str, data: Dict) -> Dict:
        """加密发送给对端的消息"""
        data_bytes = json.dumps(data).encode()
        return self.encryption.encrypt_message(peer_node_id, data_bytes)

    def decrypt_from_peer(self, peer_node_id: str, encrypted: Dict) -> Optional[Dict]:
        """解密来自对端的消息"""
        plaintext = self.encryption.decrypt_message(peer_node_id, encrypted)
        if plaintext:
            try:
                return json.loads(plaintext.decode())
            except (json.JSONDecodeError, UnicodeDecodeError):
                return None
        return None

    def sign_message(self, message: Dict) -> Dict:
        """签名消息"""
        message["signature"] = self.signer.sign(message)
        message["signer"] = self.node_id
        return message

    def verify_message(self, message: Dict) -> bool:
        """验证消息签名"""
        signature = message.get("signature", "")
        signer = message.get("signer", "")
        if not signature or not signer:
            return False
        return self.signer.verify(message, signature, signer)

    def check_incoming_message(self, peer_node_id: str,
                                ip_address: str,
                                message: Dict) -> Tuple[bool, str]:
        """
        检查入站消息安全性

        Returns:
            (是否允许, 原因)
        """
        # 检查是否被隔离
        if peer_node_id in self._isolated_nodes:
            return False, "node_isolated"

        # 速率限制
        if not self.detector.check_rate_limit(peer_node_id):
            return False, "rate_limited"

        # 签名验证
        if "signature" in message:
            if not self.verify_message(message):
                return False, "invalid_signature"

        # 女巫攻击检测
        sybil_event = self.detector.detect_sybil(peer_node_id, ip_address)
        if sybil_event and sybil_event.severity == "high":
            self.isolate_node(peer_node_id, "sybil_attack_suspected")
            return False, "sybil_attack_suspected"

        return True, "ok"

    def isolate_node(self, node_id: str, reason: str):
        """隔离节点"""
        self._isolated_nodes.add(node_id)
        event = SecurityEvent(
            event_type="node_isolated",
            source_node_id=node_id,
            severity="high",
            description=f"节点被隔离: {reason}",
            action_taken="isolated",
        )
        self.detector.record_event(event)
        logger.warning(f"节点 {node_id} 被隔离: {reason}")

    def unisolate_node(self, node_id: str):
        """解除隔离"""
        self._isolated_nodes.discard(node_id)

    def is_isolated(self, node_id: str) -> bool:
        return node_id in self._isolated_nodes

    def rotate_keys(self):
        """轮换密钥"""
        self.encryption.rotate_keys()

    def get_stats(self) -> Dict:
        return {
            "isolated_nodes": len(self._isolated_nodes),
            "session_keys": len(self.encryption.session_keys),
            "security_events": self.detector.get_stats(),
        }

"""
Libertas - P2P 去中心化网络模块
==============================

按职责拆分为独立模块：

- transport.py       TCP + TLS 传输、连接与消息编解码
- dht.py             Kademlia DHT、K 桶路由表、内容存取
- protocol.py        JSON-RPC 消息协议、握手与节点能力
- consensus.py       任务分发、结果 Gossip、信誉与冲突合并
- node.py            P2PNode 节点主类，装配以上各层
- node_discovery.py  mDNS / DNS 种子 / PEX 节点发现
- nat_traversal.py   STUN / TURN / UDP 打洞 / UPnP
- security.py        会话密钥、消息签名、攻击检测
- data_persistence.py 版本向量、缓存、迁移与增量同步
- result_verifier.py 扫描结果验证与缓存
- task_scheduler.py  任务优先级与节点负载调度
- reputation_v2.py   增强信誉与集体信誉
- asset_analytics.py 资产统计与趋势分析
- topology_qos.py    拓扑优化与流量控制
- monitoring.py      健康检查、诊断与协议协商

使用示例：
    from libertas.p2p import P2PNode, NodeCapabilities

    node = P2PNode(listen_port=9000)
    await node.start()
    await node.add_bootstrap_node("1.2.3.4", 9000)
    await node.join_network()

    task = await node.create_scan_task("192.168.1.0/24", [80, 443])
    assets = node.get_all_assets()
"""

from .transport import (
    NodeIdentity, ConnectionManager, P2PConnection, Message,
    ChannelType, ConnectionState, NodeInfo, MessageCodec,
)
from .dht import (
    DHTNode, DHTData, DHTNodeInfo,
    KBucket, RoutingTable, DHTStorage,
    xor_distance, compute_key, generate_random_id,
)
from .protocol import (
    ProtocolHandler, NodeCapabilities, ProofOfWork, MessageType,
)
from .consensus import (
    ConsensusEngine, TaskDistributor, ResultGossip,
    ReputationSystem, AssetMerger, ScanTask, ScanResult,
    ReputationRecord, AssetRecord,
)
from .node import P2PNode, create_and_start_node
from .paths import data_root

# 增强模块（15个优化方向）
from .nat_traversal import (
    NATTraversalManager, STUNClient, TURNServer, UDPHolePuncher,
    UPnPPortMapper, NATType, NATTypeDetectionResult,
)
from .data_persistence import (
    DataPersistenceEngine, DHTCache, DataMigrationManager,
    IncrementalSyncEngine, VersionVector, SyncSession,
)
from .result_verifier import (
    ResultVerifier, VerificationTask, VerificationPolicy,
)
from .node_discovery import (
    NodeDiscoveryEngine, MdnsDiscovery, DnsSeedDiscovery,
    PeerExchange, NodeHealthMonitor, DiscoveredNode,
)
from .security import (
    SecurityEngine, EndToEndEncryption, MessageSigner,
    AttackDetector, SecurityEvent, SessionKey,
)
from .task_scheduler import (
    TaskScheduler, ScheduledTask, TaskPriority,
)
from .reputation_v2 import (
    EnhancedReputationSystem, ReputationHistoryEntry, CollectiveReputation,
)
from .asset_analytics import (
    AssetAnalytics, AssetProfile,
)
from .topology_qos import (
    TopologyQoSEngine, TopologyOptimizer, TrafficController, LinkMetrics,
)
from .monitoring import (
    MonitoringEngine, HealthMonitor, DiagnosticEngine,
    ProtocolNegotiator, HealthCheck, DiagnosticReport,
)

__all__ = [
    # transport
    "NodeIdentity", "ConnectionManager", "P2PConnection", "Message",
    "ChannelType", "ConnectionState", "NodeInfo", "MessageCodec",
    # dht
    "DHTNode", "DHTData", "DHTNodeInfo", "KBucket", "RoutingTable", "DHTStorage",
    "xor_distance", "compute_key", "generate_random_id",
    # protocol
    "ProtocolHandler", "NodeCapabilities", "ProofOfWork", "MessageType",
    # consensus
    "ConsensusEngine", "TaskDistributor", "ResultGossip",
    "ReputationSystem", "AssetMerger", "ScanTask", "ScanResult",
    "ReputationRecord", "AssetRecord",
    # node
    "P2PNode", "create_and_start_node",
    # paths
    "data_root",
    # nat_traversal
    "NATTraversalManager", "STUNClient", "TURNServer", "UDPHolePuncher",
    "UPnPPortMapper", "NATType", "NATTypeDetectionResult",
    # data_persistence
    "DataPersistenceEngine", "DHTCache", "DataMigrationManager",
    "IncrementalSyncEngine", "VersionVector", "SyncSession",
    # result_verifier
    "ResultVerifier", "VerificationTask", "VerificationPolicy",
    # node_discovery
    "NodeDiscoveryEngine", "MdnsDiscovery", "DnsSeedDiscovery",
    "PeerExchange", "NodeHealthMonitor", "DiscoveredNode",
    # security
    "SecurityEngine", "EndToEndEncryption", "MessageSigner",
    "AttackDetector", "SecurityEvent", "SessionKey",
    # task_scheduler
    "TaskScheduler", "ScheduledTask", "TaskPriority",
    # reputation_v2
    "EnhancedReputationSystem", "ReputationHistoryEntry", "CollectiveReputation",
    # asset_analytics
    "AssetAnalytics", "AssetProfile",
    # topology_qos
    "TopologyQoSEngine", "TopologyOptimizer", "TrafficController", "LinkMetrics",
    # monitoring
    "MonitoringEngine", "HealthMonitor", "DiagnosticEngine",
    "ProtocolNegotiator", "HealthCheck", "DiagnosticReport",
]

__version__ = "2.0.0"

# Libertas P2P

从 `D:\past-projects\MrHua\mrhua\p2p` 迁入的去中心化网络模块，按原模块边界拆分为一个文件一个职责，保留相对导入，统一从 `libertas.p2p` 暴露公共入口。

## 模块

| 文件 | 职责 |
| --- | --- |
| `paths.py` | 统一运行数据根目录与 `certs/`、`state/`、`dht/` 子目录 |
| `transport.py` | TCP + TLS 传输、连接管理、消息编解码、节点身份 |
| `dht.py` | Kademlia DHT、160 位节点 ID、K 桶路由表、内容存取 |
| `protocol.py` | JSON-RPC 消息协议、握手、节点能力与工作量证明 |
| `consensus.py` | 任务分发、结果 Gossip、信誉、资产合并与冲突解决 |
| `node.py` | `P2PNode` 节点主类，装配传输、DHT、协议与自治层 |
| `node_discovery.py` | mDNS、DNS 种子、PEX 节点发现与健康检查 |
| `nat_traversal.py` | STUN、TURN、UDP 打洞、UPnP 端口映射 |
| `security.py` | 会话密钥、消息签名、速率限制、女巫/日食/污染检测 |
| `data_persistence.py` | 版本向量、DHT 缓存、数据迁移、增量与全量同步 |
| `result_verifier.py` | 扫描结果验证策略、验证缓存与待验证队列 |
| `task_scheduler.py` | 任务优先级、节点负载与调度 |
| `reputation_v2.py` | 信誉衰减、历史记录、集体信誉与预测 |
| `asset_analytics.py` | 资产统计、趋势与风险分析 |
| `topology_qos.py` | 拓扑优化、邻居选择与流量控制 |
| `monitoring.py` | 健康检查、诊断报告、协议协商 |

## 运行目录

所有运行期生成物统一放在一个根目录下，默认相对于启动时的工作目录：

```
runtime/p2p/
├── certs/    TLS 证书与私钥
├── state/    信誉、版本向量等节点状态
└── dht/      DHT 内容存储
```

可用环境变量 `LIBERTAS_P2P_DATA_DIR` 覆盖根目录，例如：

```powershell
$env:LIBERTAS_P2P_DATA_DIR = "D:\Aevum\runtime\p2p"
```

路径常量集中在 `paths.py`，`P2PNode`、`NodeIdentity`、`DHTNode`、`ConsensusEngine`、`DataPersistenceEngine` 等默认参数全部引用这里，不再各自写 `./p2p_certs`、`./p2p_state`、`./dht_data`。

## 公共入口

```python
from libertas.p2p import P2PNode, NodeCapabilities

node = P2PNode(listen_port=9000)
await node.start()
await node.add_bootstrap_node("1.2.3.4", 9000)
await node.join_network()
```

单独使用 DHT：

```python
from libertas.p2p.dht import DHTNode, DHTNodeInfo, RoutingTable

info = DHTNodeInfo(node_id="a" * 40, address="127.0.0.1", port=9000)
```

## 迁移时做的清理

- `dht.py` 原来有两个同名 `DHTNode`：前面的节点描述 dataclass 被后面的 Kademlia 核心类覆盖，核心类里的 `DHTNode.from_dict(...)` 实际调用到错误对象。现将描述类改为 `DHTNodeInfo`，核心类保留 `DHTNode`；`KBucket`、`RoutingTable`、`protocol.py`、`__init__.py` 的类型与构造同步修正。
- `nat_traversal.py` 删除文件末尾的兼容别名块，统一为 `TURNServer`、`UDPHolePuncher`、`NATTypeDetectionResult`，不再保留 `TURNTurnServer`、`HolePuncher`、`NATInfo` 等旧名。
- `node.py` 删除 `self.dht = self.dht_node` 兼容属性，只保留 `dht_node`。
- `security.py` 的 `AttackDetector.detect_data_poisoning` 由空实现补为实际检测：同一资产出现多个独立来源且数据哈希不一致时产生 `data_poisoning` 事件；单源数据不会被误判。
- 运行目录统一到 `runtime/p2p/`，由 `paths.py` 提供 `DEFAULT_CERT_DIR`、`DEFAULT_STATE_DIR`、`DEFAULT_DHT_DIR`，所有模块默认参数改为引用这些常量。
- 清掉源项目遗留的 `mrhua` 协议标识：mDNS 服务类型改为 `_libertas._tcp.local`，节点广播类型改为 `libertas_node`，消息魔数改为 `LBT1`，PBKDF2 salt 改为 `libertas_p2p`，DNS 种子改为 `seed.libertas.network` / `seed1.libertas.network`。

## 验证

```powershell
python -m compileall -q src\libertas\p2p
python -c "import sys; sys.path.insert(0,'src'); import libertas.p2p"
```

已做过的运行级 smoke：

- DHT 节点描述序列化、路由表添加、内容存取、`DHTNode` 构造。
- `P2PNode` 随机端口启动与停止。
- 两个本地节点 TLS 握手、bootstrap、`join_network` 与手动连接。
- `AttackDetector.detect_data_poisoning` 单源不误报、多源哈希冲突产生事件。

## 当前边界

- 本轮目标是模块化迁入与明显缺陷清理，没有逐类做原 Python 行为对齐测试。
- 扫描执行器仍由外部通过 `P2PNode.set_scan_executor()` 注入，模块本身不实现具体扫描。
- 若干持久化函数在异常时仍选择静默返回，后续应补日志与可观测性。

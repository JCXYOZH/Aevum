"""职责模块：constants。"""

from __future__ import annotations

from ..dht import DHTNode, DHTData, compute_key, xor_distance, K
import logging

logger = logging.getLogger(__name__)

REPUBLISH_INTERVAL = 1800

DATA_REDUNDANCY = K

SYNC_BATCH_SIZE = 100

SYNC_CHUNK_SIZE = 64 * 1024

CACHE_TTL = 300

CACHE_MAX_ENTRIES = 10000

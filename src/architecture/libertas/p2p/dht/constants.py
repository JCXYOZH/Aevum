"""职责模块：constants。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

KEY_SIZE = 160

K = 20

ALPHA = 3

NODE_TIMEOUT = 3600

REPUBLISH_INTERVAL = 3600

DATA_TTL = 86400

MAX_DATA_SIZE = 1024 * 1024

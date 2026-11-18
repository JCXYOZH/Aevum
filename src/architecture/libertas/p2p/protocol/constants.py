"""职责模块：constants。"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "1.0.0"

HANDSHAKE_TIMEOUT = 10.0

MAX_PENDING_REQUESTS = 1000

REQUEST_TIMEOUT = 30.0

CHALLENGE_DIFFICULTY = 4

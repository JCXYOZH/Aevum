"""P2P 安全常量。"""

import logging

logger = logging.getLogger(__name__)

SESSION_KEY_TTL = 3600
NONCE_TTL = 300
MAX_MESSAGE_AGE = 300
RATE_LIMIT_WINDOW = 60
SYBIL_BEHAVIOR_WINDOW = 3600

"""
广域网通信模块（MQTT 中继）
- 通过公共 MQTT  broker 中继消息，跨互联网通信
- 房间制：用户输入房间号+密码加入同一房间
- 消息加密：密码派生密钥，XOR 流加密 + Base64
- 支持文字消息和文件传输（base64编码，限制大小）
- 纯标准库实现，无外部依赖
"""
import os
import json
import time
import socket
import struct
import hashlib
import base64
import threading
import uuid
from typing import Dict, List, Optional, Callable
from datetime import datetime

from .crypto import *

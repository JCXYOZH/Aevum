"""
tools/tools_expansion.py - 工具集综合扩展模块

新增高级工具：网络侦察工具集、密码学工具集、数据处理工具集、
系统管理工具集、文件分析工具集、文本处理工具集。
"""
from .network_recon_tool import NetworkReconTool
from .crypto_toolkit import CryptoToolkit
from .data_processing_tool import DataProcessingTool
from .file_analysis_tool import FileAnalysisTool
import os
import json
import time
import uuid
import math
import hashlib
import hmac
import base64
import socket
import struct
import threading
import subprocess
import re
from typing import Any, Dict, List, Optional, Tuple
from libertas.foundation.byte_stream import safe_decode
from collections import deque, Counter
from enum import Enum
from libertas.foundation.terminal import terminal


# ================================================================
# 网络侦察工具集
# ================================================================


_network_recon = NetworkReconTool()

_crypto_toolkit = CryptoToolkit()

_data_processor = DataProcessingTool()

_file_analyzer = FileAnalysisTool()

def get_network_recon() -> NetworkReconTool:
    return _network_recon

def get_crypto_toolkit() -> CryptoToolkit:
    return _crypto_toolkit

def get_data_processor() -> DataProcessingTool:
    return _data_processor

def get_file_analyzer() -> FileAnalysisTool:
    return _file_analyzer

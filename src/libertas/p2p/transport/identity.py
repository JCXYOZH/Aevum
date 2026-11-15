"""P2P 传输职责：identity。"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import socket
import ssl
import struct
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from .constants import logger
from libertas.p2p.paths import DEFAULT_CERT_DIR

class NodeIdentity:
    """
    节点身份管理
    生成TLS证书，Node ID = SHA-1(公钥)
    """

    def __init__(self, cert_dir: str = DEFAULT_CERT_DIR):
        self.cert_dir = cert_dir
        self.cert_file = os.path.join(cert_dir, "node.crt")
        self.key_file = os.path.join(cert_dir, "node.key")
        self.node_id: str = ""
        self.public_key_hash: str = ""
        self._ssl_context: Optional[ssl.SSLContext] = None

        os.makedirs(cert_dir, exist_ok=True)
        self._ensure_certificate()
        self._compute_node_id()

    def _ensure_certificate(self):
        """确保TLS证书存在，不存在则生成"""
        if os.path.exists(self.cert_file) and os.path.exists(self.key_file):
            return

        # 使用openssl生成自签名证书
        import subprocess
        try:
            # 生成私钥
            subprocess.run([
                "openssl", "genrsa", "-out", self.key_file, "2048"
            ], check=True, capture_output=True)

            # 生成自签名证书
            subprocess.run([
                "openssl", "req", "-new", "-x509",
                "-key", self.key_file,
                "-out", self.cert_file,
                "-days", "3650",
                "-subj", "/CN=Libertas-P2P-Node/O=Libertas/C=CN"
            ], check=True, capture_output=True)

            logger.info("生成新的TLS证书")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            # openssl不可用时，用Python生成简化证书
            logger.warning(f"openssl不可用，使用Python生成证书: {e}")
            self._generate_certificate_python()

    def _generate_certificate_python(self):
        """纯Python生成自签名证书（简化版）"""
        try:
            from cryptography import x509
            from cryptography.x509.oid import NameOID
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import rsa
            import datetime

            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

            with open(self.key_file, "wb") as f:
                f.write(key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption(),
                ))

            subject = issuer = x509.Name([
                x509.NameAttribute(NameOID.COMMON_NAME, "Libertas-P2P-Node"),
                x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Libertas"),
                x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
            ])

            cert = (
                x509.CertificateBuilder()
                .subject_name(subject)
                .issuer_name(issuer)
                .public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(datetime.datetime.utcnow())
                .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
                .sign(key, hashes.SHA256())
            )

            with open(self.cert_file, "wb") as f:
                f.write(cert.public_bytes(serialization.Encoding.PEM))

        except ImportError:
            # cryptography也不可用，生成占位证书
            logger.error("无法生成TLS证书（openssl和cryptography都不可用）")
            # 创建占位文件
            with open(self.key_file, "w", encoding="utf-8") as f:
                f.write("PLACEHOLDER_KEY\n")
            with open(self.cert_file, "w", encoding="utf-8") as f:
                f.write("PLACEHOLDER_CERT\n")

    def _compute_node_id(self):
        """计算Node ID = SHA-1(公钥)"""
        try:
            with open(self.cert_file, "rb") as f:
                cert_data = f.read()

            # 提取公钥哈希
            try:
                from cryptography import x509
                from cryptography.hazmat.primitives import serialization
                cert = x509.load_pem_x509_certificate(cert_data)
                pub_key = cert.public_key().public_bytes(
                    encoding=serialization.Encoding.DER,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo,
                )
                self.public_key_hash = hashlib.sha1(pub_key).hexdigest()
            except ImportError:
                # 用证书内容哈希代替
                self.public_key_hash = hashlib.sha1(cert_data).hexdigest()

            self.node_id = self.public_key_hash
            logger.info(f"Node ID: {self.node_id}")
        except Exception as e:
            logger.error(f"计算Node ID失败: {e}")
            # 生成随机Node ID
            self.node_id = hashlib.sha1(os.urandom(32)).hexdigest()
            self.public_key_hash = self.node_id

    def get_ssl_context(self, server_side: bool = False) -> ssl.SSLContext:
        """获取SSL上下文"""
        if self._ssl_context is None:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS)
            ctx.load_cert_chain(certfile=self.cert_file, keyfile=self.key_file)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE  # 自签名证书，不验证CA
            ctx.set_ciphers("ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384")
            self._ssl_context = ctx
        return self._ssl_context

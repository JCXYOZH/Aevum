"""
花先生 - 资产数据库与查询系统
==============================
网络空间测绘结果的持久化存储、查询、分析和导出。

核心能力：
1. SQLite结构化存储（资产表/端口表/指纹表/CVE表/扫描任务表/标签表）
2. 批量入库与UPSERT去重合并
3. 历史版本管理（每次扫描保存快照，支持时间线回溯）
4. 高级多条件查询（IP/端口/服务/指纹/CVE/风险等级/标签）
5. 全文搜索（FTS5虚拟表）
6. 资产标签与分组管理
7. 数据导出（JSON/CSV/Excel/XML）
8. 统计分析与仪表盘数据
9. 资产变化追踪与差异报告

作者：花先生
版本：2.0.0
"""

import sqlite3
import json
import os
import time
import csv
import ipaddress
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple, Any, Union
from enum import Enum
from collections import defaultdict, Counter
import logging
import threading
import shutil
import traceback
from .models import *  # noqa: F401,F403
from .core import *  # noqa: F401,F403

class AssetDatabasePart1(object):
    def _detect_and_repair_crash(self):
        """检测并修复程序崩溃导致的数据库残留"""
        try:
            db_dir = os.path.dirname(self.db_path) or "."
            db_name = os.path.basename(self.db_path)
            wal_file = self.db_path + "-wal"
            shm_file = self.db_path + "-shm"
            marker_file = os.path.join(db_dir, "MRHUA_DB_FALLBACK_TO_MEMORY.log")

            # 检测告警文件（说明上次崩溃回退到了内存数据库）
            crash_detected = False
            if os.path.exists(marker_file):
                logger.warning("检测到数据库崩溃告警文件，上次程序异常退出")
                crash_detected = True

            # 检测残留的 WAL/SHM 文件（说明上次没有正确关闭）
            if os.path.exists(wal_file) or os.path.exists(shm_file):
                wal_size = os.path.getsize(wal_file) if os.path.exists(wal_file) else 0
                shm_size = os.path.getsize(shm_file) if os.path.exists(shm_file) else 0
                logger.warning("检测到残留的 WAL/SHM 文件 (wal=%d bytes, shm=%d bytes)，上次程序异常退出", wal_size, shm_size)
                crash_detected = True

            if not crash_detected:
                return

            # 尝试正常打开数据库并执行 checkpoint（如果能打开的话）
            try:
                test_conn = sqlite3.connect(self.db_path, timeout=10)
                test_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                test_conn.close()
                logger.info("数据库修复成功：已执行 WAL checkpoint")
                # 删除告警文件
                if os.path.exists(marker_file):
                    try:
                        os.remove(marker_file)
                    except Exception:
                        pass
                return
            except Exception as e:
                logger.warning("数据库无法正常打开 (%s)，需要重建", e)

            # 备份损坏的数据库
            try:
                import time as _time
                timestamp = _time.strftime("%Y%m%d_%H%M%S")
                backup_path = self.db_path + f".corrupt_{timestamp}"
                if os.path.exists(self.db_path):
                    import shutil
                    shutil.copy2(self.db_path, backup_path)
                    logger.info("损坏的数据库已备份到: %s", backup_path)
                # 也备份 WAL/SHM
                if os.path.exists(wal_file):
                    shutil.copy2(wal_file, backup_path + "-wal")
                if os.path.exists(shm_file):
                    shutil.copy2(shm_file, backup_path + "-shm")
            except Exception as e:
                logger.warning("数据库备份失败: %s", e)

            # 删除损坏的数据库和残留文件
            for f in [self.db_path, wal_file, shm_file, marker_file]:
                try:
                    if os.path.exists(f):
                        os.remove(f)
                        logger.info("已删除损坏的文件: %s", f)
                except Exception as e:
                    logger.warning("删除文件失败 %s: %s", f, e)

            logger.info("数据库崩溃修复完成，将创建新的干净数据库")

        except Exception as e:
            logger.exception("崩溃检测和修复失败: %s", e)
    def __init__(self, db_path: str = "./assets.db"):
        self.db_path = db_path
        # 必须用可重入锁：get_asset_by_ip / add_tag_to_asset 会在持锁状态下
        # 调用同样要加锁的 get_asset / create_tag；普通 Lock 会在同一线程上
        # 永久自锁，且锁一旦泄漏会让整个资产库对所有后续请求不可用。
        self._lock = threading.RLock()
        self._conn = None
        self._fallback_in_memory = False
        self._recovery_thread = None
        self._recovery_interval = 60  # seconds
        self._closed = False
        # 启动时检测并修复崩溃残留
        self._detect_and_repair_crash()
        # 注册程序退出时的清理函数
        try:
            import atexit
            atexit.register(self.close)
        except Exception:
            pass
        self._init_database()
    def _get_conn(self) -> sqlite3.Connection:
        """获取数据库连接（线程局部）"""
        if self._conn is None:
            try:
                self._conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=30)
                self._conn.row_factory = sqlite3.Row
                cur = self._conn.cursor()
                try:
                    cur.execute("PRAGMA journal_mode=WAL")
                except sqlite3.OperationalError as _prag_err:
                    logger.warning("PRAGMA journal_mode=WAL failed (%s), attempting DELETE fallback", _prag_err)
                    try:
                        cur.execute("PRAGMA journal_mode=DELETE")
                    except sqlite3.OperationalError as _prag_err2:
                        logger.exception("PRAGMA journal_mode=DELETE also failed: %s; falling back to in-memory DB", _prag_err2)
                        try:
                            self._conn.close()
                        except Exception:
                            pass
                        # 回退为内存数据库以保证程序继续运行（但数据不可持久化）
                        self._conn = sqlite3.connect(":memory:")
                        self._conn.row_factory = sqlite3.Row
                        self._fallback_in_memory = True
                        # 记录降级原因并创建持久化告警文件
                        try:
                            exc_text = traceback.format_exc()
                            self._write_fallback_marker('WAL and DELETE PRAGMA failed', exc_text)
                        except Exception:
                            pass
                        # 开启基本的外键支持
                        try:
                            self._conn.execute("PRAGMA foreign_keys=ON")
                        except Exception:
                            pass
                        # 启动后台恢复线程尝试恢复磁盘DB
                        try:
                            self._start_recovery_thread()
                        except Exception:
                            pass
                        return self._conn

                # 尝试其他 PRAGMA 设置，任何单项失败不阻止继续
                try:
                    self._conn.execute("PRAGMA synchronous=NORMAL")
                except sqlite3.OperationalError as _sync_err:
                    logger.warning("PRAGMA synchronous failed: %s", _sync_err)
                try:
                    self._conn.execute("PRAGMA cache_size=10000")
                except sqlite3.OperationalError:
                    pass
                try:
                    self._conn.execute("PRAGMA foreign_keys=ON")
                except sqlite3.OperationalError:
                    pass
            except sqlite3.OperationalError as _conn_err:
                logger.exception("SQLite connection failed for %s: %s", self.db_path, _conn_err)
                # 确保父目录存在后重试一次
                try:
                    parent = os.path.dirname(self.db_path)
                    if parent:
                        os.makedirs(parent, exist_ok=True)
                    self._conn = sqlite3.connect(self.db_path, check_same_thread=False, timeout=30)
                    self._conn.row_factory = sqlite3.Row
                except Exception as _retry_err:
                    logger.exception("Retry connecting to SQLite DB failed: %s; using in-memory DB instead", _retry_err)
                    try:
                        if self._conn:
                            self._conn.close()
                    except Exception:
                        pass
                    self._conn = sqlite3.connect(":memory:")
                    self._conn.row_factory = sqlite3.Row
                    self._fallback_in_memory = True
                    try:
                        exc_text = traceback.format_exc()
                        self._write_fallback_marker('connection retry failed', exc_text)
                    except Exception:
                        pass
                    try:
                        self._start_recovery_thread()
                    except Exception:
                        pass
        return self._conn
    def _write_fallback_marker(self, reason: str, exc_text: str = ""):
        """写入持久化降级告警文件到数据目录的父目录，包含诊断信息"""
        try:
            parent = os.path.dirname(self.db_path) or os.getcwd()
            marker_path = os.path.join(parent, "MRHUA_DB_FALLBACK_TO_MEMORY.log")
            with open(marker_path, 'a', encoding='utf-8') as mf:
                mf.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] FALLBACK_TO_MEMORY: {reason}\n")
                mf.write(exc_text + "\n\n")
            logger.error("Wrote fallback marker to %s", marker_path)
        except Exception:
            logger.exception("Failed to write fallback marker file")
    def _start_recovery_thread(self):
        """启动后台线程，定期尝试恢复到磁盘数据库（若当前为内存回退状态）"""
        if self._recovery_thread and self._recovery_thread.is_alive():
            return
        self._recovery_thread = threading.Thread(target=self._recovery_worker, daemon=True)
        self._recovery_thread.start()
    def _recovery_worker(self):
        """后台恢复线程函数：在回退期间定期尝试建立磁盘连接并恢复 PRAGMA 设置，同时定期执行 WAL checkpoint"""
        checkpoint_counter = 0
        while self._fallback_in_memory or not self._closed:
            time.sleep(self._recovery_interval)
            # 每5次检查执行一次 WAL checkpoint（防止 WAL 文件过大）
            checkpoint_counter += 1
            if checkpoint_counter >= 5 and self._conn and not self._fallback_in_memory:
                try:
                    self._conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
                except Exception:
                    pass
                checkpoint_counter = 0
            if self._closed:
                break
            try:
                logger.info("Attempting to recover persistent SQLite DB at %s", self.db_path)
                parent = os.path.dirname(self.db_path)
                if parent and not os.path.exists(parent):
                    try:
                        os.makedirs(parent, exist_ok=True)
                    except Exception:
                        logger.warning("Cannot create parent directory %s during recovery", parent)
                        continue

                # 尝试建立文件连接并设置 PRAGMA
                test_conn = sqlite3.connect(self.db_path, check_same_thread=False)
                try:
                    test_conn.execute("PRAGMA journal_mode=WAL")
                    test_conn.execute("PRAGMA foreign_keys=ON")
                    logger.info("Recovered persistent SQLite DB at %s", self.db_path)
                    with self._lock:
                        try:
                            if self._conn:
                                try:
                                    self._conn.close()
                                except Exception:
                                    pass
                        except Exception:
                            pass
                        self._conn = test_conn
                        self._fallback_in_memory = False
                    # 清除告警文件
                    try:
                        marker = os.path.join(parent or os.getcwd(), "MRHUA_DB_FALLBACK_TO_MEMORY.log")
                        if os.path.exists(marker):
                            os.remove(marker)
                    except Exception:
                        pass
                    break
                except Exception as _e:
                    try:
                        test_conn.close()
                    except Exception:
                        pass
                    logger.info("Recovery attempt failed: %s", _e)
                    continue
            except Exception as e:
                logger.debug("Recovery worker unexpected error: %s", e)
                continue

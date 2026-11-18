# tools/scanner.py
# 安全扫描器：基于 nmap、msfconsole、xray、nuclei 等工具执行安全扫描
# 同时集成原生Python工具（不依赖外部安装），支持结果自动存入记忆系统
import os
import re
import json
import time
import shutil
import subprocess
import tempfile
import logging
import platform
from typing import Dict, List, Optional, Any
from libertas.tools.tool_manager import ToolManager
from libertas.utils.text_decode import decode_output, describe_exception
from libertas.tools.legacy_tools import native_tools
import threading
# 可选依赖
try:
    import yaml
except ImportError:
    yaml = None

# 导入配置
from libertas.foundation.config import config

# 配置日志
logger = logging.getLogger(__name__)

from .base import *


class ScanningMixin:
    def _check_tool(self, path: str) -> bool:
        """
        检查可执行文件是否存在且可执行。
        支持两种形式：
        1. 完整路径（含目录分隔符）→ 检查文件是否存在且可执行
        2. 命令名（不含路径）→ 从系统 PATH 中查找
        """
        if not path:
            return False
        # 如果包含目录分隔符，视为文件路径
        if os.sep in path or (os.altsep and os.altsep in path):
            return os.path.exists(path) and os.access(path, os.X_OK)
        # 否则视为命令名，从 PATH 查找
        return shutil.which(path) is not None

    def port_scan(self, target: str, port_range: str = "1-1024") -> Dict[str, Any]:
        """
        对目标主机执行 TCP 端口扫描（-sT 连接扫描），返回开放端口列表。
        :param target: 目标 IP 或域名
        :param port_range: 端口范围，例如 "1-1024" 或 "80,443,8080"
        :return: 包含扫描结果和开放端口信息的字典
        """
        if not self._check_tool(self.nmap_path):
            return {"success": False, "error": f"nmap 未找到或不可执行: {self.nmap_path}"}
        cmd = [
            self.nmap_path, "-sT", "-p", port_range, "--open",
            "-T4", "-Pn", "-oG", "-", target
        ]
        try:
            logger.info(f"执行授权端口扫描，目标: {target}，端口范围: {port_range}")
            # 字节模式 + 级联解码：避免 Windows 中文环境下按 cp936 解码 UTF-8 输出
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            stdout_text = decode_output(result.stdout)
            stderr_text = decode_output(result.stderr)
            if result.returncode == 0:
                output = stdout_text
                open_ports = []
                for line in output.splitlines():
                    if "Ports:" in line:
                        ports_part = line.split("Ports:")[1].strip()
                        for port_entry in ports_part.split(","):
                            port_entry = port_entry.strip()
                            if not port_entry:
                                continue
                            fields = port_entry.split("/")
                            if len(fields) >= 3 and fields[1] == "open":
                                try:
                                    port_number = fields[0]
                                    protocol = fields[2] if len(fields) > 2 else "tcp"
                                    service = fields[4] if len(fields) > 4 and fields[4] else "unknown"
                                    open_ports.append({
                                        "port": port_number,
                                        "protocol": protocol,
                                        "service": service
                                    })
                                except ValueError:
                                    pass
                # 记录到记忆系统
                if self.memory_system is not None:
                    if open_ports:
                        port_info = ", ".join([f"{p['port']}/{p['protocol']} ({p['service']})" for p in open_ports])
                        summary = f"端口扫描结果 - 目标: {target}\n开放端口: {port_info}"
                    else:
                        summary = f"端口扫描 - 目标: {target}\n未发现开放端口"
                    self.memory_system.record_scan_memory(
                        target=target,
                        scan_type="端口扫描",
                        content=summary,
                        raw_output=output,
                        extra={"port_range": port_range, "open_ports": open_ports}
                    )
                return {
                    "success": True,
                    "target": target,
                    "open_ports": open_ports,
                    "raw_output": output
                }
            else:
                return {"success": False,
                        "error": native_tools.external_exit_error(
                            result.returncode, stderr_text, stdout_text),
                        "error_kind": ("missing_binary"
                                       if result.returncode == 127 else "nonzero_exit"),
                        "returncode": result.returncode}
        except Exception as e:
            friendly, kind = describe_exception(e)
            logger.error(f"端口扫描执行失败: {friendly}")
            return {"success": False, "error": friendly, "error_kind": kind}

    def service_version_detection(self, target: str, port_list: Optional[List[str]] = None) -> Dict[str, Any]:
        """对目标主机指定端口进行服务版本识别（-sV），并记录到记忆系统。"""
        if not self._check_tool(self.nmap_path):
            return {"success": False, "error": f"nmap 未找到或不可执行: {self.nmap_path}"}
        port_arg = ",".join(port_list) if port_list else "1-1024"
        cmd = [
            self.nmap_path, "-sV", "-p", port_arg,
            "-T4", "-Pn", target
        ]
        try:
            logger.info(f"执行服务版本识别，目标: {target}")
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            stdout_text = decode_output(result.stdout)
            stderr_text = decode_output(result.stderr)
            success = result.returncode == 0
            output = stdout_text if success else (stderr_text or stdout_text)
            services = []
            if success:
                for line in output.splitlines():
                    if "/tcp" in line and "open" in line:
                        parts = line.split()
                        if len(parts) >= 5:
                            port_proto = parts[0]
                            service = parts[2]
                            version = " ".join(parts[3:]) if len(parts) > 3 else ""
                            services.append({
                                "port": port_proto,
                                "service": service,
                                "version": version
                            })
            # 记录到记忆系统
            if success and self.memory_system is not None:
                if services:
                    svc_summary = "\n".join([f"{s['port']} - {s['service']} {s['version']}" for s in services])
                    summary = f"服务识别结果 - 目标: {target}\n{svc_summary}"
                else:
                    summary = f"服务识别 - 目标: {target}\n未识别到服务"
                self.memory_system.record_scan_memory(
                    target=target,
                    scan_type="服务识别",
                    content=summary,
                    raw_output=output,
                    extra={"services": services}
                )
            payload = {
                "success": success,
                "target": target,
                "output": output,
                # stderr 单独放字段：成功时不放进 error（避免消费方误判），
                # 失败时保留完整诊断信息（与 run_xray_scan 的形态一致）。
                "stderr": stderr_text,
                "services": services if success else []
            }
            if not success:
                # 非零退出此前只回 output、没有 error 键：/api/scan 的前端失败分支
                # 依次找 data.error / data.result.error，都取不到就显示「未知错误」
                # （与用户报障同族）。这里补齐可读原因与机器可读字段。
                payload.update({
                    "error": native_tools.external_exit_error(
                        result.returncode, stderr_text, stdout_text),
                    "error_kind": ("missing_binary"
                                   if result.returncode == 127 else "nonzero_exit"),
                    "returncode": result.returncode,
                })
            return payload
        except Exception as e:
            friendly, kind = describe_exception(e)
            logger.error(f"服务识别执行失败: {friendly}")
            return {"success": False, "error": friendly, "error_kind": kind}

    def parse_service_detection_result(self, raw_output: str) -> Dict[str, Any]:
        """
        从 nmap 服务识别输出中提取 IP、端口、服务、版本等关键信息。
        :param raw_output: nmap -sV 的原始输出
        :return: 提取的信息字典
        """
        info = {
            "ip": "未知",
            "port": "未知",
            "service": "未知",
            "version": "未知",
            "raw_output": raw_output
        }
        ip_match = re.search(r'Nmap scan report for ([\d\.]+)', raw_output)
        if ip_match:
            info["ip"] = ip_match.group(1)
        port_match = re.search(r'(\d+)/tcp\s+open\s+(\S+)', raw_output)
        if port_match:
            info["port"] = port_match.group(1)
            info["service"] = port_match.group(2)
        version_match = re.search(r'(\S+)/(\S+)\s+Python', raw_output)
        if version_match:
            info["version"] = version_match.group(2)
        else:
            version_match2 = re.search(r'Server:\s+(\S+)/(\S+)', raw_output)
            if version_match2:
                info["version"] = f"{version_match2.group(1)}/{version_match2.group(2)}"
        return info

    def run_msf_module(
        self,
        module_type: str,
        module_name: str,
        options: Dict[str, str],
        timeout: int = 300
    ) -> Dict[str, Any]:
        """
        执行 Metasploit 模块（需要 msfconsole 可用）。
        :param module_type: 模块类型，如 "auxiliary", "exploit"
        :param module_name: 模块名称，如 "scanner/portscan/tcp"
        :param options: 模块选项字典，如 {"RHOSTS": "192.168.1.1"}
        :param timeout: 超时秒数
        :return: 执行结果
        """
        if not self._check_tool(self.msf_path):
            return {"success": False, "error": f"msfconsole 未找到或不可执行: {self.msf_path}"}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.rc', delete=False) as f:
            script_path = f.name
            f.write(f"use {module_type}/{module_name}\n")
            for k, v in options.items():
                f.write(f"set {k} {v}\n")
            f.write("run\n")
            f.write("exit\n")
        error_text = ""
        error_kind = ""
        returncode = None
        stderr_text = ""
        try:
            logger.info(f"执行msf模块: {module_type}/{module_name}, 选项: {options}")
            cmd = [self.msf_path, '-q', '-r', script_path]
            result = subprocess.run(cmd, capture_output=True, timeout=timeout)
            success = result.returncode == 0
            returncode = result.returncode
            stdout_text = decode_output(result.stdout)
            stderr_text = decode_output(result.stderr)
            output = stdout_text or stderr_text
            parsed = self._parse_msf_output(output, module_type, module_name)
            if not success:
                error_text = native_tools.external_exit_error(
                    result.returncode, stderr_text, stdout_text)
                error_kind = ("missing_binary"
                              if result.returncode == 127 else "nonzero_exit")
        except subprocess.TimeoutExpired:
            logger.error(f"msf模块执行超时: {module_name}")
            success = False
            output = "执行超时"
            parsed = {}
            error_text = f"执行超时（{timeout}秒）"
            error_kind = "timeout"
        except Exception as e:
            output, _kind = describe_exception(e)
            logger.error(f"msf模块执行失败: {output}")
            success = False
            parsed = {}
            error_text = output
            error_kind = _kind
        finally:
            try:
                os.unlink(script_path)
            except Exception:
                pass
        if success:
            self.stats_panel["tool_usage_count"] += 1
        payload = {
            "success": success,
            "output": output,
            # 同 service_version_detection：stderr 独立字段，成功时不带 error
            "stderr": stderr_text,
            "parsed_result": parsed
        }
        if not success:
            # 失败必须带可读 error：/api/scan 前端失败分支只认 data.error /
            # data.result.error，两者都缺时显示「未知错误」（与用户报障同族）。
            payload["error"] = error_text
            payload["error_kind"] = error_kind
            if returncode is not None:
                payload["returncode"] = returncode
        return payload

    def _parse_msf_output(self, output: str, module_type: str, module_name: str) -> Dict[str, Any]:
        """解析 msfconsole 输出，提取关键信息"""
        parsed = {}
        if "auxiliary/scanner/portscan" in module_name:
            ports = []
            for line in output.splitlines():
                if "TCP OPEN" in line or "open" in line:
                    match = re.search(r'(\d+\.\d+\.\d+\.\d+):(\d+)', line)
                    if match:
                        ports.append(match.group(2))
            parsed["open_ports"] = list(set(ports))
        elif module_type == "exploit":
            session_match = re.search(r'Meterpreter session (\d+) opened', output)
            if session_match:
                parsed["session_id"] = session_match.group(1)
            rhosts_match = re.search(r'RHOSTS?=([\d\.]+)', output)
            if rhosts_match:
                parsed["target_ip"] = rhosts_match.group(1)
            payload_match = re.search(r'PAYLOAD=(\S+)', output)
            if payload_match:
                parsed["payload"] = payload_match.group(1)
        return parsed

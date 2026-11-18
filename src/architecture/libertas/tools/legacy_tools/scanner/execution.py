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


class ExecutionMixin:
    def run_tool_stream(self, tool_name: str, params: Dict):
        """
        流式执行工具，逐行返回 stdout
        """
        tool = self.tool_manager.get_tool(tool_name)
        if not tool:
            yield json.dumps({"type": "error", "content": f"工具 {tool_name} 未注册"}) + "\n"
            return

        # 构建命令
        cmd = self.tool_manager.build_command(tool_name, **params)
        yield json.dumps({"type": "info", "content": f"🔧 执行命令: {' '.join(cmd)}"}) + "\n"

        # 检查工具是否可用
        import shutil
        path = tool.get('path', tool_name)
        if not shutil.which(path):
            yield json.dumps({"type": "error", "content": f"❌ 工具 {tool_name} 未安装或路径不正确: {path}"}) + "\n"
            return

        # 启动进程
        with self.process_lock:
            if tool_name in self.running_processes:
                yield json.dumps({"type": "error", "content": f"工具 {tool_name} 已在运行"}) + "\n"
                return
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                # 以字节模式启动、逐行自行解码：text=True 会按系统区域编码
                # （Windows 中文环境=cp936）解码 UTF-8 的工具输出，抛
                # UnicodeDecodeError 并中断整次日志流
                # （用户报障：'gbk' codec can't decode byte 0x9a）。
                start_new_session=True,  # 子进程独立进程组，不挂终端
            )
            self.running_processes[tool_name] = process

        try:
            start_time = time.time()
            timeout = params.get('timeout', 300)
            for raw in iter(process.stdout.readline, b''):
                if not raw:
                    break
                line = decode_output(raw)
                # 检测进度标记 [xx%]
                import re
                match = re.search(r'\[(\d+)%\]', line)
                if match:
                    yield json.dumps({"type": "progress", "percent": int(match.group(1))}) + "\n"
                yield json.dumps({"type": "log", "content": line.rstrip()}) + "\n"
                if time.time() - start_time > timeout:
                    process.terminate()
                    yield json.dumps({"type": "error", "content": f"⏰ 执行超时 ({timeout}秒)，已终止"}) + "\n"
                    break

            process.wait()
            if process.returncode == 0:
                yield json.dumps({"type": "done", "content": "✅ 执行成功"}) + "\n"
            else:
                yield json.dumps({"type": "error", "content": f"❌ 执行失败，返回码: {process.returncode}"}) + "\n"
        except Exception as e:
            friendly, _kind = describe_exception(e)
            yield json.dumps({"type": "error", "content": f"❌ 异常: {friendly}"}) + "\n"
        finally:
            with self.process_lock:
                self.running_processes.pop(tool_name, None)

    def cancel_tool(self, tool_name: str) -> bool:
        """取消正在运行的工具"""
        with self.process_lock:
            process = self.running_processes.get(tool_name)
            if process:
                process.terminate()
                return True
            return False

    def kill_all(self):
        """终止所有正在运行的工具进程（退出时调用）"""
        with self.process_lock:
            for name, process in list(self.running_processes.items()):
                try:
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except Exception:
                        process.kill()
                except Exception:
                    pass
            self.running_processes.clear()

    def run_tool(self, tool_name: str, params: Dict, notify: bool = True) -> Dict[str, Any]:
        """
        通用工具执行接口

        notify=False 时不在这一层发「工具失败/完成」通知：治理层降级（如 curl →
        内置 http_headers）过程中每一次尝试都会进来，逐次通知会让用户看到
        「工具失败: curl」但其实随后已经成功。收尾通知由调用方统一发一次。
        """
        result = self.tool_manager.execute(tool_name, params)

        # ===== 记录到记忆系统（原有逻辑） =====
        if self.memory_system and result.get('success'):
            target = params.get('target') or params.get('url')
            self.memory_system.record_scan_memory(
                target=target or "unknown",
                scan_type=tool_name,
                content=result.get('raw_output', '')[:500],
                raw_output=result.get('raw_output', ''),
                extra={"parsed": result.get('parsed')}
            )

            # ===== 新增：注入到对话上下文 =====
            self._inject_scan_context(tool_name, result, params)

        # ===== 喂入漏洞知识图谱 =====
        if result.get('success'):
            target = params.get('target') or params.get('url') or \
                     params.get('domain') or params.get('host') or ""
            self._feed_graph(tool_name, target, result, params)
            if notify:
                self._notify_tool(tool_name, target, result, True)
        elif result.get('error'):
            target = params.get('target') or params.get('url') or \
                     params.get('domain') or params.get('host') or ""
            if notify:
                self._notify_tool(tool_name, target, result, False)

        return result

    def _inject_scan_context(self, tool_name: str, result: Dict, params: Dict):
        """
        将扫描结果以自然语言形式注入到对话历史中
        这样模型在后续对话中能自然引用扫描结果
        """
        # 检查是否有 model_engine 引用
        model_engine = getattr(self, 'model_engine', None)
        if not model_engine:
            # 尝试从外部获取
            if hasattr(self, '_model_engine_ref'):
                model_engine = self._model_engine_ref
            else:
                return

        # 生成摘要
        summary = self._generate_scan_summary(tool_name, result, params)
        if not summary:
            return

        # 注入到对话历史
        entry = f"系统: 执行 {tool_name} 扫描完成。{summary}"
        model_engine.conversation_history.append(entry)

        # 限制历史长度（避免过长）
        if len(model_engine.conversation_history) > 20:
            model_engine.conversation_history = model_engine.conversation_history[-20:]

        print(f"📝 扫描结果已注入对话上下文: {entry[:80]}...")

    def _generate_scan_summary(self, tool_name: str, result: Dict, params: Dict) -> str:
        """生成可读的扫描摘要"""
        target = params.get('target') or params.get('url') or '未知目标'

        # 如果有解析结果，优先使用
        parsed = result.get('parsed')
        if parsed:
            if 'open_ports' in parsed:
                ports = parsed['open_ports']
                if ports:
                    port_info = ', '.join([f"{p['port']}/{p.get('service', 'unknown')}" for p in ports[:5]])
                    if len(ports) > 5:
                        port_info += f" 等 {len(ports)} 个端口"
                    return f"目标 {target} 发现开放端口: {port_info}"
                else:
                    return f"目标 {target} 扫描完成，未发现开放端口"

            if 'domains' in parsed:
                domains = parsed['domains']
                if domains:
                    return f"目标 {target} 发现 {len(domains)} 个子域名: {', '.join(domains[:5])}"
                else:
                    return f"目标 {target} 未发现子域名"

            if 'vulnerabilities' in parsed:
                vulns = parsed['vulnerabilities']
                if vulns:
                    severity_count = {}
                    for v in vulns:
                        sev = v.get('severity', '未知')
                        severity_count[sev] = severity_count.get(sev, 0) + 1
                    summary = f"目标 {target} 发现 {len(vulns)} 个漏洞"
                    if severity_count:
                        summary += f" ({', '.join([f'{k}:{v}' for k, v in severity_count.items()])})"
                    return summary
                else:
                    return f"目标 {target} 未发现漏洞"

        # 如果没有解析结果，从 raw_output 提取
        raw = result.get('raw_output', '')
        if not raw:
            return f"目标 {target} 扫描完成"

        # 尝试提取端口信息
        import re
        ports_match = re.search(r'Ports:\s+(.+?)(?:\n|$)', raw)
        if ports_match:
            return f"目标 {target} 开放端口: {ports_match.group(1)}"

        # 尝试提取漏洞信息
        vuln_match = re.search(r'(\d+)\s+vulnerabilit', raw, re.IGNORECASE)
        if vuln_match:
            return f"目标 {target} 发现 {vuln_match.group(1)} 个漏洞"

        return f"目标 {target} 扫描完成"

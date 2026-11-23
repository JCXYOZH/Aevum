# 进程上下文完整化路线

本文只讨论 ring3 用户进程，不把 `control/render/idle` 这三个内核任务当成完整进程。

P1 建立用户进程 PCB、PID、父子关系、退出码和 `fork/exit/wait/reap` 闭环。P2.1 把地址空间推进到“255 页物理池 + 6 个 VMA + brk + guard + copyin/copyout”。P2.2 完成 COW fork 与物理页引用计数。P3.1 完成用户同步异常的默认终止、信号 pending/SIGCHLD、wait status 编码和 V 页信号视图；P3.2 在默认终止之上加入每进程 handler 表、用户栈 signal frame、`sigreturn`，并修复第二次 fork 时已有 COW 页丢失 COW 位的问题；P4.1 加入内嵌 flat 镜像 `exec`，保留 PID/任务槽，替换用户 AS、入口、栈和信号状态；P4.2 给 `exec` 增加 `argv/envp` 解析、字符串迁移和 SysV 初始栈；P4.3 增加每进程 fd 表、匿名 pipe、`pipe/read/write/close`，并证明 exec 后 fd 表继续有效；P4.4 把 fd 0/1 接到 console 字符设备，验证键盘输入、VGA/COM1 输出、fork 继承和 close 边界。P7.0 增加 `spawn(image_id,argv,envp)`：不经过 fork，直接为当前进程创建独立 AS/PCB/内核栈/用户栈的子进程，D lane 用 image 1 子进程和 wait(10) 做闭环。

## 一、P3.1/P3.2/P4.1/P4.2/P4.3/P4.4/P5.1/P5.2/P5.3/P6.0 现在的实现

| 能力 | 当前实现 | 位置 |
| --- | --- | --- |
| 用户同步异常 | `#DE/#BP/#UD/#GP` 由 `exception.c` 唯一分发；`#PF` 仍由 `page_fault.c` 独占 | `arch/x86/cpu/exception/exception.c` |
| 异常入口 | `exception_de/bp/ud/gp_stub` 统一压出与 `struct irq_frame` 对齐的帧；`#DE/#BP/#UD` 补 `err=0`，`#GP` 使用 CPU 压入的 error code | `loader.asm` |
| 异常映射 | `#DE -> SIGFPE(8)`、`#BP -> SIGTRAP(5)`、`#UD -> SIGILL(4)`、`#GP -> SIGSEGV(11)` | `exception.c` |
| 默认动作 | 没有 handler 时，CPL3 异常记录现场后 `process_terminate_current(sig)`，再 `task_exit()`；CPL0 非 #PF 异常进入诊断停机 | `exception_dispatch()` |
| 用户 handler | P3.2 每进程 `sigactions[32]`：handler、mask、flags；`0` 默认终止、`1` 忽略、其他值是用户 VA | `include/kernel/proc.h`、`process.c` |
| signal frame | P3.2 在用户栈低地址放 trampoline 返回地址，随后保存原 GPR 与 `eip/cs/eflags/esp/ss`、`sig/old_mask/magic` | `process_signal_deliver()` |
| sigreturn | P3.2 `eax=12` 从用户栈读回 frame，恢复 GPR/iret 帧和旧 mask；handler 用 `ret` 进入 trampoline | `process_sigreturn_current()` |
| handler 继承 | `fork` 复制父进程 `sigactions` 与 `sig_mask`，不复制 pending；`sig_handled` 从 0 开始 | `process_fork()` |
| 信号常量 | `SIGILL 4 / SIGTRAP 5 / SIGFPE 8 / SIGSEGV 11 / SIGCHLD 17` | `include/kernel/proc.h` |
| P3.2 系统调用 | `eax=11 sigaction(sig,handler,mask)`、`eax=12 sigreturn()`；复用 `int80_stub` 返回同一 `irq_frame` 的路径 | `arch/x86/cpu/syscall/syscall.c` |
| P4.2 exec | `eax=13 exec(image_id,argv,envp)`；`process_exec_current()` 先在旧 AS 解析两个向量，再建新 AS、构造 `argc/argv/envp` 新栈、切 CR3、更新任务 AS 指针、重置帧和信号状态、释放旧 AS；只接受镜像 1 | `kernel/proc/process.c`、`syscall.c` |
| P4.2 exec 元数据 | `struct process.image_id/exec_argc/exec_envc`：ring3=0、exec=1；`fork` 继承，`reap` 保留墓碑；`process_image_id(pid)` 与 `process_exec_counts(pid)` 都取同 PID 最大镜像代次 | `include/kernel/proc.h`、`process.c` |
| P4.2 任务 AS 指针 | `task_set_space()` 是 exec 更新任务持有 AS 的唯一入口；CR3 切换仍归 `address_space` | `kernel/task/task.c` |
| P4.3 fd 表 | PCB 内嵌 `struct proc_fd_table fds`，8 槽；fd 0 为 console 读、fd 1 为 console 写，pipe 从 2 起；`kind` 区分 console 与 pipe；`fork` 复制，pipe 端点 acquire、console 端点继承；exec 保留、exit/terminate/reap 关闭 | `kernel/proc/fd/fd.c`、`include/kernel/proc/fd.h` |
| P4.3 pipe | 4 个对象、每对象 64 字节非阻塞环形缓冲；`refs/readers/writers` 控制生命周期；空读有写端 `-1`、写端全关 `0`、满写 `-1` | `kernel/ipc/pipe/pipe.c` |
| P4.3 系统调用 | `eax=14 pipe(ebx=user u32[2])`、`15 read(ebx=fd,ecx=buf,edx=count)`、`16 write`、`17 close(ebx=fd)`；失败统一 `-1` | `syscall.c`、`fd.c` |
| P4.3 exec 镜像 2 | `user/exec-pipe/exec_pipe.asm` 从 `argv={"pipe","writer","FD=3"}` 取 fd，向继承写端写 `PIPE`，成功 `exit(12)`；失败码 26..31 | `process.c`、`user/exec-pipe/` |
| P4.4 console | `drivers/console/console.c`：16 字节 ASCII 输入队列、8×64 输出行缓存、COM1 镜像、scan/push/drop 统计；`read(0)` 非阻塞，`write(1)` 最多 64 字节 | `drivers/console/console.c` |
| P4.4 fd 0/1 | 新用户进程创建后安装 fd0 读、fd1 写；`fork` 复制父表，`exec` 保持，`close` 只清本进程句柄；console 端点不参与 pipe 引用计数 | `kernel/proc/fd/fd.c`、`process.c` |
| P4.4 X 页 | mode 4 父进程 fork 后关闭自身 0/1，子进程继续读键并写 `CON:<key>` / `FD01 OK`，`exit(14)`；页面显示 close 结果、输入队列、输出行和 UART 字节 | `app/console/demo`、`app/console/render` |
| P7.0 spawn | `eax=18 spawn(image_id,argv,envp)`：当前 ring3 进程直接创建独立子进程，不复制父 AS；父 AS 解析参数，子进程新建 AS/内核栈/PCB，复制 fd 表后以 `0x400000` 入口发布；父 wait 回收。D lane spawn image 1，子进程 exit(10)，V 页写 `SPAWN OK` | `kernel/proc/process.c`、`arch/x86/cpu/syscall/syscall.c`、`user/ring3/ring3.asm` |
| wait status | 正常退出保留原退出码（`exit(7) -> 7`）；信号终止为 `0x80000000` 按位或 `sig`（`#DE -> 0x80000008`） | `PROC_WAIT_STATUS()` |
| PCB 信号字段 | `pending/last_sig/term_sig/sig_count/sigchld_count`；`process_info` 同步暴露 | `kernel/proc/process.c` |
| pending 位图 | `pending |= 1u << (sig - 1)`；只记录 1..31 号信号，不在这里改进程状态 | `proc_signal_pending()` |
| SIGCHLD | 子进程正常退出或被信号终止都 `proc_notify_parent()`；父进程 LIVE 时置 SIGCHLD pending | `proc_notify_parent()` |
| wait 消费 | `process_wait()` 回收 ZOMBIE 后清父进程 SIGCHLD pending；`process_reap()` 保留 `term_sig` 墓碑供 V 页读取 | `process_wait()` / `process_reap()` |
| 用户态 #PF | 不可恢复的 guard/RO/非法 #PF 改走 `process_terminate_current(SIGSEGV)`；C/F 显示 `SIG11` 而不是 `EXIT 142` | `page_fault.c` |
| PID 复用 | `process_fork()` 优先复用刚退出的直接子 PID，保留另一条 lane 的墓碑；V 页按 `comm` 判 FAULT/GUARD，不按旧 PID 猜 | `proc_reusable_child_pid()`、`task_pid_reserve_hint()` |
| 调度记账 | `int 0x40` 的 `SCHED_YIELD` 也按 `WEIGHT_QUANTUM / weight` 记 vruntime，避免 `wait` 轮询饿死其他任务 | `task_schedule_irq()` |
| V 页 | 标题 `AEVUM / COW FORK + SIGNALS + PHYS`；PCB 表 `EXIT` 显示 `SIG11/SIG8` 或 `EXIT 9/10/12`；新增 #DE、SIGCHLD、D 第二轮 fork/wait、`P4 exec`（`arg/env` 计数）、`P4.3 pipe`（`fd 2>3 r4 PIPE OK`）和 `pipe obj` | `app/user/render/render.c` |

槽位预算：`TASK_MAX=10`（3 内核 + 6 用户 + 1 余量）、`PROC_MAX=8`、`AEVUM_AS_MAX=8`（exec 期间旧 AS、新 AS、fork 子 AS 同时存在，6 槽不够）、`PID_MAX=31`。P4.3 另加 `PROC_FD_MAX=8`、`PROC_FD_FIRST=2`、`PIPE_MAX=4`、`PIPE_CAPACITY=64`；P4.4 加 `CONSOLE_INPUT_MAX=16`、`CONSOLE_LINES=8`、`CONSOLE_LINE_MAX=64`、`CONSOLE_WRITE_MAX=64`。
用户内核栈顶 A `0x201000`、B `0x202000`、C `0x203000`、D `0x204000`、E `0x205000`、F `0x206000`。
物理池仍为 `0x100000..0x1FEFFF` 的 255 页位图池。

### 异常与信号的状态机

1. 用户指令触发 `#DE/#BP/#UD/#GP`：CPU 压 error code（`#DE/#BP/#UD` 没有，由 stub 补 0），`exception_dispatch()` 记录 `vector/eip/err/cr2/comm`。
2. 查 handler：`process_signal_deliver()` 读当前进程 `sigactions[sig]`。没有 handler 走第 3 步默认终止；有用户 handler 时在用户栈写 signal frame，把 `irq_frame` 改成 `eip=handler`、`user_esp=frame_addr`，`exception_common` 直接 `iret` 进 handler。
3. 默认动作：`process_terminate_current(sig)` 把当前进程置 ZOMBIE，`exit_code = PROC_WAIT_STATUS(sig)`，`term_sig = sig`，自身 pending 置位，父进程置 SIGCHLD；随后 `task_exit()`。
4. `sigreturn`：handler 执行 `ret` 弹出 frame 第一个槽的 trampoline 地址，trampoline 执行 `eax=12 int 0x80`；`process_sigreturn_current()` 从 `frame->user_esp` 读回保存的 GPR/iret 帧，回到除零后的指令。
5. 父进程 `wait`：找到 ZOMBIE 后把 `exit_code` copyout 到用户 status，回收任务/AS/PID/栈，清父进程 SIGCHLD pending。
6. 墓碑：`process_reap()` 不把 `pid/comm/term_sig/exit_code/pending/sig_handled` 等显示字段清零，V 页因此能继续显示已回收进程的信号死因和 handler 次数。

## 二、P3.1 验收记录

QEMU 实测（本构建 `kernel.bin` 42,792 字节，BSS 结束 `0x8C140`，96 扇区 / 49,152 字节窗口）：

- `V` 页 PCB 表：`userA` PID 4 / AS 1 / READY；`userB` PID 5 / AS 2 / READY；`userC` PID 6 / `FAULT` / `SIG11`；`userD` PID 7 / AS 4 / READY；`userF` PID 8 / `GUARD` / `SIG11`；`userE` PID 9 / PPID 7 / `SIG` / `SIG8`。
- VMA 摘要：A/B 的 code RX `0x400000`、data RW `0x401000`、guard `0x402000`、stack RW `0x403000`、control R `0x404000`、heap RW `0x405000`，`brk 0x406000`。
- A/B 的 heap 验收：`brk 0x406000`、`heap poke 1`、`peek 0x48454C50`、`guard poke 0`；越界 `brk(0x500000)` 返回 `0xFFFFFFFF`。
- D 第一轮：`fork 9`、`wait 9`、`status 7`，页面 `WAIT OK 7 / COW OK`；D 写 `PAPA`，E1 写 `CHLD` 后 `exit(7)`，父读回 `PAPA` 后写 `COW`。
- D 第二轮：`fork2 9`、`wait9`、`st 80000008`、`SIG OK`；E2 先写 `SIGF` 到 COW 数据页，再执行 `1/0` 触发 `#DE`，父进程拿到 `0x80000008`。
- 信号面板：`#DE 1 pid 9 eip 00400206 sig 8 SIGFPE | SIGCHLD 2 pend 00000000`。`SIGCHLD 2` 来自 E1 与 E2 两次子进程退出；父进程两次 wait 都消费了 pending，因此当前 `pend 0`。
- `#PF count 3`：面板显示 `pid6 cr2 000B8000 err 00000007 count 3`；C 与 F 都被 SIGSEGV 终止，A/B 继续计数。COW 行 `forks 2 shared 8 live 2 breaks 4` 中的 `breaks` 包含内核 `copyout` 的拆分，不能把 `breaks 4` 直接当作 4 次 COW `#PF`。
- COW 行：第一轮 `forks 2 shared 8 live 2 breaks 4 last AS4 old 00115000 -> 00118000`；第二次启动 V 后累计为 `forks 4 shared 16 live 2 breaks 9 last AS11 old 00119000 -> 0011B000`。
- `PHYS PAGES used/total`：两轮都为 `20/255`；`int 0x80 traps` 第一轮 1,080,064，第二轮 2,208,997；`last CS 0000001B`。
- 再按 `V` 停止后回机械臂，机械臂 q 值正常；再按 `V` 重新出现 A/B/C/D/F/E，ASID 从 8 起、PID 仍复用 4-9，`PHYS PAGES` 仍为 `20/255`，没有 ZOMBIE/PID/页泄漏。
- `K` 页：独立启动后直接按 `K`，显示 `fault count 1`、`EIP 000837C1`、`CR2 00400000`、`ERR 00000002`、`CR3 00010000`、`kernel image 0x00080000..0x0008E200`；按 `R` 回主画面，机械臂继续更新。
- 若先跑完整 V 再按 `K`，K 页显示 `fault count 6`：V 页自身记录 3 次，V 停止路径额外产生 2 次用户 `#PF`（尚未逐条归因），再加 K 探针 1 次。K 页的 count 是累计值，不是单次 probe 次数。

## 三、P3.2 用户 handler 与 signal frame

### 3.1 最小动作表

- `struct process` 增加 `sigactions[PROC_NSIG]`，每项保存 `handler/mask/flags`；`handler=0` 是默认终止，`handler=1` 是忽略，其他值必须是当前地址空间内可读的用户 VA。
- `sigaction(sig,handler,mask)` 只接受 `1..31`；mask 存低 31 位，当前只随 frame 保存/恢复，不做阻塞。
- `fork` 复制父进程的 `sigactions` 与 `sig_mask`，不复制 pending；子进程 `sig_handled` 从 0 开始。
- 同步异常分发先查 handler；没有 handler、handler 非法、frame 写入失败时才退回 P3.1 的默认终止。

### 3.2 signal frame 布局

`frame_addr = (frame->user_esp - 64) & ~3`，必须落在 stack VMA `0x403000..0x404000` 且可写。低地址到高地址：

| 偏移 | 内容 |
| --- | --- |
| `+0` | `sigreturn_trampoline` 的用户 VA（handler 的 `ret` 目标） |
| `+4` | `eax,ebx,ecx,edx,esi,edi,ebp` |
| `+32` | `eip,cs,eflags,user_esp,ss` |
| `+52` | `sig,old_mask,magic(0x53494746)` |

投递时 `frame->eax=sig`、`frame->ebx=frame_addr+4`、`frame->eip=handler`、`frame->user_esp=frame_addr`；`exception_common` 的 `RESTORE_CTX` 弹出 GPR 后 `iret` 进 handler。

### 3.3 `#DE` 返回点与 `sigreturn`

- CPU 对 divide error 保存的 EIP 指向 faulting `div/idiv` 本身。`process_signal_deliver()` 对 `#DE` 做最小 `F6/F7` 解码（opcode + ModRM + SIB/位移），把保存的 `eip` 前移到下一条指令；解码失败则退回默认终止。
- `sigreturn` 的入口是 frame 第一个槽：handler 用 `ret` 进入 `user_sigreturn_trampoline`，执行 `eax=12 int 0x80`。此时 `irq_frame.user_esp` 指向保存的 GPR 区，`process_sigreturn_current()` 读回 60 字节 frame，校验 magic、CS/SS RPL3、恢复 EIP 与栈范围，再写回 GPR/iret 字段。
- `sigreturn` 恢复 `old_mask`；handler 可以通过 `ebx` 指向的 frame 修改保存的 EIP（`sigreturn` 以 frame 内容为准）。

### 3.4 系统调用与构建

- `eax=11`：`sigaction(sig,handler,mask)`，参数 `ebx/ecx/edx`；成功返回 0，失败 `0xFFFFFFFF`。
- `eax=12`：`sigreturn()`；成功用恢复后的 frame 返回，失败 `0xFFFFFFFF`。
- `loader.asm` 不需要新增 stub：`exception_common` 与 `int80_stub` 都已把 C 返回的 `struct irq_frame *` 写回 `esp`，`RESTORE_CTX` 直接消费改写后的帧。

### 3.5 第二次 fork 的 COW 继承修复

`address_space_clone()` 原来只保留 `PAGE_PRESENT|PAGE_USER`，对“已经是 COW”的页第二次 fork 会丢掉 `PAGE_COW`，把可写页退化成只读页。P3.2 改为：

- `share_writable = (pte & (PAGE_RW|PAGE_COW)) != 0 || control`；
- `flags = pte & (PAGE_PRESENT|PAGE_USER|PAGE_COW)`，共享时再补 `PAGE_COW`。

这样 D 第一轮 fork 后仍处 COW 的栈页，在第二轮 fork 后仍是 COW；内核写 signal frame 时能正常拆页，handler 也能使用该栈。

### 3.6 fork 子任务起跑与 lane 创建让出

第二次 fork 暴露出一个调度平局：子任务 `task_create_common()` 继承父任务的 `vruntime`，父进程进入 `wait` 轮询后，调度器会一再选回父任务，子任务永远轮不到，D lane 停在 `fork2` 之后。修复是在 `task_fork_user()` 里把新子任务的 `vruntime` 置 0，保证它至少先跑一次、完成自己的退出路径。

`user_demo_start()` 连续创建 5 条 lane 时也会长时间占住 render 任务。每建完一条 lane 调一次 `task_yield()`，让新 READY 的用户任务先获得一次调度机会，再继续创建下一条；失败按 `task_yield` 错误走统一失败屏。

## 四、P3.2 验收记录

QEMU 实测（本构建 `kernel.bin` 44,392 字节，BSS 结束 `0x8D3C0`，96 扇区 / 49,152 字节窗口）：

- `V` 页 PCB：`userD` PID 7 / AS 4 / READY；`userE` PID 8 / PPID 7 / EXIT 9 / `userE`；handler 子进程没有再变成 `SIG8` 墓碑。
- `D fork2 8 wait 8 st 00000009 HAND OK`；`sig_ok` 是 `"HAND"`，不是 P3.1 的 `"SIG!"`。
- 信号面板：`#DE 1 pid 8 eip 0040021B sig 8 SIGFPE hdl 1 chld 2 pend 00000000`；`hdl 1` 证明 `SIGFPE` handler 被调用一次。
- `eip 0040021B` 是 faulting `div ecx` 的地址；返回后子进程执行 `0x40021D` 的 `cmp [0x401054],1`，确认 handler 计数为 1，再 `exit(9)`。
- COW 行 `forks 2 shared 8 live 2 breaks 5 last 4 old 00118000 -> 0011B000`；多出的 `breaks` 包含 signal frame 写入用户栈时的 COW 拆分。
- `PHYS PAGES used/total` 为 `26/255`，没有因为 signal frame 或 handler 泄漏页；`int 0x80 traps` 和 `last CS 0000001B` 正常。
- 再按 `V` 停止后回机械臂；没有 ZOMBIE/PID/页泄漏。

## 五、P4.2 用户态 exec 与 argv/env

### 语义

`exec` 只替换当前进程的用户地址空间和用户镜像，PID、PPID、`task_struct` 槽、内核栈、调度权重和父进程关系都不变。它不创建新进程，也不走 `fork` 的复制路径。P4.2 在 P4.1 的 AS 替换之上，增加了参数从旧用户空间到新用户栈的迁移。

- 入口：`process_exec_current(struct irq_frame *frame, uint32_t image_id, uint32_t argv, uint32_t envp)`，系统调用为 `eax=13`、`ebx=image_id`、`ecx=argv`、`edx=envp`。P4.2 只接受 `image_id==1`；其他值返回 `0xFFFFFFFF`。
- 前置校验：当前必须是 CPL3、`PROC_LIVE`、持有非空 `space`，且 `current_task` 与 `self` 一致。
- 参数解析：在旧 AS 仍有效时调用 `proc_exec_parse(self->space, argv, envp, &args)`。`argv` 和 `envp` 都是用户态 `char *` 数组，必须以 NULL 结尾；最多 `PROC_EXEC_MAX_VEC=4` 项，每串最多 `PROC_EXEC_STRING_MAX=32` 字节（31 字符 + NUL）。指针或字符串不可读、缺少 NULL、超过 4 项或超过长度上限都直接返回 -1，不分配新 AS。
- 新 AS：`address_space_create_user(user_exec_start, user_exec_end - user_exec_start)` 从 255 页池分配 PD/PT/code/data/stack/control；失败时旧 AS、旧帧和 `image_id` 都不动，返回 -1。
- 新栈：`proc_exec_build_stack()` 先算 `string_bytes = Σ(strlen+1)`，再按 `strings_base=(0x404000-string_bytes)&~3`、`envp_addr=strings_base-env_words`、`argv_addr=envp_addr-argv_words`、`esp=argv_addr-4` 布局，顺序为 `argc, argv[], NULL, envp[], NULL, 字符串区`。2 项参数 / 2 项环境时 `strings_base=0x403FE4`、`envp_addr=0x403FD8`、`argv_addr=0x403FCC`、`esp=0x403FC8`。字符串和指针数组都通过 `address_space_copyout()` 写入；超出一页或越界返回 -1，并释放新 AS。
- 切换：`cli` 下 `address_space_switch(new_space)` 写 CR3，`task_set_space(current_task, new_space)` 更新任务持有的 AS 指针，`self->space = new_space`；旧 AS 在所有引用切走后 `address_space_release()`。
- 信号状态：`proc_reset_signals(self)` 清空 `sigactions[32]`、`sig_mask`、`pending` 和 `sig_handled`。exec 后 handler 表不继承。
- iret 帧：`eax/ebx/ecx/edx/esi/edi/ebp=0`，`eip=0x400000`、`cs=0x1B`、`eflags=0x202`、`user_esp=new_esp`、`ss=0x23`；`fs/ds/es` 保持用户数据段。
- 元数据：`image_id=1`、`exec_argc=argc`、`exec_envc=envc` 写入 PCB；`fork` 让子进程继承三字段；`reap` 保留在墓碑。`process_image_id(pid)` 和 `process_exec_counts(pid)` 都遍历同 PID 的槽取最大 `image_id` 代次，避免 PID 复用后旧墓碑覆盖新镜像。
- 失败原子性：解析、AS 分配、栈构造任一步失败都只释放新 AS，旧 AS、旧帧、旧 `image_id` 和旧参数计数全部保持；成功后才更新 PCB 和帧。

### 镜像

`user/exec/exec.asm` 是第二个固定链接在 `0x400000` 的 flat 镜像，由 `Makefile` 用 `nasm -f elf32` 汇编成 `build/user/exec.o` 并链进内核；运行时不读盘。镜像开头：

1. `eax=5 getpid`，把 PID 写到 `0x401000`。
2. 把 `0x45584543`（`"EXEC"`）写到 `0x401004`。
3. 把当前 `esp` 写到 `0x401008`，证明入口栈已重置。
4. 从 `[esp]` 读 `argc` 写到 `0x40100C`，从 `[esp+16]` 读 `envc` 写到 `0x401014`。
5. 逐字节校验 `argv[0]=alpha`、`argv[1]=beta`、`argv[2]=NULL`；再校验 `envp[0]=MODE=p42`、`envp[1]=LEVEL=2`、`envp[2]=NULL`。校验用寄存器先加载再比较，保留 `argc` 在 `eax` 供后续 `lea esi,[esp+eax*4+8]` 计算 envp 起点。
6. 全部匹配才把 `0x41525647`（`"ARGV"`）写到 `0x401018`、`0x454E5650`（`"ENVP"`）写到 `0x40101C`，`eax=2 yield` 300 次给 V 页观察窗口，最后 `eax=3 exit(10)`。
7. 任一校验失败写 `0x424144`（`"BAD"`）到两个验收字，并以唯一失败码退出：20 argc、21 argv0、22 argv1、23 envc、24 env0、25 env1。QEMU 的 wait status 可直接定位失败块。

D 第三轮由父进程 `fork` 出子进程；子进程准备静态数组 `exec_argv = {0x400312("alpha"), 0x400318("beta"), 0}`、`exec_envp = {0x40031D("MODE=p42"), 0x400326("LEVEL=2"), 0}`，并按镜像基址重定位成 `0x4002FA/0x400306` 后调用 `eax=13, ebx=1, ecx=argv, edx=envp`。父进程把 child pid、wait status、wait 返回值和 `EXEC/BAD` 验收字写到 D 页。

### 验收

QEMU 实测（P4.2 clean 构建 `kernel.bin` 47,304 字节，BSS `0x8B8E0..0x8E0E0`，96 扇区 / 49,152 字节窗口）：

- `D fork2 8 wait 8 st 00000009 HAND OK` 仍成立，说明 exec 没有破坏前两轮状态。
- `P4 exec 8 wait 8 st 0000000A img 1 EXEC OK arg 2 env 2`：子进程 PID 8 不变；exec 镜像 `image_id=1`；退出码 10 被父进程 `wait` 回收；`arg/env` 计数来自 `process_exec_counts(pid)`。
- 内核调试构建的串口日志曾输出 `P42 argc=2 env=2 a0=alpha e0=MODE=p42` 与 `P42S p0=alpha p1=beta e0=MODE=p42`，证明解析结果和新栈指针指向的字符串一致；该临时输出已在最终构建前移除。
- PCB `userE PID 8 PPID 7 EXIT 10`：wait 回收后 AS 已释放；`image_id=1` 保留在墓碑。
- 信号面板 `#DE 1 pid 8 eip 004002A6 sig 8 SIGFPE hdl 1 chld 3 pend 00000000`：第三轮 fork/exec 后 P3.2 的 handler 计数仍可见。`exception_info.handled` 在投递成功时快照，避免 PID 8 旧墓碑被清掉后按 PID 重查变成 0。
- COW `forks 3 shared 12 live 2 breaks 6 last AS4 old 0011B000 -> 0011C000`；`PHYS PAGES 20/255`；`int 0x80 traps` 持续增长，`last CS 0000001B`。
- 再按 `V` 停止后回机械臂；没有 ZOMBIE/PID/页泄漏。

## 六、P4.3 每进程 fd 与匿名 pipe

### 背景：P4.2 exec 参数（已完成）

- `exec(image_id, argv, envp)` 已把字符串复制到新用户栈，按 SysV 布局写 `argc/argv/envp`；P4.2 的真实 QEMU 验收为 `st 0000000A img 1 EXEC OK arg 2 env 2`。
- PID、AS 替换、信号重置和旧 AS 失败保护语义保持不变。

### 语义

- **fd 归属**：`kernel/proc/fd/fd.c` 是每进程 fd 表的唯一 owner。PCB 内嵌 `struct proc_fd_table fds`，`PROC_FD_MAX=8`；fd 0/1 明确预留给后续 console，`PROC_FD_FIRST=2`，匿名 pipe 从 2 起分配。每槽只保存 `pipe *` 和 `kind`（`CLOSED/PIPE_READ/PIPE_WRITE`）。
- **fork**：`process_fork()` 调 `proc_fd_table_copy()` 逐槽复制，并对每个非空端点 `pipe_acquire(p,write_end)`；复制失败时释放已建立的 pipe 引用、AS、栈和 PID，不留下半张表。父子两端都关闭后对象才回池。
- **exec**：`process_exec_current()` 只替换 AS、镜像、入口栈和信号状态，不调用 `proc_fd_table_close_all()`，也不改 fd 表。因此 exec 前后 fd 编号和 pipe 端点保持不变。
- **exit/terminate/reap**：`process_exit_current()`、`process_terminate_current()` 和 `process_reap()` 都先 `proc_fd_table_close_all()`；`proc_zero()` 也先关闭再初始化。这样正常退出、信号终止、父进程回收和 PCB 槽复用都不会漏掉 `pipe_release()`。
- **pipe 对象**：`kernel/ipc/pipe/pipe.c` 固定 `PIPE_MAX=4` 个对象、每对象 `PIPE_CAPACITY=64` 字节环形缓冲；维护 `head/tail/count` 和 `refs/readers/writers`。`pipe_create()` 只从 `used==0` 的槽取对象；`pipe_acquire()` 加总引用和端点计数；`pipe_release()` 减端点与总引用，`refs==0` 时清空并立即回池。
- **非阻塞 I/O**：`pipe_read()` 在缓冲为空且仍有写端时返回 `-1`，写端全关时返回 `0`；`pipe_write()` 在无读端或剩余容量不足时返回 `-1`；成功都返回字节数。实现没有等待队列，也不睡眠。
- **系统调用**：`eax=14 pipe(ebx=用户 u32[2])` 选两个空槽，写回读/写 fd；`eax=15 read(ebx=fd,ecx=用户缓冲,edx=长度)`；`eax=16 write(...)`；`eax=17 close(ebx=fd)`。失败统一 `-1`。用户范围校验和 `copyin/copyout` 都在 fd 模块内完成：read 最多 64 字节，write 超过 64 字节直接拒绝，坏指针不进入 pipe。
- **镜像 2**：`user/exec-pipe/exec_pipe.asm` 固定链接 `0x400000`，由 `Makefile` 汇编成 `build/user/exec_pipe.o` 并链进内核。它从 `argv={"pipe","writer","FD=3"}` 解析 fd，校验 `argc=3`、三个字符串，然后向该 fd 写 4 字节 `PIPE`，成功 `exit(12)`；失败码 26 argc、27 argv0、28 argv1、29 argv2、30 fd、31 write。
- **D 第四轮**：父 `pipe()` 得到 fd 2 读 / fd 3 写；`fork` 后父关闭 fd 3，子关闭继承的 fd 2 后 `exec(2)`。exec 不触碰 fd 表，新镜像继续持有 fd 3；它写 `PIPE` 后 `exit(12)`。父 `wait` 得到 12，从 fd 2 读 4 字节并校验 `0x45505049`，再关闭 fd 2；V 页写 `P4.3 pipe 8 wait 8 st 0000000C fd 2>3 r4 PIPE OK`，两端释放后 `pipe obj 0`。
- **双 exec 证据的确定性**：P4.2 与 P4.3 的子进程都复用 PID 8，不能用“当前最大 `image_id`”稳定区分两行。PCB 增加 `PROC_REAP_HISTORY=2` 的 `reaped[2]`，在 `process_wait()` 回收前保存子进程的 `pid/image_id/argc/envc`；`process_reaped_exec(parent_pid,slot,...)` 只读这份历史。V 页 slot 0 固定显示 P4.2 的 `img 1 arg 2 env 2`，slot 1 对应 P4.3，不依赖 render 采样时机或额外 yield。

### 验收

QEMU 实测（P4.3 final clean 构建 `kernel.bin` 50,760 字节，BSS `0x8C660..0x8F2E0`，104 扇区 / 53,248 字节窗口，`AEVUM_KERNEL_END=0x8F400`）：

- 同一帧同时出现 `P4 exec 8 wait 8 st 0000000A img 1 EXEC OK arg 2 env 2` 与 `P4.3 pipe 8 wait 8 st 0000000C fd 2>3 r4 PIPE OK`，说明 P4.2 的参数证据和 P4.3 的 fd 证据互不覆盖。
- `fd 2>3` 是父进程分配的真实槽位；`r4` 是父从 fd 2 读回的 4 字节；`PIPE OK` 表示 payload 校验为 `0x45505049`。执行顺序为 pipe -> fork -> 父 close 写端 -> 子 close 读端 -> 子 exec(2) -> 子写 `PIPE` -> 子 exit(12) -> 父 wait 12 -> 父 read 4 -> 父 close 读端。
- `pipe obj 0`：父子端点全部关闭后对象回池；`PHYS PAGES 20/255` 与停止前一致，没有 ZOMBIE/PID/页/fd/pipe 泄漏。
- `int 0x80 traps` 持续增长，`last CS 0000001B`，说明 pipe/read/write/close 都从真实 CPL3 系统调用门进入。
- 再按 `V` 停止后回机械臂，再按 `V` 重建：仍是 `20/255`、`pipe obj 0`、P4.2/P4.3 两行一致；V 停止→重启→再跑一轮也保持同样结果，证明 fd/pipe 引用、AS、PID 和进程历史都随新一轮清场。
- 取证说明：`screendump` 在 `-display none` / 无持续 VNC 客户端时可能读到旧显示 surface；验收以 QEMU monitor `pmemsave 0xB8000 4000 "/tmp/vga.bin"` 读到的 guest VGA 文本缓冲为准，再用等宽字体渲染成截图。稳定文本为 `PHYS PAGES used/total 20 /255`、两行 P4/P4.3 证据、`pipe obj 0`。

## 七、P4.4 console fd 0/1

### 语义

- **设备归属**：`drivers/console/console.c` 是 console 字符设备的唯一 owner；它只维护输入队列、输出行缓存、COM1 镜像和统计，不直接抢 VGA 布局。X 页渲染器只读 `console_line()`，VGA 写者仍是 `vga.c`。
- **fd 0**：`proc_fd_console_open()` 在新用户进程创建成功后安装 `CONSOLE_READ`；`read(0)` 从 16 字节 US ASCII 环形队列取数据，非阻塞，空队列返回 `-1`，有数据返回 1..len。输入源仍是 render 的 `keyboard_poll()`：X 页把非 `X` 的 scancode set 1 交给 `console_input_push()`，支持左右 Shift，release/未知键忽略。
- **fd 1**：同一入口安装 `CONSOLE_WRITE`；`write(1)` 最多 `CONSOLE_WRITE_MAX=64` 字节，追加到 8×64 行缓存，并逐字节 `uart_write()` 镜像 COM1。原始 ASCII 位于 VGA 差量帧之间，桌面 bridge 按 `A5 5A` 重新同步。
- **fork/exec/close**：`fork` 复制整张 fd 表；pipe 端点 `pipe_acquire()`，console 端点直接继承；`exec` 保留 fd 表；`close`、exit、terminate、reap 都只清本进程句柄。`proc_fd_entry_close()` 只对 pipe kind 调 `pipe_release()`，console 没有 pipe 指针，不能走 pipe 释放路径。
- **共享边界**：console 是全局字符设备，没有进程私有副本，也没有前台焦点；所有持 fd0 的进程竞争同一条输入队列，所有持 fd1 的进程写同一行缓存和 COM1。`close` 只关闭调用者的句柄；只要另一个进程仍持有端点，console 对象继续工作。
- **X 页演示**：mode 4 用户进程先 `fork`。父进程关闭自己的 fd0/fd1，验证 `read(0)=-1`、`write(1)=-1`，设置 `CON!` 后保持存活；子进程继续用继承端点循环读 fd0，读到按键后写 `CON:<key>` 和 `FD01 OK`，再 `exit(14)`。父进程不 `wait`，避免在 X 页里再引入一轮 `yield` 轮询；`wait` 语义已由 P4.3 的 D 第四轮覆盖。页面用 `out 14` 与 `child EXIT 14` 判定子进程完成。

### 验收

QEMU 实测（P4.4 final clean 构建 `kernel.bin` 55,208 字节，BSS `0x8D7C0..0x906D4`，112 扇区 / 57,344 字节窗口，`AEVUM_KERNEL_END=0x90800`）：

- X 页首屏显示 `AEVUM / CONSOLE FD 0/1`，`pid 4 child 5`，父进程关闭 0/1 后 `close0 0 close1 0 r0 -1 w1 -1`。
- 发送 `a` 后同一帧变为 `scan 3 push 1 frames 1590`、`in 1 last a q 0 drop 0`、`out 14 uart 14`、`child EXIT 14`、`CLOSE OK`；输出区两行 `CON:a` 与 `FD01 OK`。
- COM1 原始日志中包含 `CON:a\nFD01 OK\n`，同时仍有 `A5 5A` 差量帧，说明 fd1 文本与桌面 VGA 协议共用 COM1 时没有破坏帧同步。
- 按 `X` 退出后回到机械臂主画面，再按 `X` 可重新进入并再次读键；页面帧计数持续增长，子进程 `out` 和输出行重置后重新建立。
- 取证同样使用 `pmemsave 0xB8000 4000` 读取 guest VGA 文本缓冲，再渲染成 PNG；串口日志用原始字节检查。

## 八、P5.1 槽池与动态内核栈

P5.1 把容量从 P4.4 的 10/8/8 提到 `TASK_MAX=16`、`PROC_MAX=12`、`AEVUM_AS_MAX=12`，并把原来 6 个固定用户内核栈改成 12 个 4KB 槽的位图池 `0x200000..0x20BFFF`（槽 0 顶 `0x201000`，槽 11 顶 `0x20C000`）。`kernel/task/stack/stack.c` 唯一持有位图；`kernel_stack_alloc()` 在创建/fork 时取槽，`kernel_stack_free()` 在失败路径和 `process_reap()` 归还，分配与释放都整槽清零，避免旧中断帧穿透到下一个进程。

`Y` 页让父进程连续 fork 8 个子进程并全部保持 LIVE，页面同时显示 `task 12/16`、`proc 9/12`、`AS 9/12`、`kstack 9/12`、`live 9`、`root 4`、`children 8/8`、`POOL OK` 和 12 行槽表；PID 4..12 对应栈顶 `0x201000..0x209000`。按 `Y` 停止后父 `exit(16)`、子 `exit(17)`，procs 前 9 槽 PID 归零；再次按 `Y` 仍得到 9/12/12/12，并复用 PID 4..12 与同一批栈顶，证明槽位、地址空间和 4KB 栈都完成回收与复用。

P5.1 clean 构建 `kernel.bin=57,768`，SHA256 `16EC038ED0F9F0A236C44DDD370B62323D181AE1616D94D4DE3C78E34015042B`；`boot.bin=512`，`D9A70CE2062C369AA0F08BDF6E98906E6D38F75FF10878F22FB6988B39ADB6ED`；`disk.img=1,474,560`，`85CAC1864BCB80B378EC93966855348B5E7F748DCBA5BD36D342DDC2FEC49970`。`AEVUM_KERNEL_END` 当时为 `0x92000`。

## 九、P5.2 V 页分页与观测面

### 9.1 UI 状态与绘制分离

P5.2 新增 `include/app/user/page.h` 与 `app/user/page/page.c`，由 page 模块唯一持有 `page_mode`、`page_slot`、`page_first`；`USER_PAGE_COUNT=4`、`USER_PAGE_ROWS=10`。`app/arm/app/app.c` 在 `user_live` 时把扫描码交给 `user_page_key()`，不再在 arm app 内散落翻页逻辑。

键位：`Tab`（`0x0F`）循环切页，数字 `1..4`（`0x02..0x05`）直达 `SLOTS/TREE/ADDRESS/FD+SIG`，`Up/Down`（`0x48/0x50`）移选中槽，`PgUp/PgDn`（`0x49/0x51`）整窗滚 10 槽，`Home/End`（`0x47/0x4F`）跳首尾；`keyboard_poll()` 的 `0xE0` 前缀由 page 模块吞掉，下一帧的方向键实际码才生效。空槽详情仍显示 `EMPTY` 与池统计。

渲染拆成 `render.c`（公共标题、页签、slot/pid/page 状态、底栏与页面分派）、`draw.c/.h`（统一 `put_dec/put_hex`、进程状态名/颜色、VMA kind 名、fd kind 名）、`slots.c`（10 行窗口覆盖 12 槽，选中槽含 KSTACK/CR3/BRK/VMA、image/argc/envc/switches/ticks、信号、children/WAITER、池统计）、`tree.c`（按 PPID 递归，根 `R0`、子节点 `+depth`，`CH` 子进程数、`W` ZOMBIE 子进程数，visited 防环）、`address.c`（6 条 VMA 的 START/END/FLAGS 与真实 PTE R/W 探针，COW/PHYS、信号、exec/reap 历史、REAP0/1、COW last、children/WAITER，底部 P3/P4 验收）、`fd.c`（8 个 fd 槽逐项 kind/open、fd 打开数、pipe 端点数、信号、最近异常、最近 `#PF`、pipe 对象数、children/WAITER）。

### 9.2 只读观测 API

- `include/kernel/proc/fd.h` 新增 `struct proc_fd_info { int used; u32 kind; }` 与 `proc_fd_snapshot(...)`；`kernel/proc/fd/fd.c` 逐 fd 返回 kind，不暴露 pipe 指针。
- `include/kernel/proc.h` 新增 `struct proc_fd_info` 前向声明、`process_slot_space(int slot)`、`process_slot_fd_info(int slot,int fd,...)`；`kernel/proc/process.c` 按 PCB 槽直接取 AS/fd，DEAD/FREE 槽返回空。
- 保留 `process_slot_used()` 原语义（只数 LIVE/ZOMBIE）；`V` 页的 `POOL proc` 改为显式统计 `live+zomb+dead`，避免把 DEAD 墓碑误报为未占用。

### 9.3 ZOMBIE 观察窗口

为让 ZOMBIE 在 `V` 页稳定可观察，`user/ring3/ring3.asm` 在 D lane 父进程 `wait` 前增加基于 `0x4010D0` 的 yield 间隔，最终值 262144。子进程 `userE` 退出后保持 ZOMBIE 数秒，父 `userD` 随后仍执行原 wait/COW 验收；这个改动只影响 D lane 时序，不改变 wait 结果。

### 9.4 QEMU 验收

clean 构建 `kernel.bin=64,872`、`boot.bin=512`、`disk.img=1,474,560`；kernel SHA256 `48B046EB73CB31C2378E1FBBC90C01C8812F8E62AF46883B4DABA427285664D8`，boot `D9A70CE2062C369AA0F08BDF6E98906E6D38F75FF10878F22FB6988B39ADB6ED`，disk `97379832264407B170E94BAE97F4422623E1CD34987DB23C0E85E086486E4E7C`。增量构建与 `make clean && make all` 的 kernel 哈希一致；`__bss_end=0x939F8`，`AEVUM_KERNEL_END=0x94000`。

- page 1 SLOTS：`slot 0 PID 4`、`window 1-10/12`、`SLOT 4 PID 8 PP 7 ST ZOMB TK ZOMB EX 7 ASID 5`、`POOL proc 6/12 live 3 zomb 1 dead 2 task 7/16 AS 4/12`。
- page 2 TREE：`roots 5 used 6/12 live 3 zomb 1 dead 2`；`PID 7 userD CH 1 W 1`，其下 `+1 PID 8 PP 7 ST ZOMB`。
- page 3 ADDRESS：`userA CR3 00100000 ASID 1 VMA 6`，6 条 VMA `00400000..00406000`，CODE `R-X PTE R-`、DATA/STACK/HEAP `RW- PTE RW`、GUARD `--- PTE --`、CTRL `R-- PTE R-`；`TEST wait OK cow OK hand OK exec OK pipe OK`。
- page 4 FD/SIG：fd0 `CONR kind 3`、fd1 `CONW kind 4`、fd2..7 closed，`OPEN fd 2/8`；`EXC #DE cnt 1 pid 8 eip 00400606 sig 8 SIGFPE hdl 1`；`#PF pid 7 eip 004002A4 cr2 00401080 err 00000007 count 8`。
- 滚动：`PgDn` 后 `window 3-12/12`，`SLOT 2..11` 全部出现；再 `Up` 两次选中槽 4，详情为 `TASK ZOMB ... AS CR3 0011A000 ASID 5`，窗口不变。

## 十、P5.3 100 轮 fork/wait 压测

### 10.1 落点与归属

P5.3 不新增页面：`S`（`0x1F`）复用 P5.1 的池页外壳，`pool_demo_start(int stress)` 仍是 `poolA/stressA` 创建、模式写入和首次 yield 的唯一入口，`stress ? 6u : 5u` 选择 ring3 mode 6 或 P5.1 mode 5。`pool_demo_is_stress()` 只供 `app/arm/app/app.c` 选择退出键（`S`/`Y`），页面仍由 `app/pool/render/render.c` 唯一绘制。

数据布局复用 P5.1 用户页，不新增结构体：`0x4010C0` 已完成轮次，`0x4010C4` 完成魔数 `POOL`，`0x4010C8` 只执行一次标记，`0x401100/0x401104/0x401108` 首 PID/末 PID/wait status。`pool_demo_child_count()` 在 stress 下返回 0..100，且跳过 8 项 PID 缓存循环；`pool_demo_child_pid(0/1)` 读首/末 PID。

### 10.2 ring3 校验

父进程 100 轮：`eax=6 fork`；子进程 `eax=3, ebx=7 exit(7)`；父进程以本轮返回子 PID 调 `eax=4 wait`，校验返回值等于子 PID、status 等于 7；首轮 PID 写 `0x401100`，后续必须与首轮相同。任一失败立即停在 `<100` 且不写魔数；全部通过才写 `0x4010C4="POOL"` 并保持存活。`S` 停止时父进程 `exit(18)`，由现有 `process_wait/reap/cleanup` 路径回收 fd、task 槽、AS、PID、内核栈和物理页。

### 10.3 构建预算

新增代码后首次构建 66,120B 超限。最终把 `Makefile` 的 C 目标加 `-ffunction-sections -fdata-sections`、链接加 `--gc-sections`，回收约 1.3KB 不可达代码；clean `kernel.bin=64,808`，余量 728B，`__bss_end=0x9395C`，`AEVUM_KERNEL_END=0x94000`。

### 10.4 QEMU 验收

两轮都从 fresh boot 的机械臂主画面按 `S` 进入，每轮等 `round 100/100` 与 `STRESS OK` 后按 `S` 停止、回主画面再启动下一轮：

- 第一轮：`round 100/100 first 5 -> 5 live 1 state STRESS OK`，`PHYS 6/255 proc 1/12 AS 1/12 KSTK 1/12`，进程表 `PID 4 LIVE stressA`、`PID 5 DEAD userE`；ASID 1。
- 第二轮：`round 100/100 first 5 -> 5 live 1 state STRESS OK`，`PHYS 6/255 proc 1/12 AS 1/12 KSTK 1/12`；ASID 102，首末 PID 仍为 5。
- 两轮间 PID、AS 槽、内核栈槽与物理页计数完全一致；ASID 变化只说明地址空间槽被重新分配后再次复用，没有累积。

## 十一、后续阶段

### P5：规模与可观测性

- P5.1 已完成：16/12/12 任务/进程/AS 槽位，12 个 4KB 用户内核栈位图池，`Y` 页 9 个 LIVE 进程与两轮槽位/栈复用。
- P5.2 已完成：`V` 页 4 页分页/滚动，进程树、ZOMBIE、waiters、VMA、信号、fd 全部可观察；clean `kernel.bin=64,872`，距 65,536 上限余 664 字节。
- P5.3 已完成：`S` 复用池页执行 100 轮 fork/wait，首末 PID 均为 5，两轮 `PHYS 6/255`、`proc/AS/KSTK 1/12`；clean `kernel.bin=64,808`，余量 728B。
- P6.0 已完成细节收口：`process_wait()` 对 `pid>0` 先校验直接子进程，非子进程或不存在立即返回 -1；`pid<=0` 等任意直接子进程。`proc_orphan_children()` 同时处理 LIVE 和 ZOMBIE 直接子进程，并记录最近一次 `from/to/children[]` 事件；V 页 TREE 增加 `ORPHAN` 两行，G 页 reparent 面板允许显示 4 个子进程并在超过 4 个时显示 `+N more`。clean `kernel.bin=64,488`，余量 1,048B。当前速度基线见 `PERFORMANCE.md`。

## 十二、P3.1/P3.2/P4.1/P4.2/P4.3/P4.4/P5.1/P5.2/P5.3/P6.0 边界与已知取舍

- `wait` 仍是 `task_yield()` 轮询，不是阻塞睡眠；P6.0 只修了参数语义：`pid>0` 必须先是当前进程的直接子进程，否则立即返回 -1；`pid<=0` 等任意直接子进程。P4.4 X 页为了保持交互帧率，父进程关闭 0/1 后不进入 `wait`，子进程完成后由页面 `out 14` / `EXIT 14` 判定。
- `proc_orphan_children()` 现在把 LIVE 和 ZOMBIE 的直接子进程都改成 `ppid=0`，并写一份全局最近事件；ZOMBIE 子进程仍由 `process_reap_orphans()` 回收。事件只是 V 页只读快照，不改变调度或回收顺序。
- G 页 reparent 面板从“最多 3 个子进程”改为 4 个；`child_count > 4` 时在第 13 行显示 `+N more`，`children` 计数仍显示总数，列表只放前 4 个。
- V 页 TREE 的 `ORPHAN` 行占第 20/21 行，树节点上限从第 21 行收到第 19 行；第 22 行仍是 TREE 统计，第 23/24 行仍是公共底栏。当前用户 demo 没有“父进程先退出、子进程继续存活”的 lane，所以 TREE 页默认显示 `ORPHAN none yet`；事件路径已由 `process_terminate_current()` / `process_exit_current()` 的真实退出路径调用，不是渲染层伪造。
- 当前速度基线（QEMU TCG，非实时）：100 Hz PIT 是硬控制节拍上限；CPU 页 4.14 秒窗口内 `SWITCHES +129,890`（约 31.4k/s）、`PREEMPTIONS +384`（约 92.8/s），control/render/idle 仍是 50/38/12；监视器建立后 69 ms 的首帧采样已有完整机械臂画面。详见 `PERFORMANCE.md`。
- P5.2 的 `V` 页固定 4 页，原第 5 页 `DEMO` 因 `kernel.bin` 达到 68,744B、超过 65,536B 上限被删除，旧证据压缩进 `ADDRESS` 页。P5.3 clean 构建为 64,808B、余量 728B；`--gc-sections` 已回收不可达代码，但新增页面或长文案前仍必须先算体积。
- `V` 页的页面状态是单个静态实例（`page_mode/page_slot/page_first`），四页共享同一个选中槽；`process_slot_space()` / `process_slot_fd_info()` 是只读快照，没有 seqlock，单核下仍可能在 PIT 切换窗口看到半更新字段，已知取舍是“可观察面优先、不做事务化快照”。
- `PgDn` 把选中槽带到槽 10/11 后，空槽详情只显示 `EMPTY` 和池统计；要回到有内容槽需 `Up` 或 `Home`，这是当前交互语义，不是滚动丢失。
- P5.3 没有新增持久对象、页面或第二套计数；只复用 P5.1 池页与用户数据槽，压测状态由 ring3 写、页面只读。`S` 与 `Y` 共用同一池页外壳，二者互斥，不能同时运行。

- P3.2 已有用户 handler、signal frame 和 `sigreturn`；P4.1 已有内嵌 flat 镜像 `exec`、PID/任务槽保留、AS 替换和信号重置；P4.2 已有 `argv/envp` 解析、字符串迁移、SysV 初始栈和 `exec_argc/exec_envc` 元数据；P4.3 已有每进程 fd 表、匿名 pipe、`pipe/read/write/close` 和 exec 后 fd 保留；P4.4 已有全局 console fd 0/1、fork 继承、close 边界和 VGA/COM1 双写。仍没有 ELF loader、文件系统/路径 `open`、console 会话/前台焦点、`kill()`、信号排队、真正阻塞的 mask、`SA_SIGINFO`/`SA_RESTART` 等 POSIX 语义。
- `sig_mask` 只随 frame 保存/恢复，不阻止信号投递；handler 执行期间同一信号仍可能再次进入。
- `#DE` 解码只覆盖 `F6/F7` 的 `div/idiv` group，且只处理可读的用户代码字节；其他同步异常把原 EIP 存入 frame，handler 若直接 `ret` 会回到 faulting 指令，需要自行修改 frame 的 `eip`。
- `SIG_IGN` 只对可安全前移的 `#DE` 和保存 EIP 已指向下一条的 `#BP` 生效；`#UD/#GP` 的忽略会退回默认终止，避免死循环。
- `#PF` 仍由 `page_fault.c` 独占，`exception.c` 不安装 14 号门；两者只在“用户不可恢复故障最终按 SIGSEGV 终止”这一语义上对齐。
- COW 拆分后如果旧页引用已降到 1，当前实现仍会复制一次；这是为了保持“拆分函数只做复制”的最小语义，后续可按引用计数改成原地恢复 RW。
- 第二次 fork 的 COW 继承修复只保证已有 COW 页不退化；没有改变 code 页只读共享、data/stack/heap/control 走 COW 的边界。
- `fork` 的 code 页只读共享，不参与 COW；data/stack/heap 和 control 走 COW。
- A/B/C/D/F 由 render 内核任务通过 `process_create_user()` 创建；E1/E2/E3/E4 是用户父进程 `fork` 创建的进程。
- `family.c` 只维护内核任务树，用户进程树由 `process.c` 维护；`G` 页和 `V` 页是两套树。
- `exec` 只接受内嵌镜像 1/2，不读盘、不解析 ELF；`argv/envp` 最多 4 项、每串最多 31 字符，必须有 NULL 结尾。fd 表只接匿名 pipe，pipe 池固定 4 个对象、每对象 64 字节且非阻塞；没有文件系统、路径 `open` 或 console fd 0/1。用户堆已有 brk 和按需零填，但不是完整 `mmap`。
- exec 的参数解析、新 AS 分配或新栈构造失败时返回 -1，旧 AS、旧帧和 `image_id` 都不动；成功后旧 AS 已释放，不再保留旧页。`exec` 不改变 PID/PPID/父进程 notify 关系。
- 非探针内核 trap 仍是终止性诊断；用户态 `#PF` 与 `#DE/#UD/#GP` 已分发，但 CPL0 的 `#DE/#UD/#GP` 没有 fixup，直接停机。
- VGA BIOS 影子 ROM 位于 `0xC0000..0xFFFFF`，物理池必须避开；当前池选在 `0x100000..0x1FEFFF`，不与内核、VGA、任务栈重叠。

P3.1 的目标是让“同步异常 -> 致命信号 -> ZOMBIE 墓碑 -> 父进程 wait status + SIGCHLD”这条默认动作链路先成立；P3.2 的目标是让用户 handler 接管同步异常并在 `sigreturn` 后继续原指令；P4.1 的目标是在不换 PID/任务槽的前提下，把当前进程从 ring3 镜像切到 exec 镜像并释放旧 AS；P4.2 进一步让 `argv/envp` 跨过 exec 并落在新用户栈；P4.3 在不引入文件系统的前提下，让 fd 表随 fork 复制、随 exec 保留、随 exit 关闭，并用匿名 pipe 验证父子进程数据通路。五条链路当前都已成立并有 QEMU 证据。

# 进程上下文完整化路线

本文只讨论 ring3 用户进程，不把 `control/render/idle` 这三个内核任务当成完整进程。

P1 建立用户进程 PCB、PID、父子关系、退出码和 `fork/exit/wait/reap` 闭环。P2.1 把地址空间推进到“255 页物理池 + 6 个 VMA + brk + guard + copyin/copyout”。P2.2 完成 COW fork 与物理页引用计数。P3.1 完成用户同步异常的默认终止、信号 pending/SIGCHLD、wait status 编码和 V 页信号视图；用户态 handler、signal frame、`sigreturn` 仍不在本阶段。

## 一、P3.1 现在的实现

| 能力 | 当前实现 | 位置 |
| --- | --- | --- |
| 用户同步异常 | `#DE/#BP/#UD/#GP` 由 `exception.c` 唯一分发；`#PF` 仍由 `page_fault.c` 独占 | `arch/x86/cpu/exception/exception.c` |
| 异常入口 | `exception_de/bp/ud/gp_stub` 统一压出与 `struct irq_frame` 对齐的帧；`#DE/#BP/#UD` 补 `err=0`，`#GP` 使用 CPU 压入的 error code | `loader.asm` |
| 异常映射 | `#DE -> SIGFPE(8)`、`#BP -> SIGTRAP(5)`、`#UD -> SIGILL(4)`、`#GP -> SIGSEGV(11)` | `exception.c` |
| 默认动作 | CPL3 异常记录现场后 `process_terminate_current(sig)`，再 `task_exit()`；CPL0 非 #PF 异常进入诊断停机 | `exception_dispatch()` |
| 信号常量 | `SIGILL 4 / SIGTRAP 5 / SIGFPE 8 / SIGSEGV 11 / SIGCHLD 17` | `include/kernel/proc.h` |
| wait status | 正常退出保留原退出码（`exit(7) -> 7`）；信号终止为 `0x80000000` 按位或 `sig`（`#DE -> 0x80000008`） | `PROC_WAIT_STATUS()` |
| PCB 信号字段 | `pending/last_sig/term_sig/sig_count/sigchld_count`；`process_info` 同步暴露 | `kernel/proc/process.c` |
| pending 位图 | `pending |= 1u << (sig - 1)`；只记录 1..31 号信号，不在这里改进程状态 | `proc_signal_pending()` |
| SIGCHLD | 子进程正常退出或被信号终止都 `proc_notify_parent()`；父进程 LIVE 时置 SIGCHLD pending | `proc_notify_parent()` |
| wait 消费 | `process_wait()` 回收 ZOMBIE 后清父进程 SIGCHLD pending；`process_reap()` 保留 `term_sig` 墓碑供 V 页读取 | `process_wait()` / `process_reap()` |
| 用户态 #PF | 不可恢复的 guard/RO/非法 #PF 改走 `process_terminate_current(SIGSEGV)`；C/F 显示 `SIG11` 而不是 `EXIT 142` | `page_fault.c` |
| PID 复用 | `process_fork()` 优先复用刚退出的直接子 PID，保留另一条 lane 的墓碑；V 页按 `comm` 判 FAULT/GUARD，不按旧 PID 猜 | `proc_reusable_child_pid()`、`task_pid_reserve_hint()` |
| 调度记账 | `int 0x40` 的 `SCHED_YIELD` 也按 `WEIGHT_QUANTUM / weight` 记 vruntime，避免 `wait` 轮询饿死其他任务 | `task_schedule_irq()` |
| V 页 | 标题 `AEVUM / COW FORK + SIGNALS + PHYS`；PCB 表 `EXIT` 显示 `SIG11/SIG8`，新增 #DE、SIGCHLD、D 第二轮 fork/wait 面板 | `app/user/render/render.c` |

槽位预算：`TASK_MAX=10`（3 内核 + 6 用户 + 1 余量）、`PROC_MAX=8`、`AEVUM_AS_MAX=6`、`PID_MAX=31`。
用户内核栈顶 A `0x201000`、B `0x202000`、C `0x203000`、D `0x204000`、E `0x205000`、F `0x206000`。
物理池仍为 `0x100000..0x1FEFFF` 的 255 页位图池。

### 异常与信号的状态机

1. 用户指令触发 `#DE/#BP/#UD/#GP`：CPU 压 error code（`#DE/#BP/#UD` 没有，由 stub 补 0），`exception_dispatch()` 记录 `vector/eip/err/cr2/comm`。
2. 默认动作：`process_terminate_current(sig)` 把当前进程置 ZOMBIE，`exit_code = PROC_WAIT_STATUS(sig)`，`term_sig = sig`，自身 pending 置位，父进程置 SIGCHLD；随后 `task_exit()`。
3. 父进程 `wait`：找到 ZOMBIE 后把 `exit_code` copyout 到用户 status，回收任务/AS/PID/栈，清父进程 SIGCHLD pending。
4. 墓碑：`process_reap()` 不把 `pid/comm/term_sig/exit_code/pending` 等显示字段清零，V 页因此能继续显示已回收进程的信号死因。
5. 不执行用户 handler：P3.1 只有默认终止，不构造 signal frame，也不实现 `sigreturn`。

## 二、P3.1 验收记录

QEMU 实测（本构建 `kernel.bin` 42,920 字节，BSS 结束 `0x8C1E0`，96 扇区 / 49,152 字节窗口）：

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
- `K` 页：独立启动后直接按 `K`，显示 `fault count 1`、`EIP 000837C1`、`CR2 00400000`、`ERR 00000002`、`CR3 00010000`、`kernel image 0x00080000..0x0008C300`；按 `R` 回主画面，机械臂继续更新。
- 若先跑完整 V 再按 `K`，K 页显示 `fault count 6`：V 页自身记录 3 次，V 停止路径额外产生 2 次用户 `#PF`（尚未逐条归因），再加 K 探针 1 次。K 页的 count 是累计值，不是单次 probe 次数。

## 三、后续阶段

### P3.2：用户 handler 与 signal frame

- `sigaction` 最小表：每进程每信号一个 handler 地址、mask、默认动作。
- 在用户栈上构造 signal frame，保存原 `eip/cs/eflags/esp/ss` 和通用寄存器，`iret` 进 handler。
- `sigreturn` 恢复原帧；handler 返回后继续原指令。
- 验收：`#DE` 被用户 handler 捕获后进程存活，`sigreturn` 回到除零后的下一条指令。

### P4：exec 与每进程资源

- `exec` 用内嵌用户镜像或最小 ELF loader 替换当前 AS；保留 PID，重置用户栈和入口。
- `argv/env` 复制到用户栈；`exit` 关闭 fd。
- 每进程 fd 表 + console read/write + pipe；`pipe` 连接父子进程。
- 验收：`exec` 后 `/proc` 页 PID 不变、镜像变化；pipe 两端可读写；`wait` 仍能回收。

### P5：规模与可观测性

- 动态内核栈、任务/AS 槽池、8+ 并发进程。
- `V` 页分页/滚动，进程树、ZOMBIE、waiters、VMA、信号、fd 全部可观察。
- 压测：反复 fork/wait 100 轮，无 PID/页/栈泄漏。

## 四、P3.1 边界与已知取舍

- `wait` 仍是 `task_yield()` 轮询，不是阻塞睡眠；本轮给 yield 补了 vruntime 记账，避免父进程轮询时把其他 lane 饿死。
- 同步异常只做默认终止；没有用户 handler、没有 signal frame、没有 `sigreturn`，也没有 `kill()` 系统调用。
- `pending` 目前是“记录 + wait 消费 SIGCHLD”的位图，不是完整的信号排队/屏蔽/合并模型。
- `#PF` 仍由 `page_fault.c` 独占，`exception.c` 不安装 14 号门；两者只在“用户不可恢复故障最终按 SIGSEGV 终止”这一语义上对齐。
- COW 拆分后如果旧页引用已降到 1，当前实现仍会复制一次；这是为了保持“拆分函数只做复制”的最小语义，后续可按引用计数改成原地恢复 RW。
- `fork` 的 code 页只读共享，不参与 COW；data/stack/heap 和 control 走 COW。
- A/B/C/D/F 由 render 内核任务通过 `process_create_user()` 创建；E1/E2 是用户父进程 `fork` 创建的进程。
- `family.c` 只维护内核任务树，用户进程树由 `process.c` 维护；`G` 页和 `V` 页是两套树。
- 没有 `exec`、fd/pipe、argv/env；用户堆已有 brk 和按需零填，但不是完整 `mmap`。
- 非探针内核 trap 仍是终止性诊断；用户态 `#PF` 与 `#DE/#UD/#GP` 已分发，但 CPL0 的 `#DE/#UD/#GP` 没有 fixup，直接停机。
- VGA BIOS 影子 ROM 位于 `0xC0000..0xFFFFF`，物理池必须避开；当前池选在 `0x100000..0x1FEFFF`，不与内核、VGA、任务栈重叠。

P3.1 的目标不是“完整 POSIX 信号”，而是让“同步异常 -> 致命信号 -> ZOMBIE 墓碑 -> 父进程 wait status + SIGCHLD”这条默认动作链路先成立；当前链路已成立并有 QEMU 证据。

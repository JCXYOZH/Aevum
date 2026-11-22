# 进程上下文完整化路线

本文只讨论 ring3 用户进程，不把 `control/render/idle` 这三个内核任务当成完整进程。
P1 已完成并通过 QEMU 验收：用户进程现在有 PCB、PID、父子关系、退出码、`fork/exit/wait/reap` 闭环，`V` 页直接显示进程表。

## 一、P1 现在的实现

| 能力 | 当前实现 | 位置 |
| --- | --- | --- |
| 用户态执行 | A/B/C/D/E 五个 lane，`CPL3`，`int 0x80` | `app/user/demo/demo.c` |
| 地址空间 | 每个进程独立 PD/PT/CR3，固定 4 个用户页；6 个 AS 槽 | `kernel/mm/address_space/address_space.c` |
| 用户虚拟布局 | code `0x400000`、data `0x401000`、stack `0x402000`、control `0x403000` | `config/memory.h` |
| PCB | `struct process`：`pid/ppid/state/exit_code/comm/stack_top/space/task` | `kernel/proc/process.c` |
| 进程状态 | `PROC_FREE / PROC_LIVE / PROC_ZOMBIE / PROC_DEAD` | `include/kernel/proc.h` |
| PID | 进程先 `task_pid_reserve()` 保留，再 `task_create_user_with_pid()` 使用同一 PID | `kernel/task/task.c` |
| 父子关系 | `process_exit_current()` 把直接子进程的 `ppid` 改成 0，交给 orphan reaper | `kernel/proc/process.c` |
| fork | 复制父进程 4 个用户页、PD/PT、ring3 中断帧和 FPU；子 `eax=0`，父拿到子 PID | `process_fork()` / `task_fork_user()` |
| 退出码 | `eax=3 exit(ebx=code)`；`#PF` 用户路径写 `128+14=142` | `arch/x86/cpu/syscall/syscall.c`、`page_fault.c` |
| wait/reap | `eax=4 wait(ebx=pid, ecx=&status)`；找到 ZOMBIE 后写 status、回收任务槽/AS/PID/栈 | `process_wait()` / `process_reap()` |
| 调度回收 | 调度器只自动回收无 `proc` 的内核任务；用户 ZOMBIE 由 wait 或 orphan reaper 回收 | `task_reap()`、`process_reap_orphans()` |
| V 页 | PCB 表 `PID PPID ST EXIT CR3 AS CNT COMM`、fork/wait 摘要、#PF 面板 | `app/user/render/render.c` |
| 重复启动 | `process_cleanup()` 回收上一轮 ZOMBIE、清 DEAD 墓碑 | `kernel/proc/process.c` |

槽位预算：`TASK_MAX=10`（3 内核 + 6 用户 + 1 余量）、`PROC_MAX=8`、`AEVUM_AS_MAX=6`、`PID_MAX=31`。
用户内核栈顶 A `0x201000`、B `0x202000`、C `0x203000`、D `0x204000`、E `0x205000`、F `0x206000`。
AS 区从 `0x40000` 起、步长 `0x6000`，A-E 分别是 `0x40000 / 0x46000 / 0x4C000 / 0x52000 / 0x58000`。

## 二、P1 验收记录

QEMU 实测（本构建 `kernel.bin` 34,504 字节，BSS `0x886E0..0x89A34`）：

- `V` 页 PCB 表出现 5 行：`userA` PID 4 / CR3 `0x40000`，`userB` PID 5 / `0x46000`，`userC` PID 6 / `0x4C000` / `FAULT` / `EXIT 142`，`userD` PID 7 / `0x52000`，`userE` PID 8 / `0x58000` / `PPID 7` / `REAP` / `EXIT 7`。
- `userD fork 8`，`userE` 的 PPID 为 7；E `exit(7)` 后 D `wait` 返回 8、status 7，页面显示 `WAIT OK 7: child exit code crossed the syscall ABI`。
- `userA/userB` 的计数器在 `V` 页持续增长；C 的 `#PF pid 6 eip 00400029 cr2 000B8000 err 00000007`、`P=1 W=1 U=1` 只杀死 C。
- `int 0x80 traps` 约 30 万次，`last CS 0000001B`。
- 再按 `V` 停止后回机械臂，任务计数回到 `TASK SCHED P3/31`；再按 `V` 重新出现 A-E，AS 槽从 6 起，PID 仍复用 4-8，没有 ZOMBIE/PID 泄漏。
- 先跑 V 后按 `K`，panic 页显示 `fault count 2 / recoveries 0`（C 的用户态 #PF 已计一次）；按 `R` 回主画面，再按 `K` 为 `fault count 3 / recoveries 1`，kernel image 范围 `0x80000..0x89A34`。

## 三、后续阶段

### P2：地址空间管理与按需分页

- 新增物理页分配器（位图），支持 `alloc/free`，不再只靠固定 AS 槽。
- `struct vm_area`：code RO、data RW、guard、stack RW、heap RW；`address_space_map/unmap/protect` 成为唯一 PTE 写入口。
- 用户布局改为：code `0x400000`、data `0x401000`、guard `0x402000`、stack `0x403000`（栈顶 `0x404000`）、control `0x404000`；栈向下溢出先撞 guard。
- `brk` 增长用户堆；缺页时按 VMA 零填页；`fork` 改 COW，页引用计数 + 写保护。
- 系统调用统一 `copyin/copyout`，校验用户指针落在 present+user 的 VMA 内。
- 验收：子进程写 COW 页后父进程不变；guard 触发只 kill 当前进程；`brk` 后堆可读写；V 页显示 VMA 与 COW 计数。

### P3：用户异常与信号

- IDT 增加 `#DE/#UD/#GP/#BP` 的用户态分发；记录 vector、EIP、ERR、CR2。
- `process_signal(pid, sig)`、`pending` 位图、默认动作（terminate/ignore）、`SIGCHLD`。
- `wait` status 编码 `normal exit code` 与 `signal number`。
- 可选用户 handler：构造 signal frame、`sigreturn`，先只做默认 terminate。
- 验收：`userC` 除零触发 `#DE`，只死 C；父进程 wait 得到 signal status；V 页显示 `SIG#`。

### P4：exec 与每进程资源

- `exec` 用内嵌用户镜像或最小 ELF loader 替换当前 AS；保留 PID，重置用户栈和入口。
- `argv/env` 复制到用户栈；`exit` 关闭 fd。
- 每进程 fd 表 + console read/write + pipe；`pipe` 连接父子进程。
- 验收：`exec` 后 `/proc` 页 PID 不变、镜像变化；pipe 两端可读写；`wait` 仍能回收。

### P5：规模与可观测性

- 动态内核栈、任务/AS 槽池、8+ 并发进程。
- `V` 页分页/滚动，进程树、ZOMBIE、waiters、VMA、信号、fd 全部可观察。
- 压测：反复 fork/wait 100 轮，无 PID/页/栈泄漏。

## 五、P1 边界与已知取舍

- `wait` 用 `task_yield()` 轮询，不是阻塞睡眠；父进程在子进程退出前会持续让出 CPU。P2 可加 wait queue。
- `fork` 是 eager copy 4 个用户页，不是 COW；子进程写自己的数据页不会影响父进程，但物理页已经复制。
- A/B/C/D 仍由 render 内核任务通过 `process_create_user()` 创建；E 是第一个由用户父进程 `fork` 创建的进程。P1 证明的是进程生命周期契约，不是完整 POSIX 会话。
- `family.c` 只维护内核任务树，用户进程树由 `process.c` 维护；`G` 页和 `V` 页是两套树。这是为了不在 P1 引入第二份 pid/ppid 真相。
- 没有 `exec`、信号、fd/pipe、argv/env、COW、按需分页和用户堆；这些按 P2-P5 推进。
- 非探针内核 fault 仍是终止性诊断；用户态只分发 `#PF`，没有 `#DE/#UD/#GP`。

P1 的目标不是“完整 POSIX”，而是让进程身份、父子关系、退出码、回收责任这四条契约先成立；当前四条都已成立并有可观察证据。

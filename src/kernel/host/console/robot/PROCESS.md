# 进程上下文完整化路线

本文只讨论 ring3 用户进程，不把 `control/render/idle` 这三个内核任务当成完整进程。

P1 建立用户进程 PCB、PID、父子关系、退出码和 `fork/exit/wait/reap` 闭环。P2.1 把地址空间推进到“255 页物理池 + 6 个 VMA + brk + guard + copyin/copyout”。P2.2 已完成并通过 QEMU 验收：`fork` 不再复制用户页，父子共享 PTE，首次写由 COW 拆成私有页；物理页有引用计数，最后一页才归还池。`V` 页直接显示 PCB、VMA、COW 统计和物理池用量。

## 一、P2.2 现在的实现

| 能力 | 当前实现 | 位置 |
| --- | --- | --- |
| 用户态执行 | A/B/C/D/F 五个 lane，`CPL3`，`int 0x80`；D fork 出 E | `app/user/demo/demo.c` |
| 地址空间 | 每个进程独立 PD/PT/CR3；PD/PT/code/data/stack/control 从物理池分配；6 个 AS 槽 | `kernel/mm/address_space/address_space.c` |
| 物理页池 | `0x100000..0x1FEFFF` 共 255 页，位图 + 每页 `u16` 引用计数；`phys_alloc/share/put` 是唯一入口 | `config/memory.h`、`address_space.c` |
| 用户虚拟布局 | code `0x400000`、data `0x401000`、guard `0x402000`、stack `0x403000`（栈顶 `0x404000`）、control `0x404000`、heap `0x405000..0x410000` | `config/memory.h` |
| VMA | 6 个：code RX、data RW、guard 无权限、stack RW、control R、heap RW；`address_space_vma_snapshot()` 只读 | `address_space.c` |
| guard | `0x402000` 有 VMA、无 PTE；写它触发 `#PF`，只杀死当前进程 | `vma_init()`、`page_fault.c` |
| brk | `eax=8 brk(ebx)`；增长零填新页并把 heap VMA end 推到新 brk；缩回按引用计数释放；越界返回 -1 | `address_space_set_brk()` |
| copyin/copyout | `eax=9 peek(ebx)` / `eax=10 poke(ebx,ecx)`；逐字节翻译用户 VA，VMA 权限 + PTE present/user/RW/COW 校验；写 COW 页先拆分 | `address_space_copyin/copyout` |
| COW fork | `address_space_clone()` 只分配新 PD/PT；data/stack/heap 和内核可写的 control 页清 RW、置 PTE bit 9 后共享；code 只读共享；`phys_ref++` | `address_space_clone()` |
| COW 拆分 | `cow_break_page()` 分配新页、复制旧内容、按 VMA 恢复 RW、`phys_put_page(old)`、清 COW 位；记录 `last AS/old/new` | `address_space.c` |
| 用户缺页 | heap 内、brk 以下、PTE 未 present 的页零填后重试；present + write + COW 页复制后重试；guard/RO/非法返回 0 | `address_space_handle_user_fault()` |
| COW 统计 | `address_space_cow_snapshot()` 返回 `live/breaks/forks/shared/last_asid/last_old/last_new` | `include/kernel/mm/address_space.h` |
| control 页 | 用户只读；内核 `set_stop` 先检查 PTE 的 COW 位并拆出私有页，再写停止字，避免改到子进程 | `address_space_set_stop()` |
| PCB | `struct process`：`pid/ppid/state/exit_code/comm/stack_top/space/task`；`process_info` 增加 `cow_pages` | `kernel/proc/process.c` |
| 进程状态 | `PROC_FREE / PROC_LIVE / PROC_ZOMBIE / PROC_DEAD` | `include/kernel/proc.h` |
| PID | 进程先 `task_pid_reserve()`，再 `task_create_user_with_pid()` 使用同一 PID | `kernel/task/task.c` |
| 父子关系 | `process_exit_current()` 把直接子进程的 `ppid` 改成 0，交给 orphan reaper | `kernel/proc/process.c` |
| fork 帧 | `task_fork_user()` 复制父进程的 ring3 中断帧、通用寄存器、用户栈和 FPU；子 `eax=0`，父拿到子 PID | `task_fork_user()` / `process_fork()` |
| 退出码 | `eax=3 exit(ebx=code)`；`#PF` 用户路径写 `128+14=142` | `syscall.c`、`page_fault.c` |
| wait/reap | `eax=4 wait(ebx=pid, ecx=&status)`；`copyout` 写 status；回收任务槽/AS/PID/栈 | `process_wait()` / `process_reap()` |
| 调度回收 | 调度器只自动回收无 `proc` 的内核任务；用户 ZOMBIE 由 wait 或 orphan reaper 回收 | `task_reap()`、`process_reap_orphans()` |
| V 页 | `PID PPID ST EXIT CR3 AS PGS/C BRK COMM`、VMA 摘要、heap/guard 结果、COW 行、fork/wait、`PHYS PAGES`、#PF | `app/user/render/render.c` |
| 重复启动 | `process_cleanup()` 回收上一轮 ZOMBIE、清 DEAD 墓碑 | `kernel/proc/process.c` |

槽位预算：`TASK_MAX=10`（3 内核 + 6 用户 + 1 余量）、`PROC_MAX=8`、`AEVUM_AS_MAX=6`、`PID_MAX=31`。
用户内核栈顶 A `0x201000`、B `0x202000`、C `0x203000`、D `0x204000`、E `0x205000`、F `0x206000`。
物理池 A 首个 PD 从 `0x100000` 起；CR3 不再是固定的 `0x40000` 段。

### COW 页的状态机

1. fork：`address_space_clone()` 把父 PTE 的 `RW` 清掉、置 `PAGE_COW`；子 PTE 指向同一物理页，`phys_ref` 加一。
2. 子/父首次写：CPU 以 `P=1 W=1 U=1` 触发 `#PF`；`page_fault.c` 调 `address_space_handle_user_fault()`。
3. 拆分：`cow_break_page()` 分配新页、复制内容、按 VMA 恢复权限、旧页减引用；返回原帧重试。
4. 内核写：`copyout` 走同一拆分函数；`control` 页在 `set_stop` 里先拆分，再写停止字。
5. 释放：`address_space_release()` 与 `brk` 缩回只减引用，引用归零才清位图。

## 二、P2.2 验收记录

QEMU 实测（本构建 `kernel.bin` 40,328 字节，BSS `0x89DA0..0x8B640`，80 扇区 / 40,960 字节窗口）：

- `V` 页 PCB 表出现 6 行：`userA` PID 4 / CR3 `0x00100000` / AS 1 / PGS 5 / C 0 / BRK `0x00406000`；`userB` PID 5 / CR3 `0x00103000` / AS 2；`userC` PID 6 / FAULT / EXIT 142；`userD` PID 7 / CR3 `0x00112000` / AS 4 / PGS 4 / C 2；`userF` PID 8 / GUARD / EXIT 142；`userE` PID 9 / PPID 7 / REAP / EXIT 7。
- VMA 摘要：`userA VMA 6`；code RX `0x400000`、data RW `0x401000`、guard `0x402000`、stack RW `0x403000`、control R `0x404000`、heap RW `0x405000`，`brk 0x406000`。
- A/B 的 heap 验收：`brk 0x406000`、`heap poke 1`、`peek 0x48454C50`、`guard poke 0`；越界 `brk(0x500000)` 返回 `0xFFFFFFFF`。
- COW 行：`forks 1 shared 4 live 2 breaks 2 last AS4 old 00115000 -> 00118000`。D fork 时 4 个用户页共享，未复制；子写 `CHLD` 到 `0x401038` 触发一次拆分，父 wait 的 status 写回再触发一次；D 仍保留 stack/control 两个 COW 页。
- `userD fork 9`，`userE` 的 PPID 为 7；E `exit(7)` 后 D `wait` 返回 9、status 7，页面显示 `WAIT OK 7`，E 行变 `REAP`。
- COW 隔离：fork 前父把 `PAPA` 写到 `0x401038`，子写 `CHLD` 后退出，父 wait 后读回 `PAPA` 并把 `COW` 写到 `0x401040`，页面显示 `COW OK`。
- `#PF count 3`：COW 子页首次写一条，C 写 `0xB8000` 的 `cr2 000B8000 / err 7` 一条，F 写 guard `0x402000` 一条；C 行 `FAULT`、F 行 `GUARD`，两者 `EXIT=142`，A/B 计数器继续增长。
- `PHYS PAGES used/total` 为 `20/255`：fork 没有新增 4 个用户页，C/F 退出释放页，E 被 D wait 回收，A/B/D 的 live 页为 20；`int 0x80 traps` 408,270 次，`last CS 0000001B`。
- 再按 `V` 停止后回机械臂，机械臂 q 值正常；再按 `V` 重新出现 A/B/C/D/F，ASID 从 7 起、PID 仍复用 4-9，`PHYS PAGES` 仍为 `20/255`，COW 统计累计为 `forks 2 shared 8 live 2 breaks 5`，没有 ZOMBIE/PID/页泄漏。
- 先跑 V 后按 `K`，panic 页显示 `fault count 4 / recoveries 0`（COW 子页写 + C/F 的用户态 #PF 已计三次），`EIP 000835FD`，`kernel image 0x00080000..0x0008B700`；按 `R` 回主画面，机械臂继续更新。

## 三、后续阶段

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

## 四、P2.2 边界与已知取舍

- `wait` 仍用 `task_yield()` 轮询，不是阻塞睡眠；父进程在子进程退出前会持续让出 CPU。
- COW 拆分后如果旧页引用已降到 1，当前实现仍会复制一次；这是为了保持“拆分函数只做复制”的最小语义，后续可按引用计数改成原地恢复 RW。
- `fork` 的 code 页只读共享，不参与 COW；data/stack/heap 和 control 走 COW。
- A/B/C/D/F 由 render 内核任务通过 `process_create_user()` 创建；E 是用户父进程 `fork` 创建的进程。
- `family.c` 只维护内核任务树，用户进程树由 `process.c` 维护；`G` 页和 `V` 页是两套树。
- 没有 `exec`、信号、fd/pipe、argv/env；用户堆已有 brk 和按需零填，但不是完整 `mmap`。
- 非探针内核 fault 仍是终止性诊断；用户态只分发 `#PF`，没有 `#DE/#UD/#GP`。
- VGA BIOS 影子 ROM 位于 `0xC0000..0xFFFFF`，物理池必须避开；当前池选在 `0x100000..0x1FEFFF`，不与内核、VGA、任务栈重叠。

P2.2 的目标不是“完整 POSIX”，而是让 COW fork 的共享、拆分、引用计数、control 页写保护和可观测统计先成立；当前四条都已成立并有 QEMU 证据。

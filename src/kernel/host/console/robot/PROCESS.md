# 进程上下文完整化路线

本文只讨论 ring3 用户进程，不把 `control/render/idle` 这三个内核任务当成完整进程。
当前 `V` 页是“最小 ring3 地址空间演示”，还不是可 fork、可 wait、可 exec 的进程模型。

## 一、现在到底有什么

| 能力 | 当前实现 | 位置 |
| --- | --- | --- |
| 用户态执行 | 固定 3 个 lane：`userA/userB/userC`，`CPL3`，`int 0x80` | `app/user/demo/demo.c` |
| 地址空间 | 每个 lane 独立 PD/PT/CR3，固定 4 个用户页 | `kernel/mm/address_space/address_space.c` |
| 用户虚拟布局 | code `0x400000`、data `0x401000`、stack `0x402000`、control `0x403000` | `config/memory.h` |
| 任务创建 | 由 render 内核任务调用 `task_create_user()`，不是用户父进程 fork | `kernel/task/task.c` |
| 调度上下文 | `ctx.esp` 指向同构中断帧；`fxsave/fxrstor` 保存 FPU/SSE | `kernel/task/task.c` |
| 地址空间切换 | 调度时写 CR3，`tss_set_esp0(next->stack_top)` | `task_schedule_irq()` |
| 系统调用 | `eax=2` yield、`eax=3` exit；exit 无退出码 | `arch/x86/cpu/syscall/syscall.c` |
| 用户故障 | 只处理 `#PF`，只 kill 当前任务；无 `#GP/#UD/#DE` 分发 | `page_fault.c` |
| 父子关系 | `family.c` 维护独立 pid/ppid 表；退出即移除，供树页观察 | `kernel/task/family/family.c` |
| 资源 | 无 fd 表、无 pipe、无 argv/env、无 per-process 文件表 | — |
| 回收 | 调度器每次直接 `task_reap()` 所有 ZOMBIE，没有 wait | `task_schedule_irq()` |

硬限制：`TASK_MAX=6`，`AEVUM_AS_MAX=3`，用户内核栈固定 `0x201000/0x202000/0x203000`。
`control/render/idle + A/B/C` 已占满 6 个任务槽，`V` 运行期间不能再创建 probe/tree/duel。

## 二、缺口的本质

现在有“任务切换 + 独立页表”，但没有“进程”这个对象：

- PID 属于任务槽，不属于进程；任务槽一回收，PID 和地址空间一起消失。
- 父子关系在 `family.c`，任务生命周期在 `task.c`，地址空间在 `address_space.c`，三份状态没有单一 owner。
- `exit` 不保留退出码，ZOMBIE 立即被调度器回收，父进程没有机会 `wait`。
- 用户进程不是从用户父进程 fork 出来，`fork/exec/wait/reap` 的语义都不存在。
- 地址空间是固定 4 页，没有页分配器、VMA、guard page、按需分页、COW、用户堆。
- 只有 `#PF` kill；没有信号、没有 `SIGCHLD`、没有 wait status。
- 系统调用只认固定地址，没有用户指针校验、`copyin/copyout`、errno 约定。

## 三、目标所有权

```
process (kernel/proc)
  pid, ppid, state, exit_code, wait_status
  address_space *
  task_struct *          // 调度载体，不反向拥有 pid
  parent / children
        │
        ├── address_space (kernel/mm)   // PD/PT/VMA/物理页唯一 owner
        └── task_struct (kernel/task)    // 栈、FPU、ctx、调度唯一 owner
```

约束：

1. `process` 是 PID、父子关系、退出状态的唯一写者；`task_struct` 只保留调度字段和对 `process` 的引用。
2. `address_space` 继续是页表和物理页的唯一 owner；`process` 只持有指针，不直接改 PTE。
3. `family.c` 不再维护第二份 pid/ppid。P1 把它降为 `process` 表的只读投影，树页直接读 `process_snapshot()`；否则父子关系会出现两个真相。
4. `task_reap()` 只自动回收内核任务；用户 ZOMBIE 必须由父进程 `wait` 或 reaper 回收。

## 四、分阶段实施

### P1：PCB + fork/exit/wait 闭环（下一步）

目标：让用户进程真正“生、退、等、收”，并在 `V` 页看见状态变化。

实施项：

1. 新增 `include/kernel/proc.h`、`kernel/proc/process.c`。
   - `struct process`：`pid/ppid/state/exit_code/space/task/parent/children[]/waiters`。
   - 状态：`PROC_EMBRYO / PROC_RUNNING / PROC_ZOMBIE / PROC_DEAD`。
   - `process_create_user()` 取代 demo 直接拼 `address_space_create_user()+task_create_user()`。
   - `process_exit(code)` 只标 ZOMBIE、记录退出码、唤醒父进程；不立刻释放 AS。
   - `process_wait(pid, &status)` 扫描子进程；ZOMBIE 才 `process_reap()`。
   - `process_reap()` 释放 AS、释放 PID、清任务槽；必须在切走当前任务后执行。
2. `task_struct` 增加 `struct process *proc`；`task_pid_of()` 从 `proc->pid` 取 PID。
3. 扩展槽位：
   - `TASK_MAX=10`：3 个内核任务 + 最多 6 个用户任务 + 1 个余量。
   - `AEVUM_AS_MAX=6`：A/B/C + fork 父子 + 1 个余量。
   - 用户内核栈加到 `0x204000/0x205000/0x206000`，`AEVUM_TASK_STACK_MAX` 同步。
   - AS 区仍是 `0x40000` 起、步长 `0x6000`，6 个空间结束于 `0x64000`，不与 `0x80000` 内核重叠。
4. 系统调用 ABI：
   - `eax=2` yield。
   - `eax=3` exit，`ebx=code`。
   - `eax=4` wait，`ebx=pid`（`-1` 表示任意子进程），`ecx=user u32 *status`；返回子 PID 或 `-1`。
   - `eax=5` getpid。
   - `eax=6` fork；父进程返回子 PID，子进程返回 0。
5. `fork` 实现：
   - 复制当前进程的 4 个用户页和 PD/PT，分配新 AS、内核栈、任务槽。
   - 复制父进程当前内核栈上的异常帧；子进程帧的 `eax` 改为 0，父进程帧的 `eax` 改为子 PID。
   - 复制 FPU 状态；子进程从同一用户 EIP 继续执行。
   - P1 先做 eager copy；COW 留到 P2。
6. `V` 页改成进程表：
   - 列：`PID PPID ST EXIT CR3 AS COMM`；保留 `#PF` 面板和 `int 0x80` 统计。
   - 新增 `userD` 父进程 + `userE` 子进程演示 `fork/wait/exit`。
   - 子进程 `exit(7)` 后先显示 `ZOMBIE`，父进程 `wait` 成功后显示 `WAIT OK 7`，子进程行变 `REAPED`。

P1 验收：

- `V` 页出现 `userD` 和 `userE` 两个不同 PID/CR3；`fork` 返回值和子进程 0 返回值可在数据页读到。
- `userE` 写自己的数据页，`userD` 的数据页不变；证明 fork 后地址空间独立。
- `userE` 调 `exit(7)`，父进程 `wait` 返回子 PID，status=`7`；V 页出现 `WAIT OK 7`。
- `userA/userB/userC` 的计数器、CR3、`int 0x80` 统计不受影响。
- 按 `V` 停止后没有 ZOMBIE/PID 泄漏；再按 `V` 能重新创建完整进程组。

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

## 五、P1 的最小改动顺序

1. 先加 `struct process` 和 `process_create_user/exit/wait/reap`，不改调度器语义。
2. 把 `family.c` 的父子表改为 `process` 投影；树页改读 `process_snapshot()`。
3. 扩 `TASK_MAX/AEVUM_AS_MAX` 和用户内核栈；先让 4 个 lane 跑起来。
4. 加 `eax=3` 退出码、`eax=4` wait、`eax=5` getpid、`eax=6` fork。
5. 最后改 `ring3.asm` 和 `V` 页，做 `userD/userE` 的 fork/wait 演示。

不要把顺序倒过来：先做页面会掩盖生命周期问题；先做 fork 而没有 wait 会立刻泄漏 ZOMBIE。

## 六、边界

P1 完成后仍然是单核、固定物理页池、无文件系统、无多核。`fork` 是 eager copy，不是 COW；`exec` 和信号在 P3/P4 才做。P1 的目标不是“完整 POSIX”，而是让进程身份、父子关系、退出码、回收责任这四条契约先成立。

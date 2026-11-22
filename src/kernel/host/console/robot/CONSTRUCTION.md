# 内核施工说明（归属唯一 / 定位有码）

本目录是 32 位裸机多进程教学内核。`kernel.c` 已拆成模块目录，构建入口仍是
`make clean && make all`，产物仍是 `disk.img` 给桌面「内核实况」读取。

## 一、模块与归属

每个可变字段只有一个写者。其他模块只能通过该模块导出的接口读快照或提交请求。

| 模块 | 文件 | 唯一归属 | 对外接口 |
| --- | --- | --- | --- |
| 内存布局 | `config/memory.h` | 物理地址常量 | 只读宏 |
| 基础类型 | `include/kernel/types.h` | `i32/u32/u16/u8/i64/u64` | 只读类型 |
| 错误入口 | `kernel/error/error.c` | 错误屏、停机 | `aevum_fail()` |
| 任务 | `kernel/task/task.c` | `task_struct` 字段、`tasks[]`、`current_task`、`pid_map`、切换轨迹、`cpu_ticks`/`vruntime`/`fpu_state` | `task_boot/task_create/task_start/task_current/task_exit/task_yield/task_block/task_wake/task_pid_used/task_pid_of/task_snapshot_pid/task_preempt_total/task_cpu_total` |
| 进程家族 | `kernel/task/family/family.c` | `family[]`、`reaper`、最近一次重挂事件；只写 `ppid` 关系 | `family_boot/set_reaper/add/exit/snapshot/last_event` |
| 地址空间 | `kernel/mm/address_space/address_space.c` | 用户 PD/PT、用户页、CR3 切换与地址空间槽 | `address_space_boot/kernel/create_user/switch/release/cr3/id/set_mode/...` |
| 页错误 | `arch/x86/cpu/fault/page_fault.c` | IDT 14 门、CR2/ERR/EIP 记录、用户故障 kill、内核态 panic 页、受控探针 | `page_fault_init/last/count/clear/probe` |
| TSS | `arch/x86/cpu/tss/tss.c` | `tss.esp0/ss0`、TSS 描述符、`ltr` | `tss_init/tss_set_esp0` |
| 系统调用 | `arch/x86/cpu/syscall/syscall.c` | `int 0x80` 入口、调用计数、最后 CS | `syscall_init/dispatch/count_total/last_cs` |
| 用户程序 | `user/ring3/ring3.asm` | 被复制进每个用户地址空间的 ring3 代码；同一段代码按 `mode` 进入正常/故障路径 | `user_program_start/end` |
| 用户演示 | `app/user/demo/demo.c` | `userA/userB/userC` 的创建、停止、地址空间和 PID | `user_demo_start/stop/alive/error/pid/space` |
| 用户渲染 | `app/user/render/render.c` | 全屏 ring3 页；只读地址空间快照 | `user_render_frame` |
| 端口 I/O | `include/arch/x86/io.h` | `in/out` 指令封装 | `port_inb/port_outb`（内联） |
| 中断/定时 | `arch/x86/cpu/interrupt/interrupt.c` | IDT、8259A PIC、PIT 100Hz、IRQ0 EOI | `interrupt_init/interrupt_set_user_gate/interrupt_eoi` |
| VGA | `drivers/video/vga/text/vga.c` | 影子显存 `0x20000`、`0xB8000` 刷新 | `vga_*` |
| 串口 | `drivers/serial/uart/uart.c` | COM1、`0x30000` 快照、差量帧缓冲 | `uart_*` |
| 键盘 | `drivers/input/keyboard/keyboard.c` | 无状态；只读扫描码 | `keyboard_poll()` |
| 定点 | `lib/fixed/fixed.c` + `include/lib/fixed.h` | Q16.16 运算 | `fx_mul/fx_div/isqrt64/fx_sqrt` |
| 三角 | `lib/math/trig.c` | `sin_tab`、`fx_sin_deg` | `fx_sin/fx_cos/fx_deg/fx_rad` |
| 格式化 | `lib/format/format.c` | 十进制/十六进制/定点转字符串 | `fmt_dec/fmt_hex/fmt_hex_width/fmt_fx` |
| 运动学 | `app/arm/kinematics/kinematics.c` | 纯函数，无状态 | `arm_fk/arm_jacobian/arm_solve` |
| 控制 | `app/arm/control/control.c` | `q/dq/points/target/...` 与 `arm_status` 快照 | `arm_control_init/step/toggle_nullspace/status` |
| 渲染 | `app/arm/render/render.c` | 轨迹环形缓冲 `trace[]`；只读 `arm_status` | `arm_render_init/frame/trace_push` |
| 应用装配 | `app/arm/app/app.c` | `p_control/p_render/p_idle/app_dep_code`；创建三个常驻任务；键盘分发（含 `V` / `K`） | `arm_app_init/start/dep_code` |
| FPU 上下文实验 | `app/fpu/demo/demo.c` | `active/stop/done[]/lanes[]`；两个任务各自维护 XMM0 标签与计数 | `fpu_demo_start/stop/live/read` |
| FPU 实验渲染 | `app/fpu/render/render.c` | 全屏 VGA 布局；只读 `struct fpu_lane` 快照 | `fpu_render_frame` |
| 家族树演示 | `app/tree/demo/demo.c` | `famP/famA/famB` 的创建、停止、done 标志；父进程退出由 `task_exit()` 触发 | `tree_demo_start/stop/alive/error` |
| 家族树渲染 | `app/tree/render/render.c` | 全屏树形页；只读 `family_entry` 与 `task_info` 快照 | `tree_render_frame` |
| 组合根 | `kernel/main/main.c` | 只做初始化编排 | `kernel_main()` |

约束：

- `task_struct` 对 `task.c` 以外不透明；外部不能直接写 `state`。
- 渲染只读 `struct arm_status` 快照，不直接读控制器的私有变量。
- VGA 只通过 `vga.c` 写；串口只通过 `uart.c` 写。
- `kernel_main` 不持有业务状态，只按依赖顺序装配并处理装配失败。

## 二、错误码

格式 `0xRRFFTT`：

- `RR`：职责号
- `FF`：职责内字段号（`0x00` 通用，`0x01` 入口，`0x02` 栈，`0x03` PID，`0x04` 状态，`0x05` 出参，`0x06` 优先级，`0x08` PID 池）
- `TT`：错误类型（`0x01` 字段缺失，`0x02` 字段冲突，`0x03` 依赖未满足，`0x04` 外部操作失败）

| 代码 | 常量 | 场景 |
| --- | --- | --- |
| `0x200004` | `ERR_KERNEL_MAIN_ARM_APP` | 应用装配失败 |
| `0x210004` | `ERR_TASK_SLOT_FULL` | 任务槽满 |
| `0x210101` | `ERR_TASK_ENTRY_MISSING` | 入口为空 |
| `0x210203` | `ERR_TASK_STACK_INVALID` | 栈顶越界或未 16 字节对齐 |
| `0x210302` | `ERR_TASK_PID_DUP` | 旧 PID 重复模板，`task_create` 已不再使用 |
| `0x210803` | `ERR_TASK_PID_EXHAUSTED` | PID 位图 1..31 已耗尽 |
| `0x210403` | `ERR_TASK_BAD_STATE` | 状态非法或任务指针为空 |
| `0x210501` | `ERR_TASK_OUT_MISSING` | 出参为空 |
| `0x220004` | `ERR_ARM_APP_TASK_CREATE` | 应用创建任务失败 |
| `0x220003` | `ERR_ARM_APP_SWITCH` | 应用任务切换失败 |
| `0x280004` | `ERR_MM_NO_SPACE` | 地址空间槽已耗尽或用户页分配失败 |

职责号：`0x20` main、`0x21` task、`0x22` arm_app、`0x23` arm_control、
`0x24` arm_render、`0x25` vga、`0x26` uart、`0x27` keyboard、`0x28` mm。

`aevum_fail()` 是唯一停机入口，错误屏必须带四要素：错误码、owner、field、detail；
有上游依赖时再带 `dep_code/dep_rr`。

## 三、进程状态

`task_struct.state` 只有 `task.c` 能写。当前已经跑通的边：

| 起始 | 触发 | 目标 | 实现 |
| --- | --- | --- | --- |
| `UNUSED` | 创建任务 | `READY` | `task_create()` 末尾发布 |
| `READY` | 调度器选中 | `RUNNING` | `task_schedule_irq()` |
| `RUNNING` | 主动让出 / PIT 时间片到期 | `READY` | `task_yield()` / IRQ0 的 `task_schedule_irq()` |
| `RUNNING` | 主动阻塞 | `BLOCKED` | `task_block()` |
| `BLOCKED` | 别的任务唤醒 | `READY` | `task_wake(pid)` |
| `RUNNING` | 任务退出 | `ZOMBIE` | `task_exit()` |
| `ZOMBIE` | 调度器下一次进入 | `UNUSED` | `task_reap()` 释放 PID |

`RUNNING` 的三种离开方式现在统一走 `task_set_current_state(state)`：
`TASK_READY` 等价 `task_yield()`，`TASK_BLOCKED` 等价 `task_block()`，`TASK_ZOMBIE` 等价
`task_exit()`。设置 `TASK_RUNNING` 是无副作用 no-op；非 `RUNNING` 的当前任务传其他状态返回
`ERR_TASK_BAD_STATE`。这样 `state` 仍只有 `task.c` 一个写者，不会出现应用直接改状态后不切调度的情况。

`task_pick_next()` 只选择 `READY`，因此 `BLOCKED` 和 `ZOMBIE` 不会被调度。
PIT 通道 0 以 100Hz 触发 IRQ0，`task_schedule_irq()` 在 IRQ0 和 `int 0x40` 两条入口上做同一套调度；
`px` 是 IRQ0 实际造成的抢占切换数，`sw` 是全部切换数（含主动 `task_yield`）。

### 3.1 优先级加权公平选择

- `priority` 取值 `0..3`，权重 `weight = priority + 1`，即 `1..4`。
- 每个 PIT tick 给正在运行的任务 `vruntime += 64 / weight`。
- `task_pick_next()` 在 READY 任务中选择 `vruntime` 最小者；同值从 `prev` 之后的槽位轮转，避免固定顺序。
- 新建任务从 `current_task->vruntime` 起跑，不从 0 值插队。
- 高优先级任务获得更大 CPU 份额，低优先级任务仍会前进，不会被严格最高优先饿死。

三个常驻任务的权重是 `control=4`、`render=3`、`idle=1`，理论 CPU 份额约 `50% / 37.5% / 12.5%`。

### 3.2 每任务 CPU 时间

- `struct task_struct` 增加 `cpu_ticks` 和 `vruntime`；`struct task_info` 暴露 `cpu_ticks`。
- 每次 IRQ0 且 `prev->state == RUNNING` 时：`prev->cpu_ticks++`、`prev->vruntime += 64 / weight`。
- `task_cpu_total()` 汇总仍存活任务的 `cpu_ticks`，所以 CPU 页各行百分比相加为 100%。
- 调度器选中当前任务自己时，必须把状态恢复为 `RUNNING`；否则一次 yield 会把任务永久留在 READY，PIT 不再给它计费，`vruntime` 不再增长，最终独占 CPU。
- `C` 键（扫描码 `0x2E`）打开全屏 `AEVUM / CPU TIME ACCOUNTING`：PID、TASK、PRI、WT、STATE、CPU%、TICKS、SHARE，底部 PIT TICKS、SWITCHES、PREEMPTIONS。

当前 `BLOCKED` 仍没有超时和 sleep，`task_wake()` 必须由另一个任务显式调用。

### 3.3 当前任务状态写入口

`task_set_current_state(state)` 不是“改一个字段就返回”，而是立刻触发调度：

- `TASK_RUNNING`：当前任务已是 RUNNING，直接返回 0，不产生切换。
- `TASK_READY`：以 `SCHED_YIELD` 进入 `int 0x40`，调度器把 `prev` 置 READY 并选择下一个任务。
- `TASK_BLOCKED`：以 `SCHED_BLOCK` 进入调度；若无其他 READY 任务，调度器恢复 `RUNNING` 并返回错误，和原 `task_block()` 一致。
- `TASK_ZOMBIE`：以 `SCHED_EXIT` 进入调度，`prev` 置 ZOMBIE，`task_reap()` 释放 PID，调用永不返回。

`task_yield()`、`task_block()`、`task_exit()` 都改为调用这个入口，B 键演示因此实际走的就是
`RUNNING -> BLOCKED -> READY -> RUNNING` 的同一套状态写入路径。

### 3.4 FPU / SSE 上下文

- 每个任务栈底部预留 512 字节 FXSAVE 区，16 字节对齐；`task->fpu_state` 指向它，`stack_base` 后移 512 字节，实际可用栈 3.5KB。
- `task_boot()` 先 `fninit`，把初始 FPU/SSE 状态分别存进 `fpu_template` 和 `boot_fpu_state`；新任务从模板复制，不从零初始化。
- 调度器只在 `next != prev` 时执行 `fxsave(prev->fpu_state)`、`fxrstor(next->fpu_state)`；同任务不切换则不动 FPU。
- `loader.asm` 打开 `CR4.OSFXSR/OSXMMEXCPT`，清 `CR0.EM/TS` 并置 `MP`，否则 `fxsave/fxrstor` 不可用。
- 这一节只讲 CPU 状态。地址空间、CR3 和 ring3 在 3.7；`ctx.esp` 只是帧指针，FPU/SSE 是第二块 CPU 状态。

### 3.5 FPU 上下文实验

`F` 键创建 `fpuA` / `fpuB` 两个 CPU 密集型任务，循环里不调用 `task_yield()`；两个任务只在 `XMM0` 里维护自己的标签和计数。`app/fpu/demo/demo.c` 是 `lanes[]`、`active/stop/done[]` 的唯一写者，`app/fpu/render/render.c` 只读快照并画 `CTX OK/LOST`。如果切换漏掉 `fxsave/fxrstor`，标签会串到另一条 lane，屏幕直接判 `CTX LOST`；`F` 再按一次停止并回到机械臂。

全局 `CFLAGS` 使用 `-Os -mno-sse`，只有 `app/fpu/demo` 追加 `-msse2`。这不是为了省事：如果编译器在普通任务代码里生成 SSE 暂存，它会在调度器执行 `fxsave` 前改写 `XMM0`，把任务的标签保存成 0，屏幕上就会看到 `TAG 0 / CTX LOST`。

### 3.6 进程家族树

`kernel/task/family/family.c` 单独维护 `pid -> ppid` 表，`task.c` 只负责在创建和退出时通知它：

- `task_create()` 在发布 READY 前调用 `family_add(pid, current_pid)`，新任务是当前任务的直接子进程
- 内核任务 `task_exit()` 进入 ZOMBIE 后调用 `family_exit(pid)`，只遍历 `ppid == pid` 的直接子进程；带 `proc` 的用户任务不走这条路径
- 重挂目标是 `family_set_reaper(idle_pid)` 设置的 `idle`；若 reaper 是退出任务的子孙，回落到 `init(0)`，避免父子成环
- 这版只描述内核任务树：内核任务没有 exit-status 等待，`task_reap()` 仍立即回收 PID；用户进程的 `fork/exit/wait/reap` 由 `kernel/proc/process.c` 单独提供，不复用 `family` 表

`G` 键展示真实树：`famP` 创建 `famA` / `famB` 后退出，两个子进程被移到 `idle` 下面，右侧事件面板记录父 PID、两个子 PID 和新父亲。`app/tree/render/render.c` 只读 `family_snapshot()` 和 `task_snapshot_pid()`，不直接改关系。

### 3.7 进程模型、地址空间与 ring3

P1 建立用户 PCB 与 `fork/exit/wait/reap` 闭环；P2.1 把地址空间从“固定 4 页 + 固定 AS 槽”推进到“物理页池 + VMA + brk + guard + copyin/copyout”；P2.2 把 `fork` 从 eager copy 改成 COW，并给物理页加引用计数。职责仍是三分：

- `kernel/proc/process.c`：用户 PCB、PID/PPID、`PROC_LIVE/ZOMBIE/DEAD`、退出码、`fork/wait/reap/cleanup` 的唯一写者。它只持有 `address_space *` 和 `task_struct *`，不直接改 PTE，也不切上下文。
- `kernel/task/task.c`：任务槽、内核栈、调度和 FPU 的唯一 owner；`task_struct.proc` 只是对 PCB 的反向引用，不反向拥有 PID。
- `kernel/mm/address_space/address_space.c`：PD/PT、VMA、用户页、物理页池、brk、CR3 和缺页修复的唯一 owner。`address_space_create_user()` 从位图池分配 PD/PT/code/data/stack/control 六页；`address_space_clone()` 复制所有 present 用户页；`address_space_release()` 遍历 PT 逐页归还；`address_space_set_brk()` 增删 heap 页；`copyin/copyout` 通过 VMA + PTE 翻译，不再让内核直接解引用用户指针。
- `kernel/task/family/family.c` 只保留内核任务树：带 `proc` 的用户任务不再调用 `family_add()`，调度器也不对用户 ZOMBIE 调用 `family_exit()`。`G` 页展示内核任务树，`V` 页展示用户进程树，两者是两套关系，不再互相写。

地址空间和用户进程：

- 内核空间固定使用 `0x10000` 页目录，`0..4MB` 恒等映射保持 supervisor-only；VGA BIOS 影子 ROM `0xC0000..0xFFFFF` 不放进页池。
- 用户物理页池 `0x100000..0x1FEFFF` 共 255 页，位图分配，每页一个引用计数；避开内核 `0x80000..0x8B640`、VGA/BIOS 和 `0x200000` 起的任务栈。
- 每个用户空间有独立 PD/PT；用户 VA 固定为 code `0x400000`（RX）、data `0x401000`（RW）、guard `0x402000`（VMA 无 PTE）、stack `0x403000`（RW，栈顶 `0x404000`）、control `0x404000`（R）、heap `0x405000..0x410000`（RW）。`fork` 只分配新 PD/PT，可写用户页共享为 COW，control 页因内核要写停止字也走 COW。
- 6 个 VMA 是 `code/data/guard/stack/control/heap`；`address_space_user_range_ok()` 按 VMA 权限 + PTE present/user/RW 双重校验，`handle_user_fault()` 只对 heap VMA 内、brk 以下的缺页零填并 `iret` 重试，guard/RO/非法地址一律返回 0。
- 用户内核栈顶为 A `0x201000`、B `0x202000`、C `0x203000`、D `0x204000`、E `0x205000`、F `0x206000`；`AEVUM_TASK_STACK_MAX=0x206000`。每栈底部 512 字节仍是 FXSAVE 区。
- `task_create_user_with_pid()` 构造 14 槽中断帧：`cs=0x1B`、`ss=0x23`、`eflags=0x202`，并使用进程先保留的 PID。`task_fork_user()` 复制父进程的 ring3 中断帧、通用寄存器、用户栈和 FPU；子进程帧 `eax=0`，父进程系统调用返回时拿到子 PID。
- `V` 演示创建 A/B/C/D/F 五个 lane：A/B 递增各自的 `0x401000` 计数器，并做 `brk(0x406000)`、`poke(0x405800,"HELP")`、`peek`、越界 `brk(0x500000)`、`poke(guard)`；C 用 `mode=1` 写 `0xB8000`；D 用 `mode=2` fork 出 E；F 用 `mode=3` 写 guard `0x402000`。实测 D 的 PID 7、E 的 PID 9、PPID 7；fork 后 D/E 共享 4 个用户页，D 行 `PGS 4 / C 2`，子写 `CHLD`、父读回 `PAPA`，页面显示 `WAIT OK 7 / COW OK`。C/F 都以 142 退出，A/B 继续计数。
- A/B/C/D/F 由 render 内核任务通过 `process_create_user()` 创建，E 是用户父进程 `fork` 创建的进程。P2.2 证明 VMA、brk、guard、copyin/copyout、物理页回收和 COW 写时复制；不证明 `exec` 或完整 POSIX 内存管理。
- `int 0x80` 是 DPL3 中断门：`eax=2` yield、`3` exit(ebx=code)、`4` wait(`ebx=pid,ecx=user status`)、`5` getpid、`6` fork、`7` getppid、`8` brk(ebx=new_brk)、`9` peek(ebx=user ptr)、`10` poke(ebx=user ptr,ecx=value)。`wait` 仍用 `task_yield()` 轮询；`copyout` 写 status，不直接解引用用户指针。
- `V` 页直接读 `process_snapshot()`：列为 `PID PPID ST EXIT CR3 AS PGS/C BRK COMM`，另有 VMA 摘要、heap/guard 结果、COW 统计、`PHYS PAGES used/total`、`int 0x80 traps`、fork/wait 摘要和 #PF 面板。`process_cleanup()` 在每次 V 启动前回收 ZOMBIE、清掉 DEAD 墓碑。
- `page_fault_dispatch()` 的用户路径先 `address_space_handle_user_fault()`；修好 heap 缺页就返回原帧重试，否则 `process_exit_current(128+14)` 再 `task_exit()`，所以 C/F 的退出状态是 142。内核态受控探针条件不变：`probe_armed`、`CR2=0x00400000`、CPL0、`ERR.P=0`、`CR3=内核 PD`。
- 调度器 `task_reap()` 只自动回收没有 `proc` 的内核任务，并调用 `process_reap_orphans()` 回收没有活父进程的用户 ZOMBIE；`process_reap()` 统一释放任务槽、地址空间、PID 和内核栈，保留 DEAD 墓碑供 V 页显示。

边界：32 位、平坦段、单核、255 页固定物理池的最小实现。没有 ELF 加载、`exec`、信号、fd/pipe，也没有文件系统和多核。`fork` 是 COW，但 `wait` 是 yield 轮询；`family` 和 `process` 是两套树；非探针内核 fault 仍终止性停机。

## 四、内存与构建预算

| 地址 | 用途 |
| --- | --- |
| `0x80000` | 内核镜像起点 |
| `0x80000..0x8A000` | boot 一次 LBA 读取的 80 扇区（40KB）窗口；当前 `kernel.bin` 40,328 字节 |
| `0x89DA0..0x8B640` | `.bss`，由 loader 的 `rep stosb` 清零；尾部高于 80 扇区加载窗口 |
| `0x9000..0x9FFF` | `render` 任务栈（栈顶 `0xA000`） |
| `0xA000..0xAFFF` | `idle` 任务栈（栈顶 `0xB000`） |
| `0xB000..0xBFFF` | 内核主线程栈（栈顶 `0xC000`） |
| `0xC000..0xCFFF` | `probe` 任务栈（栈顶 `0xD000`） |
| `0xD000..0xDFFF` | `spinA` 任务栈（栈顶 `0xE000`） |
| `0xE000..0xEFFF` | `spinB` 任务栈（栈顶 `0xF000`） |
| `0x1FF000..0x1FFFFF` | `control` 任务栈（栈顶 `0x200000`） |
| `0x200000..0x200FFF` | `userA` 内核栈（栈顶 `0x201000`） |
| `0x201000..0x201FFF` | `userB` 内核栈（栈顶 `0x202000`） |
| `0x202000..0x202FFF` | `userC` 内核栈（栈顶 `0x203000`） |
| `0x203000..0x203FFF` | `userD` 内核栈（栈顶 `0x204000`） |
| `0x204000..0x204FFF` | `userE` 内核栈（栈顶 `0x205000`） |
| `0x205000..0x205FFF` | `userF` 预留内核栈（栈顶 `0x206000`） |
| `0x10000 / 0x11000` | 内核页目录 / 页表（0–4MB 恒等映射） |
| `0x13000..0x13FFF` | `K` 探针恢复用的 PDE 1 页表 |
| `0x14000..0x14FFF` | `K` 探针恢复用的诊断页（承接 `0x00400000` 写） |
| `0x12000..0x127FF` | 256 项 IDT（0x20 IRQ0、0x40 软件调度门、0x80 ring3 系统调用门） |
| `0x89640..0x8966F` | 内核 GDT（6 项） |
| `0x8A7C0..0x8A827` | TSS（`esp0/ss0`） |
| `0x100000..0x1FEFFF` | 用户物理页池，255 页位图分配 |
| `0x400000` / `0x401000` | 用户 code RX / data RW |
| `0x402000` | guard：VMA 存在但无 PTE |
| `0x403000` / `0x404000` | 用户 stack RW（栈顶 `0x404000`）/ control R |
| `0x405000..0x410000` | 用户 heap，`brk` 从这里增长 |
| `0x20000` | VGA 影子显存 |
| `0x30000` | 串口帧快照 |
| `0xB8000` | VGA 文本显存 |

`boot.asm` 用一次 LBA 读 80 个扇区到 `0x80000`，所以 `kernel.bin` 必须不超过 40,960 字节。
当前构建 40,328 字节，BSS 结束于 `0x8B640`；镜像余量 632 字节。BSS 尾部 `0x8A000..0x8B640` 不在加载窗口内，loader 按链接符号清零。BSS 与 `render` 栈 `0x9000`、VGA `0xB8000`、VGA BIOS 影子 ROM `0xC0000` 均不重叠。
`kernel.bin` 由 `kernel.elf` 经 `objcopy -O binary` 生成，保证 loader 与 C 看到的 `__bss_start`/`__bss_end` 一致。
若继续增长，先加 `boot.asm` 扇区数，同时确认 BSS 不越过 `0x9000`。`AEVUM_TASK_STACK_MIN=0x8000`，
`AEVUM_TASK_STACK_MAX=0x206000`，`AEVUM_AS_MAX=6`，`PROC_MAX=8`，`TASK_MAX=10`，`AEVUM_PHYS_POOL_BASE=0x100000`，`AEVUM_PHYS_POOL_END=0x1FF000`。

## 五、验收

```sh
make clean && make all
wc -c kernel.bin          # 必须 <= 38912
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

通过标准：

- `kernel.bin` 不超过 38912 字节，链接无 undefined symbol。
- QEMU 不 triple fault，串口首帧为 `a5 5a 01 ...`。
- 屏幕出现机械臂、目标点、轨迹和右侧 `ARM STATUS` 面板；标题显示 `PIT 100Hz | P/B/T/C/F/G/V/K`，面板出现 `px` 抢占计数和每任务 CPU 百分比。
- 空格扫描码 `0x39` 可切换零空间；每 420 帧自动切换。
- 按 `P`（扫描码 `0x19`）创建 `probe` 任务，画面显示 PID（首次为 4）和 `PIT PREEMPTIONS` 计数；探针循环不调用 `task_yield`，计数仍持续增长，证明 IRQ0 真的抢占了 CPU 密集型任务。任务退出后 `P3/31` 回到 3，再按 `P` 仍分配 PID 4，证明 ZOMBIE 回收与 PID 复用。
- 按 `B`（扫描码 `0x30`）让 `idle` 任务执行 `task_block()`，面板第三行从 `3id r` 变成 `3id B` 并出现 `BLOCKED` 提示；再按 `B` 调 `task_wake()`，变回 `3id r`，证明 `RUNNING -> BLOCKED -> READY` 两条边成立。
- 按 `T`（扫描码 `0x14`）进入全屏 `PREEMPTION DUEL`：创建 `spinA` / `spinB` 两个 CPU 密集型任务，循环里都不调用 `task_yield()`；两条 lane 的 `STEP` 同时增长，80 格抢占磁带出现青/洋红交替条纹，`PIT PREEMPTIONS` 持续增加。再按 `T` 停止，两个任务经 `task_exit()` 退出，画面恢复机械臂，面板回到 `P3/31`。
- 按 `C`（扫描码 `0x2E`）进入全屏 `AEVUM / CPU TIME ACCOUNTING`：三行任务的 `CPU%` 应稳定在约 `50% / 38% / 12%`，`TICKS` 每秒增长，`PIT TICKS` 等于三行 `TICKS` 之和；再按 `C` 返回机械臂，帧号和 `sw` 继续增长。
- 按 `F`（扫描码 `0x21`）进入全屏 `AEVUM / FPU CONTEXT LAB`：`fpuA` / `fpuB` 两个 CPU 密集型任务同时推进 `COUNT`，`TAG` 始终分别为 `A11CE` / `B22CE`，两条 lane 都显示 `CTX OK`；`SWITCHES` / `PREEMPTIONS` 持续增长。再按 `F` 停止，画面恢复机械臂。
- 按 `G`（扫描码 `0x22`）进入全屏 `AEVUM / PROCESS FAMILY TREE`：`famP` 下面先出现 `famA` / `famB`；约 1.5 秒后 `famP` 退出，两个子进程移到 `idle` 下面，右侧 `LAST REPARENT` 显示 `parent`、`children`、子 PID 和 `reaper`。再按 `G` 停止，画面恢复机械臂。
- 按 `V`（扫描码 `0x2F`）进入全屏 `AEVUM / COW FORK + VMA + PHYS PAGES`：PCB 表同时出现 A/B/C/D/F/E，`PGS/C` 与 `BRK` 每行可见，A/B 私有计数器各自增长；`int 0x80` 行显示真实 `last CS 0x1B`。VMA 摘要显示 code/data/guard/stack/control/heap 六个区域，guard `0x402000` 无 PTE。
- A/B 的 `brk(0x406000)` 返回 `0x406000`；heap `0x405800` 写入 `HELP` 后 `peek=0x48454C50`、`poke=1`；越界 `brk(0x500000)` 返回 `0xFFFFFFFF`；`poke(guard 0x402000)` 返回 0。
- D fork 后父子共享 4 个用户页，D 行显示 `PGS 4 / C 2`；COW 行为 `forks 1 shared 4 live 2 breaks 2 last AS4 old 00115000 -> 00118000`。子进程先写 `CHLD` 到 `0x401038`，父进程 wait 后读回 fork 前写的 `PAPA`，`0x401040` 写 `COW` 魔数，页面显示 `COW OK`。
- `userC` 的 `mode=1` 计数到 20000 后写 `0xB8000`，`userF` 的 `mode=3` 直接写 guard `0x402000`；页面 `#PF count 3`（一条 COW 子页写 + 两条越界故障），C 行 `FAULT`、F 行 `GUARD`，两者 `EXIT=142`；A/B 的计数器继续增长，证明故障只杀死当前用户进程。
- `userD` 的 `fork` 返回 9，`userE` 的 PPID 为 7；E `exit(7)` 后 D `wait` 返回 9、status 7，E 行变 `REAP`，页面出现 `WAIT OK 7`。
- 再按 `V` 停止所有用户进程并回机械臂；机械臂 q 值保持正常，证明启动/调度/FPU 状态没有被 `#PF` 或 COW 路径破坏。再按一次 `V` 能重新创建 A/B/C/D/F，ASID 从 7 起、PID 仍复用 4-9，`PHYS PAGES` 保持 `20/255`，COW 统计累计为 `forks 2 shared 8 live 2 breaks 5`，没有 ZOMBIE/PID/页泄漏。
- 在机械臂主画面按 `K`（扫描码 `0x25`）：页面切到 `AEVUM / KERNEL PAGE FAULT`，显示 `task 2 render`、`CS=0x0008 / CPL 0`、`EIP=0x000835FD`、`CR2=0x00400000`、`ERR=0x00000002`、`CR3=0x00010000`、`P=0 W/R=1 U/S=0 RSVD=0 I/D=0`、`fault count 4`、`recoveries 0` 和 `kernel image 0x00080000..0x0008B700`；按 `R` 后回到机械臂，q 值继续变化。先跑 V 时 COW 子页写和 C/F 的用户态 #PF 已计三次，因此第一张 K 页从 4 起；直接先按 K 则为 1。按 `H` 才停机。

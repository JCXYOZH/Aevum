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
| 地址空间 | `kernel/mm/address_space/address_space.c` | 用户 PD/PT、用户页、CR3 切换与地址空间槽 | `address_space_boot/kernel/create_user/switch/release/cr3/id/...` |
| TSS | `arch/x86/cpu/tss/tss.c` | `tss.esp0/ss0`、TSS 描述符、`ltr` | `tss_init/tss_set_esp0` |
| 系统调用 | `arch/x86/cpu/syscall/syscall.c` | `int 0x80` 入口、调用计数、最后 CS | `syscall_init/dispatch/count_total/last_cs` |
| 用户程序 | `user/ring3/ring3.asm` | 被复制进每个用户地址空间的 ring3 代码 | `user_program_start/end` |
| 用户演示 | `app/user/demo/demo.c` | `userA/userB` 的创建、停止、地址空间和 PID | `user_demo_start/stop/alive/error/pid/space` |
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
| 应用装配 | `app/arm/app/app.c` | `p_control/p_render/p_idle/app_dep_code`；创建三个常驻任务；键盘分发（含 `V`） | `arm_app_init/start/dep_code` |
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
- `task_exit()` 进入 ZOMBIE 后调用 `family_exit(pid)`，只遍历 `ppid == pid` 的直接子进程，不假设兄弟必须整体迁移
- 重挂目标是 `family_set_reaper(idle_pid)` 设置的 `idle`；若 reaper 是退出任务的子孙，回落到 `init(0)`，避免父子成环
- 这版不做 exit-status 等待队列，`task_reap()` 仍然立即回收 PID；因此它是“关系正确 + 重挂可见”，不是完整的 Linux `wait/reap` 语义

`G` 键展示真实树：`famP` 创建 `famA` / `famB` 后退出，两个子进程被移到 `idle` 下面，右侧事件面板记录父 PID、两个子 PID 和新父亲。`app/tree/render/render.c` 只读 `family_snapshot()` 和 `task_snapshot_pid()`，不直接改关系。

### 3.7 进程地址空间与 ring3

`task_struct` 只持有 `struct address_space *` 和 `user` 标志；页目录、页表、用户页和 CR3 都由 `kernel/mm/address_space` 唯一维护：

- 内核空间固定使用 `0x10000` 页目录，`0..4MB` 恒等映射保持 supervisor-only（PDE/PTE 的 U/S 位为 0）。
- 每个用户空间有独立 PD/PT，虚拟 `0x400000..0x403FFF` 映射代码、数据、用户栈和控制页；代码页只读、控制页只读、数据/栈可写，四个 PTE 都置 U/S=1。
- `task_create_user()` 构造 14 槽中断帧：`cs=0x1B`、`ss=0x23`、`eflags=0x202`，并带用户 `esp`。`task_create()` 的内核任务仍用 12 槽 `cs=0x08` 帧。
- 调度器在 `next != prev` 时调用 `address_space_switch(next->space)`；同一地址空间不重复写 CR3。切到用户任务前还要 `tss_set_esp0(next->stack_top)`，ring3 中断/系统调用才能落到该任务的内核栈。
- `int 0x80` 是 DPL3 中断门：`eax=2` 调 `task_yield()`，`eax=3` 调 `task_exit()`；`syscall_dispatch` 记录调用次数和真实 `frame->cs`，页面显示 `CS=0x1B` 作为 ring3 证据。
- `V` 演示创建 `userA/userB`：两段代码都复制到 `0x400000`，但物理代码页分别为 `0x42000/0x48000`，数据页 `0x43000/0x49000`；两任务各自递增同一个虚拟地址 `0x401000` 的私有计数器，页面上的两个数值不同就是地址空间隔离的直接证据。

边界：这是 32 位、平坦段、单核、固定物理页池的最小实现；没有 ELF 加载、按需分页、COW、完整 `wait/reap`，也没有文件系统和多核。`userA/userB` 的任务槽与内核栈是编译期固定的，地址空间槽只有 2 个。

## 四、内存与构建预算

| 地址 | 用途 |
| --- | --- |
| `0x1000` | 内核镜像起点 |
| `0x1000..0x7BFF` | boot 读取的 54 扇区（27KB）窗口；当前镜像结束于 `0x7908` |
| `0x7920..0x88BC` | `.bss`，由 loader 的 `rep stosb` 清零 |
| `0x88C0..0x8FFF` | BSS 尾部到 `render` 栈的保护空隙 |
| `0x9000..0x9FFF` | `render` 任务栈（栈顶 `0xA000`） |
| `0xA000..0xAFFF` | `idle` 任务栈（栈顶 `0xB000`） |
| `0xB000..0xBFFF` | 内核主线程栈（栈顶 `0xC000`） |
| `0xC000..0xCFFF` | `probe` 任务栈（栈顶 `0xD000`） |
| `0xD000..0xDFFF` | `spinA` 任务栈（栈顶 `0xE000`） |
| `0xE000..0xEFFF` | `spinB` 任务栈（栈顶 `0xF000`） |
| `0x1FF000..0x1FFFFF` | `control` 任务栈（栈顶 `0x200000`） |
| `0x200000..0x200FFF` | `userA` 内核栈（栈顶 `0x201000`） |
| `0x201000..0x201FFF` | `userB` 内核栈（栈顶 `0x202000`） |
| `0x10000 / 0x11000` | 内核页目录 / 页表（0–4MB 恒等映射） |
| `0x12000..0x127FF` | 256 项 IDT（0x20 IRQ0、0x40 软件调度门、0x80 ring3 系统调用门） |
| `0x7860..0x788F` | 内核 GDT（6 项） |
| `0x82E0..0x8347` | TSS（`esp0/ss0`） |
| `0x40000..0x45FFF` | 用户 A 的 PD/PT/代码/数据/栈/控制页 |
| `0x46000..0x4BFFF` | 用户 B 的 PD/PT/代码/数据/栈/控制页 |
| `0x20000` | VGA 影子显存 |
| `0x30000` | 串口帧快照 |
| `0xB8000` | VGA 文本显存 |

`boot.asm` 读 54 个扇区到 `0x1000`，所以 `kernel.bin` 必须不超过 27,648 字节。
当前构建 26,888 字节，BSS 结束于 `0x88BC`；镜像余量 760 字节，BSS 距 `0x9000` 的 `render` 栈还有 1,860 字节。
`kernel.bin` 由 `kernel.elf` 经 `objcopy -O binary` 生成，保证 loader 与 C 看到的 `__bss_start`/`__bss_end` 一致。
若继续增长，先加 `boot.asm` 扇区数，同时确认 BSS 不越过 `0x9000`。`AEVUM_TASK_STACK_MIN=0x8000`，
`AEVUM_TASK_STACK_MAX=0x202000`。

## 五、验收

```sh
make clean && make all
wc -c kernel.bin          # 必须 <= 27648
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

通过标准：

- `kernel.bin` 不超过 27648 字节，链接无 undefined symbol。
- QEMU 不 triple fault，串口首帧为 `a5 5a 01 ...`。
- 屏幕出现机械臂、目标点、轨迹和右侧 `ARM STATUS` 面板；标题显示 `PIT 100Hz | P/B/T/C/F/G/V`，面板出现 `px` 抢占计数和每任务 CPU 百分比。
- 空格扫描码 `0x39` 可切换零空间；每 420 帧自动切换。
- 按 `P`（扫描码 `0x19`）创建 `probe` 任务，画面显示 PID（首次为 4）和 `PIT PREEMPTIONS` 计数；探针循环不调用 `task_yield`，计数仍持续增长，证明 IRQ0 真的抢占了 CPU 密集型任务。任务退出后 `P3/31` 回到 3，再按 `P` 仍分配 PID 4，证明 ZOMBIE 回收与 PID 复用。
- 按 `B`（扫描码 `0x30`）让 `idle` 任务执行 `task_block()`，面板第三行从 `3id r` 变成 `3id B` 并出现 `BLOCKED` 提示；再按 `B` 调 `task_wake()`，变回 `3id r`，证明 `RUNNING -> BLOCKED -> READY` 两条边成立。
- 按 `T`（扫描码 `0x14`）进入全屏 `PREEMPTION DUEL`：创建 `spinA` / `spinB` 两个 CPU 密集型任务，循环里都不调用 `task_yield()`；两条 lane 的 `STEP` 同时增长，80 格抢占磁带出现青/洋红交替条纹，`PIT PREEMPTIONS` 持续增加。再按 `T` 停止，两个任务经 `task_exit()` 退出，画面恢复机械臂，面板回到 `P3/31`。
- 按 `C`（扫描码 `0x2E`）进入全屏 `AEVUM / CPU TIME ACCOUNTING`：三行任务的 `CPU%` 应稳定在约 `50% / 38% / 12%`，`TICKS` 每秒增长，`PIT TICKS` 等于三行 `TICKS` 之和；再按 `C` 返回机械臂，帧号和 `sw` 继续增长。
- 按 `F`（扫描码 `0x21`）进入全屏 `AEVUM / FPU CONTEXT LAB`：`fpuA` / `fpuB` 两个 CPU 密集型任务同时推进 `COUNT`，`TAG` 始终分别为 `A11CE` / `B22CE`，两条 lane 都显示 `CTX OK`；`SWITCHES` / `PREEMPTIONS` 持续增长。再按 `F` 停止，画面恢复机械臂。
- 按 `G`（扫描码 `0x22`）进入全屏 `AEVUM / PROCESS FAMILY TREE`：`famP` 下面先出现 `famA` / `famB`；约 1.5 秒后 `famP` 退出，两个子进程移到 `idle` 下面，右侧 `LAST REPARENT` 显示 `parent`、`children`、子 PID 和 `reaper`。再按 `G` 停止，画面恢复机械臂。
- 按 `V`（扫描码 `0x2F`）进入全屏 `AEVUM / RING3 PROCESS CONTEXT`：`userA` / `userB` 的 `CPL 3` 与 `CR3 0x40000 / 0x46000` 同时出现；两者都映射虚拟 `0x400000` 和 `0x401000`，但代码/数据物理页不同，私有计数器各自增长；`int 0x80` 行显示真实 `last CS 0x1B`。再按 `V` 等两个用户任务结束后回机械臂。

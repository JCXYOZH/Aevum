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
| 任务 | `kernel/task/task.c` | `task_struct` 字段、`tasks[]`、`current_task`、`pid_map`、切换轨迹、`cpu_ticks`/`vruntime` | `task_boot/task_create/task_start/task_current/task_exit/task_yield/task_block/task_wake/task_pid_used/task_preempt_total/task_cpu_total` |
| 端口 I/O | `include/arch/x86/io.h` | `in/out` 指令封装 | `port_inb/port_outb`（内联） |
| 中断/定时 | `arch/x86/cpu/interrupt/interrupt.c` | IDT、8259A PIC、PIT 100Hz、IRQ0 EOI | `interrupt_init/interrupt_eoi` |
| VGA | `drivers/video/vga/text/vga.c` | 影子显存 `0x20000`、`0xB8000` 刷新 | `vga_*` |
| 串口 | `drivers/serial/uart/uart.c` | COM1、`0x30000` 快照、差量帧缓冲 | `uart_*` |
| 键盘 | `drivers/input/keyboard/keyboard.c` | 无状态；只读扫描码 | `keyboard_poll()` |
| 定点 | `lib/fixed/fixed.c` + `include/lib/fixed.h` | Q16.16 运算 | `fx_mul/fx_div/isqrt64/fx_sqrt` |
| 三角 | `lib/math/trig.c` | `sin_tab`、`fx_sin_deg` | `fx_sin/fx_cos/fx_deg/fx_rad` |
| 格式化 | `lib/format/format.c` | 十进制/定点转字符串 | `fmt_dec/fmt_fx` |
| 运动学 | `app/arm/kinematics/kinematics.c` | 纯函数，无状态 | `arm_fk/arm_jacobian/arm_solve` |
| 控制 | `app/arm/control/control.c` | `q/dq/points/target/...` 与 `arm_status` 快照 | `arm_control_init/step/toggle_nullspace/status` |
| 渲染 | `app/arm/render/render.c` | 轨迹环形缓冲 `trace[]`；只读 `arm_status` | `arm_render_init/frame/trace_push` |
| 应用装配 | `app/arm/app/app.c` | `p_control/p_render/p_idle/app_dep_code`；创建三个常驻任务 | `arm_app_init/start/dep_code` |
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

职责号：`0x20` main、`0x21` task、`0x22` arm_app、`0x23` arm_control、
`0x24` arm_render、`0x25` vga、`0x26` uart、`0x27` keyboard。

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

## 四、内存与构建预算

| 地址 | 用途 |
| --- | --- |
| `0x1000` | 内核镜像起点 |
| `0x1000..0x5FFF` | boot 读取的 40 扇区（20KB）窗口 |
| `0x5F40..0x649F` | `.bss`，由 loader 的 `rep stosb` 清零 |
| `0x64A0..0x6FFF` | BSS 尾部到任务栈的保护空隙 |
| `0x7000..0x7FFF` | `control` 任务栈（栈顶 `0x8000`） |
| `0x8000..0x8FFF` | `render` 任务栈（栈顶 `0x9000`） |
| `0x9000..0x9FFF` | `idle` 任务栈（栈顶 `0xA000`） |
| `0xA000..0xAFFF` | 内核主线程栈（栈顶 `0xB000`） |
| `0xB000..0xBFFF` | `probe` 任务栈（栈顶 `0xC000`） |
| `0xC000..0xCFFF` | `spinA` 任务栈（栈顶 `0xD000`） |
| `0xD000..0xDFFF` | `spinB` 任务栈（栈顶 `0xE000`） |
| `0x10000 / 0x11000` | 页目录 / 页表 |
| `0x12000..0x127FF` | 256 项 IDT（0x20 IRQ0、0x40 软件调度门） |
| `0x12800..0x12817` | 重定位后的 GDT（3 项） |
| `0x20000` | VGA 影子显存 |
| `0x30000` | 串口帧快照 |
| `0xB8000` | VGA 文本显存 |

`boot.asm` 读 40 个扇区到 `0x1000`，所以 `kernel.bin` 必须不超过 20480 字节。
当前构建 20,276 字节，BSS 结束于 `0x64A0`；镜像余量 204 字节，BSS 距 `0x7000` 任务栈还有 2,912 字节。
`kernel.bin` 由 `kernel.elf` 经 `objcopy -O binary` 生成，保证 loader 与 C 看到的 `__bss_start`/`__bss_end` 一致。
若继续增长，先加 `boot.asm` 扇区数，同时确认 BSS 不越过 `0x7000`。`AEVUM_TASK_STACK_MIN=0x7000`，
`AEVUM_TASK_STACK_MAX=0xE000`。

## 五、验收

```sh
make clean && make all
wc -c kernel.bin          # 必须 <= 20480
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

通过标准：

- `kernel.bin` 不超过 20480 字节，链接无 undefined symbol。
- QEMU 不 triple fault，串口首帧为 `a5 5a 01 ...`。
- 屏幕出现机械臂、目标点、轨迹和右侧 `ARM STATUS` 面板；标题显示 `PIT 100Hz | P/B/T/C`，面板出现 `px` 抢占计数和每任务 CPU 百分比。
- 空格扫描码 `0x39` 可切换零空间；每 420 帧自动切换。
- 按 `P`（扫描码 `0x19`）创建 `probe` 任务，画面显示 PID（首次为 4）和 `PIT PREEMPTIONS` 计数；探针循环不调用 `task_yield`，计数仍持续增长，证明 IRQ0 真的抢占了 CPU 密集型任务。任务退出后 `P3/31` 回到 3，再按 `P` 仍分配 PID 4，证明 ZOMBIE 回收与 PID 复用。
- 按 `B`（扫描码 `0x30`）让 `idle` 任务执行 `task_block()`，面板第三行从 `3id r` 变成 `3id B` 并出现 `BLOCKED` 提示；再按 `B` 调 `task_wake()`，变回 `3id r`，证明 `RUNNING -> BLOCKED -> READY` 两条边成立。
- 按 `T`（扫描码 `0x14`）进入全屏 `PREEMPTION DUEL`：创建 `spinA` / `spinB` 两个 CPU 密集型任务，循环里都不调用 `task_yield()`；两条 lane 的 `STEP` 同时增长，80 格抢占磁带出现青/洋红交替条纹，`PIT PREEMPTIONS` 持续增加。再按 `T` 停止，两个任务经 `task_exit()` 退出，画面恢复机械臂，面板回到 `P3/31`。
- 按 `C`（扫描码 `0x2E`）进入全屏 `AEVUM / CPU TIME ACCOUNTING`：三行任务的 `CPU%` 应稳定在约 `50% / 38% / 12%`，`TICKS` 每秒增长，`PIT TICKS` 等于三行 `TICKS` 之和；再按 `C` 返回机械臂，帧号和 `sw` 继续增长。

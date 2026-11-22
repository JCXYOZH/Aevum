# Aevum Robot Kernel 介绍

## 是什么

`Aevum Robot Kernel` 是一个 32 位裸机多进程教学内核。它不依赖 libc，不跑在桌面操作系统里，而是由 BIOS 引导扇区一次装入 `0x80000`，进入保护模式、开启分页，然后运行三个常驻任务；调度由 PIT 100Hz 时间片抢占和任务主动让出共同驱动：

- `control`：计算机械臂每一步的关节速度与位置；
- `render`：把机械臂、目标点、轨迹和状态面板画到 VGA 文本屏，同时通过 COM1 上报差量帧；
- `idle`：空闲任务，用来验证调度器在没有业务可做时仍能正常轮转。

桌面端的「内核实况」窗口读取本目录的 `disk.img`，再由 `src/kernel/host/bridge/serial_bridge.py` 把串口帧转成 WebSocket 画面。没有这段串口旁路，内核只写 `0xB8000`，桌面收不到画面。

## 能做什么

- **引导**：`boot.asm` 用 LBA 扩展一次读 96 个扇区到 `0x80000`；读盘失败打印可见消息；调用 `boot_common.inc` 建立 GDT、0~4MB 恒等页表，跳到内核入口；`loader.asm` 加载内核自己的 6 项 GDT（ring0/ring3 代码、数据、TSS 槽），清 BSS，再 `ltr 0x28` 启用 TSS。内核完全避开 BIOS 低内存暂存区、`0x7C00` boot 代码与 `0xC0000..0xFFFFF` VGA BIOS 影子 ROM。
- **多任务**：`task.c` 管理 10 个任务槽（3 内核 + 6 用户 + 1 余量），三个常驻任务按 READY/RUNNING 状态轮转；PIT 通道 0 以 100Hz 触发 IRQ0，CPU 密集型任务也会被定时抢占；主动让出统一走 `int 0x40`，调度策略归 `task.c`，应用层不再指定“下一个是谁”。
- **任务描述符**：每个任务保存 PID、状态、优先级、栈底/栈顶、上下文、切出次数、`cpu_ticks`、`vruntime`、`fpu_state`、`space`（地址空间指针）和 `user` 标志；栈底填魔数，运行时扫描得到真实栈水位。每个任务栈底部还预留 512 字节 FXSAVE 区，切换时保存/恢复 FPU/SSE。**PID 由 `task.c` 的 31 位位图分配**；用户进程先 `task_pid_reserve()` 保留 PID，再由 `process.c` 把它写进 PCB，`task_create` 不再接收显式 PID，应用层也不写 1/2/3；内核任务 `task_exit()` 后置为 ZOMBIE，调度器下一次进入时回收 PID；用户进程退出后先变 ZOMBIE，由父进程 `wait` 或 orphan reaper 回收 PID。
- **状态链路**：`UNUSED -> READY -> RUNNING`；`RUNNING -> READY` 由 `task_yield()` 或 PIT IRQ0；`RUNNING -> BLOCKED` 由 `task_block()`，`BLOCKED -> READY` 由 `task_wake(pid)`；`RUNNING -> ZOMBIE` 由 `task_exit()`，`ZOMBIE -> UNUSED` 由 `task_reap()`。这三种 `RUNNING` 离开方式都收敛到 `task_set_current_state(state)`，状态字段只由 `task.c` 写入；`B` 键演示阻塞/唤醒，`P` 键演示 PID 分配/回收，`T` 键演示 PIT 抢占下的双任务同时推进，`C` 键查看每任务 CPU 时间。
- **抢占决斗**：按 `T` 创建 `spinA` / `spinB` 两个 CPU 密集型任务，两个循环都不调用 `task_yield()`；全屏显示各自的实时 `STEP`、进度条、运行历史，以及 80 格 IRQ0 抢占磁带。只有 PIT 100Hz 真的打断 CPU，两条 lane 才会同时前进，磁带才会出现青/洋红交替条纹；再按 `T` 停止。
- **FPU 上下文实验**：按 `F` 创建 `fpuA` / `fpuB` 两个 CPU 密集型任务，循环里不调用 `task_yield()`；两个任务在 `XMM0` 里各自保存标签和计数，全屏显示 `TAG`、`COUNT`、`CTX OK/LOST` 与进度条。只要 `fxsave/fxrstor` 漏掉一次，标签就会串到另一条 lane。
- **进程家族树**：按 `G` 进入全屏 `AEVUM / PROCESS FAMILY TREE`；`famP` 创建 `famA` / `famB` 后退出，`family.c` 只把这两个直接子进程重挂到 `idle`，右侧面板显示父 PID、子 PID 和 `reaper`。树形页读的是真实 `ppid` 关系，不是画出来的假树。
- **进程上下文 / COW fork / exec**：按 `V` 启动 A/B/C/D/F 五个用户进程，D 做三轮 fork/wait。每个进程有独立 PD/PT 和 CR3，PD/PT、代码、数据、栈、control 从 `0x100000..0x1FEFFF` 的 255 页位图池分配，每页有引用计数；6 个 VMA 为 code RX、data RW、guard 无权限、stack RW、control R、heap RW。全屏页显示 PCB 表 `PID PPID ST EXIT CR3 AS PGS/C BRK COMM`、VMA 摘要、heap/guard 结果、COW 统计、fork/wait、信号面板、`P4 exec` 与 `PHYS PAGES`。第一轮子进程写 `CHLD` 后 `exit(7)`，父显示 `WAIT OK 7 / COW OK`；第二轮子进程安装 `SIGFPE` handler 后 `1/0`，signal frame 进入 handler、`sigreturn` 返回除零后的指令，写 `HAND` 后 `exit(9)`，父 wait 得到 status 9 并显示 `HAND OK`；第三轮子进程 `exec(1, argv, envp)`，参数为 `alpha/beta/NULL` 与 `MODE=p42/LEVEL=2/NULL`；PID 不变、换新 AS 和 exec 镜像，内核把字符串复制到新栈（`esp=0x403FC8`），新镜像逐字节校验四串后写 `ARGV/ENVP` 并 `exit(10)`，父 wait 得到 10 并显示 `P4 exec 8 wait 8 st 0000000A img 1 EXEC OK arg 2 env 2`。地址空间由 `kernel/mm/address_space` 唯一维护，PID/父子/退出码/信号/回收由 `kernel/proc/process.c` 唯一维护，调度与 FPU 仍归 `task.c`。
- **同步异常与用户信号**：`#DE/#BP/#UD/#GP` 由 `exception.c` 唯一分发；CPL3 时记录 `pid/eip/err/cr2` 后 `#DE -> SIGFPE`、`#BP -> SIGTRAP`、`#UD -> SIGILL`、`#GP -> SIGSEGV`。没有 handler 时调用 `process_terminate_current()` 后 `task_exit()`；有 handler 时在用户栈构造 64 字节 signal frame，`iret` 进 handler，`eax=12 sigreturn` 恢复原 GPR/EIP/CS/EFLAGS/ESP/SS。`#DE` 的保存 EIP 指向 faulting `div/idiv`，内核按 `F6/F7` 最小解码后前移。`eax=11 sigaction(sig,handler,mask)` 建表；`fork` 继承 handler 表与 mask，不继承 pending。正常 `exit(7)` 的 wait status 是 `7`，默认信号终止是 `0x80000000 | sig`；子进程退出给父进程置 SIGCHLD pending，父 wait 消费后清零。CPL0 的非 #PF 同步异常没有 fixup，进入诊断停机。
- **用户 exec**：`eax=13 exec(image_id, argv, envp)` 只替换当前进程的用户地址空间和镜像，保留 PID/PPID/任务槽。`process_exec_current()` 先在旧 AS 仍有效时解析并复制 `argv/envp`（最多 4 项、每串最多 31 字符、必须有 NULL 结尾），再建新 AS，按 `argc, argv[], NULL, envp[], NULL, 字符串区` 构造新用户栈；2 项参数/2 项环境时 `esp=0x403FC8`。随后 `cli` 下切 CR3、更新任务持有的 AS 指针，重置 `sigactions`/mask/pending，把 iret 帧改成入口 `0x400000`，再释放旧 AS；解析、AS 分配或栈构造失败时返回 -1，旧 AS/frame 不动。P4.2 只接受内嵌镜像 1，`user/exec/exec.asm` 校验四个字符串后写 `ARGV/ENVP` 并 `exit(10)`。
- **COW 写时复制**：`address_space_clone()` 只分配新 PD/PT，把 data/stack/heap 和内核可写的 control 页清 `RW`、置 PTE bit 9 后共享，代码页只读共享；已经是 COW 的页第二次 fork 时保留 COW 位，避免退化成只读页。首次写触发 `#PF` 时分配新页、复制内容并恢复 VMA 权限，旧页引用计数减一。V 页实测 `forks 3 shared 12 live 2 breaks 6 last AS4 old 0011B000 -> 0011C000`，其中 signal frame 写入用户栈也触发了一次 COW 拆分。
- **brk / guard / copyin-copyout**：`eax=8 brk` 增长 heap 并零填新页、缩回释放、越界拒绝；`eax=9 peek` / `eax=10 poke` 逐字节按 VMA+PTE 翻译用户指针，写 COW 页先拆分。A/B 的 `brk(0x406000)`、`poke(0x405800,"HELP")`、`peek=0x48454C50` 成立；`brk(0x500000)` 返回 `0xFFFFFFFF`；写 guard `0x402000` 返回 0。
- **`#PF` 故障隔离**：`userC` 在私有数据页置 `mode=1`，数到 5000 后故意写内核显存 `0xB8000`；`userF` 在 `mode=3` 直接写 guard `0x402000`。内核只修 heap 内、brk 以下的缺页和 COW 写页；guard/RO/非法地址走 `process_terminate_current(SIGSEGV)`，C/F 的 `EXIT` 显示 `SIG11`。全屏页显示 `#PF count 3`、`cr2 000B8000`、`P/W/U`，A/B 的 CR3 与计数器继续推进。
- **内核态 #PF 诊断页**：按 `K` 从 render 的 kernel task 写 `0x00400000`，越过 0–4 MB 恒等映射，CPL0 触发 `#PF`。panic 页先 `cli`，再显示 PID/comm、CS/CPL、EIP、CR2、ERR、CR3、P/W/U/RSVD/I-D、fault count、recoveries 和 kernel image 范围 `0x80000..0x8E200`；按 `R` 临时映射诊断页、执行完出错写并 `iret` 返回，按 `H` 停机。
- **CPU 统计**：按 `C` 打开全屏 `AEVUM / CPU TIME ACCOUNTING`，三行任务显示 PID、TASK、PRI、WT、STATE、CPU%、TICKS、SHARE，底部是 PIT TICKS、SWITCHES、PREEMPTIONS。百分比来自每个任务的 `cpu_ticks`，并随 PIT 持续变化。
- **机械臂**：三自由度平面臂，Q16.16 定点运算；阻尼最小范数控制、零空间投影、2×2 雅可比奇异值面板。
- **显示**：80×25 VGA 文本，影子显存在 `0x20000`，整块刷新到 `0xB8000`；右侧 `TASK SCHED` 第二行显示每任务 CPU 百分比，第三行保留栈水位条，底部是滚动调度时间轴。
- **串口**：COM1 差量帧 `A5 5A 01 COUNT [row col ch attr] CRC`，每 8 帧扫描一次，每 120 次扫描强制全帧。
- **交互**：空格扫描码 `0x39` 切换零空间；每 420 帧自动切换一次；`P`（扫描码 `0x19`）创建一个全屏 `probe` 任务；`B`（扫描码 `0x30`）把 `idle` 任务阻塞成 `3id B`，再按一次 `B` 唤醒；`T`（扫描码 `0x14`）进入/退出全屏抢占决斗；`C`（扫描码 `0x2E`）进入/退出 CPU 统计页；`F`（扫描码 `0x21`）进入/退出 FPU 页；`G`（扫描码 `0x22`）进入/退出家族树页；`V`（扫描码 `0x2F`）进入/退出 COW fork + 信号 + exec + 物理池页；`K`（扫描码 `0x25`）触发内核态 `#PF` 诊断页，`R` 恢复、`H` 停机；`userC` 写 `0xB8000`、`userF` 写 guard 都会触发 `#PF`，D 的第二轮子进程 `1/0` 触发 `#DE` 并由用户 handler 捕获；C/F 只终止当前用户进程，D 子进程在 `sigreturn` 后继续执行并 `exit(9)`，第三轮子进程 exec 后 `exit(10)`。
- **错误**：错误身份是 `(owner, field)` 字符串对；失败时由 `aevum_fail()` 打印 owner、field、type、detail、at，并停机。

## 模块结构

```text
config/memory.h                 物理内存布局（只读常量）
include/kernel/                 基础类型、结构化错误、任务接口
include/arch/x86/               端口 I/O、IDT/PIC/PIT 接口
include/drivers/                VGA、UART、键盘接口
include/lib/                    定点、三角、格式化接口
include/app/arm/                机械臂运动学、控制、渲染、装配接口
include/app/fpu/                FPU 实验任务与渲染接口
include/app/tree/               家族树演示任务与渲染接口
include/kernel/proc.h            用户 PCB/PID/父子/退出码/wait 接口
include/kernel/task/family.h    内核任务树父子关系/reaper 接口
include/kernel/mm/address_space.h 用户地址空间/CR3 接口
include/arch/x86/page_fault.h    #PF 记录/查询接口
include/arch/x86/exception.h     #DE/#BP/#UD/#GP 记录/信号名接口
include/arch/x86/tss.h           TSS 接口
include/arch/x86/syscall.h       int 0x80 接口
include/arch/x86/frame.h         ring0/ring3 共用中断帧

kernel/main/main.c              组合根
kernel/error/error.c            唯一错误屏/停机入口
kernel/task/task.c              任务字段与 current 的唯一写者
kernel/task/family/family.c      内核任务树的父子关系、reaper、重挂事件
kernel/proc/process.c            用户 PCB、PID、fork/wait/reap/cleanup、信号 pending/SIGCHLD
kernel/mm/address_space/address_space.c  用户 PD/PT、用户页、CR3 切换
arch/x86/cpu/interrupt/interrupt.c  IDT / PIC / PIT 100Hz / DPL3 门
arch/x86/cpu/exception/exception.c  #DE/#BP/#UD/#GP 门、信号默认终止、CPL0 诊断停机
arch/x86/cpu/tss/tss.c           TSS 与 esp0
arch/x86/cpu/syscall/syscall.c   int 0x80 分发
arch/x86/cpu/fault/page_fault.c  IDT 14 门、CR2/ERR/EIP、用户故障 kill、内核态 panic 页与受控探针
user/ring3/ring3.asm             被复制的 ring3 用户代码
user/exec/exec.asm               P4.2 内嵌 exec flat 镜像（argv/env）
drivers/video/vga/text/vga.c    VGA 唯一写者
drivers/serial/uart/uart.c      COM1 与帧快照唯一写者
drivers/input/keyboard/keyboard.c 扫描码读取
lib/fixed/ lib/math/ lib/format/  纯函数
app/arm/kinematics/             纯运动学
app/arm/control/                机械臂状态唯一写者
app/arm/render/                 只读状态快照，拥有轨迹缓冲和任务监视器
app/arm/app/                    三常驻任务装配 + 抢占决斗任务 + CPU 统计页状态
app/fpu/demo/ + app/fpu/render/ XMM0 标签任务 + FPU CONTEXT LAB
app/tree/demo/ + app/tree/render/ famP/famA/famB + 家族树页
app/user/demo/ + app/user/render/ A/B/C/D/F + 三轮 fork/wait + exec + 信号页
```

更细的字段归属、结构化错误表和验收口径见 `CONSTRUCTION.md`。

## 构建与运行

```sh
make clean && make all
make run
```

`kernel.bin` 上限 49,152 字节（`boot.asm` 一次 LBA 读 96 个扇区到 `0x80000`）；当前构建 47,304 字节，BSS 结束于 `0x8E0E0`，镜像余量 1,848 字节；BSS 尾部 `0x8C000..0x8E0E0` 由 loader 清零。桌面固定读取 `disk.img`，`make all` 会同时生成 `os.img` 和 `disk.img`。

无界面验收：

```sh
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

## 运行效果

屏幕左侧是机械臂工作区：`#` 基座、`O` 肘、`*` 腕、`@` 末端、`o` 目标、`.` 轨迹；右侧上半部是 `ARM STATUS` 面板，显示关节角、可操作度、最小奇异值、阻尼/无阻尼速度、末端误差和限位余量。底部根据数据给出奇异构型提示。

右侧下半部是这一版新增的 `TASK SCHED`：

- 第一行是 PID 池占用 `P3/31`、累计切换 `sw` 和 IRQ0 实际抢占 `px`；
- 第二行按 PID 列出 `control` / `render` / `idle` 的状态和真实 CPU 百分比；`probe` 运行时临时出现第 4 项；
- 第二行下方是三条栈水位条，长度按 512 字节一档；
- 底部贯穿全宽的是最近 64 个采样切换的调度时间轴，80 格居中显示，青色/洋红/黄色分别对应三个任务；最近一次采样到的任务会在第二行以彩色底高亮。

这不是静态面板：调度时间轴每帧滚动，任务状态和栈水位来自 `task.c` 的实时快照。

按 `P` 后，`probe` 全屏显示 `PID 4 / RUN #1` 和 `PIT PREEMPTIONS` 计数；探针循环不调用 `task_yield`，计数仍持续增长，证明 IRQ0 真的中断了 CPU 密集型任务。它执行完 `task_exit()` 进入 ZOMBIE，调度器回收 PID，面板回到 `P3/31`。再次按 `P`，画面显示 `RUN #2` 且 PID 仍为 4——这不是打印常量，而是内核 PID 位图的真实分配与复用。

按 `T` 后，全屏变成 `PREEMPTION DUEL`：左右两条 lane 分别属于 `spinA` / `spinB`，两个任务都在 `for (;;)` 里累加 `STEP`，没有一处 `task_yield()`。两条 lane 的进度条、运行历史和底部 80 格“抢占磁带”同时变化，磁带里青色和洋红一格一格交替——这些格子只在 IRQ0 抢占发生时写入，所以它既是画面，也是 PIT 真实打断 CPU 的证据。再按 `T`，两个任务退出，机械臂画面和 `P3/31` 面板恢复。

按 `C` 后，全屏变成 `AEVUM / CPU TIME ACCOUNTING`：

- 三行常驻任务分别显示 `PRI`、`WT`、状态、`CPU%`、`TICKS` 和横向 `SHARE` 条；
- `control` 优先级 3、权重 4，`render` 优先级 2、权重 3，`idle` 优先级 0、权重 1，实测份额约为 `50% / 38% / 12%`；
- 底部 `PIT TICKS` 是三个任务 tick 之和，`SWITCHES` 和 `PREEMPTIONS` 持续增长；再按 `C` 回到机械臂，帧号继续前进。

按 `V` 后，全屏变成 `AEVUM / COW FORK + SIGNALS + PHYS`：PCB 表列出 A/B/C/D/F/E 的 `PID` / `PPID` / `ST` / `EXIT` / `CR3` / `AS` / `PGS/C` / `BRK` / `COMM`；VMA 摘要给出 code RX、data RW、guard、stack RW、control R、heap RW。A/B 的 `brk(0x406000)`、heap `0x405800` poke/peek `0x48454C50`、越界 `brk(0x500000)` 返回 `0xFFFFFFFF`、guard poke 返回 0。C 写 `0xB8000`、F 写 guard 后分别 `ST=FAULT / SIG11`、`ST=GUARD / SIG11`；D 第一轮子进程写 `CHLD` 后 `exit(7)`，父进程显示 `WAIT OK 7 / COW OK` 和 COW 行 `forks 3 shared 12 live 2 breaks 6`；第二轮子进程安装 `SIGFPE` handler 后 `1/0` 触发 `#DE`，父进程 `wait 8` 得到 `st 00000009`，页面显示 `HAND OK`，信号面板为 `#DE 1 pid 8 eip 004002A6 sig 8 SIGFPE hdl 1 chld 3 pend 00000000`；第三轮子进程 `exec(1, argv, envp)`，参数为 `alpha/beta/MODE=p42/LEVEL=2`；父进程 `wait 8` 得到 `st 0000000A`，页面显示 `P4 exec 8 wait 8 st 0000000A img 1 EXEC OK arg 2 env 2`。底部 `PHYS PAGES 20/255` 和 `int 0x80 traps` 同时可见。再按 `V`，所有用户进程被回收，画面回到机械臂，没有 ZOMBIE/PID/页泄漏。

按 `K` 后，画面变成 `AEVUM / KERNEL PAGE FAULT`：`task 2 render` 写 `0x00400000`，`CS=0x0008`、`CPL 0`，`CR2=0x00400000`、`ERR=0x00000002`、`CR3=0x00010000`，`P=0 W/R=1 U/S=0`。页面标题是 `RING0 FAULT - CONTROLLED PROBE`，并提供 `R = recover + re-arm` / `H = halt`；按 `R` 后回到机械臂。独立启动后直接按 `K` 是 `fault count 1`；先跑完整 V 再按 `K` 是累计 `fault count 6`（V 页 3 次、V 停止路径额外 2 次、K 探针 1 次），这个 count 不是单次 probe 次数。

更细的字段归属、结构化错误表和验收口径见 `CONSTRUCTION.md`；机器人学下一目标见 `ROBOTICS.md`。

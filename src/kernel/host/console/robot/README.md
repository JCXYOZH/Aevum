# 32 位裸机多进程内核（教学版）

> 本目录是 AEVUM 桌面「内核实况」窗口实际运行的内核。原 `kernel.c` 已按
> 「归属唯一、定位有码」拆成模块目录；`kernel.bin` 仍由本目录 `Makefile` 产出。
> COM1 串口初始化和 VGA 差量帧上报保留：每轮渲染后把变化的 80×25 单元按
> `A5 5A 01 COUNT [row col ch attr] CRC` 发到 QEMU 串口，由
> `src/kernel/host/bridge/serial_bridge.py` 转成 WebSocket。没有这段串口旁路，
> 内核只写 `0xB8000`，桥接收不到画面。
>
> 构建（Windows 上可用 WSL2，或任意 Linux）：
>
> ```sh
> make clean && make all
> ```
>
> `interface/desktop/main.js` 优先启动本目录的 `disk.img`；`kernel.bin` 上限
> 36,864 字节（boot.asm 一次 LBA 读 72 个扇区到 0x80000）。串口快照放在 `0x30000`，
> 不占内核镜像窗口。模块归属、错误码和验收流程见 `CONSTRUCTION.md`，进程上下文完整化路线见 `PROCESS.md`。

一个用 NASM + C 写的 32 位裸机内核：从软盘镜像启动，进入保护模式、建立自己的 GDT 和分页，
然后运行 `control` / `render` / `idle` 三个常驻任务；按 `P` 可生成一个 `probe` 任务，按 `T` 可启动两个 CPU 密集型任务的抢占决斗，按 `F` 可打开 FPU/SSE 上下文实验，按 `C` 可切到全屏 CPU 时间统计。PIT 100Hz 时间片抢占、按优先级加权的 `vruntime` 选择和任务主动让出共同驱动轮转；按 `V` 可切到 PCB 进程表、fork/wait 与 `#PF` 故障隔离演示，按 `K` 触发内核态 `#PF` 受控探针，页内 `R` 恢复、`H` 停机；整个过程都在 VGA 文本模式下绘制三自由度机械臂和运行信息。

---

## 一、功能简介

- **启动流程**：BIOS 把引导扇区加载到 `0x7C00` → `boot.asm` 用 `INT 13h` 的 LBA 扩展读一次把 72 个扇区读到 `0x80000`
  → 装载 GDT 进入保护模式 → 建立 0~4MB 恒等分页 → 跳到 `0x80000`。
- **内核入口**：`loader.asm` 加载内核自己的 6 项 GDT、清 BSS、把主栈设为 `0xC000`（启动镜像里不再需要尾部搬运），再调用 C 的 `kernel_main`；`tss_init()` 写 TSS 描述符并 `ltr 0x28`。
- **多进程**：`kernel_main` 通过 `task_create` 为 `control` / `render` / `idle` 构造独立内核栈；PID 由 `task.c` 的位图自动分配，应用不再硬编码，再用 `task_start` 切入第一个任务。
  每个进程各自拥有栈和计数器，互不影响。
- **上下文切换**：IDT 门 + 统一中断帧保存 `eax/ebx/ecx/edx/esi/edi/ebp/eip/cs/eflags`；每个任务栈底预留 512 字节 FXSAVE 区，切换时用 `fxsave/fxrstor` 保存 FPU/SSE 状态；`loader.asm` 打开 CR4.OSFXSR/OSXMMEXCPT 并清 CR0.EM/TS。PIT 通道 0 以 100Hz 触发 IRQ0，`task_schedule_irq` 在 IRQ0 与 `int 0x40` 两条入口上做同一套调度；若选中的仍是当前任务，必须恢复 `RUNNING`，否则一次 yield 会让任务永久停在 `READY`、PIT 不再给它计费。
  `task_yield()` / `task_block()` / `task_exit()` / `task_start()` 都走 `int 0x40`；`task_exit()` 置 ZOMBIE；内核任务由调度器回收，用户进程由父进程 `wait` 或 reaper 回收；`task_block()` / `task_wake()` 已打通 BLOCKED 与 READY。
  `task_set_current_state(state)` 是当前任务状态的统一写入口：`RUNNING` 无副作用，`READY` / `BLOCKED` / `ZOMBIE` 分别等价于让出、阻塞、退出；`task_yield()` / `task_block()` / `task_exit()` 都只是它的薄封装。
- **FPU 上下文实验**：按 `F`（扫描码 `0x21`）创建 `fpuA` / `fpuB` 两个 CPU 密集型任务；两个任务都没有 `task_yield()`，各自在 `XMM0` 里保存不同标签和计数。全屏显示两条 lane 的 PID、TAG、COUNT、`CTX OK/LOST` 和进度条；如果 `fxsave/fxrstor` 漏掉，标签会串到另一条 lane，屏幕直接判 `CTX LOST`。再按 `F` 停止并回到机械臂。
- **进程家族树**：按 `G`（扫描码 `0x22`）进入全屏 `AEVUM / PROCESS FAMILY TREE`；`famP` 创建 `famA` / `famB` 后主动退出，两个直接子进程由 `family.c` 重挂到 `idle`。树形页显示真实的 `ppid` 关系、每任务 CPU、reaper 和最近一次 `parent -> reaper` 重挂事件；再按 `G` 停止并回到机械臂。
- **进程地址空间 / PCB 表**：按 `V`（扫描码 `0x2F`）启动五个用户进程：`userA` / `userB` 做独立地址空间计数，`userC` 做用户态 `#PF` 样本，`userD` fork 出 `userE`。每个进程有自己的页目录和 CR3，代码都复制到同一个虚拟地址 `0x400000`，数据页映射到不同物理页；A-E 的 CR3 为 `0x40000 / 0x46000 / 0x4C000 / 0x52000 / 0x58000`。全屏页直接显示 PCB 表：`PID PPID ST EXIT CR3 AS CNT COMM`，另有 `int 0x80`、fork/wait 摘要和 `#PF` 面板。`userD` 的 fork 返回 8，`userE` 的 PPID 为 7；`userE exit(7)` 后变 ZOMBIE，`userD wait` 返回 8、status 7，`userE` 变 `REAP`，页面出现 `WAIT OK 7`。
- **`#PF` 故障隔离**：`userC` 在私有数据页置 `mode=1`，数到 20000 后故意写内核显存 `0xB8000`；CPU 触发 `#PF`，内核读取 `CR2/ERR/EIP`，以 `128+14=142` 退出当前进程，`userA/userB` 的 CR3 与计数器继续推进。全屏页显示 `P/W/U`、`KILLED` 计数和故障 task 的 `comm`，C 行 `EXIT=142`；再按 `V` 停止所有用户进程并回到机械臂。
- **内核态 `#PF` 诊断页**：按 `K`（扫描码 `0x25`）从 `render` 的 kernel task 写 `0x00400000`，越过 0–4 MB 恒等映射，CPL0 触发 `#PF`。页面进入即 `cli`，显示 `task 2 render`、`CS=0x0008 / CPL 0`、`EIP`、`CR2`、`ERR`、`CR3`、`P/W/U/RSVD/I-D`、fault count、recoveries 和 `kernel image 0x00080000..0x00089A34`。按 `R` 临时建立 PDE 1（页表 `0x13000`、诊断页 `0x14000`），让出错写指令执行成功并通过原异常帧 `iret` 返回，随后撤销映射、重新武装 `K`；按 `H` 或遇到非探针内核 fault 仍停机。
- **显示输出**：直接写显存 `0xB8000`（80×25 文本模式），`render` 每帧在影子显存 `0x20000`
  画三自由度机械臂、目标点、轨迹和右侧数值面板，再整块搬到 VGA；同一帧通过 COM1
  把变化的文本单元发给 QEMU 串口，供桌面「内核实况」窗口实时显示。
- **抢占决斗**：按 `T`（扫描码 `0x14`）创建 `spinA` / `spinB` 两个 CPU 密集型任务，循环里都不调用
  `task_yield()`；全屏显示两条 lane 的实时步数、进度条和 80 格 IRQ0 抢占磁带。只有 PIT 真的抢占 CPU，
  两条 lane 才会同时推进，磁带才会出现青/洋红交替的条纹；再按 `T` 停止并回到机械臂画面。
- **优先级与 CPU 统计**：`priority 0..3` 映射为权重 `1..4`；每个 PIT tick 给当前任务 `vruntime += 64 / weight`，`task_pick_next()` 选择 READY 任务中 `vruntime` 最小者，同值按 `prev` 之后的槽位轮转。高优先级任务获得更大份额，低优先级任务不会被饿死。每个任务累计 `cpu_ticks`，面板第二行显示真实 CPU 百分比；按 `C` 打开全屏 `AEVUM / CPU TIME ACCOUNTING`，列出 PID、TASK、PRI、WT、STATE、CPU%、TICKS、SHARE，底部是 PIT TICKS、SWITCHES、PREEMPTIONS。
- **无 libc**：完全 freestanding，字符串输出、整数转十进制和 Q16.16 定点运算都由内核自己实现。

### 操作按键总表

所有按键都由 `app/arm/app/app.c` 的 `proc_render()` 轮询 PS/2 扫描码分发。下表是完整集合，没有隐藏的组合键。

| 当前画面 | 按键 | 扫描码 | 动作 | 返回与限制 |
| --- | --- | --- | --- | --- |
| 机械臂主画面 | `空格` | `0x39` | 切换零空间（nullspace）开/关 | 只在主画面生效；不按键也会每 420 帧自动切换一次 |
| 机械臂主画面 | `P` | `0x19` | 创建 `probe` 任务，全屏显示 PID、生命周期和 PIT 抢占计数 | 自动演示 6000 帧后任务结束并回主画面；没有手动停止键，探针显示期间按 `P` 不会重入 |
| 机械臂主画面 | `B` | `0x30` | 让 `idle` 执行 `task_block()`；再按一次 `task_wake()` 唤醒 | 只在主画面生效；阻塞时第三行显示 `3id B`，并出现 `BLOCKED` 提示 |
| 机械臂主画面 | `T` | `0x14` | 进入/停止 `PREEMPTION DUEL`，创建 `spinA` / `spinB` 两个不让出的 CPU 密集型任务 | 只在主画面启动；停止后等两个 lane 任务结束再回主画面 |
| 机械臂主画面 | `C` | `0x2E` | 进入/退出全屏 `AEVUM / CPU TIME ACCOUNTING` | 只在主画面启动；在统计页再按 `C` 返回 |
| 机械臂主画面 | `F` | `0x21` | 进入/退出全屏 `AEVUM / FPU CONTEXT LAB` | 只在主画面启动；在实验页再按 `F` 返回 |
| 机械臂主画面 | `G` | `0x22` | 进入/退出全屏 `AEVUM / PROCESS FAMILY TREE` | 只在主画面启动；在树页再按 `G`，等 `famP` / `famA` / `famB` 都结束后回主画面 |
| 机械臂主画面 | `V` | `0x2F` | 进入/退出全屏 `AEVUM / PROCESS CONTEXT`，启动 A/B/C/D/E 五个用户进程 | 只在主画面启动；在页内再按 `V`，等 A/B/D 结束后回主画面 |
| 机械臂主画面 | `K` | `0x25` | 触发内核态 `#PF`，进入全屏 `AEVUM / KERNEL PAGE FAULT` | 受控探针；页内按 `R` 恢复并重新武装，按 `H` 停机；不参与其他演示 |
| `KERNEL PAGE FAULT` | `R` | `0x13` | 临时映射 4 MB 诊断页，执行完出错写指令并 `iret` 返回主画面 | 只对 `K` 探针可用；返回后撤销 PDE 1，下一次 `K` 会重新触发 |
| `KERNEL PAGE FAULT` | `H` | `0x23` | 立即停机 | 保留现场，不返回；非探针内核 fault 没有这个选择 |
| `PREEMPTION DUEL` | `T` | `0x14` | 停止决斗 | 全屏页只响应 `T`；停止不是立即切页，要等两个任务退出 |
| `CPU TIME ACCOUNTING` | `C` | `0x2E` | 返回机械臂 | 全屏页只响应 `C` |
| `FPU CONTEXT LAB` | `F` | `0x21` | 停止实验并返回机械臂 | 全屏页只响应 `F` |
| `PROCESS FAMILY TREE` | `G` | `0x22` | 停止演示并返回机械臂 | 全屏页只响应 `G`；有任务未退完时继续显示树页 |
| `PROCESS CONTEXT` | `V` | `0x2F` | 停止所有用户进程并返回机械臂 | 全屏页只响应 `V`；等 A/B/D 都结束后回主画面 |
| `PID PROBE` | 无 | — | 自动运行到结束 | 没有停止键，也不能在探针页启动其他演示 |

补充：

- 这些全屏演示互斥：`T` / `C` / `F` / `G` / `V` 只能从机械臂主画面进入，进入后其他演示键不响应。`K` 是受控故障注入入口，不参与互斥；页内 `R` 恢复，`H` 停机。
- 机械臂主画面没有方向键、目标点手动输入、`ESC` 退出或 `R` 复位；目标点沿预设轨迹自动移动，`make run` 的退出由 QEMU 窗口或宿主终端负责。
- `P` / `B` / 空格只在机械臂主画面生效；任何全屏演示期间按它们都不会改变后台任务。
- `V` 的用户任务使用独立 CR3；`V` 页显示的 `CS=0x1B` 是最近一次 `int 0x80` 帧里的真实 CS，不是固定字符串。

### 运行效果

```
 3-DOF Arm | PIT 100Hz | P/B/T/C/F/G/V/K
 ARM STATUS                         nullsp ON
 joint angles
 q1  -37.1  q2  60.9  q3  83.6
 ...
 tip @  elbow O  wrist *  target o  path .  base #  radial sweep
```

机械臂会持续追踪右侧面板里的目标点，`control` 算控制量，`render` 负责渲染；PIT 100Hz 抢占保证 CPU 密集型任务也不能独占。

---

## 二、环境安装与要求

### 运行环境

- 64 位 Linux（Debian / Ubuntu / Kali 等），或 Windows 上的 WSL2。
- 终端里能执行 `make`。

### 依赖工具

| 工具 | 用途 | 说明 |
| --- | --- | --- |
| `nasm` | 汇编器 | 汇编 `boot.asm`、`loader.asm` |
| `gcc` | C 编译器 | 需要支持 `-m32` 编译（能生成 32 位目标文件即可） |
| `ld`（binutils） | 链接器 | 用 `-m elf_i386` 按 `kernel.ld` 链接 |
| `make` | 构建工具 | 执行 Makefile |
| `qemu-system-i386` | 模拟器 | 运行生成的 `os.img` |

### 安装命令（Debian / Ubuntu / Kali）

```bash
sudo apt-get update
sudo apt-get install -y nasm gcc make binutils qemu-system-x86

# 可选：想在系统里另外链接普通 32 位程序时再装
sudo apt-get install -y gcc-multilib
```

> 本项目的链接方式是 freestanding（不连 libc、直接用 `ld` 链接），
> 所以**不装 `gcc-multilib` 也能构建成功**，它只是方便你做别的 32 位实验。

### 验证安装

```bash
nasm -v
gcc -dumpversion
ld --version | head -1
make --version | head -1
qemu-system-i386 --version | head -1
```

### 本项目测试过的版本

- nasm 3.01
- gcc 15（x86_64-linux-gnu）
- GNU ld (binutils) 2.47
- GNU Make 4.4.1
- QEMU 11.1.0

---

## 三、构建与运行

```bash
make            # 生成 os.img
make run        # 用 QEMU 启动并显示内核画面
make debug      # 启动 QEMU 并停在起点等待 gdb（gdb: target remote :1234）
make clean      # 删除全部编译产物
make rebuild    # 先 clean 再重新编译
```

没有图形界面时，可用无界面方式启动：

```bash
qemu-system-i386 -drive format=raw,file=os.img -display none
```

---

## 四、文件说明

### 源文件

| 文件 | 作用 |
| --- | --- |
| `boot.asm` | 主引导扇区（512 字节）。用 `INT 13h` 的 LBA 扩展一次读 72 个扇区到 `0x80000`；设置 GDT；建立 `0x10000` 页目录 + `0x11000` 页表（恒等映射 0~4MB）；开启分页后跳到 `0x80000`。 |
| `loader.asm` | 保护模式入口 `start`。打开 CR4.OSFXSR/OSXMMEXCPT、清 CR0.EM/TS；加载 6 项内核 GDT（ring0/ring3 代码、数据、TSS 槽），清 BSS，主栈设 `0xC000`，调用 `kernel_main`；提供 IRQ0、`int 0x40`、`int 0x80` 和 `#PF` 四个 stub，返回后死循环。 |
| `kernel/main/main.c` | 组合根：初始化 VGA、串口、任务、机械臂应用、IDT/PIC/PIT，最后切入第一个任务。 |
| `kernel/error/error.c` | 唯一错误屏与停机入口，打印 `0xRRFFTT` 四要素。 |
| `kernel/task/task.c` | `task_struct`、任务槽、上下文切换的唯一写者。 |
| `arch/x86/cpu/fault/page_fault.c` | IDT 14 号门、用户态故障隔离、内核态 panic 页与 `page_fault_probe()` 的唯一写者。 |
| `kernel/task/family/family.c` | 只维护内核任务树的父子关系、reaper 与孤儿重挂；用户进程父子关系归 `kernel/proc/process.c`。 |
| `kernel/proc/process.c` | 用户 PCB、PID、父子关系、退出码、`fork/wait/reap/cleanup` 的唯一写者；只持有 AS 和 task 指针。 |
| `arch/x86/cpu/interrupt/interrupt.c` | IDT、8259A PIC 重映射、PIT 100Hz、EOI 的唯一写者。 |
| `drivers/video/vga/text/vga.c` | VGA 影子显存与文本绘制。 |
| `drivers/serial/uart/uart.c` | COM1 初始化、差量帧上报。 |
| `drivers/input/keyboard/keyboard.c` | PS/2 扫描码读取。 |
| `lib/fixed/`、`lib/math/`、`lib/format/` | 定点、三角、格式化。 |
| `app/arm/kinematics/`、`control/`、`render/`、`app/` | 机械臂纯运动学、控制状态、渲染、任务装配。 |
| `app/fpu/demo/`、`app/fpu/render/` | FPU/SSE 实验的任务状态与全屏页面。 |
| `app/tree/demo/`、`app/tree/render/` | 家族树演示任务与树形页；演示任务由 `famP` 创建两个子进程后退出。 |
| `kernel.ld` | 链接脚本。加载基址 `0x80000`；BSS 当前到 `0x89A34`，由 loader 清零；`render` 栈从 `0x9000` 起，远低于内核段。 |
| `Makefile` | 构建脚本：汇编、编译、链接、打包镜像，以及运行 / 调试 / 清理。 |

### 生成的文件（`make clean` 会全部删除）

| 文件 | 说明 |
| --- | --- |
| `boot.bin` | `boot.asm` 汇编出的 512 字节引导扇区。 |
| `build/` | 各模块的 `.o` 与 `loader.o` 中间产物。 |
| `kernel.elf` | 带符号信息的 ELF，用于 `objdump` / `gdb` 调试。 |
| `kernel.bin` | 纯二进制内核镜像，被写入磁盘。 |
| `os.img` | 1.44MB 软盘镜像：第 0 扇区是 `boot.bin`，第 1 扇区起是 `kernel.bin`。 |

---

## 五、内存布局

| 物理地址 | 用途 |
| --- | --- |
| `0x00080000` – `0x00089000` | boot 一次 LBA 读取的 72 扇区（36KB）窗口；当前 `kernel.bin` 34,504 字节 |
| `0x000886E0` – `0x00089A34` | `.bss`：loader 载入后由 `rep stosb` 清零；尾部高于加载窗口 |
| `0x00009000` – `0x00009FFF` | `render` 任务栈（栈顶 `0xA000`，向下增长） |
| `0x0000A000` – `0x0000AFFF` | `idle` 任务栈（栈顶 `0xB000`，向下增长） |
| `0x0000B000` – `0x0000BFFF` | 内核主线程栈（栈顶 `0xC000`） |
| `0x0000C000` – `0x0000CFFF` | `probe` 任务栈（栈顶 `0xD000`，按 `P` 创建） |
| `0x0000D000` – `0x0000DFFF` | `spinA` 任务栈（栈顶 `0xE000`，按 `T` 创建） |
| `0x0000E000` – `0x0000EFFF` | `spinB` 任务栈（栈顶 `0xF000`，按 `T` 创建） |
| `0x001FF000` – `0x001FFFFF` | `control` 任务栈（栈顶 `0x200000`，向下增长） |
| `0x00200000` – `0x00200FFF` | `userA` 的内核栈（栈顶 `0x201000`） |
| `0x00201000` – `0x00201FFF` | `userB` 的内核栈（栈顶 `0x202000`） |
| `0x00010000` / `0x00011000` | 内核页目录 / 页表（`boot.asm` 建立 0–4MB 恒等映射） |
| `0x00013000` – `0x00013FFF` | `K` 探针恢复用的 PDE 1 页表；默认 PDE 1=0，按 `R` 时临时挂上 |
| `0x00014000` – `0x00014FFF` | `K` 探针恢复用的诊断页；只承接 `0x00400000` 的写操作 |
| `0x00012000` – `0x000127FF` | 256 项 IDT（`0x20` IRQ0、`0x40` 软件调度门、`0x80` ring3 系统调用门） |
| `0x00088660` – `0x0008868F` | 内核 GDT（6 项：ring0 代码/数据、ring3 代码/数据、TSS） |
| `0x00089420` – `0x00089487` | TSS（ring3 进内核时提供 `esp0/ss0`） |
| `0x00040000` – `0x00045FFF` | 用户 A 的 PD/PT/代码/数据/栈/控制页（6×4KB） |
| `0x00046000` – `0x0004BFFF` | 用户 B 的 PD/PT/代码/数据/栈/控制页（6×4KB） |
| `0x0004C000` – `0x00051FFF` | 用户 C 的 PD/PT/代码/数据/栈/控制页（6×4KB） |
| `0x00052000` – `0x00057FFF` | 用户 D 的 PD/PT/代码/数据/栈/控制页（6×4KB） |
| `0x00058000` – `0x0005DFFF` | 用户 E 的 PD/PT/代码/数据/栈/控制页（6×4KB） |
| `0x0005E000` – `0x00063FFF` | 用户 F 的预留地址空间（6×4KB） |
| `0x00202000` – `0x00202FFF` | `userC` 的内核栈（栈顶 `0x203000`） |
| `0x00203000` – `0x00203FFF` | `userD` 的内核栈（栈顶 `0x204000`） |
| `0x00204000` – `0x00204FFF` | `userE` 的内核栈（栈顶 `0x205000`） |
| `0x00205000` – `0x00205FFF` | `userF` 预留内核栈（栈顶 `0x206000`） |
| `0x00020000` | VGA 影子显存 |
| `0x00030000` | 串口帧快照 |
| `0x000B8000` | VGA 文本显存（80×25，每字符 2 字节：字符 + 颜色） |

---

## 六、注意事项

1. **内核镜像必须小于 36KB**：`boot.asm` 一次 LBA 读 72 个扇区（36,864 字节）到 `0x80000`。
   当前 `kernel.bin` 为 34,504 字节，BSS 结束于 `0x89A34`；镜像数据本身不超过 36,864 字节，余量 2,360 字节。BSS 尾部 `0x89000..0x89A34` 不在加载窗口内，由 loader 按链接符号清零。
   内核已完全避开 BIOS 低内存暂存区与 `0x7C00` boot 代码；若继续增长，必须同时增加扇区数并同步 `kernel.ld`/`config/memory.h`。
2. 内核页目录 / 页表固定在 `0x10000` / `0x11000`，IDT 固定在 `0x12000..0x127FF`；内核 GDT 在 `.data` 的 `0x88660..0x8868F`，TSS 在 BSS 的 `0x89420..0x89487`；不要和内核段或任务栈重叠。
3. 按 `B`（扫描码 `0x30`）可把 `idle` 任务阻塞成 `3id B`，再按一次唤醒；这是 `BLOCKED` 状态的可控演示。
4. 按 `T`（扫描码 `0x14`）进入/退出抢占决斗；决斗使用 `spinA` / `spinB` 两个 CPU 密集型任务，只有 PIT/IRQ0 抢占才能让两边同时前进。
5. 按 `C`（扫描码 `0x2E`）在机械臂与全屏 CPU 统计页之间切换；统计页中的 CPU% 来自每个任务的 `cpu_ticks`，不是静态文本。
6. 按 `F`（扫描码 `0x21`）进入/退出全屏 `AEVUM / FPU CONTEXT LAB`；两个任务在 `XMM0` 里各自保存不同标签，屏幕的 `CTX OK` 表示切换后读回的是自己的状态。
7. 按 `G`（扫描码 `0x22`）进入/退出全屏 `AEVUM / PROCESS FAMILY TREE`；`famP` 退出后 `famA` / `famB` 会被重挂到 `idle`，右侧面板显示父 PID、子 PID 和新父亲。
8. 按 `V`（扫描码 `0x2F`）进入/退出全屏 `AEVUM / PROCESS CONTEXT`；A-E 都从 CPL3 的 `0x400000` 执行，但 `CR3`、代码物理页、数据物理页和计数器不同。D fork E 的 `fork` 返回 8、E 的 PPID 为 7，E `exit(7)` 后 D `wait` 得到 status 7，E 行变 `REAP`；C 写 `0xB8000` 触发 `#PF` 后以 142 退出，A/B 继续运行。按 `V` 停止后所有用户进程被回收，再按 `V` 能重新启动完整进程组。
9. 任务栈顶由 `config/memory.h` 的 `AEVUM_STACK_P1=0x200000` / `AEVUM_STACK_P2=0xA000` / `AEVUM_STACK_IDLE=0xB000` / `AEVUM_STACK_MAIN=0xC000` / `AEVUM_STACK_PROBE=0xD000` / `AEVUM_STACK_DUEL_A=0xE000` / `AEVUM_STACK_DUEL_B=0xF000` / `AEVUM_STACK_USER_A=0x201000` / `AEVUM_STACK_USER_B=0x202000` / `AEVUM_STACK_USER_C=0x203000` / `AEVUM_STACK_USER_D=0x204000` / `AEVUM_STACK_USER_E=0x205000` / `AEVUM_STACK_USER_F=0x206000` 决定，修改时要保证互不重叠。每个任务栈底部 512 字节是 FXSAVE 区，实际可用栈为 3.5KB。
10. 中断帧布局必须与 `loader.asm` 的 `SAVE_CTX/RESTORE_CTX` 逐槽一致；新增字段时先改汇编压栈顺序，再改 `struct irq_frame`，否则 `iret` 会恢复到错误地址。
11. `control` 栈已移到 `0x1FF000..0x1FFFFF`；内核镜像整体在 `0x80000..0x89A34`，与 `render` 栈 `0x9000`、用户地址空间 `0x40000..0x63FFF` 不重叠；加载窗口 72 扇区到 `0x89000`，BSS 尾部由 loader 清零。
12. 全局 `CFLAGS` 用 `-Os -mno-sse`；只有 `app/fpu/demo` 追加 `-msse2`。非 FPU 模块若让编译器生成 SSE 暂存，会和 `fxsave` 捕获任务 `XMM` 状态的时序打架，表现为 `TAG 0 / CTX LOST`。
13. `K` 的恢复只修共享内核 PD 的 PDE 1，不碰用户地址空间；恢复后 `page_fault_probe()` 撤销 PTE/PDE 并 `invlpg`。非探针内核 fault 没有 fixup，仍走 panic 停机。

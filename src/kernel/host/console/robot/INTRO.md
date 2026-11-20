# Aevum Robot Kernel 介绍

## 是什么

`Aevum Robot Kernel` 是一个 32 位裸机多进程教学内核。它不依赖 libc，不跑在桌面操作系统里，而是由 BIOS 引导扇区直接装入 `0x1000`，进入保护模式、开启分页，然后运行三个协作式任务：

- `control`：计算机械臂每一步的关节速度与位置；
- `render`：把机械臂、目标点、轨迹和状态面板画到 VGA 文本屏，同时通过 COM1 上报差量帧；
- `idle`：空闲任务，用来验证调度器在没有业务可做时仍能正常轮转。

桌面端的「内核实况」窗口读取本目录的 `disk.img`，再由 `src/kernel/host/bridge/serial_bridge.py` 把串口帧转成 WebSocket 画面。没有这段串口旁路，内核只写 `0xB8000`，桌面收不到画面。

## 能做什么

- **引导**：`boot.asm` 读 32 个扇区到 `0x1000`，建立 GDT、0~4MB 恒等页表，跳到内核入口。
- **多任务**：`task.c` 管理 6 个任务槽，三个常驻任务按 READY/RUNNING 状态轮转；任务主动调用 `task_yield()`，调度策略归 `task.c`，应用层不再指定“下一个是谁”。
- **任务描述符**：每个任务保存 PID、状态、优先级、栈底/栈顶、上下文、切出次数；栈底填魔数，运行时扫描得到真实栈水位。**PID 由 `task.c` 的 31 位位图自动分配**，`task_create` 不再接收显式 PID，应用层也不写 1/2/3；任务 `task_exit()` 后置为 ZOMBIE，下一次 `task_yield()` 回收 PID。
- **机械臂**：三自由度平面臂，Q16.16 定点运算；阻尼最小范数控制、零空间投影、2×2 雅可比奇异值面板。
- **显示**：80×25 VGA 文本，影子显存在 `0x20000`，整块刷新到 `0xB8000`；右侧新增 `TASK SCHED` 任务监视器和滚动调度条。
- **串口**：COM1 差量帧 `A5 5A 01 COUNT [row col ch attr] CRC`，每 8 帧扫描一次，每 120 次扫描强制全帧。
- **交互**：空格扫描码 `0x39` 切换零空间；每 420 帧自动切换一次；`P`（扫描码 `0x19`）创建一个全屏 `probe` 任务。
- **错误**：统一 `0xRRFFTT` 错误码；失败时由 `aevum_fail()` 打印错误码、owner、field、detail，并停机。

## 模块结构

```text
config/memory.h                 物理内存布局（只读常量）
include/kernel/                 基础类型、错误码、任务接口
include/arch/x86/               端口 I/O、上下文切换接口
include/drivers/                VGA、UART、键盘接口
include/lib/                    定点、三角、格式化接口
include/app/arm/                机械臂运动学、控制、渲染、装配接口

kernel/main/main.c              组合根
kernel/error/error.c            唯一错误屏/停机入口
kernel/task/task.c              任务字段与 current 的唯一写者
arch/x86/cpu/context/context.c  cpu_switch
drivers/video/vga/text/vga.c    VGA 唯一写者
drivers/serial/uart/uart.c      COM1 与帧快照唯一写者
drivers/input/keyboard/keyboard.c 扫描码读取
lib/fixed/ lib/math/ lib/format/  纯函数
app/arm/kinematics/             纯运动学
app/arm/control/                机械臂状态唯一写者
app/arm/render/                 只读状态快照，拥有轨迹缓冲和任务监视器
app/arm/app/                    三任务装配；不再手工指定下一个任务
```

更细的字段归属、错误码表和验收口径见 `CONSTRUCTION.md`。

## 构建与运行

```sh
make clean && make all
make run
```

`kernel.bin` 上限 16384 字节（`boot.asm` 读 32 个扇区）；当前构建 15,476 字节，保留约 908 字节余量。桌面固定读取 `disk.img`，`make all` 会同时生成 `os.img` 和 `disk.img`。

无界面验收：

```sh
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

## 运行效果

屏幕左侧是机械臂工作区：`#` 基座、`O` 肘、`*` 腕、`@` 末端、`o` 目标、`.` 轨迹；右侧上半部是 `ARM STATUS` 面板，显示关节角、可操作度、最小奇异值、阻尼/无阻尼速度、末端误差和限位余量。底部根据数据给出奇异构型提示。

右侧下半部是这一版新增的 `TASK SCHED`：

- 第一行是 PID 池占用 `P3/31` 和累计上下文切换次数；
- 第二行按 PID 列出 `control` / `render` / `idle` 的状态和真实栈水位（单位字节）；`probe` 运行时临时出现第 4 项；
- 第二行下方是三条栈水位条，长度按 512 字节一档；
- 底部贯穿全宽的是最近 64 个采样切换的调度时间轴，80 格居中显示，青色/洋红/黄色分别对应三个任务；最近一次采样到的任务会在第二行以彩色底高亮。

这不是静态面板：调度时间轴每帧滚动，任务状态和栈水位来自 `task.c` 的实时快照。

按 `P` 后，`probe` 全屏显示 `PID 4 / RUN #1`；它执行完 `task_exit()` 进入 ZOMBIE，下一次 `task_yield()` 回收 PID，面板回到 `P3/31`。再次按 `P`，画面显示 `RUN #2` 且 PID 仍为 4——这不是打印常量，而是内核 PID 位图的真实分配与复用。

更细的字段归属、错误码表和验收口径见 `CONSTRUCTION.md`；机器人学下一目标见 `ROBOTICS.md`。




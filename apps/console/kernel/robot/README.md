# 32 位裸机多进程内核（教学版）

> 本目录是 AEVUM 桌面「内核实况」窗口实际运行的内核。`kernel.c` 保留旧教学内核的
> 完整结构，并追加了
> COM1 串口初始化和 VGA 差量帧上报：每轮 `render(); flush();` 后把变化的
> 80×25 单元按 `A5 5A 01 COUNT [row col ch attr] CRC` 发到 QEMU 串口，
> 由 `apps/console/bridge/serial_bridge.py` 转成 WebSocket。没有这段串口旁路，
> 原内核只写 `0xB8000`，桥接是收不到画面的。画布上边界从第 1 行下移到第 2 行，
> 让第 0 行的标题不被画布边框覆盖。
>
> 构建（Windows 上可用 WSL2，或任意 Linux）：
>
> ```sh
> make clean && make all
> ```
>
> `apps/desktop/main.js` 优先启动本目录的 `disk.img`；`kernel.bin` 必须不超过
> 8192 字节（boot.asm 读 16 个扇区到 0x1000）。串口快照放在 `0x30000`，
> 不占内核镜像的低 8KB。

一个用 NASM + C 写的 32 位裸机内核：从软盘镜像启动，进入保护模式、建立自己的 GDT 和分页，
然后运行两个进程（`proc1` / `proc2`），用协作式上下文切换轮流执行，并在 VGA 文本模式下
打印带有自增计数的运行信息。

---

## 一、功能简介

- **启动流程**：BIOS 把引导扇区加载到 `0x7C00` → `boot.asm` 用 `INT 13h` 把内核读到 `0x1000`
  → 装载 GDT 进入保护模式 → 建立 0~4MB 恒等分页 → 跳到 `0x1000`。
- **内核入口**：`loader.asm` 设置内核栈并调用 C 的 `kernel_main`。
- **多进程**：`kernel_main` 为两个进程分别构造独立内核栈，然后用 `switch_to` 启动第一个进程。
  每个进程各自拥有栈和计数器，互不影响。
- **上下文切换**：`cpu_switch` 保存/恢复 7 个通用寄存器与栈指针，实现真正意义上的任务切换；
  采用协作式调度（进程主动调用 `switch_to` 让出 CPU）。
- **显示输出**：直接写显存 `0xB8000`（80×25 文本模式），`proc2` 每帧在影子显存 `0x20000`
  画三自由度机械臂、目标点、轨迹和右侧数值面板，再整块搬到 VGA；同一帧通过 COM1
  把变化的文本单元发给 QEMU 串口，供桌面「内核实况」窗口实时显示。
- **无 libc**：完全 freestanding，字符串输出、整数转十进制和 Q16.16 定点运算都由内核自己实现。

### 运行效果

```
 3-DOF Planar Arm  |  Jacobian live demo
 ARM STATUS                         nullsp ON
 joint angles
 q1  -37.1  q2  60.9  q3  83.6
 ...
 tip @  elbow O  wrist *  target o  path .  base #  radial sweep
```

机械臂会持续追踪右侧面板里的目标点，`proc1` 算控制量，`proc2` 负责渲染，1:1 协作切换。

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
| `boot.asm` | 主引导扇区（512 字节）。用 `INT 13h` 读 16 个扇区到 `0x1000`；设置 GDT；建立 `0x10000` 页目录 + `0x11000` 页表（恒等映射 0~4MB）；开启分页后跳到 `0x1000`。 |
| `loader.asm` | 保护模式下的入口 `start`。把栈设为 `0x6000` 并调用 C 的 `kernel_main`；返回后死循环停机。 |
| `kernel.c` | 内核主体：进程描述符 `task_struct`、上下文切换 `cpu_switch` / `switch_to`、两个进程 `proc1` / `proc2`、显存输出与整数显示。 |
| `kernel.ld` | 链接脚本。所有段从 `0x1000` 起连续排布，整体保持在 `0x3000` 以下，避免与栈、页表冲突。 |
| `Makefile` | 构建脚本：汇编、编译、链接、打包镜像，以及运行 / 调试 / 清理。 |

### 生成的文件（`make clean` 会全部删除）

| 文件 | 说明 |
| --- | --- |
| `boot.bin` | `boot.asm` 汇编出的 512 字节引导扇区。 |
| `loader.o` | `loader.asm` 的 32 位 ELF 目标文件。 |
| `kernel.o` | `kernel.c` 的 32 位目标文件。 |
| `kernel.elf` | 带符号信息的 ELF，用于 `objdump` / `gdb` 调试。 |
| `kernel.bin` | 纯二进制内核镜像，被写入磁盘。 |
| `os.img` | 1.44MB 软盘镜像：第 0 扇区是 `boot.bin`，第 1 扇区起是 `kernel.bin`。 |

---

## 五、内存布局

| 物理地址 | 用途 |
| --- | --- |
| `0x00001000` | 内核镜像（`.text` / `.rodata` / `.data` / `.bss`） |
| `0x00003000` – `0x00003FFF` | `proc1` 的内核栈（栈顶 `0x4000`，向下增长） |
| `0x00004000` – `0x00004FFF` | `proc2` 的内核栈（栈顶 `0x5000`，向下增长） |
| `0x00005000` – `0x00005FFF` | 内核主线程栈（栈顶 `0x6000`） |
| `0x00010000` | 页目录 PD（`boot.asm` 使用） |
| `0x00011000` | 页表 PT（`boot.asm` 使用） |
| `0x000B8000` | VGA 文本显存（80×25，每字符 2 字节：字符 + 颜色） |

---

## 六、注意事项

1. **内核镜像必须小于 8KB**：`boot.asm` 一次只读 16 个扇区（8KB）到 `0x1000`。
   如果 `kernel.bin` 超过 8KB，需要同步增大 `boot.asm` 里的读取扇区数
   （并注意不要跨出磁道边界）。
2. 页目录 / 页表固定在 `0x10000` / `0x11000`，不要和内核段或进程栈重叠。
3. 进程栈顶由 `kernel.c` 里的 `STACK_P1` / `STACK_P2` 决定，修改时要保证互不重叠。
4. `cpu_switch` 必须是 `__attribute__((naked))`（无栈帧）：普通 C 函数会在寄存器与返回地址之间
   插入编译器栈帧，任务被“重新调度回来”时 `ret` 会弹到错误地址。
# P6.0 运行速度基线

本文件只记录当前 `P6.0` clean 构建在 QEMU 里的实测值。它不是硬件实时性报告，也不能直接外推为未来机器人控制器的抖动指标。

## 1. 构建设置

- 源码目录：`D:\Aevum\src\kernel\host\console\robot`
- 构建：WSL Debian，`gcc 16.2.0-3`、`ld 2.46`、`nasm`，`make clean && make kernel.bin && make disk.img`
- QEMU：`qemu-system-i386` 11.1.0，`-m 32M`，`-display none`，TCG（未使用 KVM）
- 镜像：`disk.img=1,474,560` 字节
- 内核：`kernel.bin=64,488` 字节，上限 65,536，余量 1,048 字节
- `boot.bin=512` 字节
- SHA256：kernel `48b25c3f...`，boot `d9a70ce2...`，disk `bbcc9235...`
- BSS 结束：`__bss_end=0x9387C`，`AEVUM_KERNEL_END=0x94000`

## 2. 定时器与控制周期

当前 PIT 是唯一周期源：

- `PIT_HZ=100`
- 输入时钟 1,193,182 Hz
- divisor 11,931
- 实际约 100.0069 Hz，周期约 9.9993 ms
- IRQ0 向量 `0x20`

因此在没有 one-shot timer / 更高 tick 之前，控制回路的硬上限是 100 Hz，即 10 ms 一个 tick。1 kHz 伺服（1 ms 周期）不能靠现有 tick 直接得到。

## 3. CPU 页实测

在机械臂主画面按 `C` 进入 `AEVUM / CPU TIME ACCOUNTING`，间隔 5 秒抓两次屏：

| 采样 | PIT TICKS | SWITCHES | PREEMPTIONS | control ticks | render ticks | idle ticks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 286 | 97,684 | 259 | 142 (50%) | 108 (38%) | 36 (12%) |
| B | 700 | 227,574 | 643 | 350 (50%) | 265 (38%) | 87 (12%) |

B 行三任务 ticks 相加为 702，PIT TICKS 为 700；这是同一帧页面采样的 1–2 tick 偏差（任务 ticks 与全局 tick 不是同一时刻原子快照），比例仍按 50/38/12 使用，不把三行相加当成精确总数。

两次采样相差：

- 414 个 PIT tick = 4.1397 秒（按 9.9993 ms/tick）
- SWITCHES +129,890，约 **31,377 次/秒**
- PREEMPTIONS +384，约 **92.8 次/秒**
- 平均每个逻辑切换间隔约 **31.9 微秒**
- control / render / idle 的 tick 增量分别为 +208 / +157 / +51，比例仍是 50% / 38% / 12%

解释边界：

- `SWITCHES` 是调度器“选中另一个任务”的计数，不等价于一次完整的硬件上下文切换成本；它包含 `task_yield()`、`int 0x40` 和 IRQ0 抢占路径。
- 31k 次/秒说明三个常驻任务仍在频繁主动让出，不是每 10 ms 才动一次。`idle` 仍占 12%，没有 `hlt` 停机。
- PIT tick 只决定抢占节拍；任务自己 `yield` 的切换不在这 100 Hz 里。这个差别对实时控制很重要：100 Hz 是“最长不被抢占的粒度”，不是“任务实际切换次数上限”。

## 4. 启动首帧

用 QEMU monitor 在启动后每约 60 ms `screendump` 一次：

- 监视器建立后第一次采样在 69 ms，画面已经是完整机械臂主界面（`PIT 100Hz`、机械臂、`ARM STATUS`、`TASK SCHED`）。
- 25 次采样从 69 ms 到 1,582 ms 都有稳定非空画面。
- 只能说明“首帧不晚于监视器建立后约 69 ms”；QEMU 进程启动前的 BIOS/loader 时间没有被这段采样覆盖，不能当作硬件启动时间。

## 5. 还缺的测量

- 没有 100 轮 fork/wait 的当前墙钟时间；P5.3 的两轮 `100/100` 是历史功能证据，不是本轮速度数据。当前 V 页 D lane 是 4 轮 fork/wait，不是 100 轮。
- 没有测量单次上下文切换的周期数、IRQ 进入/退出延迟、最坏关中断时间。
- 没有真实硬件数据；QEMU TCG 不是实时环境，不能给出机器人关节抖动的可信上限。

## 6. 对后续硬件内核的直接含义

1. **先做阻塞 wait**：当前 `wait` 仍是 `task_yield()` 轮询；父进程等待子进程时会持续参与调度。P6.1 应把“扫描子进程 + 进入 BLOCKED”放在同一个不可被打断的临界区，避免 lost wake。
2. **idle 要能停机**：`idle` 占 12% 且频繁 yield；真实硬件上应改成 `hlt`/WFI 或事件驱动，不能让 idle 空转。
3. **控制周期要独立于 100 Hz tick**：1 kHz 伺服需要 1 kHz tick、APIC/HPET one-shot 或独立 PWM/定时器；不能把 100 Hz 当控制周期。
4. **把渲染移出控制路径**：`render` 占 38%，当前和 `control` 共享 PIT tick；硬件上应先保证 control 的截止时间，再让 render 降频或在空闲时间跑。
5. **先测真实切换成本**：31k 次/秒是逻辑计数，不等于 31k 次完整保存/恢复的成本；在目标硬件上要用 TSC/周期计数器测 `task_switch` 前后差值。

## 7. 证据文件

- `D:\Aevum\build\p6-baseline\p60-cpu-a.png`：A 采样
- `D:\Aevum\build\p6-baseline\p60-cpu-b.png`：B 采样
- `D:\Aevum\build\p6-baseline\p60-g-late.png`：G 页重挂后
- `D:\Aevum\build\p6-baseline\p60-vtree.png`：V 页 TREE
- `D:\Aevum\build\p6-baseline\bootf-00.png`：首帧采样（PNG，已从 PPM 转换）
- `D:\Aevum\src\kernel\host\console\robot\kernel.bin`、`disk.img`：本轮 clean 产物

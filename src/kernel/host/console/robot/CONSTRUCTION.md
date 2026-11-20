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
| 任务 | `kernel/task/task.c` | `task_struct` 字段、`tasks[]`、`current_task`、`pid_map`、切换轨迹 | `task_boot/task_create/task_set_state/task_current/task_switch_to/task_exit/task_yield/task_pid_used` |
| 端口 I/O | `include/arch/x86/io.h` | `in/out` 指令封装 | `port_inb/port_outb`（内联） |
| 上下文 | `arch/x86/cpu/context/context.c` | 寄存器保存/恢复 | `cpu_switch()` |
| VGA | `drivers/video/vga/text/vga.c` | 影子显存 `0x20000`、`0xB8000` 刷新 | `vga_*` |
| 串口 | `drivers/serial/uart/uart.c` | COM1、`0x30000` 快照、差量帧缓冲 | `uart_*` |
| 键盘 | `drivers/input/keyboard/keyboard.c` | 无状态；只读扫描码 | `keyboard_poll()` |
| 定点 | `lib/fixed/fixed.c` + `include/lib/fixed.h` | Q16.16 运算 | `fx_mul/fx_div/isqrt64/fx_sqrt` |
| 三角 | `lib/math/trig.c` | `sin_tab`、`fx_sin_deg` | `fx_sin/fx_cos/fx_deg/fx_rad` |
| 格式化 | `lib/format/format.c` | 十进制/定点转字符串 | `fmt_dec/fmt_fx` |
| 运动学 | `app/arm/kinematics/kinematics.c` | 纯函数，无状态 | `arm_fk/arm_jacobian/arm_solve` |
| 控制 | `app/arm/control/control.c` | `q/dq/points/target/...` 与 `arm_status` 快照 | `arm_control_init/step/toggle_nullspace/status` |
| 渲染 | `app/arm/render/render.c` | 轨迹环形缓冲 `trace[]`；只读 `arm_status` | `arm_render_init/frame/trace_push` |
| 应用装配 | `app/arm/app/app.c` | `p_control/p_render/app_dep_code`；两进程调度 | `arm_app_init/start/dep_code` |
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

## 三、内存与构建预算

| 地址 | 用途 |
| --- | --- |
| `0x1000` | 内核镜像起点 |
| `0x1000..0x4FFF` | boot 读取的 32 扇区（16KB）窗口 |
| `0x5000..0x5FFF` | 内核 BSS 尾部与保留区（不放置任务栈） |
| `0x7000` | `control` 任务栈顶（向下增长） |
| `0x8000` | `render` 任务栈顶（向下增长） |
| `0x9000` | `idle` 任务栈顶（向下增长） |
| `0xA000` | 内核主线程栈顶 |
| `0xB000` | `probe` 任务栈顶（按 `P` 创建） |
| `0x10000 / 0x11000` | 页目录 / 页表 |
| `0x20000` | VGA 影子显存 |
| `0x30000` | 串口帧快照 |
| `0xB8000` | VGA 文本显存 |

`boot.asm` 读 32 个扇区到 `0x1000`，所以 `kernel.bin` 必须不超过 16384 字节。
当前构建 15,444 字节，保留约 940 字节余量。若继续增长，先加 `boot.asm` 扇区数，
同时把 `control`/`render` 栈和主栈整体上移，不要覆盖任务栈。

## 四、验收

```sh
make clean && make all
wc -c kernel.bin          # 必须 <= 16384
timeout 6 qemu-system-i386 -accel tcg -drive format=raw,file=disk.img \
  -display none -serial file:/tmp/robot-serial.bin -no-reboot
xxd -l 4 /tmp/robot-serial.bin   # 期望 a5 5a 01
```

通过标准：

- `kernel.bin` 不超过 16384 字节，链接无 undefined symbol。
- QEMU 不 triple fault，串口首帧为 `a5 5a 01 ...`。
- 屏幕出现机械臂、目标点、轨迹和右侧 `ARM STATUS` 面板。
- 空格扫描码 `0x39` 可切换零空间；每 420 帧自动切换。
- 按 `P`（扫描码 `0x19`）创建 `probe` 任务，画面显示 PID（首次为 4）；任务退出后 `P3/31` 回到 3，再按 `P` 仍分配 PID 4，证明 ZOMBIE 回收与 PID 复用。

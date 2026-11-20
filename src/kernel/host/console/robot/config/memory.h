#ifndef AEVUM_CONFIG_MEMORY_H
#define AEVUM_CONFIG_MEMORY_H

/*
 * 物理内存布局。boot.asm 已建立 0~4MB 恒等映射，内核只使用低地址。
 * 这些地址是跨模块共享的布局常量，只允许本文件定义，其他模块只读。
 */
#define AEVUM_KERNEL_BASE       0x00001000u
#define AEVUM_KERNEL_END        0x00006000u
#define AEVUM_STACK_P1          0x00007000u
#define AEVUM_STACK_P2          0x00008000u
#define AEVUM_STACK_IDLE        0x00009000u
#define AEVUM_STACK_MAIN        0x0000A000u
#define AEVUM_STACK_PROBE       0x0000B000u
#define AEVUM_STACK_DUEL_A      0x0000C000u
#define AEVUM_STACK_DUEL_B      0x0000D000u
#define AEVUM_TASK_STACK_MIN    0x00006000u
#define AEVUM_TASK_STACK_MAX    0x0000D000u
#define AEVUM_TASK_STACK_SIZE   0x00001000u
#define AEVUM_VGA_PHYS          0x000B8000u
#define AEVUM_SHADOW            0x00020000u
#define AEVUM_FRAME_SNAP        0x00030000u

#endif

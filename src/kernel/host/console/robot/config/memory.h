#ifndef AEVUM_CONFIG_MEMORY_H
#define AEVUM_CONFIG_MEMORY_H

/*
 * 物理内存布局。boot.asm 建立 0~4MB 恒等映射；内核静态区在 0x8000 以下，
 * 页表、任务栈和用户页都在 4MB 以内。地址是跨模块共享常量，只允许本文件定义。
 */
#define AEVUM_KERNEL_BASE       0x00001000u
#define AEVUM_KERNEL_END        0x000088BCu
#define AEVUM_STACK_P1          0x00200000u
#define AEVUM_STACK_P2          0x0000A000u
#define AEVUM_STACK_IDLE        0x0000B000u
#define AEVUM_STACK_USER_A      0x00201000u
#define AEVUM_STACK_USER_B      0x00202000u
#define AEVUM_STACK_MAIN        0x0000C000u
#define AEVUM_STACK_PROBE       0x0000D000u
#define AEVUM_STACK_DUEL_A      0x0000E000u
#define AEVUM_STACK_DUEL_B      0x0000F000u
#define AEVUM_TASK_STACK_MIN    0x00008000u
#define AEVUM_TASK_STACK_MAX    0x00202000u
#define AEVUM_TASK_STACK_SIZE   0x00001000u
#define AEVUM_PAGE_SIZE         0x00001000u
#define AEVUM_FPU_STATE_SIZE    0x00000200u
#define AEVUM_TASK_STACK_USABLE (AEVUM_TASK_STACK_SIZE - AEVUM_FPU_STATE_SIZE)
#define AEVUM_VGA_PHYS          0x000B8000u
#define AEVUM_KERNEL_PD          0x00010000u
#define AEVUM_KERNEL_PT          0x00011000u
#define AEVUM_SHADOW            0x00020000u
#define AEVUM_FRAME_SNAP        0x00030000u

/* 用户地址空间：每进程一套 PD/PT 和四张用户页，物理页仍落在 4MB 恒等映射内。 */
#define AEVUM_AS_BASE           0x00040000u
#define AEVUM_AS_STRIDE         0x00006000u
#define AEVUM_AS_MAX            2
#define AEVUM_USER_VA_BASE      0x00400000u
#define AEVUM_USER_CODE_VA      0x00400000u
#define AEVUM_USER_DATA_VA      0x00401000u
#define AEVUM_USER_STACK_VA     0x00402000u
#define AEVUM_USER_CONTROL_VA   0x00403000u
#define AEVUM_USER_STACK_TOP    0x00403000u

#endif

#ifndef AEVUM_CONFIG_MEMORY_H
#define AEVUM_CONFIG_MEMORY_H

/*
 * 物理内存布局。boot.asm 建立 0~4MB 恒等映射；内核静态区在 0x80000..0x8C140，
 * 页表、任务栈和用户页都在 4MB 以内。地址是跨模块共享常量，只允许本文件定义。
 */
#define AEVUM_KERNEL_BASE       0x00080000u
#define AEVUM_KERNEL_END        0x0008C300u
#define AEVUM_STACK_P1          0x00200000u
#define AEVUM_STACK_P2          0x0000A000u
#define AEVUM_STACK_IDLE        0x0000B000u
#define AEVUM_STACK_USER_A      0x00201000u
#define AEVUM_STACK_USER_B      0x00202000u
#define AEVUM_STACK_USER_C      0x00203000u
#define AEVUM_STACK_USER_D      0x00204000u
#define AEVUM_STACK_USER_E      0x00205000u
#define AEVUM_STACK_USER_F      0x00206000u
#define AEVUM_STACK_MAIN        0x0000C000u
#define AEVUM_STACK_PROBE       0x0000D000u
#define AEVUM_STACK_DUEL_A      0x0000E000u
#define AEVUM_STACK_DUEL_B      0x0000F000u
#define AEVUM_TASK_STACK_MIN    0x00008000u
#define AEVUM_TASK_STACK_MAX    0x00206000u
#define AEVUM_TASK_STACK_SIZE   0x00001000u
#define AEVUM_PAGE_SIZE         0x00001000u
#define AEVUM_FPU_STATE_SIZE    0x00000200u
#define AEVUM_TASK_STACK_USABLE (AEVUM_TASK_STACK_SIZE - AEVUM_FPU_STATE_SIZE)
#define AEVUM_VGA_PHYS          0x000B8000u
#define AEVUM_KERNEL_PD          0x00010000u
#define AEVUM_KERNEL_PT          0x00011000u
/* 内核态 #PF 恢复专用：PDE 1 的页表与一张诊断页，位于 IDT 与影子显存之间。 */
#define AEVUM_KERNEL_PF_PT       0x00013000u
#define AEVUM_KERNEL_PF_PAGE     0x00014000u
#define AEVUM_PF_PROBE_VA        0x00400000u
#define AEVUM_SHADOW            0x00020000u
#define AEVUM_FRAME_SNAP        0x00030000u

/* 用户地址空间：每进程一套 PD/PT 和 VMA 映射，物理页从全局页池分配。 */
#define AEVUM_AS_BASE           0x00040000u
#define AEVUM_AS_STRIDE         0x00006000u
#define AEVUM_AS_MAX            6
#define AEVUM_USER_VA_BASE      0x00400000u
#define AEVUM_USER_CODE_VA      0x00400000u
#define AEVUM_USER_DATA_VA      0x00401000u
#define AEVUM_USER_GUARD_VA     0x00402000u
#define AEVUM_USER_STACK_VA     0x00403000u
#define AEVUM_USER_CONTROL_VA   0x00404000u
#define AEVUM_USER_STACK_TOP    0x00404000u
#define AEVUM_USER_HEAP_VA      0x00405000u
#define AEVUM_USER_HEAP_MAX     0x00410000u
#define AEVUM_USER_VMA_MAX      8

/*
 * 用户页物理池：内核镜像、VGA/BIOS ROM 影子、任务栈之外的空闲区。
 * 0x100000..0x1FEFFF 共 255 页，位于 0..4MB 恒等映射内；避开 0xC0000
 * 起的 VGA BIOS 影子 ROM 和 0x200000 起的任务栈。
 */
#define AEVUM_PHYS_POOL_BASE    0x00100000u
#define AEVUM_PHYS_POOL_END     0x001FF000u

#endif

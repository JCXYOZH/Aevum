#ifndef AEVUM_KERNEL_TASK_STACK_H
#define AEVUM_KERNEL_TASK_STACK_H

#include "kernel/types.h"

/*
 * 动态内核栈池的唯一 owner。
 * 池区 0x200000..0x20C000，共 AEVUM_KSTACK_COUNT 个 4KB 槽；
 * 分配返回栈顶（不含），栈底由 task_create_common 按 4KB 计算。
 * 内核静态任务（render/idle/main/probe/duel）继续使用低地址固定栈，
 * 不进入本池；用户进程/线程和 P8 动态 kthread 使用本池。
 */
void kernel_stack_reset(void);
u32 kernel_stack_alloc(void);
void kernel_stack_free(u32 top);
int kernel_stack_used(void);
int kernel_stack_capacity(void);

#endif

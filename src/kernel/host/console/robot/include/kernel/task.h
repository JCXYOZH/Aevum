#ifndef AEVUM_KERNEL_TASK_H
#define AEVUM_KERNEL_TASK_H

#include "kernel/types.h"

#define TASK_NAME_MAX 15

enum task_state {
    TASK_RUNNING = 0,
    TASK_INTERRUPTIBLE = 1
};

struct task_struct;

/* 任务模块是 task_struct 字段的唯一写者；调用方只拿不透明句柄。 */
void task_boot(void);
u32 task_create(int pid, const char *name, void (*entry)(void), u32 stack_top,
                struct task_struct **out);
u32 task_set_state(struct task_struct *task, int state);
struct task_struct *task_current(void);
u32 task_switch_to(struct task_struct *next);

#endif

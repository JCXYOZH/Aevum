#ifndef AEVUM_KERNEL_TASK_H
#define AEVUM_KERNEL_TASK_H

#include "kernel/types.h"

#define TASK_NAME_MAX 15
#define TASK_MAX 6

enum task_state {
    TASK_UNUSED = 0,
    TASK_READY = 1,
    TASK_RUNNING = 2,
    TASK_BLOCKED = 3,
    TASK_ZOMBIE = 4
};

struct task_struct;

/* 进程描述符的只读快照；渲染/监视器只能读，不能改任务字段。 */
struct task_info {
    int pid;
    int state;
    int priority;
    char comm[TASK_NAME_MAX + 1];
    u32 stack_top;
    u32 stack_used;
    u32 switches;
};

/* 任务模块是 task_struct 字段的唯一写者；调用方只拿不透明句柄。 */
void task_boot(void);
u32 task_create(int priority, const char *name,
                void (*entry)(void), u32 stack_top, struct task_struct **out);
void task_exit(void) __attribute__((noreturn));
int task_current_pid(void);
int task_pid_used(void);
int task_pid_capacity(void);
u32 task_set_state(struct task_struct *task, int state);
struct task_struct *task_current(void);
u32 task_switch_to(struct task_struct *next);

/* 协作式轮转：当前任务主动让出，调度策略归 task.c，不再由应用层指定下一个。 */
u32 task_yield(void);

/* 阻塞/唤醒：阻塞后不返回，直到另一个任务 task_wake(pid) 把它重新置为 READY。 */
u32 task_block(void);
u32 task_wake(int pid);

/* 监视器接口：按槽位读任务快照；返回 0 表示该槽未使用。 */
int task_snapshot(int slot, struct task_info *out);
int task_trace_len(void);
u32 task_trace_pid(int index);
u32 task_switch_total(void);

#endif

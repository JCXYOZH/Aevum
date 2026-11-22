#ifndef AEVUM_KERNEL_TASK_H
#define AEVUM_KERNEL_TASK_H

#include "kernel/types.h"

#define TASK_NAME_MAX 15
#define TASK_MAX 10

enum task_state {
    TASK_UNUSED = 0,
    TASK_READY = 1,
    TASK_RUNNING = 2,
    TASK_BLOCKED = 3,
    TASK_ZOMBIE = 4
};

struct task_struct;
struct address_space;
struct process;
struct irq_frame;

/* 进程描述符的只读快照；渲染/监视器只能读，不能改任务字段。 */
struct task_info {
    int pid;
    int state;
    int priority;
    char comm[TASK_NAME_MAX + 1];
    u32 stack_top;
    u32 stack_used;
    u32 switches;
    u32 cpu_ticks;
};

/* 任务模块是 task_struct 字段的唯一写者；调用方只拿不透明句柄。 */
void task_boot(void);
u32 task_create(int priority, const char *name,
                void (*entry)(void), u32 stack_top, struct task_struct **out);

/* 用户任务：进程表先保留 PID，任务模块只负责把该 PID 变成可调度的 ring3 任务。 */
u32 task_create_user_with_pid(int priority, const char *name, u32 user_eip,
                              u32 kernel_stack_top, struct address_space *space,
                              u32 user_stack_top, struct process *proc, int pid,
                              struct task_struct **out);

/* fork：复制父进程当前 ring3 中断帧、用户栈和 FPU 状态；子任务 eax=0。 */
u32 task_fork_user(int pid, const char *name, struct irq_frame *frame,
                   u32 kernel_stack_top, struct address_space *space,
                   struct process *proc, struct task_struct **out);

/* PID 由进程/任务共用；进程表保留 PID 后，任务创建不再二次分配。 */
int task_pid_reserve(void);
void task_pid_release(int pid);

/* 用户 ZOMBIE 由 process_wait/reaper 回收：清任务槽但不释放 PID/地址空间。 */
int task_release_slot(int pid);
void task_exit(void) __attribute__((noreturn));
int task_current_pid(void);
int task_pid_of(struct task_struct *task);
struct process *task_process_current(void);
struct process *task_process_of(struct task_struct *task);
int task_pid_used(void);
int task_pid_capacity(void);
struct task_struct *task_current(void);

/* 状态标签的唯一映射：渲染层不要再各写一份 switch。 */
char task_state_char(int state);
const char *task_state_name(int state);

/* 从启动线程切入第一个任务；成功后不返回。 */
void task_start(struct task_struct *first) __attribute__((noreturn));

/* 主动让出：进入 int 0x40，与 PIT IRQ0 共用 task.c 的同一个调度入口。 */
u32 task_yield(void);

/* 阻塞/唤醒：阻塞时切走；另一个任务 task_wake(pid) 置 READY 后，本调用才返回。 */
u32 task_block(void);
u32 task_wake(int pid);

/*
 * 统一的当前任务状态入口：
 * TASK_RUNNING 无副作用；TASK_READY 等价 yield；TASK_BLOCKED 等价 block；
 * TASK_ZOMBIE 不返回。非 RUNNING 的当前任务或其他状态返回 ERR_TASK_BAD_STATE。
 */
u32 task_set_current_state(int state);

/* 监视器接口：按槽位读任务快照；返回 0 表示该槽未使用。 */
int task_snapshot(int slot, struct task_info *out);
int task_snapshot_pid(int pid, struct task_info *out);
int task_trace_len(void);
u32 task_trace_pid(int index);
u32 task_switch_total(void);
u32 task_preempt_total(void);
u32 task_cpu_total(void);

#endif

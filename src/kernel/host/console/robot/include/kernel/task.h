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

/* 任务模块是 task_struct 字段的唯一写者；调用方只拿不透明句柄。
 * 创建成功返回 0，失败返回失败字段名（例如 "out"/"entry"/"stack"/"slot"）。 */
void task_boot(void);
const char *task_create(int priority, const char *name,
                        void (*entry)(void), u32 stack_top,
                        struct task_struct **out);

/* 用户任务：进程表先保留 PID，任务模块只负责把该 PID 变成可调度的 ring3 任务。 */
const char *task_create_user_with_pid(int priority, const char *name, u32 user_eip,
                                      u32 kernel_stack_top,
                                      struct address_space *space,
                                      u32 user_stack_top, struct process *proc,
                                      int pid, struct task_struct **out);

/* fork：复制父进程当前 ring3 中断帧、用户栈和 FPU 状态；子任务 eax=0。 */
const char *task_fork_user(int pid, const char *name, struct irq_frame *frame,
                           u32 kernel_stack_top, struct address_space *space,
                           struct process *proc, struct task_struct **out);

/* PID 由进程/任务共用；进程表保留 PID 后，任务创建不再二次分配。 */
int task_pid_reserve(void);
int task_pid_reserve_hint(int pid);
void task_pid_release(int pid);

/* 用户 ZOMBIE 由 process_wait/reaper 回收：清任务槽但不释放 PID/地址空间。 */
int task_release_slot(int pid);
void task_exit(void) __attribute__((noreturn));
int task_current_pid(void);
int task_pid_of(struct task_struct *task);
struct process *task_process_current(void);
struct process *task_process_of(struct task_struct *task);
/*
 * exec 更换地址空间时，任务持有的 space 指针必须一起换。
 * 只允许 process 模块调用；CR3 切换由 address_space 负责。
 */
void task_set_space(struct task_struct *task, struct address_space *space);
int task_pid_used(void);
int task_pid_capacity(void);
struct task_struct *task_current(void);

/* 状态标签的唯一映射：渲染层不要再各写一份 switch。 */
char task_state_char(int state);
const char *task_state_name(int state);

/* 从启动线程切入第一个任务；成功后不返回。 */
void task_start(struct task_struct *first) __attribute__((noreturn));

/* 主动让出：进入 int 0x40，与 PIT IRQ0 共用 task.c 的同一个调度入口。
 * 成功返回 0，失败返回失败字段名。 */
const char *task_yield(void);

/* 阻塞/唤醒：阻塞时切走；另一个任务 task_wake(pid) 置 READY 后，本调用才返回。 */
const char *task_block(void);
const char *task_wake(int pid);

/*
 * 统一的当前任务状态入口：
 * TASK_RUNNING 无副作用；TASK_READY 等价 yield；TASK_BLOCKED 等价 block；
 * TASK_ZOMBIE 不返回。非 RUNNING 的当前任务或其他状态返回 "state"。
 */
const char *task_set_current_state(int state);

/* 监视器接口：按槽位读任务快照；返回 0 表示该槽未使用。 */
int task_snapshot(int slot, struct task_info *out);
int task_snapshot_pid(int pid, struct task_info *out);
int task_trace_len(void);
u32 task_trace_pid(int index);
u32 task_switch_total(void);
u32 task_preempt_total(void);
u32 task_cpu_total(void);

#endif

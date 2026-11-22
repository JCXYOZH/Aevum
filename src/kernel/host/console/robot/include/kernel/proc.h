#ifndef AEVUM_KERNEL_PROC_H
#define AEVUM_KERNEL_PROC_H

#include "kernel/types.h"

struct address_space;
struct task_struct;
struct irq_frame;

#define PROC_MAX 8
#define PROC_NAME_MAX 15

/*
 * 用户进程生命周期。PID、父子关系、退出码和 wait 状态归本模块；
 * 调度、内核栈和 FPU 现场仍归 task 模块；页表和用户页归 address_space。
 */
enum proc_state {
    PROC_FREE = 0,
    PROC_LIVE = 1,
    PROC_ZOMBIE = 2,
    PROC_DEAD = 3
};

struct process_info {
    int used;
    int pid;
    int ppid;
    int state;
    int task_state;
    u32 exit_code;
    char comm[PROC_NAME_MAX + 1];
    u32 stack_top;
    u32 cr3;
    u32 asid;
    u32 counter;
    u32 code_phys;
    u32 data_phys;
    u32 brk;
    u32 user_pages;
    u32 vma_count;
    u32 switches;
    u32 cpu_ticks;
};

void process_boot(void);

/* 由 kernel task 创建用户进程：保留 PID，分配 AS/内核栈，最后才发布任务 READY。 */
struct process *process_create_user(int priority, const char *name,
                                    const u8 *code, u32 code_size,
                                    u32 kernel_stack_top, u32 user_stack_top);

/* fork 当前 ring3 进程：复制 VMA 用户页、内核帧和 FPU；父返回子 PID，子返回 0。 */
struct process *process_fork(struct irq_frame *frame);

/* 标记当前进程 ZOMBIE 并记录退出码；调用方随后 task_exit()。 */
int process_exit_current(u32 code);

/* wait 子进程：P1 用 task_yield() 轮询，找到 ZOMBIE 后写 user status 并回收。 */
int process_wait(int pid, u32 user_status);

int process_getpid_current(void);
int process_getppid_current(void);
int process_alive(int pid);
int process_live_count(void);

/* V 停止：给所有活进程的控制页写停止字。 */
void process_stop_all(void);

/* V 新启动前：回收上一轮 ZOMBIE，清掉 DEAD 墓碑。 */
void process_cleanup(void);

/* 调度器钩子：回收没有活父进程的 ZOMBIE；不碰当前任务。 */
void process_reap_orphans(void);

int process_snapshot(int slot, struct process_info *out);
int process_count(void);
int process_pid_of(struct process *proc);
struct address_space *process_space(struct process *proc);
u32 process_read32(int pid, u32 va);

#endif

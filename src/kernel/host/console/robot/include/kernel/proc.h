#ifndef AEVUM_KERNEL_PROC_H
#define AEVUM_KERNEL_PROC_H

#include "kernel/types.h"

struct address_space;
struct task_struct;
struct irq_frame;
struct proc_fd_table;

#define PROC_MAX 8
#define PROC_NAME_MAX 15

/* P3.2：同步异常先查每进程 handler；无 handler 才走 P3.1 的默认终止。 */
#define PROC_NSIG    32
#define PROC_SIG_DFL 0u
#define PROC_SIG_IGN 1u
#define PROC_SIGILL  4
#define PROC_SIGTRAP 5
#define PROC_SIGFPE  8
#define PROC_SIGSEGV 11
#define PROC_SIGCHLD 17

/* wait status 高位置 1 表示被信号终止；正常退出仍保留原 exit code。 */
#define PROC_WAIT_SIGNAL_FLAG 0x80000000u
#define PROC_WAIT_STATUS(sig) (PROC_WAIT_SIGNAL_FLAG | ((u32)(sig) & 0x7Fu))
#define PROC_WAIT_IS_SIGNAL(status) (((status) & PROC_WAIT_SIGNAL_FLAG) != 0)
#define PROC_WAIT_SIGNAL(status) ((status) & 0x7Fu)
#define PROC_WAIT_EXIT_CODE(status) ((status) & 0xFFu)

/*
 * 用户进程生命周期。PID、父子关系、退出码、信号和 wait 状态归本模块；
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
    u32 cow_pages;
    u32 vma_count;
    u32 switches;
    u32 cpu_ticks;
    u32 pending;
    u32 last_sig;
    u32 term_sig;
    u32 sig_count;
    u32 sigchld_count;
    u32 sig_handled;
    u32 sig_mask;
    u32 image_id;
    u32 exec_argc;
    u32 exec_envc;
};

void process_boot(void);

/* 由 kernel task 创建用户进程：保留 PID，分配 AS/内核栈，最后才发布任务 READY。 */
struct process *process_create_user(int priority, const char *name,
                                    const u8 *code, u32 code_size,
                                    u32 kernel_stack_top, u32 user_stack_top);

/* fork 当前 ring3 进程：复制 VMA 用户页、内核帧和 FPU；父返回子 PID，子返回 0。 */
struct process *process_fork(struct irq_frame *frame);

/*
 * P4.2 exec：保留当前 PID/PPID/任务槽，新建 AS 并切换到内嵌用户镜像。
 * argv/envp 是旧 AS 中的用户指针；内核在释放旧 AS 前解析并复制字符串，
 * 按 argc/argv[]/NULL/envp[]/NULL/字符串区 写入新用户栈。
 * 成功返回 0，失败保留原 AS 并返回 -1；成功后调用方直接归还改写后的 irq_frame。
 * P4.3：exec 不触碰当前进程的 fd 表，pipe 端点随进程保留。
 */
int process_exec_current(struct irq_frame *frame, int image_id, u32 argv, u32 envp);

/* 标记当前进程 ZOMBIE 并记录退出码；调用方随后 task_exit()。 */
int process_exit_current(u32 code);

/*
 * 同步异常的唯一终止入口：把当前进程标成 ZOMBIE，exit status 记为
 * PROC_WAIT_STATUS(sig)，并给父进程置 SIGCHLD pending；调用方随后 task_exit()。
 */
int process_terminate_current(int sig);

/*
 * P3.2 每进程同步信号动作：handler=0 默认终止，1 忽略，其他值为用户 VA。
 * mask 只随 signal frame 保存/恢复，当前不做阻塞。
 */
int process_sigaction_current(int sig, u32 handler, u32 mask);

/*
 * 用户态同步异常投递：有用户 handler 时在用户栈构造 signal frame，
 * 改写 iret 目标；返回 1 表示 frame 已改成 handler 入口。
 * 无 handler、忽略但无法安全前移、或 frame 构造失败时返回 0，由调用方默认终止。
 * #DE 的保存 EIP 指向 faulting div/idiv，本函数会按最小指令长度前移。
 */
int process_signal_deliver(struct irq_frame *frame, int sig, u32 vector);

/* sigreturn：从用户栈 signal frame 恢复原 GPR/EIP/CS/EFLAGS/ESP/SS。 */
int process_sigreturn_current(struct irq_frame *frame);

/* 当前进程已执行 handler 的次数；异常记录在投递时取一次快照，避免 PID 复用后失真。 */
u32 process_sig_handled_current(void);

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
/* 每进程 fd 表归 kernel/proc/fd；exec 不重建它，fork 复制引用。 */
struct proc_fd_table *process_fds(struct process *proc);
u32 process_read32(int pid, u32 va);
/* exec 后镜像编号；0 表示初始 ring3 镜像，1 表示 P4.2 exec 镜像，2 表示 P4.3 pipe 镜像。 */
int process_image_id(int pid);
/* exec 后参数计数；同 PID 有多个墓碑时取最大镜像代次，失败返回 -1。 */
int process_exec_counts(int pid, u32 *argc, u32 *envc);

/* 最近两次 wait 回收子进程的 exec 快照，用于 PID 复用后的 V 页证据。 */
int process_reaped_exec(int parent_pid, int slot, int *pid,
                        u32 *image_id, u32 *argc, u32 *envc);

#endif

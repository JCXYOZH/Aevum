#include "kernel/proc.h"
#include "kernel/task.h"
#include "kernel/mm/address_space.h"
#include "arch/x86/exception.h"
#include "arch/x86/frame.h"
#include "config/memory.h"

#define PROC_STACK_COUNT 6
#define PROC_SIGFRAME_MAGIC 0x53494746u  /* "SIGF" */

extern u8 user_program_start[];
extern u8 user_sigreturn_trampoline[];
extern u8 user_exec_start[];
extern u8 user_exec_end[];

struct proc_sigaction {
    u32 handler;
    u32 mask;
    u32 flags;
};

/*
 * signal frame 布局固定：低地址是 sigreturn trampoline 返回地址，随后是
 * 内核保存的原 iret 帧和通用寄存器。顺序必须与 process_signal_deliver()
 * 写入、process_sigreturn_current() 读回一致。
 */
struct proc_signal_frame {
    u32 eax, ebx, ecx, edx, esi, edi, ebp;
    u32 eip, cs, eflags, user_esp, ss;
    u32 sig, old_mask, magic;
};

struct process {
    int pid;
    int ppid;
    int state;
    u32 exit_code;
    char comm[PROC_NAME_MAX + 1];
    u32 stack_top;
    struct address_space *space;
    struct task_struct *task;
    u32 pending;
    u32 last_sig;
    u32 term_sig;
    u32 sig_count;
    u32 sigchld_count;
    struct proc_sigaction sigactions[PROC_NSIG];
    u32 sig_mask;
    u32 sig_handled;
    u32 image_id;
};

static struct process procs[PROC_MAX];
static const u32 stack_tops[PROC_STACK_COUNT] = {
    AEVUM_STACK_USER_A, AEVUM_STACK_USER_B, AEVUM_STACK_USER_C,
    AEVUM_STACK_USER_D, AEVUM_STACK_USER_E, AEVUM_STACK_USER_F
};
static u32 stack_map;

static void proc_reset_signals(struct process *p)
{
    int i;

    p->pending = 0;
    p->last_sig = 0;
    p->term_sig = 0;
    p->sig_count = 0;
    p->sigchld_count = 0;
    p->sig_mask = 0;
    p->sig_handled = 0;
    for (i = 0; i < PROC_NSIG; i++) {
        p->sigactions[i].handler = PROC_SIG_DFL;
        p->sigactions[i].mask = 0;
        p->sigactions[i].flags = 0;
    }
}

static void proc_zero(struct process *p)
{
    int i;
    p->pid = 0;
    p->ppid = 0;
    p->state = PROC_FREE;
    p->exit_code = 0;
    for (i = 0; i <= PROC_NAME_MAX; i++) p->comm[i] = 0;
    p->stack_top = 0;
    p->space = 0;
    p->task = 0;
    p->image_id = 0;
    proc_reset_signals(p);
}

void process_boot(void)
{
    int i;
    for (i = 0; i < PROC_MAX; i++) {
        proc_zero(&procs[i]);
        procs[i].pid = -1;
    }
    stack_map = 0;
}

static struct process *proc_find_active(int pid)
{
    int i;
    if (pid <= 0) return 0;
    for (i = 0; i < PROC_MAX; i++) {
        if ((procs[i].state == PROC_LIVE || procs[i].state == PROC_ZOMBIE) &&
            procs[i].pid == pid)
            return &procs[i];
    }
    return 0;
}

/* pending 只记录 1..31 号信号；推荐动作由投递方决定，不在这里改状态。 */
static void proc_signal_pending(struct process *p, int sig)
{
    if (!p || sig <= 0 || sig > 31) return;
    p->pending |= 1u << (sig - 1);
    p->last_sig = (u32)sig;
    p->sig_count++;
    if (sig == PROC_SIGCHLD) p->sigchld_count++;
}

/*
 * #DE 保存的 EIP 指向 faulting div/idiv 本身。这里只解码 P3.2 用到的
 * F6/F7 group：opcode + ModRM + 可选 SIB/位移，返回指令长度。
 * 其他异常返回 0，由原来的默认终止路径处理。
 */
static u32 proc_fault_skip_len(struct process *p, u32 vector, u32 eip)
{
    u8 buf[8];
    u32 i = 0;
    u32 op;
    u32 modrm;
    u32 mod;
    u32 rm;

    if (!p || !p->space || vector != EXC_DE) return 0;
    if (address_space_copyin(p->space, buf, eip, sizeof(buf)) != 0) return 0;

    if (buf[0] == 0x66) i++;
    if (i >= sizeof(buf)) return 0;
    op = buf[i++];
    if (op != 0xF6 && op != 0xF7) return 0;
    if (i >= sizeof(buf)) return 0;

    modrm = buf[i++];
    mod = modrm >> 6;
    rm = modrm & 7u;
    if (mod != 3 && rm == 4) {
        u32 sib;
        if (i >= sizeof(buf)) return 0;
        sib = buf[i++];
        if (mod == 0 && (sib & 7u) == 5) i += 4;
    }
    if (mod == 0 && rm == 5) i += 4;
    else if (mod == 1) i += 1;
    else if (mod == 2) i += 4;

    return i <= sizeof(buf) ? i : 0;
}

static u32 proc_sigreturn_trampoline_va(void)
{
    return AEVUM_USER_CODE_VA +
           (u32)((u32)user_sigreturn_trampoline - (u32)user_program_start);
}

int process_sigaction_current(int sig, u32 handler, u32 mask)
{
    struct process *self;

    if (sig <= 0 || sig >= PROC_NSIG) return -1;
    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (self->state != PROC_LIVE || !self->space) return -1;
    if (handler != PROC_SIG_DFL && handler != PROC_SIG_IGN &&
        !address_space_user_range_ok(self->space, handler, 1, 0))
        return -1;

    self->sigactions[sig].handler = handler;
    self->sigactions[sig].mask = mask & 0x7FFFFFFFu;
    self->sigactions[sig].flags = 0;
    return 0;
}

int process_signal_deliver(struct irq_frame *frame, int sig, u32 vector)
{
    struct process *self;
    struct proc_sigaction *action;
    struct proc_signal_frame sf;
    u32 frame_addr;
    u32 skip;
    u32 tramp;
    u32 frame_size;

    if (!frame || sig <= 0 || sig >= PROC_NSIG) return 0;
    if (!task_current() || !task_process_current()) return 0;
    self = task_process_current();
    if (self->state != PROC_LIVE || !self->space) return 0;
    if ((frame->cs & 3u) != 3u) return 0;

    action = &self->sigactions[sig];
    if (action->handler == PROC_SIG_DFL) return 0;

    skip = proc_fault_skip_len(self, vector, frame->eip);
    if (vector == EXC_DE && skip == 0) return 0;

    if (action->handler == PROC_SIG_IGN) {
        /* #DE 可安全前移；#BP 的保存 EIP 已经指向下一条。其他同步异常重试会死循环。 */
        if (skip == 0 && vector != EXC_BP) return 0;
        frame->eip += skip;
        self->sig_handled++;
        return 1;
    }

    if (!address_space_user_range_ok(self->space, action->handler, 1, 0))
        return 0;
    if (frame->user_esp < sizeof(sf) + 4u) return 0;

    frame_size = (u32)sizeof(sf) + 4u;
    frame_addr = (frame->user_esp - frame_size) & ~3u;
    if (frame_addr < AEVUM_USER_STACK_VA ||
        frame_addr + frame_size > AEVUM_USER_STACK_TOP)
        return 0;
    if (!address_space_user_range_ok(self->space, frame_addr, frame_size, 1))
        return 0;

    tramp = proc_sigreturn_trampoline_va();
    if (!address_space_user_range_ok(self->space, tramp, 1, 0)) return 0;

    sf.eax = frame->eax;
    sf.ebx = frame->ebx;
    sf.ecx = frame->ecx;
    sf.edx = frame->edx;
    sf.esi = frame->esi;
    sf.edi = frame->edi;
    sf.ebp = frame->ebp;
    sf.eip = frame->eip + skip;
    sf.cs = frame->cs;
    sf.eflags = frame->eflags;
    sf.user_esp = frame->user_esp;
    sf.ss = frame->ss;
    sf.sig = (u32)sig;
    sf.old_mask = self->sig_mask;
    sf.magic = PROC_SIGFRAME_MAGIC;

    if (address_space_copyout(self->space, frame_addr, &tramp, 4) != 0)
        return 0;
    if (address_space_copyout(self->space, frame_addr + 4, &sf,
                              (u32)sizeof(sf)) != 0)
        return 0;

    self->sig_mask = action->mask;
    self->sig_handled++;

    frame->eax = (u32)sig;
    frame->ebx = frame_addr + 4;
    frame->eip = action->handler;
    frame->user_esp = frame_addr;
    return 1;
}

int process_sigreturn_current(struct irq_frame *frame)
{
    struct process *self;
    struct proc_signal_frame sf;

    if (!frame) return -1;
    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (self->state != PROC_LIVE || !self->space) return -1;
    if (!address_space_user_range_ok(self->space, frame->user_esp,
                                     (u32)sizeof(sf), 0))
        return -1;
    if (address_space_copyin(self->space, &sf, frame->user_esp,
                             (u32)sizeof(sf)) != 0)
        return -1;
    if (sf.magic != PROC_SIGFRAME_MAGIC) return -1;
    if ((sf.cs & 3u) != 3u || (sf.ss & 3u) != 3u) return -1;
    if (!address_space_user_range_ok(self->space, sf.eip, 1, 0)) return -1;
    if (sf.user_esp < AEVUM_USER_STACK_VA ||
        sf.user_esp > AEVUM_USER_STACK_TOP)
        return -1;

    frame->eax = sf.eax;
    frame->ebx = sf.ebx;
    frame->ecx = sf.ecx;
    frame->edx = sf.edx;
    frame->esi = sf.esi;
    frame->edi = sf.edi;
    frame->ebp = sf.ebp;
    frame->eip = sf.eip;
    frame->cs = sf.cs;
    frame->eflags = sf.eflags;
    frame->user_esp = sf.user_esp;
    frame->ss = sf.ss;
    frame->vector = 0;
    frame->err = 0;
    self->sig_mask = sf.old_mask;
    return 0;
}

u32 process_sig_handled_current(void)
{
    struct process *self;

    if (!task_current() || !task_process_current()) return 0;
    self = task_process_current();
    return self->sig_handled;
}

static void proc_notify_parent(struct process *self)
{
    struct process *parent;

    if (!self || self->ppid <= 0) return;
    parent = proc_find_active(self->ppid);
    if (parent && parent->state == PROC_LIVE)
        proc_signal_pending(parent, PROC_SIGCHLD);
}

static void proc_orphan_children(struct process *self)
{
    int i;
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_LIVE && procs[i].ppid == self->pid)
            procs[i].ppid = 0;
}

/* 连续 fork/wait 时优先复用刚退出的直接子 PID，保住无关 lane 的墓碑。 */
static int proc_reusable_child_pid(const struct process *parent)
{
    int i;
    if (!parent) return 0;
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_DEAD && procs[i].ppid == parent->pid)
            return procs[i].pid;
    return 0;
}

static struct process *proc_alloc_slot(int pid)
{
    struct process *slot = 0;
    int i;

    /* 优先空槽；DEAD 只作为可显示的墓碑，可以被下一次创建复用。 */
    for (i = 0; i < PROC_MAX; i++) {
        if (procs[i].state == PROC_FREE) {
            slot = &procs[i];
            break;
        }
    }
    if (!slot) {
        for (i = 0; i < PROC_MAX; i++) {
            if (procs[i].state == PROC_DEAD) {
                slot = &procs[i];
                break;
            }
        }
    }
    if (!slot) return 0;

    /* PID 可能被复用；清掉其他同 PID 的旧墓碑，避免 V 页出现重复行。 */
    for (i = 0; i < PROC_MAX; i++) {
        if (&procs[i] != slot && procs[i].state == PROC_DEAD &&
            procs[i].pid == pid)
            proc_zero(&procs[i]);
    }
    proc_zero(slot);
    slot->pid = pid;
    return slot;
}

static u32 stack_alloc(u32 top)
{
    int i;
    for (i = 0; i < PROC_STACK_COUNT; i++) {
        if (stack_tops[i] == top) {
            u32 mask = 1u << i;
            if (stack_map & mask) return 0;
            stack_map |= mask;
            return top;
        }
    }
    return 0;
}

static u32 stack_alloc_any(void)
{
    int i;
    for (i = 0; i < PROC_STACK_COUNT; i++) {
        u32 mask = 1u << i;
        if (!(stack_map & mask)) {
            stack_map |= mask;
            return stack_tops[i];
        }
    }
    return 0;
}

static void stack_free(u32 top)
{
    int i;
    for (i = 0; i < PROC_STACK_COUNT; i++)
        if (stack_tops[i] == top) stack_map &= ~(1u << i);
}

/* 回收一个 ZOMBIE：任务槽、地址空间、PID、内核栈一次释放；保留墓碑用于 V 页。 */
static void process_reap(struct process *p)
{
    if (!p || (p->state != PROC_ZOMBIE && p->state != PROC_LIVE)) return;
    if (p->task == task_current()) return;
    task_release_slot(p->pid);
    if (p->space) address_space_release(p->space);
    task_pid_release(p->pid);
    stack_free(p->stack_top);
    p->task = 0;
    p->space = 0;
    p->stack_top = 0;
    p->state = PROC_DEAD;
}

static int proc_copy_name(struct process *p, const char *name)
{
    int i;
    if (!name) return -1;
    for (i = 0; i < PROC_NAME_MAX && name[i]; i++) p->comm[i] = name[i];
    p->comm[i] = 0;
    return 0;
}

struct process *process_create_user(int priority, const char *name,
                                    const u8 *code, u32 code_size,
                                    u32 kernel_stack_top, u32 user_stack_top)
{
    struct process *p;
    struct task_struct *task;
    struct address_space *space;
    int pid;
    u32 stack_top;
    const char *rc;

    if (!name || !code || !code_size) return 0;

    pid = task_pid_reserve();
    if (!pid) return 0;
    p = proc_alloc_slot(pid);
    if (!p) {
        task_pid_release(pid);
        return 0;
    }
    stack_top = stack_alloc(kernel_stack_top);
    if (!stack_top) {
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }
    space = address_space_create_user(code, code_size);
    if (!space) {
        stack_free(stack_top);
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }

    p->state = PROC_LIVE;
    p->ppid = (task_current() && task_process_current())
                  ? task_process_current()->pid
                  : 0;
    p->stack_top = stack_top;
    p->space = space;
    p->task = 0;
    p->exit_code = 0;
    proc_copy_name(p, name);

    rc = task_create_user_with_pid(priority, name, AEVUM_USER_CODE_VA,
                                   stack_top, space, user_stack_top,
                                   p, pid, &task);
    if (rc) {
        address_space_release(space);
        stack_free(stack_top);
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }
    p->task = task;
    return p;
}

struct process *process_fork(struct irq_frame *frame)
{
    struct process *parent;
    struct process *p;
    struct task_struct *task;
    struct address_space *space;
    int pid;
    int i;
    u32 stack_top;
    const char *rc;

    if (!frame) return 0;
    parent = (task_current() && task_process_current())
                 ? task_process_current()
                 : 0;
    if (!parent || parent->state != PROC_LIVE) return 0;
    if ((frame->cs & 3u) != 3u) return 0;

    pid = proc_reusable_child_pid(parent);
    if (pid && task_pid_reserve_hint(pid) != pid) pid = 0;
    if (!pid) pid = task_pid_reserve();
    if (!pid) return 0;
    p = proc_alloc_slot(pid);
    if (!p) {
        task_pid_release(pid);
        return 0;
    }
    stack_top = stack_alloc_any();
    if (!stack_top) {
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }
    space = address_space_clone(parent->space);
    if (!space) {
        stack_free(stack_top);
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }

    p->state = PROC_LIVE;
    p->ppid = parent->pid;
    p->stack_top = stack_top;
    p->space = space;
    p->task = 0;
    p->exit_code = 0;
    proc_copy_name(p, "userE");
    /* 信号动作与 mask 随 fork 继承；pending 不继承。 */
    for (i = 0; i < PROC_NSIG; i++) p->sigactions[i] = parent->sigactions[i];
    p->sig_mask = parent->sig_mask;
    p->image_id = parent->image_id;

    rc = task_fork_user(pid, "userE", frame, stack_top, space, p, &task);
    if (rc) {
        address_space_release(space);
        stack_free(stack_top);
        proc_zero(p);
        task_pid_release(pid);
        return 0;
    }
    p->task = task;
    return p;
}

static const u8 *proc_exec_image(int image_id, u32 *size)
{
    if (!size) return 0;
    if (image_id == 1) {
        *size = (u32)((u32)user_exec_end - (u32)user_exec_start);
        return user_exec_start;
    }
    return 0;
}

/*
 * P4.1 exec：PID/PPID/任务槽保持不变，用户地址空间整体换新。
 * 新 AS 先分配成功再切 CR3，旧 AS 在任务空间指针更新后才释放；
 * 分配失败时旧 AS、旧镜像和 frame 都不动，系统调用返回 -1。
 */
int process_exec_current(struct irq_frame *frame, int image_id)
{
    struct process *self;
    struct address_space *old_space;
    struct address_space *new_space;
    const u8 *code;
    u32 code_size;
    u32 flags;

    if (!frame || (frame->cs & 3u) != 3u) return -1;
    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (self->state != PROC_LIVE || !self->space) return -1;

    code = proc_exec_image(image_id, &code_size);
    if (!code || !code_size) return -1;

    new_space = address_space_create_user(code, code_size);
    if (!new_space) return -1;

    old_space = self->space;
    __asm__ __volatile__("pushf; pop %0; cli" : "=r"(flags) : : "memory");
    address_space_switch(new_space);
    task_set_space(task_current(), new_space);
    self->space = new_space;
    self->image_id = image_id;
    proc_reset_signals(self);
    self->exit_code = 0;

    frame->eax = 0;
    frame->ebx = 0;
    frame->ecx = 0;
    frame->edx = 0;
    frame->esi = 0;
    frame->edi = 0;
    frame->ebp = 0;
    frame->eip = AEVUM_USER_CODE_VA;
    frame->cs = 0x1B;
    frame->eflags = 0x202;
    frame->user_esp = AEVUM_USER_STACK_TOP;
    frame->ss = 0x23;

    address_space_release(old_space);
    __asm__ __volatile__("push %0; popf" : : "r"(flags) : "memory", "cc");
    return 0;
}

int process_exit_current(u32 code)
{
    struct process *self;

    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (self->state != PROC_LIVE) return -1;
    self->state = PROC_ZOMBIE;
    self->term_sig = 0;
    self->exit_code = code & 0xFFu;

    /* 父进程先退：直接子进程变成 0 号孤儿，交给调度器 reaper。 */
    proc_orphan_children(self);
    proc_notify_parent(self);
    return 0;
}

int process_terminate_current(int sig)
{
    struct process *self;

    if (sig <= 0 || sig > 31) return -1;
    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (self->state != PROC_LIVE) return -1;

    proc_signal_pending(self, sig);
    self->state = PROC_ZOMBIE;
    self->term_sig = (u32)sig;
    self->exit_code = PROC_WAIT_STATUS(sig);
    proc_orphan_children(self);
    proc_notify_parent(self);
    return 0;
}

static int proc_has_children(const struct process *self)
{
    int i;
    for (i = 0; i < PROC_MAX; i++)
        if ((procs[i].state == PROC_LIVE || procs[i].state == PROC_ZOMBIE) &&
            procs[i].ppid == self->pid)
            return 1;
    return 0;
}

int process_wait(int pid, u32 user_status)
{
    struct process *self;
    int i;

    if (!task_current() || !task_process_current()) return -1;
    self = task_process_current();
    if (!address_space_user_range_ok(self->space, user_status, 4, 1)) return -1;
    if (!proc_has_children(self)) return -1;

    for (;;) {
        for (i = 0; i < PROC_MAX; i++) {
            struct process *child = &procs[i];
            if (child->state != PROC_ZOMBIE) continue;
            if (child->ppid != self->pid) continue;
            if (pid >= 0 && child->pid != pid) continue;

            if (address_space_copyout(self->space, user_status,
                                      &child->exit_code, 4) != 0)
                return -1;
            {
                int child_pid = child->pid;
                /*
                 * 回收必须在切走子任务之后；此时 current 是父进程，
                 * process_reap() 会清掉子进程的调度槽。
                 * wait 取走 ZOMBIE 即消费掉一次 SIGCHLD pending。
                 */
                process_reap(child);
                self->pending &= ~(1u << (PROC_SIGCHLD - 1));
                return child_pid;
            }
        }

        /* 指定 PID 已经不存在：不要永久等一个永远不会退出的子进程。 */
        if (pid > 0 && !proc_find_active(pid)) {
            int found = 0;
            for (i = 0; i < PROC_MAX; i++)
                if (procs[i].state == PROC_ZOMBIE && procs[i].pid == pid &&
                    procs[i].ppid == self->pid)
                    found = 1;
            if (!found) return -1;
        }
        if (task_yield()) return -1;
    }
}

int process_getpid_current(void)
{
    return (task_current() && task_process_current())
               ? task_process_current()->pid
               : task_current_pid();
}

int process_getppid_current(void)
{
    return (task_current() && task_process_current())
               ? task_process_current()->ppid
               : 0;
}

int process_alive(int pid)
{
    struct process *p = proc_find_active(pid);
    struct task_info info;
    if (!p || p->state != PROC_LIVE) return 0;
    return task_snapshot_pid(pid, &info) && info.state != TASK_ZOMBIE;
}

int process_live_count(void)
{
    int i, n = 0;
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_LIVE) n++;
    return n;
}

void process_stop_all(void)
{
    int i;
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_LIVE && procs[i].space)
            address_space_set_stop(procs[i].space, 1);
}

/* 新 V 演示开始前清掉上一轮墓碑和已经无父的 ZOMBIE。 */
void process_cleanup(void)
{
    int i;
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_ZOMBIE)
            process_reap(&procs[i]);
    for (i = 0; i < PROC_MAX; i++)
        if (procs[i].state == PROC_DEAD)
            proc_zero(&procs[i]);
}

void process_reap_orphans(void)
{
    int i;
    int current_pid = task_current_pid();

    for (i = 0; i < PROC_MAX; i++) {
        struct process *p = &procs[i];
        struct process *parent;

        if (p->state != PROC_ZOMBIE || p->pid == current_pid) continue;
        parent = proc_find_active(p->ppid);
        if (p->ppid == 0 || !parent || parent->state != PROC_LIVE)
            process_reap(p);
    }
}

int process_snapshot(int slot, struct process_info *out)
{
    struct process *p;
    struct task_info info;
    int has_task;

    if (!out || slot < 0 || slot >= PROC_MAX) return 0;
    p = &procs[slot];
    if (p->state == PROC_FREE) return 0;

    out->used = 1;
    out->pid = p->pid;
    out->ppid = p->ppid;
    out->state = p->state;
    out->exit_code = p->exit_code;
    out->stack_top = p->stack_top;
    out->cr3 = address_space_cr3(p->space);
    out->asid = address_space_id(p->space);
    out->counter = address_space_counter(p->space);
    out->code_phys = address_space_code_phys(p->space);
    out->data_phys = address_space_data_phys(p->space);
    out->brk = address_space_brk(p->space);
    out->user_pages = address_space_user_pages(p->space);
    out->cow_pages = address_space_cow_pages(p->space);
    out->vma_count = address_space_vma_count(p->space);
    out->pending = p->pending;
    out->last_sig = p->last_sig;
    out->term_sig = p->term_sig;
    out->sig_count = p->sig_count;
    out->sigchld_count = p->sigchld_count;
    out->sig_handled = p->sig_handled;
    out->sig_mask = p->sig_mask;
    out->image_id = p->image_id;

    has_task = task_snapshot_pid(p->pid, &info);
    if (has_task) {
        int i;
        out->task_state = info.state;
        out->switches = info.switches;
        out->cpu_ticks = info.cpu_ticks;
        for (i = 0; i <= PROC_NAME_MAX; i++) out->comm[i] = info.comm[i];
    } else {
        int i;
        out->task_state = TASK_UNUSED;
        out->switches = 0;
        out->cpu_ticks = 0;
        for (i = 0; i <= PROC_NAME_MAX && p->comm[i]; i++)
            out->comm[i] = p->comm[i];
        out->comm[i] = 0;
    }
    return 1;
}

int process_count(void)
{
    return PROC_MAX;
}

int process_pid_of(struct process *proc)
{
    return proc ? proc->pid : 0;
}

struct address_space *process_space(struct process *proc)
{
    return proc ? proc->space : 0;
}

u32 process_read32(int pid, u32 va)
{
    struct process *p = proc_find_active(pid);
    if (!p || !p->space) return 0;
    return address_space_user_read32(p->space, va);
}

int process_image_id(int pid)
{
    int i;
    int image = 0;

    if (pid <= 0) return 0;
    for (i = 0; i < PROC_MAX; i++) {
        if (procs[i].state != PROC_FREE && procs[i].pid == pid &&
            (int)procs[i].image_id > image)
            image = (int)procs[i].image_id;
    }
    return image;
}

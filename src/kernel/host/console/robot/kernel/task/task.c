#include "kernel/task.h"
#include "kernel/error.h"
#include "arch/x86/interrupt.h"
#include "config/memory.h"

#define CTX_FRAME_SLOTS 12
#define TASK_TRACE_N    64
#define TASK_TRACE_DIV  32
#define PID_MAX         31
#define STACK_MAGIC     0xA5A5A5A5u

/* 与 loader.asm 的 irq_common 帧逐槽对应。 */
struct irq_frame {
    u32 eax, ebx, ecx, edx, esi, edi, ebp;
    u32 vector, err, eip, cs, eflags;
};

struct context {
    u32 esp;
};

struct task_struct {
    int  pid;
    int  state;
    int  priority;
    char comm[TASK_NAME_MAX + 1];
    void (*entry)(void);
    u32  stack_base;
    u32  stack_top;
    u32  switches;
    struct context ctx;
};

enum schedule_reason {
    SCHED_START = 0,
    SCHED_YIELD = 1,
    SCHED_BLOCK = 2,
    SCHED_EXIT = 3,
    SCHED_TICK = 4
};

static struct task_struct tasks[TASK_MAX];
static struct task_struct boot_task;
static struct task_struct *current_task;
static struct task_struct *start_target;

static volatile u32 sched_reason;
static volatile int sched_failed;

static u32 switch_trace[TASK_TRACE_N];
static int switch_i;
static u32 switch_total;
static u32 trace_total;
static u32 pid_map;
static u32 preempt_total;

static int pid_alloc(void)
{
    int i;
    for (i = 0; i < PID_MAX; i++) {
        u32 mask = 1u << i;
        if (!(pid_map & mask)) {
            pid_map |= mask;
            return i + 1;
        }
    }
    return 0;
}

static void pid_free(int pid)
{
    if (pid >= 1 && pid <= PID_MAX) pid_map &= ~(1u << (pid - 1));
}

static void task_zero(struct task_struct *task)
{
    int i;
    task->pid = 0;
    task->state = TASK_UNUSED;
    task->priority = 0;
    for (i = 0; i <= TASK_NAME_MAX; i++) task->comm[i] = 0;
    task->entry = 0;
    task->stack_base = 0;
    task->stack_top = 0;
    task->switches = 0;
    task->ctx.esp = 0;
}

void task_boot(void)
{
    task_zero(&boot_task);
    boot_task.state = TASK_RUNNING;
    boot_task.comm[0] = 'i';
    boot_task.comm[1] = 'n';
    boot_task.comm[2] = 'i';
    boot_task.comm[3] = 't';
    current_task = &boot_task;
    pid_map = 0;
}

u32 task_create(int priority, const char *name,
                void (*entry)(void), u32 stack_top, struct task_struct **out)
{
    struct task_struct *task;
    u32 *sp;
    u32 *p;
    u32 stack_base;
    int i, pid;

    if (!out) return ERR_TASK_OUT_MISSING;
    *out = 0;
    if (!entry) return ERR_TASK_ENTRY_MISSING;
    if (priority < 0 || priority > 3) return ERR_TASK_PRIORITY;
    if (stack_top < AEVUM_TASK_STACK_MIN || stack_top > AEVUM_TASK_STACK_MAX ||
        (stack_top & 0xFu))
        return ERR_TASK_STACK_INVALID;

    stack_base = stack_top - AEVUM_TASK_STACK_SIZE;
    if (stack_base < AEVUM_TASK_STACK_MIN) return ERR_TASK_STACK_INVALID;

    task = 0;
    for (i = 0; i < TASK_MAX; i++) {
        if (tasks[i].state == TASK_UNUSED) {
            task = &tasks[i];
            break;
        }
    }
    if (!task) return ERR_TASK_SLOT_FULL;

    pid = pid_alloc();
    if (!pid) return ERR_TASK_PID_EXHAUSTED;

    task_zero(task);
    task->pid = pid;
    task->priority = priority;
    task->entry = entry;
    task->stack_base = stack_base;
    task->stack_top = stack_top;
    for (i = 0; i < TASK_NAME_MAX && name[i]; i++) task->comm[i] = name[i];
    task->comm[i] = 0;

    /* 栈底到栈顶填魔数，运行后从栈底向上扫描即可得到真实栈水位。 */
    for (p = (u32 *)stack_base; p < (u32 *)stack_top; p++) *p = STACK_MAGIC;

    /*
     * 新任务的初始帧必须和中断帧同构，第一次 iret 就会进入 entry。
     * eflags=0x202 打开 IF，任务开始运行后 PIT 才能真正抢占。
     */
    sp = (u32 *)(stack_top - CTX_FRAME_SLOTS * 4);
    for (i = 0; i < CTX_FRAME_SLOTS; i++) sp[i] = 0;
    sp[9]  = (u32)entry;
    sp[10] = 0x08;
    sp[11] = 0x202;
    task->ctx.esp = (u32)sp;

    /*
     * 新任务必须在完全构造好之后才发布为 READY。
     * 否则 PIT 可能在 task_create 中途抢占，调度器会选中 ctx.esp 还无效的任务。
     */
    {
        u32 flags;
        __asm__ __volatile__("pushf; pop %0; cli" : "=r"(flags) : : "memory");
        task->state = TASK_READY;
        *out = task;
        __asm__ __volatile__("push %0; popf" : : "r"(flags) : "memory", "cc");
    }
    return 0;
}

struct task_struct *task_current(void)
{
    return current_task;
}

int task_current_pid(void)
{
    return current_task ? current_task->pid : 0;
}

int task_pid_used(void)
{
    int i, n = 0;
    for (i = 0; i < PID_MAX; i++)
        if (pid_map & (1u << i)) n++;
    return n;
}

int task_pid_capacity(void)
{
    return PID_MAX;
}

static void task_note_switch(struct task_struct *next)
{
    switch_total++;
    if ((switch_total % TASK_TRACE_DIV) == 0) {
        switch_trace[switch_i] = (u32)next->pid;
        switch_i = (switch_i + 1) % TASK_TRACE_N;
        trace_total++;
    }
}

static struct task_struct *task_pick_next(struct task_struct *prev)
{
    int start = 0;
    int i;

    for (i = 0; i < TASK_MAX; i++) {
        if (&tasks[i] == prev) {
            start = i + 1;
            break;
        }
    }

    for (i = 0; i < TASK_MAX; i++) {
        int idx = (start + i) % TASK_MAX;
        if (tasks[idx].state == TASK_READY) return &tasks[idx];
    }
    return 0;
}

static void task_reap(void)
{
    int i;
    for (i = 0; i < TASK_MAX; i++) {
        if (tasks[i].state == TASK_ZOMBIE) {
            pid_free(tasks[i].pid);
            task_zero(&tasks[i]);
        }
    }
}

/*
 * 唯一调度入口：IRQ0、int 0x40 都从这里切栈。
 * 返回下一个任务的帧指针；loader.asm 恢复该帧并 iret。
 */
u32 task_schedule_irq(struct irq_frame *frame)
{
    struct task_struct *prev = current_task;
    struct task_struct *next;
    u32 reason = sched_reason;

    if (!prev || !frame) {
        for (;;) __asm__ __volatile__("cli; hlt");
    }

    if (frame->vector == 0x20) {
        interrupt_eoi();
        reason = SCHED_TICK;
    }

    prev->ctx.esp = (u32)frame;
    sched_failed = 0;

    if (reason == SCHED_START) {
        next = start_target;
        if (!next || next->state != TASK_READY) {
            sched_failed = 1;
            for (;;) __asm__ __volatile__("cli; hlt");
        }
        next->state = TASK_RUNNING;
        current_task = next;
        task_note_switch(next);
        sched_reason = SCHED_YIELD;
        return next->ctx.esp;
    }

    if (prev->state == TASK_RUNNING) {
        if (reason == SCHED_EXIT)
            prev->state = TASK_ZOMBIE;
        else if (reason == SCHED_BLOCK)
            prev->state = TASK_BLOCKED;
        else
            prev->state = TASK_READY;       /* yield 或 PIT 时间片到期 */
    }

    task_reap();
    next = task_pick_next(prev);

    if (!next) {
        if (reason == SCHED_EXIT)
            for (;;) __asm__ __volatile__("cli; hlt");
        if (reason == SCHED_BLOCK) {
            prev->state = TASK_RUNNING;
            sched_failed = 1;
        } else {
            prev->state = TASK_RUNNING;
        }
        next = prev;
    }

    if (next != prev) {
        prev->switches++;
        next->state = TASK_RUNNING;
        if (reason == SCHED_TICK) preempt_total++;
        task_note_switch(next);
    }
    current_task = next;
    sched_reason = SCHED_YIELD;
    return next->ctx.esp;
}

void task_exit(void)
{
    sched_reason = SCHED_EXIT;
    sched_failed = 0;
    __asm__ __volatile__("int $0x40");
    for (;;) __asm__ __volatile__("cli; hlt");
}

u32 task_block(void)
{
    struct task_struct *prev = current_task;

    if (!prev || prev->state != TASK_RUNNING) return ERR_TASK_BAD_STATE;
    sched_reason = SCHED_BLOCK;
    sched_failed = 0;
    __asm__ __volatile__("int $0x40");
    return sched_failed ? ERR_TASK_BAD_STATE : 0;
}

u32 task_wake(int pid)
{
    int i;
    for (i = 0; i < TASK_MAX; i++) {
        if (tasks[i].pid == pid && tasks[i].state == TASK_BLOCKED) {
            tasks[i].state = TASK_READY;
            return 0;
        }
    }
    return ERR_TASK_BAD_STATE;
}

u32 task_yield(void)
{
    struct task_struct *prev = current_task;

    if (!prev) return ERR_TASK_BAD_STATE;
    sched_reason = SCHED_YIELD;
    sched_failed = 0;
    __asm__ __volatile__("int $0x40");
    return sched_failed ? ERR_TASK_BAD_STATE : 0;
}

void task_start(struct task_struct *first)
{
    start_target = first;
    sched_reason = SCHED_START;
    sched_failed = 0;
    __asm__ __volatile__("int $0x40");
    for (;;) __asm__ __volatile__("cli; hlt");
}

static u32 task_stack_used(struct task_struct *task)
{
    u32 *base = (u32 *)task->stack_base;
    int n = (int)((task->stack_top - task->stack_base) / 4);
    int i;

    for (i = 0; i < n; i++)
        if (base[i] != STACK_MAGIC) break;

    if (i >= n) return 32;
    return task->stack_top - (task->stack_base + (u32)i * 4u);
}

int task_snapshot(int slot, struct task_info *out)
{
    struct task_struct *task;
    int i;

    if (!out || slot < 0 || slot >= TASK_MAX) return 0;
    task = &tasks[slot];
    if (task->state == TASK_UNUSED) return 0;
    out->pid = task->pid;
    out->state = task->state;
    out->priority = task->priority;
    for (i = 0; i <= TASK_NAME_MAX; i++) out->comm[i] = task->comm[i];
    out->stack_top = task->stack_top;
    out->stack_used = task_stack_used(task);
    out->switches = task->switches;
    return 1;
}

int task_trace_len(void)
{
    if (trace_total > TASK_TRACE_N) return TASK_TRACE_N;
    return (int)trace_total;
}

u32 task_trace_pid(int index)
{
    int len = task_trace_len();
    int start;

    if (index < 0 || index >= len) return 0;
    start = (switch_i - len + TASK_TRACE_N) % TASK_TRACE_N;
    return switch_trace[(start + index) % TASK_TRACE_N];
}

u32 task_switch_total(void)
{
    return switch_total;
}

u32 task_preempt_total(void)
{
    return preempt_total;
}

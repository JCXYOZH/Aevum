#include "kernel/task.h"
#include "kernel/error.h"
#include "arch/x86/context.h"
#include "config/memory.h"

#define CTX_SLOTS     8
#define TASK_TRACE_N  64
#define TASK_TRACE_DIV 32
#define PID_MAX       31
#define STACK_MAGIC   0xA5A5A5A5u

struct context {
    u32 eax, ebx, ecx, edx, esi, edi, ebp, esp, eip;
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

static struct task_struct tasks[TASK_MAX];
static struct task_struct boot_task;
static struct task_struct *current_task;

static u32 switch_trace[TASK_TRACE_N];
static int switch_i;
static u32 switch_total;
static u32 trace_total;
static u32 pid_map;

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
    task->ctx.eax = 0;
    task->ctx.ebx = 0;
    task->ctx.ecx = 0;
    task->ctx.edx = 0;
    task->ctx.esi = 0;
    task->ctx.edi = 0;
    task->ctx.ebp = 0;
    task->ctx.esp = 0;
    task->ctx.eip = 0;
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
    task->state = TASK_READY;
    task->priority = priority;
    task->entry = entry;
    task->stack_base = stack_base;
    task->stack_top = stack_top;
    for (i = 0; i < TASK_NAME_MAX && name[i]; i++) task->comm[i] = name[i];
    task->comm[i] = 0;

    /* 栈底到栈顶填魔数，运行后从栈底向上扫描即可得到真实栈水位。 */
    for (p = (u32 *)stack_base; p < (u32 *)stack_top; p++) *p = STACK_MAGIC;

    sp = (u32 *)(stack_top - CTX_SLOTS * 4);
    for (i = 0; i < CTX_SLOTS - 1; i++) sp[i] = 0;
    sp[CTX_SLOTS - 1] = (u32)entry;
    task->ctx.esp = (u32)sp;
    task->ctx.eip = (u32)entry;

    *out = task;
    return 0;
}

u32 task_set_state(struct task_struct *task, int state)
{
    if (!task) return ERR_TASK_BAD_STATE;
    if (state != TASK_READY && state != TASK_RUNNING && state != TASK_BLOCKED)
        return ERR_TASK_BAD_STATE;
    task->state = state;
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

u32 task_switch_to(struct task_struct *next)
{
    struct task_struct *prev = current_task;

    if (!prev || !next || prev == next) return ERR_TASK_BAD_STATE;
    prev->switches++;
    task_note_switch(next);
    current_task = next;
    cpu_switch(&prev->ctx.esp, next->ctx.esp);
    return 0;
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
    return prev;
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

void task_exit(void)
{
    struct task_struct *prev = current_task;
    struct task_struct *next;

    if (!prev) for (;;) __asm__ __volatile__("cli; hlt");
    prev->state = TASK_ZOMBIE;
    next = task_pick_next(prev);
    if (!next || next == prev) for (;;) __asm__ __volatile__("cli; hlt");
    next->state = TASK_RUNNING;
    (void)task_switch_to(next);
    for (;;) __asm__ __volatile__("cli; hlt");
}

u32 task_yield(void)
{
    struct task_struct *prev = current_task;
    struct task_struct *next;
    u32 rc;

    if (!prev) return ERR_TASK_BAD_STATE;
    task_reap();
    if (prev->state == TASK_RUNNING) prev->state = TASK_READY;
    next = task_pick_next(prev);
    if (next == prev) {
        prev->state = TASK_RUNNING;
        return 0;
    }
    next->state = TASK_RUNNING;
    rc = task_switch_to(next);
    prev->state = TASK_RUNNING;
    return rc;
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


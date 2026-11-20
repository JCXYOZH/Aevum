#include "kernel/task.h"
#include "kernel/error.h"
#include "arch/x86/context.h"
#include "config/memory.h"

#define TASK_MAX   3
#define CTX_SLOTS  8

struct context {
    u32 eax, ebx, ecx, edx, esi, edi, ebp, esp, eip;
};

struct task_struct {
    int  pid;
    int  state;
    char comm[TASK_NAME_MAX + 1];
    struct context ctx;
};

static struct task_struct tasks[TASK_MAX];
static struct task_struct boot_task;
static struct task_struct *current_task;
static int task_count;

static void task_zero(struct task_struct *task)
{
    int i;
    task->pid = 0;
    task->state = TASK_RUNNING;
    for (i = 0; i <= TASK_NAME_MAX; i++) task->comm[i] = 0;
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
    boot_task.comm[0] = 'i';
    boot_task.comm[1] = 'n';
    boot_task.comm[2] = 'i';
    boot_task.comm[3] = 't';
    current_task = &boot_task;
}

u32 task_create(int pid, const char *name, void (*entry)(void), u32 stack_top,
                struct task_struct **out)
{
    struct task_struct *task;
    u32 *sp;
    int i;

    if (!out) return ERR_TASK_OUT_MISSING;
    *out = 0;
    if (!entry) return ERR_TASK_ENTRY_MISSING;
    if (stack_top < AEVUM_TASK_STACK_MIN || stack_top > AEVUM_TASK_STACK_MAX ||
        (stack_top & 0xFu))
        return ERR_TASK_STACK_INVALID;

    for (i = 0; i < task_count; i++)
        if (tasks[i].pid == pid) return ERR_TASK_PID_DUP;

    if (task_count >= TASK_MAX) return ERR_TASK_SLOT_FULL;

    task = &tasks[task_count++];
    task_zero(task);
    task->pid = pid;
    task->state = TASK_RUNNING;
    for (i = 0; i < TASK_NAME_MAX && name[i]; i++) task->comm[i] = name[i];
    task->comm[i] = 0;

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
    if (state != TASK_RUNNING && state != TASK_INTERRUPTIBLE)
        return ERR_TASK_BAD_STATE;
    task->state = state;
    return 0;
}

struct task_struct *task_current(void)
{
    return current_task;
}

u32 task_switch_to(struct task_struct *next)
{
    struct task_struct *prev = current_task;

    if (!prev || !next) return ERR_TASK_BAD_STATE;
    current_task = next;
    cpu_switch(&prev->ctx.esp, next->ctx.esp);
    return 0;
}

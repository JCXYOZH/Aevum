#include "app/tree/demo.h"
#include "kernel/task.h"
#include "config/memory.h"

#define TREE_PARENT_TICKS 150

static volatile int active;
static volatile int stop;
static volatile int done_parent;
static volatile int done_a;
static volatile int done_b;
static const char *volatile tree_err;
static struct task_struct *p_parent;

static void tree_child_exit(int lane)
{
    if (lane) done_b = 1;
    else done_a = 1;
    task_exit();
}

static void proc_tree_a(void)
{
    u32 step = 0;

    while (!stop) {
        step++;
        if ((step & 0x3FFFu) == 0)
            __asm__ __volatile__("" ::: "memory");
    }
    tree_child_exit(0);
}

static void proc_tree_b(void)
{
    u32 step = 0;

    while (!stop) {
        step++;
        if ((step & 0x3FFFu) == 0)
            __asm__ __volatile__("" ::: "memory");
    }
    tree_child_exit(1);
}

static void proc_tree_parent(void)
{
    struct task_struct *child;
    u32 start;
    const char *rc;

    rc = task_create(1, "famA", proc_tree_a, AEVUM_STACK_DUEL_A, &child);
    if (rc) {
        tree_err = rc;
        done_a = 1;
        done_b = 1;
        stop = 1;
        done_parent = 1;
        task_exit();
    }
    done_a = 0;

    rc = task_create(1, "famB", proc_tree_b, AEVUM_STACK_DUEL_B, &child);
    if (rc) {
        tree_err = rc;
        done_b = 1;
        stop = 1;
        done_parent = 1;
        task_exit();
    }
    done_b = 0;

    start = task_preempt_total();
    while (!stop && (task_preempt_total() - start) < TREE_PARENT_TICKS)
        __asm__ __volatile__("" ::: "memory");

    done_parent = 1;
    task_exit();
}

const char *tree_demo_start(void)
{
    const char *rc;

    if (active) return 0;

    stop = 0;
    tree_err = 0;
    done_parent = 0;
    done_a = 1;
    done_b = 1;
    active = 1;

    rc = task_create(1, "famP", proc_tree_parent, AEVUM_STACK_PROBE, &p_parent);
    if (rc) {
        active = 0;
        return rc;
    }
    return 0;
}

void tree_demo_stop(void)
{
    stop = 1;
}

int tree_demo_alive(void)
{
    if (active && done_parent && done_a && done_b) {
        active = 0;
        stop = 0;
    }
    return active;
}

const char *tree_demo_error(void)
{
    return tree_err;
}

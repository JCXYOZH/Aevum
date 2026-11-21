#include "kernel/task/family.h"

static struct family_entry family[AEVUM_FAMILY_MAX];
static int family_reaper;
static u32 family_order_next;
static u32 family_event_seq;
static struct family_event last_reparent;

static void irq_save(u32 *flags)
{
    __asm__ __volatile__("pushf; pop %0; cli" : "=r"(*flags) : : "memory");
}

static void irq_restore(u32 flags)
{
    __asm__ __volatile__("push %0; popf" : : "r"(flags) : "memory", "cc");
}

static struct family_entry *family_find(int pid)
{
    int i;
    for (i = 0; i < AEVUM_FAMILY_MAX; i++)
        if (family[i].used && family[i].pid == pid) return &family[i];
    return 0;
}

static int family_parent_of(int pid)
{
    struct family_entry *entry = family_find(pid);
    return entry ? entry->ppid : -1;
}

/* reaper 如果是退出任务的子孙，重挂会形成环，必须回落到 init(0)。 */
static int family_is_descendant(int candidate, int ancestor)
{
    int pid = candidate;
    int guard = 0;

    while (pid > 0 && guard++ < AEVUM_FAMILY_MAX) {
        if (pid == ancestor) return 1;
        pid = family_parent_of(pid);
    }
    return 0;
}

void family_boot(void)
{
    int i;

    for (i = 0; i < AEVUM_FAMILY_MAX; i++) {
        family[i].used = 0;
        family[i].pid = -1;
        family[i].ppid = -1;
        family[i].order = 0;
    }
    family[0].used = 1;
    family[0].pid = 0;
    family[0].ppid = -1;
    family[0].order = 0;
    family_order_next = 1;
    family_reaper = 0;
    family_event_seq = 0;
    last_reparent.valid = 0;
    last_reparent.seq = 0;
    last_reparent.from = 0;
    last_reparent.to = 0;
    last_reparent.child_count = 0;
}

void family_set_reaper(int pid)
{
    family_reaper = pid;
}

int family_reaper_pid(void)
{
    return family_reaper;
}

void family_add(int pid, int ppid)
{
    struct family_entry *entry;
    u32 flags;
    int i;

    if (pid <= 0) return;
    if (ppid < 0 || ppid == pid || family_parent_of(ppid) < 0) ppid = 0;

    irq_save(&flags);
    entry = family_find(pid);
    if (!entry) {
        for (i = 0; i < AEVUM_FAMILY_MAX; i++) {
            if (!family[i].used) {
                entry = &family[i];
                break;
            }
        }
    }
    if (entry) {
        entry->used = 1;
        entry->pid = pid;
        entry->ppid = ppid;
        entry->order = family_order_next++;
    }
    irq_restore(flags);
}

void family_exit(int pid)
{
    struct family_event event;
    struct family_entry *entry;
    u32 flags;
    int i, reaper;

    if (pid <= 0) return;

    irq_save(&flags);
    entry = family_find(pid);
    if (!entry) {
        irq_restore(flags);
        return;
    }

    reaper = family_reaper;
    if (reaper == pid || !family_find(reaper) || family_is_descendant(reaper, pid))
        reaper = 0;

    event.valid = 0;
    event.seq = family_event_seq;
    event.from = pid;
    event.to = reaper;
    event.child_count = 0;
    for (i = 0; i < AEVUM_FAMILY_EVENT_CHILDREN; i++) event.children[i] = 0;

    /* 只移动直接子进程；孙进程仍挂在它们自己的父进程下面。 */
    for (i = 0; i < AEVUM_FAMILY_MAX; i++) {
        if (family[i].used && family[i].ppid == pid) {
            family[i].ppid = reaper;
            if (event.child_count < AEVUM_FAMILY_EVENT_CHILDREN)
                event.children[event.child_count] = family[i].pid;
            event.child_count++;
        }
    }

    entry->used = 0;
    if (event.child_count) {
        event.valid = 1;
        event.seq = ++family_event_seq;
        last_reparent = event;
    }
    irq_restore(flags);
}

int family_snapshot(struct family_entry *out, int max)
{
    u32 flags;
    int i, n = 0;

    if (!out || max <= 0) return 0;
    irq_save(&flags);
    for (i = 0; i < AEVUM_FAMILY_MAX && n < max; i++) {
        if (family[i].used) out[n++] = family[i];
    }
    irq_restore(flags);
    return n;
}

int family_last_event(struct family_event *out)
{
    u32 flags;

    if (!out) return 0;
    irq_save(&flags);
    *out = last_reparent;
    irq_restore(flags);
    return out->valid;
}

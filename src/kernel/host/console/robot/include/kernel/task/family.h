#ifndef AEVUM_KERNEL_TASK_FAMILY_H
#define AEVUM_KERNEL_TASK_FAMILY_H

#include "kernel/types.h"

#define AEVUM_FAMILY_MAX 32
#define AEVUM_FAMILY_EVENT_CHILDREN 4

/*
 * 进程家族关系只在这里维护：
 *   - family_add() 在 task_create() 发布 READY 之前登记 pid -> ppid
 *   - family_exit() 在任务变成 ZOMBIE 时，只重挂它的直接子进程
 *   - 重挂目标是显式设置的 reaper；没有 reaper 时回落到 init(0)
 * 任务生命周期归 task.c，父子关系归 family.c，渲染只读快照。
 */
struct family_entry {
    int used;
    int pid;
    int ppid;
    u32 order;
};

struct family_event {
    int valid;
    u32 seq;
    int from;
    int to;
    int child_count;
    int children[AEVUM_FAMILY_EVENT_CHILDREN];
};

void family_boot(void);
void family_set_reaper(int pid);
int family_reaper_pid(void);
void family_add(int pid, int ppid);
void family_exit(int pid);
int family_snapshot(struct family_entry *out, int max);
int family_last_event(struct family_event *out);

#endif

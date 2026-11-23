#ifndef AEVUM_KERNEL_KTHREAD_H
#define AEVUM_KERNEL_KTHREAD_H

#include "kernel/types.h"

/*
 * P8 动态内核线程：
 * - 创建发生在 ring0，任务槽和 TID 在运行时分配；
 * - 内核栈从 kernel_stack_alloc() 的 12 槽池动态取得；
 * - 退出后进入 ZOMBIE，直到另一个内核任务 kthread_join() 回收。
 *
 * 与静态内核任务（control/render/idle）的区别不是“是否 ring0”，
 * 而是生命周期来自运行时请求，且退出后必须显式 join 才归还栈和 TID。
 */
int kthread_create(const char *name, void (*entry)(void *), void *arg,
                   int priority);
void kthread_exit(u32 code) __attribute__((noreturn));
/*
 * 等待目标 kthread 进入 ZOMBIE，读取退出码并回收栈/TID/任务槽。
 * 成功返回 0；tid 非法、目标不是动态 kthread 或已不可回收返回 -1。
 * status 只接受内核指针，不做用户态 copyout。
 */
int kthread_join(int tid, u32 *status);
/* 当前任务若为动态 kthread 返回 TID，否则返回 -1。 */
int kthread_self(void);

struct kthread_stats {
    u32 created;     /* 成功创建的 kthread 数 */
    u32 exited;      /* 调用 kthread_exit 的次数 */
    u32 reaped;      /* kthread_join 成功回收的次数 */
    u32 failed;      /* 创建失败次数（栈池/任务槽/PID/参数） */
    u32 join_blocks; /* join 实际进入 BLOCKED 的次数 */
    u32 join_wakes;  /* join 被唤醒返回的次数 */
    u32 live;        /* created - reaped，含尚未 join 的 ZOMBIE */
};

void kthread_stats(struct kthread_stats *out);
void kthread_boot(void);

#endif

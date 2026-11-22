#ifndef AEVUM_ARCH_X86_EXCEPTION_H
#define AEVUM_ARCH_X86_EXCEPTION_H

#include "kernel/types.h"

struct irq_frame;

#define EXC_DE 0u
#define EXC_BP 3u
#define EXC_UD 6u
#define EXC_GP 13u

/*
 * 用户态同步异常入口：#DE/#BP/#UD/#GP 只记录现场并投递致命信号，
 * 由 process 层把当前进程标成 ZOMBIE、编码 wait status、通知父进程 SIGCHLD。
 * 内核态异常没有 fixup，打印现场后停机；#PF 仍由 page_fault.c 独占。
 */
struct exception_info {
    u32 pid;
    u32 cs;
    u32 vector;
    u32 sig;
    u32 eip;
    u32 err;
    u32 cr2;
    char comm[16];
};

void exception_init(void);
void exception_clear(void);
u32 exception_dispatch(struct irq_frame *frame);
int exception_last(struct exception_info *out);
u32 exception_count(void);
u32 exception_vector_count(u32 vector);

const char *exception_vector_name(u32 vector);
const char *exception_signal_name(u32 sig);

#endif

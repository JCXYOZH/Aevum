#ifndef AEVUM_ARCH_X86_SYSCALL_H
#define AEVUM_ARCH_X86_SYSCALL_H

#include "arch/x86/frame.h"

/* 最小系统调用：int 0x80；eax=2 让出，3 exit(ebx=code)，4 wait(ebx=pid,ecx=status)，
 * 5 getpid，6 fork，7 getppid。 */
void syscall_init(void);
u32 syscall_dispatch(struct irq_frame *frame);
u32 syscall_count_total(void);
u32 syscall_last_cs(void);

#endif

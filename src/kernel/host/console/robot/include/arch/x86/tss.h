#ifndef AEVUM_ARCH_X86_TSS_H
#define AEVUM_ARCH_X86_TSS_H

#include "kernel/types.h"

/* ring3 进内核时 CPU 从 TSS 取 esp0/ss0；调度器在切到用户任务前更新 esp0。 */
void tss_init(void);
void tss_set_esp0(u32 esp0);

#endif

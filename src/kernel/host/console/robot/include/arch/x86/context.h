#ifndef AEVUM_ARCH_X86_CONTEXT_H
#define AEVUM_ARCH_X86_CONTEXT_H

#include "kernel/types.h"

/* 保存当前栈指针到 *save_esp，然后切到 new_esp 恢复上下文。 */
void cpu_switch(u32 *save_esp, u32 new_esp);

#endif

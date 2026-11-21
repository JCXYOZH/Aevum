#ifndef AEVUM_ARCH_X86_FRAME_H
#define AEVUM_ARCH_X86_FRAME_H

#include "kernel/types.h"

/*
 * ring0/ring3 共用中断帧。ring0 帧到 eflags 结束；ring3 帧在 eflags 后
 * 还有 CPU 自动压入的 user_esp/ss。字段顺序必须与 loader.asm 逐槽一致。
 */
struct irq_frame {
    u32 eax, ebx, ecx, edx, esi, edi, ebp;
    u32 vector, err, eip, cs, eflags;
    u32 user_esp, ss;
};

#endif

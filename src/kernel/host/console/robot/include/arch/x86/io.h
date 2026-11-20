#ifndef AEVUM_ARCH_X86_IO_H
#define AEVUM_ARCH_X86_IO_H

#include "kernel/types.h"

/* x86 端口 I/O 的唯一实现点。热路径（vsync/串口）必须内联，避免每次端口读都走 call。 */
static inline u8 port_inb(u16 port)
{
    u8 value;
    __asm__ __volatile__("inb %1, %0" : "=a"(value) : "Nd"(port));
    return value;
}

static inline void port_outb(u16 port, u8 value)
{
    __asm__ __volatile__("outb %0, %1" : : "a"(value), "Nd"(port));
}

#endif

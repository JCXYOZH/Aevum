#include "arch/x86/context.h"

/*
 * 任务上下文切换。栈上保存 8 个 32 位槽位：
 * eax ebx ecx edx esi edi ebp ret
 * 调用约定：cpu_switch(save_esp, new_esp)
 */
__attribute__((naked))
void cpu_switch(u32 *save_esp __attribute__((unused)),
                u32 new_esp __attribute__((unused)))
{
    __asm__ __volatile__(
        "pushl %ebp\n\t"
        "pushl %edi\n\t"
        "pushl %esi\n\t"
        "pushl %edx\n\t"
        "pushl %ecx\n\t"
        "pushl %ebx\n\t"
        "pushl %eax\n\t"
        "movl  32(%esp), %eax\n\t"
        "movl  %esp, (%eax)\n\t"
        "movl  36(%esp), %eax\n\t"
        "movl  %eax, %esp\n\t"
        "popl  %eax\n\t"
        "popl  %ebx\n\t"
        "popl  %ecx\n\t"
        "popl  %edx\n\t"
        "popl  %esi\n\t"
        "popl  %edi\n\t"
        "popl  %ebp\n\t"
        "ret\n\t"
    );
}

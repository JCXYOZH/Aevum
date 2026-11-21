#include "arch/x86/syscall.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"

extern void int80_stub(void);

static u32 call_count;
static u32 last_cs;

void syscall_init(void)
{
    interrupt_set_user_gate(0x80, int80_stub);
}

u32 syscall_dispatch(struct irq_frame *frame)
{
    call_count++;
    last_cs = frame->cs;
    switch (frame->eax) {
        case 2:
            frame->eax = 0;
            (void)task_yield();
            break;
        case 3:
            task_exit();
        default:
            frame->eax = (u32)-1;
            break;
    }
    return (u32)frame;
}

u32 syscall_count_total(void)
{
    return call_count;
}

u32 syscall_last_cs(void)
{
    return last_cs;
}

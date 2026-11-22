#include "arch/x86/syscall.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "kernel/mm/address_space.h"

extern void int80_stub(void);

static u32 call_count;
static u32 last_cs;

static struct address_space *current_space(void)
{
    struct process *proc = task_process_current();
    return proc ? process_space(proc) : 0;
}

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
            (void)process_exit_current(frame->ebx);
            task_exit();
        case 4:
            frame->eax = (u32)process_wait((int)frame->ebx, frame->ecx);
            break;
        case 5:
            frame->eax = (u32)process_getpid_current();
            break;
        case 6:
            {
                struct process *child = process_fork(frame);
                frame->eax = child ? (u32)process_pid_of(child) : (u32)-1;
            }
            break;
        case 7:
            frame->eax = (u32)process_getppid_current();
            break;
        case 8:
            {
                struct address_space *space = current_space();
                frame->eax = (space && address_space_set_brk(space, frame->ebx) == 0)
                                 ? address_space_brk(space)
                                 : (u32)-1;
            }
            break;
        case 9:
            {
                u32 value;
                struct address_space *space = current_space();
                frame->eax = (space &&
                              address_space_copyin(space, &value, frame->ebx, 4) == 0)
                                 ? value
                                 : (u32)-1;
            }
            break;
        case 10:
            {
                struct address_space *space = current_space();
                frame->eax = (space &&
                              address_space_user_write32(space, frame->ebx,
                                                         frame->ecx))
                                 ? 1u
                                 : 0u;
            }
            break;
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

#include "kernel/types.h"
#include "kernel/error.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "kernel/mm/address_space.h"
#include "arch/x86/tss.h"
#include "arch/x86/syscall.h"
#include "arch/x86/page_fault.h"
#include "arch/x86/interrupt.h"
#include "drivers/video/vga.h"
#include "drivers/serial/uart.h"
#include "app/arm/app.h"

void kernel_main(void)
{
    u32 rc;

    vga_init();
    uart_init();
    address_space_boot();
    task_boot();
    process_boot();
    tss_init();

    rc = arm_app_init();
    if (rc) {
        struct aevum_error e = {
            ERR_KERNEL_MAIN_ARM_APP,
            "kernel_main",
            "arm_app_init",
            "arm app assembly failed",
            "kernel_main",
            rc,
            (u8)((rc >> 16) & 0xFF)
        };
        aevum_fail(&e);
    }

    /* 先装 IDT/PIC/PIT，再让第一个任务 iret 打开 IF；定时抢占从此刻开始。 */
    __asm__ __volatile__("cli");
    interrupt_init();
    syscall_init();
    page_fault_init();
    arm_app_start();
    for (;;) __asm__ __volatile__("cli; hlt");
}

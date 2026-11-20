#include "kernel/types.h"
#include "kernel/error.h"
#include "kernel/task.h"
#include "drivers/video/vga.h"
#include "drivers/serial/uart.h"
#include "app/arm/app.h"

void kernel_main(void)
{
    u32 rc;

    vga_init();
    uart_init();
    task_boot();

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

    arm_app_start();
    for (;;) __asm__ __volatile__("cli; hlt");
}

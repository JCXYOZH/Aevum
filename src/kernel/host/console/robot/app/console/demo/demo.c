#include "app/console/demo.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "kernel/mm/address_space.h"
#include "arch/x86/page_fault.h"
#include "arch/x86/exception.h"
#include "drivers/console/console.h"
#include "config/memory.h"

extern u8 user_program_start[];
extern u8 user_program_end[];

#define CONSOLE_CHILD_PID     0x0A0u
#define CONSOLE_CLOSE_READ    0x0A4u
#define CONSOLE_CLOSE_WRITE   0x0A8u
#define CONSOLE_PARENT_READ   0x0ACu
#define CONSOLE_PARENT_WRITE  0x0B0u
#define CONSOLE_MAGIC         0x0BCu

static struct process *console_proc;
static struct address_space *console_space;
static int console_pid;
static const char *volatile console_error;

static u32 console_read32(u32 offset)
{
    if (!console_space) return 0;
    return address_space_user_read32(console_space, AEVUM_USER_DATA_VA + offset);
}

const char *console_demo_start(void)
{
    u32 code_size;

    if (console_demo_alive()) return "console_demo_live";

    code_size = (u32)user_program_end - (u32)user_program_start;
    console_error = 0;
    process_cleanup();
    page_fault_clear();
    exception_clear();
    console_reset();

    console_proc = process_create_user(1, "console", user_program_start,
                                       code_size, AEVUM_USER_STACK_TOP);
    if (!console_proc) {
        console_error = "process_create_user";
        return console_error;
    }
    console_space = process_space(console_proc);
    console_pid = process_pid_of(console_proc);
    address_space_set_mode(console_space, 4u);
    if (task_yield()) {
        console_error = "task_yield";
        console_demo_stop();
        return console_error;
    }
    return 0;
}

void console_demo_stop(void)
{
    process_stop_all();
}

void console_demo_cleanup(void)
{
    process_cleanup();
    console_proc = 0;
    console_space = 0;
    console_pid = 0;
}

int console_demo_alive(void)
{
    return console_pid && process_alive(console_pid) &&
           address_space_user_active(console_space);
}

const char *console_demo_error(void)
{
    return console_error;
}

int console_demo_pid(void)
{
    return console_pid;
}

u32 console_demo_child_pid(void)
{
    return console_read32(CONSOLE_CHILD_PID);
}

u32 console_demo_close_read(void)
{
    return console_read32(CONSOLE_CLOSE_READ);
}

u32 console_demo_close_write(void)
{
    return console_read32(CONSOLE_CLOSE_WRITE);
}

u32 console_demo_parent_read(void)
{
    return console_read32(CONSOLE_PARENT_READ);
}

u32 console_demo_parent_write(void)
{
    return console_read32(CONSOLE_PARENT_WRITE);
}

u32 console_demo_magic(void)
{
    return console_read32(CONSOLE_MAGIC);
}

#include "app/pool/demo.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "kernel/mm/address_space.h"
#include "arch/x86/page_fault.h"
#include "arch/x86/exception.h"
#include "config/memory.h"

extern u8 user_program_start[];
extern u8 user_program_end[];

#define POOL_MAGIC 0x4C4F4F50u  /* "POOL" */
#define POOL_COUNT_OFF 0x0C0u
#define POOL_MAGIC_OFF 0x0C4u
#define POOL_PID_OFF   0x100u

static struct process *pool_proc;
static struct address_space *pool_space;
static int pool_pid;
static u32 pool_pids[POOL_DEMO_CHILDREN];
static const char *volatile pool_error;

const char *pool_demo_start(void)
{
    u32 code_size;

    if (pool_demo_alive()) return "pool_demo_live";

    code_size = (u32)user_program_end - (u32)user_program_start;
    pool_error = 0;
    process_cleanup();
    page_fault_clear();
    exception_clear();
    pool_proc = 0;
    pool_space = 0;
    pool_pid = 0;
    {
        int i;
        for (i = 0; i < POOL_DEMO_CHILDREN; i++) pool_pids[i] = 0;
    }

    pool_proc = process_create_user(1, "poolA", user_program_start,
                                    code_size, AEVUM_USER_STACK_TOP);
    if (!pool_proc) {
        pool_error = "process_create_user";
        return pool_error;
    }
    pool_space = process_space(pool_proc);
    pool_pid = process_pid_of(pool_proc);
    address_space_set_mode(pool_space, 5u);
    if (task_yield()) {
        pool_error = "task_yield";
        pool_demo_stop();
        return pool_error;
    }
    return 0;
}

void pool_demo_stop(void)
{
    process_stop_all();
}

void pool_demo_cleanup(void)
{
    int i;

    process_cleanup();
    pool_proc = 0;
    pool_space = 0;
    pool_pid = 0;
    for (i = 0; i < POOL_DEMO_CHILDREN; i++) pool_pids[i] = 0;
}

int pool_demo_alive(void)
{
    /*
     * 只用全局 live 计数，不依赖某个 AS 指针。
     * 根进程先退出时它的 space 可能已被回收，但 8 个子进程仍在跑；
     * 若此时把 space->used 当作整体存活条件，渲染层会过早 cleanup，
     * 留下子进程占 task/proc/AS/栈槽。
     */
    return process_live_count() > 0;
}

const char *pool_demo_error(void)
{
    return pool_error;
}

int pool_demo_pid(void)
{
    return pool_pid;
}

u32 pool_demo_child_count(void)
{
    int i;
    u32 count;

    if (!pool_space || !address_space_user_active(pool_space))
        return 0;
    count = address_space_user_read32(pool_space, AEVUM_USER_DATA_VA + POOL_COUNT_OFF);
    if (count > POOL_DEMO_CHILDREN) count = POOL_DEMO_CHILDREN;
    for (i = 0; i < (int)count; i++)
        pool_pids[i] = address_space_user_read32(
            pool_space, AEVUM_USER_DATA_VA + POOL_PID_OFF + (u32)i * 4u);
    return count;
}

u32 pool_demo_child_pid(int index)
{
    if (!pool_space || index < 0 || index >= POOL_DEMO_CHILDREN)
        return 0;
    pool_pids[index] = address_space_user_read32(
        pool_space, AEVUM_USER_DATA_VA + POOL_PID_OFF + (u32)index * 4u);
    return pool_pids[index];
}

u32 pool_demo_magic(void)
{
    if (!pool_space || !address_space_user_active(pool_space))
        return 0;
    return address_space_user_read32(pool_space, AEVUM_USER_DATA_VA + POOL_MAGIC_OFF);
}

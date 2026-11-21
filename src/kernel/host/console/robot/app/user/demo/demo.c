#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/mm/address_space.h"
#include "config/memory.h"
#include "kernel/error.h"

#define USER_LANES 2

extern u8 user_program_start[];
extern u8 user_program_end[];

static struct task_struct *tasks[USER_LANES];
static struct address_space *spaces[USER_LANES];
static int pids[USER_LANES];
static volatile u32 demo_error;

static int lane_alive(int lane)
{
    struct task_info info;
    return pids[lane] && address_space_user_active(spaces[lane]) &&
           task_snapshot_pid(pids[lane], &info);
}

u32 user_demo_start(void)
{
    u32 code_size;
    int i;

    if (lane_alive(0) || lane_alive(1)) return 0;
    code_size = (u32)user_program_end - (u32)user_program_start;
    demo_error = 0;

    for (i = 0; i < USER_LANES; i++) {
        spaces[i] = address_space_create_user(user_program_start, code_size);
        if (!spaces[i]) {
            demo_error = ERR_MM_NO_SPACE;
            return demo_error;
        }
    }

    for (i = 0; i < USER_LANES; i++) {
        u32 rc = task_create_user(
            1,
            i ? "userB" : "userA",
            AEVUM_USER_CODE_VA,
            i ? AEVUM_STACK_USER_B : AEVUM_STACK_USER_A,
            spaces[i],
            AEVUM_USER_STACK_TOP,
            &tasks[i]);
        if (rc) {
            demo_error = rc;
            user_demo_stop();
            return rc;
        }
        pids[i] = task_pid_of(tasks[i]);
    }
    return 0;
}

void user_demo_stop(void)
{
    int i;
    for (i = 0; i < USER_LANES; i++)
        if (spaces[i]) address_space_set_stop(spaces[i], 1);
}

int user_demo_alive(void)
{
    return lane_alive(0) || lane_alive(1);
}

u32 user_demo_error(void)
{
    return demo_error;
}

int user_demo_pid(int lane)
{
    return (lane >= 0 && lane < USER_LANES) ? pids[lane] : 0;
}

struct address_space *user_demo_space(int lane)
{
    return (lane >= 0 && lane < USER_LANES) ? spaces[lane] : 0;
}

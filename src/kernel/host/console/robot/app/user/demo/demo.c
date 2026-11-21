#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/mm/address_space.h"
#include "arch/x86/page_fault.h"
#include "config/memory.h"
#include "kernel/error.h"

extern u8 user_program_start[];
extern u8 user_program_end[];

static struct task_struct *tasks[USER_DEMO_LANES];
static struct address_space *spaces[USER_DEMO_LANES];
static int pids[USER_DEMO_LANES];
static volatile u32 demo_error;

static const char *const lane_names[USER_DEMO_LANES] = {
    "userA", "userB", "userC"
};
static const u32 lane_stacks[USER_DEMO_LANES] = {
    AEVUM_STACK_USER_A, AEVUM_STACK_USER_B, AEVUM_STACK_USER_C
};

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

    for (i = 0; i < USER_DEMO_LANES; i++)
        if (lane_alive(i)) return 0;

    code_size = (u32)user_program_end - (u32)user_program_start;
    demo_error = 0;
    /* 新演示从干净的 #PF 记录开始；旧记录的 PID 可能被下一次复用。 */
    page_fault_clear();

    for (i = 0; i < USER_DEMO_LANES; i++) {
        spaces[i] = address_space_create_user(user_program_start, code_size);
        if (!spaces[i]) {
            demo_error = ERR_MM_NO_SPACE;
            return demo_error;
        }
        /* 同一段用户代码，用数据页里的 mode 区分正常任务和故障探针。 */
        address_space_set_mode(spaces[i], i == USER_DEMO_FAULT_LANE ? 1u : 0u);
    }

    for (i = 0; i < USER_DEMO_LANES; i++) {
        u32 rc = task_create_user(
            1,
            lane_names[i],
            AEVUM_USER_CODE_VA,
            lane_stacks[i],
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
    for (i = 0; i < USER_DEMO_LANES; i++)
        if (spaces[i]) address_space_set_stop(spaces[i], 1);
}

/* V 页只等两个正常用户任务退完；userC 故障后由 #PF 单独回收。 */
int user_demo_alive(void)
{
    int i;
    for (i = 0; i < USER_DEMO_NORMAL; i++)
        if (lane_alive(i)) return 1;
    return 0;
}

u32 user_demo_error(void)
{
    return demo_error;
}

int user_demo_pid(int lane)
{
    return (lane >= 0 && lane < USER_DEMO_LANES) ? pids[lane] : 0;
}

struct address_space *user_demo_space(int lane)
{
    return (lane >= 0 && lane < USER_DEMO_LANES) ? spaces[lane] : 0;
}

int user_demo_faulted(int lane)
{
    struct page_fault_info info;
    if (lane != USER_DEMO_FAULT_LANE) return 0;
    return page_fault_last(&info) && info.pid == (u32)pids[lane];
}

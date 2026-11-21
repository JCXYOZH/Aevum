#include "app/fpu/demo.h"
#include "kernel/task.h"
#include "config/memory.h"

#define FPU_LANES 2

static struct task_struct *p_lane[FPU_LANES];
static volatile int active;
static volatile u32 stop;
static volatile u32 done[FPU_LANES];
static volatile struct fpu_lane lanes[FPU_LANES];

/* 16 字节对齐的 XMM0 初值和每步增量；标签放在第 1 个 dword，切换后必须不变。 */
static const u32 base_a[4] __attribute__((aligned(16))) = { 0u, 0x000A11CEu, 0x11111111u, 0u };
static const u32 base_b[4] __attribute__((aligned(16))) = { 0u, 0x000B22CEu, 0x22222222u, 0u };
static const u32 step_a[4] __attribute__((aligned(16))) = { 1u, 0u, 0u, 0u };
static const u32 step_b[4] __attribute__((aligned(16))) = { 2u, 0u, 0u, 0u };

static void fpu_lane_task(int lane)
{
    const u32 *base = lane ? base_b : base_a;
    const u32 *step = lane ? step_b : step_a;
    u32 expected_tag = lane ? 0x000B22CEu : 0x000A11CEu;
    u32 out[4] __attribute__((aligned(16)));

    lanes[lane].pid = (u32)task_current_pid();
    lanes[lane].count = 0;
    lanes[lane].tag = expected_tag;
    lanes[lane].ok = 1;
    lanes[lane].seq = 0;

    __asm__ __volatile__("movdqu (%0), %%xmm0" : : "r"(base) : "memory");

    while (!stop) {
        __asm__ __volatile__("paddd (%0), %%xmm0" : : "r"(step) : "memory", "xmm0");
        __asm__ __volatile__("movdqu %%xmm0, (%0)" : : "r"(out) : "memory");

        lanes[lane].count = out[0];
        lanes[lane].tag = out[1];
        lanes[lane].ok = (out[1] == expected_tag);
        lanes[lane].seq++;
    }

    done[lane] = 1;
    task_exit();
}

static void fpu_lane_a(void) { fpu_lane_task(0); }
static void fpu_lane_b(void) { fpu_lane_task(1); }

u32 fpu_demo_start(void)
{
    u32 rc;

    if (fpu_demo_live()) return 0;

    stop = 0;
    done[0] = 0;
    done[1] = 0;
    active = 1;

    rc = task_create(2, "fpuA", fpu_lane_a, AEVUM_STACK_PROBE, &p_lane[0]);
    if (rc) {
        active = 0;
        done[0] = 1;
        done[1] = 1;
        return rc;
    }

    rc = task_create(1, "fpuB", fpu_lane_b, AEVUM_STACK_DUEL_A, &p_lane[1]);
    if (rc) {
        stop = 1;
        done[1] = 1;
        active = 0;
        return rc;
    }

    return 0;
}

void fpu_demo_stop(void)
{
    stop = 1;
}

int fpu_demo_live(void)
{
    if (active && done[0] && done[1]) active = 0;
    return active && (!done[0] || !done[1]);
}

int fpu_demo_read(int lane, struct fpu_lane *out)
{
    if (!out || lane < 0 || lane >= FPU_LANES) return 0;
    out->pid = lanes[lane].pid;
    out->count = lanes[lane].count;
    out->tag = lanes[lane].tag;
    out->ok = lanes[lane].ok;
    out->seq = lanes[lane].seq;
    return 1;
}

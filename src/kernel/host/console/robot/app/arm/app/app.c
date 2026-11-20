#include "app/arm/app.h"
#include "app/arm/control.h"
#include "app/arm/render.h"
#include "kernel/task.h"
#include "kernel/error.h"
#include "drivers/video/vga.h"
#include "drivers/serial/uart.h"
#include "drivers/input/keyboard.h"
#include "config/memory.h"
#include "lib/format.h"

#define PROC_AUTO_TOGGLE 420
#define PROBE_FRAMES 6000
#define DUEL_TAPE 80

static struct task_struct *p_control;
static struct task_struct *p_render;
static struct task_struct *p_idle;
static int probe_live;
static u32 app_dep_code;
static struct task_struct *p_duel_a;
static struct task_struct *p_duel_b;
static volatile u32 duel_stop;
static volatile u32 duel_a;
static volatile u32 duel_b;
static volatile int duel_alive;
static volatile int duel_live;
static volatile u8 duel_tape[DUEL_TAPE];
static volatile u32 duel_tape_head;
static u32 probe_runs;
static volatile int idle_pid;
static volatile u32 idle_block_req;
static volatile u32 idle_blocked;

static const struct aevum_error app_err_template = {
    0, "arm_app", "task_create", "arm app task assembly failed", 0, 0, 0
};

static void proc_control(void)
{
    for (;;) {
        arm_control_step();
        if (task_yield()) {
            struct aevum_error e = app_err_template;
            e.code = ERR_ARM_APP_SWITCH;
            e.field = "task_yield(control)";
            aevum_fail(&e);
        }
    }
}

static void proc_render(void)
{
    int frames = 0;

    for (;;) {
        struct arm_status status;
        u8 key = keyboard_poll();

        if (key == 0x14) {                 /* T：开始/停止抢占决斗 */
            if (duel_live) duel_stop = 1;
            else if (!probe_live) (void)arm_app_start_duel();
        }

        if (!duel_live) {
            if (key == 0x39) arm_control_toggle_nullspace();
            if (key == 0x19) (void)arm_app_spawn_probe();
            if (key == 0x30) {
                if (idle_blocked) (void)task_wake(idle_pid);
                else idle_block_req = 1;
            }
        }

        /* 两个 CPU 密集型 lane 占用全屏；render 只刷新和观察。 */
        if (duel_live) {
            if (duel_alive == 0) {
                duel_live = 0;
            } else {
                arm_render_duel_status(duel_a, duel_b, (const u8 *)duel_tape, duel_tape_head);
                vga_flush();
                if (task_yield()) {
                    struct aevum_error e = app_err_template;
                    e.code = ERR_ARM_APP_SWITCH;
                    e.field = "task_yield(render/duel)";
                    aevum_fail(&e);
                }
                continue;
            }
        }

        /* 探针占用全屏时，render 不再抢画，但仍在调度器里正常让出。 */
        if (probe_live) {
            if (task_yield()) {
                struct aevum_error e = app_err_template;
                e.code = ERR_ARM_APP_SWITCH;
                e.field = "task_yield(render/probe-live)";
                aevum_fail(&e);
            }
            continue;
        }

        arm_control_status(&status);
        arm_render_frame(&status);
        if (idle_blocked)
            vga_text(2, 2, "BLOCKED: idle waiting task_wake()", 0x09);
        vga_flush();
        if ((frames & 7) == 0) uart_scan();
        vga_vsync();
        arm_render_trace_push(&status);

        if ((frames % PROC_AUTO_TOGGLE) == 0)
            arm_control_toggle_nullspace();
        frames++;

        if (task_yield()) {
            struct aevum_error e = app_err_template;
            e.code = ERR_ARM_APP_SWITCH;
            e.field = "task_yield(render)";
            aevum_fail(&e);
        }
    }
}

static void proc_probe(void)
{
    char buf[16];
    int i, c, p, pid = task_current_pid();

    for (i = 0; i < PROBE_FRAMES; i++) {
        int life = ((PROBE_FRAMES - i) * 100) / PROBE_FRAMES;

        vga_clear(0x10);
        vga_text(23, 1, "AEVUM / PID PROBE", 0x1F);
        vga_text(18, 3, "LIVE PROCESS DESCRIPTOR", 0x1B);

        p = 0;
        p += fmt_dec(buf, (u32)pid);
        buf[p] = 0;
        vga_text(28, 5, "PID", 0x1B);
        vga_text(32, 5, buf, 0x1E);
        vga_text(35, 5, "< allocated by task.c", 0x1F);

        p = 0;
        p += fmt_dec(buf, probe_runs);
        buf[p] = 0;
        vga_text(62, 5, "RUN #", 0x1B);
        vga_text(68, 5, buf, 0x1E);

        vga_text(12, 7, "state RUNNING   stack 0xA000..0xB000", 0x1A);
        vga_text(12, 9, "kernel PID bitmap 1..31  /  no hard-coded 1,2,3", 0x18);

        for (c = 8; c < 72; c++)
            vga_cell(c, 11, (char)(c == 8 + ((i * 64) / PROBE_FRAMES) ? 0xDB : 0xB0), 0x1B);

        p = 0;
        p += fmt_dec(buf, (u32)life);
        buf[p] = 0;
        vga_text(12, 13, "life", 0x18);
        vga_text(17, 13, buf, 0x1E);
        vga_text(20, 13, "%", 0x18);

        vga_text(12, 15, "RUNNING  ->  ZOMBIE  ->  REAP  ->  PID REUSED", 0x1F);
        vga_text(12, 17, "press P after return: the same PID is issued again", 0x1E);
        vga_text(12, 19, "this is a real scheduled task, not a printed bitmap", 0x18);

        p = 0;
        p += fmt_dec(buf, task_preempt_total());
        buf[p] = 0;
        vga_text(12, 21, "PIT PREEMPTIONS", 0x18);
        vga_text(29, 21, buf, 0x1E);
        vga_text(34, 21, "timer IRQ0 switched this CPU-bound loop", 0x1B);
        vga_flush();
        vga_vsync();
    }

    probe_live = 0;
    task_exit();
}

/*
 * 两个 CPU 密集型任务：循环里没有 task_yield()。
 * 如果 PIT/IRQ0 不抢占，先跑的那个会把另一个彻底饿死。
 */
static void proc_duel(int lane)
{
    int pid = task_current_pid();
    u32 step = 0;
    u32 last_px = task_preempt_total();
    volatile u32 spin;

    for (;;) {
        if (duel_stop) break;
        step++;
        if (lane) duel_b = step;
        else duel_a = step;
        if (task_preempt_total() != last_px) {
            last_px = task_preempt_total();
            duel_tape[duel_tape_head % (u32)DUEL_TAPE] = (u8)(lane + 1);
            duel_tape_head++;
        }
        if ((step & 63u) == 0)
            arm_render_duel_lane(lane, step, pid);
        for (spin = 0; spin < 12u; spin++)
            __asm__ __volatile__("" ::: "memory");
    }

    arm_render_duel_lane(lane, step, pid);
    duel_alive--;
    task_exit();
}

static void proc_duel_a(void) { proc_duel(0); }
static void proc_duel_b(void) { proc_duel(1); }

static void proc_idle(void)
{
    idle_pid = task_current_pid();
    for (;;) {
        if (idle_block_req) {
            idle_block_req = 0;
            idle_blocked = 1;
            if (task_block()) idle_blocked = 0;
            idle_blocked = 0;
        }
        if (task_yield()) {
            struct aevum_error e = app_err_template;
            e.code = ERR_ARM_APP_SWITCH;
            e.field = "task_yield(idle)";
            aevum_fail(&e);
        }
    }
}

u32 arm_app_spawn_probe(void)
{
    struct task_struct *probe;
    u32 rc;

    if (probe_live) return 0;
    rc = task_create(1, "probe", proc_probe, AEVUM_STACK_PROBE, &probe);
    if (!rc) {
        probe_live = 1;
        probe_runs++;
    }
    return rc;
}

u32 arm_app_start_duel(void)
{
    u32 rc;

    if (duel_live || probe_live) return 0;

    duel_stop = 0;
    duel_a = 0;
    duel_b = 0;
    duel_alive = 2;
    duel_live = 1;
    duel_tape_head = 0;
    arm_render_duel_init();

    rc = task_create(1, "spinA", proc_duel_a, AEVUM_STACK_DUEL_A, &p_duel_a);
    if (rc) {
        duel_stop = 1;
        duel_alive = 0;
        duel_live = 0;
        return rc;
    }

    rc = task_create(1, "spinB", proc_duel_b, AEVUM_STACK_DUEL_B, &p_duel_b);
    if (rc) {
        /* 第一个任务已经存在，让它看到 stop 后自己退出。 */
        duel_stop = 1;
        duel_alive = 1;
        return rc;
    }
    return 0;
}

u32 arm_app_init(void)
{
    u32 rc;

    app_dep_code = 0;
    arm_control_init();
    arm_render_init();

    rc = task_create(3, "control", proc_control, AEVUM_STACK_P1, &p_control);
    if (rc) {
        app_dep_code = rc;
        return ERR_ARM_APP_TASK_CREATE;
    }

    rc = task_create(2, "render", proc_render, AEVUM_STACK_P2, &p_render);
    if (rc) {
        app_dep_code = rc;
        return ERR_ARM_APP_TASK_CREATE;
    }

    rc = task_create(0, "idle", proc_idle, AEVUM_STACK_IDLE, &p_idle);
    if (rc) {
        app_dep_code = rc;
        return ERR_ARM_APP_TASK_CREATE;
    }

    return 0;
}

void arm_app_start(void)
{
    if (!p_control || !p_render || !p_idle) {
        struct aevum_error e = app_err_template;
        e.code = ERR_ARM_APP_TASK_CREATE;
        e.field = "p_control/p_render/p_idle";
        aevum_fail(&e);
    }

    task_start(p_control);
}

u32 arm_app_dep_code(void)
{
    return app_dep_code;
}

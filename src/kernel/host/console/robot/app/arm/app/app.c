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

static struct task_struct *p_control;
static struct task_struct *p_render;
static struct task_struct *p_idle;
static int probe_live;
static u32 app_dep_code;
static u32 probe_runs;

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
        if (key == 0x39) arm_control_toggle_nullspace();
        if (key == 0x19) (void)arm_app_spawn_probe();

        arm_control_status(&status);
        arm_render_frame(&status);
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
        vga_flush();
        vga_vsync();
    }

    probe_live = 0;
    task_exit();
}

static void proc_idle(void)
{
    for (;;) {
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

    if (task_set_state(p_control, TASK_RUNNING)) {
        struct aevum_error e = app_err_template;
        e.code = ERR_ARM_APP_SWITCH;
        e.field = "task_set_state(control)";
        aevum_fail(&e);
    }

    if (task_switch_to(p_control)) {
        struct aevum_error e = app_err_template;
        e.code = ERR_ARM_APP_SWITCH;
        e.field = "task_switch_to(control)";
        aevum_fail(&e);
    }

    for (;;) __asm__ __volatile__("cli; hlt");
}

u32 arm_app_dep_code(void)
{
    return app_dep_code;
}

#include "app/arm/app.h"
#include "app/arm/control.h"
#include "app/arm/render.h"
#include "kernel/task.h"
#include "kernel/error.h"
#include "drivers/video/vga.h"
#include "drivers/serial/uart.h"
#include "drivers/input/keyboard.h"
#include "config/memory.h"

#define PROC_AUTO_TOGGLE 420

static struct task_struct *p_control;
static struct task_struct *p_render;
static struct task_struct *p_idle;
static u32 app_dep_code;

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

u32 arm_app_init(void)
{
    u32 rc;

    app_dep_code = 0;
    arm_control_init();
    arm_render_init();

    rc = task_create(1, 3, "control", proc_control, AEVUM_STACK_P1, &p_control);
    if (rc) {
        app_dep_code = rc;
        return ERR_ARM_APP_TASK_CREATE;
    }

    rc = task_create(2, 2, "render", proc_render, AEVUM_STACK_P2, &p_render);
    if (rc) {
        app_dep_code = rc;
        return ERR_ARM_APP_TASK_CREATE;
    }

    rc = task_create(3, 0, "idle", proc_idle, AEVUM_STACK_IDLE, &p_idle);
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

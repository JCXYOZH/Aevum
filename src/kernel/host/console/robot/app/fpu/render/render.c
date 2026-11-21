#include "app/fpu/render.h"
#include "app/fpu/demo.h"
#include "drivers/video/vga.h"
#include "kernel/task.h"
#include "lib/format.h"

#define C_DARK   0x10
#define C_GRAY   0x08
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_RED    0x0C
#define C_CYAN   0x0B
#define C_MAG    0x0D
#define C_YELLOW 0x0E
#define C_BLUE   0x09

#define BAR_CELLS 40

static char *put_dec(char *p, u32 value)
{
    int n = fmt_dec(p, value);
    p[n] = 0;
    return p + n;
}

static char *put_hex(char *p, u32 value)
{
    int n = fmt_hex(p, value);
    p[n] = 0;
    return p + n;
}

static void draw_lane(int row, const char *name, u8 color,
                      const struct fpu_lane *lane)
{
    char buf[32];
    char *p;
    int i, n;

    vga_text(6, row, name, color);
    vga_text(9, row, "PID", C_GRAY);
    p = buf;
    p = put_dec(p, lane->pid);
    vga_text(13, row, buf, C_WHITE);

    vga_text(18, row, "TAG", C_GRAY);
    p = buf;
    p = put_hex(p, lane->tag);
    vga_text(22, row, buf, color);

    vga_text(31, row, "COUNT", C_GRAY);
    p = buf;
    p = put_dec(p, lane->count);
    vga_text(37, row, buf, C_WHITE);

    if (lane->ok) {
        vga_text(52, row, "CTX OK", C_GREEN);
    } else {
        vga_text(52, row, "CTX LOST", C_RED);
    }

    n = (int)(lane->count % BAR_CELLS);
    for (i = 0; i < BAR_CELLS; i++)
        vga_cell(6 + i, row + 1, i < n ? (char)0xDB : (char)0xB0, color);
}

void fpu_render_frame(void)
{
    struct fpu_lane a, b;
    char buf[32];
    char *p;

    if (!fpu_demo_read(0, &a)) {
        a.pid = a.count = a.tag = a.seq = 0;
        a.ok = 0;
    }
    if (!fpu_demo_read(1, &b)) {
        b.pid = b.count = b.tag = b.seq = 0;
        b.ok = 0;
    }

    vga_clear(C_DARK);
    vga_text(22, 1, "AEVUM / FPU CONTEXT LAB", C_WHITE);
    vga_text(8, 3, "XMM0 is per task: fxsave(prev) -> fxrstor(next)", C_BLUE);
    vga_text(8, 4, "PIT 100Hz preemption, no task_yield() in the lane loop", C_GRAY);

    draw_lane(6, "A", C_CYAN, &a);
    draw_lane(11, "B", C_MAG, &b);

    vga_text(6, 15, "SWITCHES", C_GRAY);
    p = buf;
    p = put_dec(p, task_switch_total());
    vga_text(15, 15, buf, C_WHITE);
    vga_text(28, 15, "PREEMPTIONS", C_GRAY);
    p = buf;
    p = put_dec(p, task_preempt_total());
    vga_text(40, 15, buf, C_WHITE);

    vga_text(6, 17, "A tag A11CE, B tag B22CE.", C_YELLOW);
    vga_text(6, 18, "If XMM0 were CPU-global, one lane would lose its tag.", C_YELLOW);
    vga_text(6, 20, "The counter advances only when its own saved XMM0 comes back.", C_GRAY);
    vga_text(6, 22, "F: stop and return to the arm", C_GREEN);
}

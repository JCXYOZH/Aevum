#include "app/arm/render.h"
#include "drivers/video/vga.h"
#include "kernel/task.h"
#include "lib/fixed.h"
#include "lib/format.h"
#include "lib/trig.h"

#define C_GRAY   0x08
#define C_DGRAY  0x07
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_RED    0x0C
#define C_YELLOW 0x0E
#define C_CYAN   0x0B
#define C_BLUE   0x09
#define C_MAG    0x0D

#define CH_H     0xC4
#define CH_V     0xB3
#define CH_TL    0xDA
#define CH_TR    0xBF
#define CH_BL    0xC0
#define CH_BR    0xD9
#define CH_TT    0xC2
#define CH_BT    0xC1
#define CH_FULL  0xDB
#define CH_MED   0xB1
#define CH_LIGHT 0xB0
#define CH_DEG   0xF8

#define CV_X  1
#define CV_Y  2
#define CV_W  42
#define CV_H  19

#define WX0    (-55706)
#define WY0    (-58982)
#define WSPANX 111411
#define WSPANY 117965

#define TRACE_N 48

static u16 trace[TRACE_N];
static int trace_i;

void arm_render_init(void)
{
    int i;
    for (i = 0; i < TRACE_N; i++) trace[i] = 0;
    trace_i = 0;
}

static int wx(i32 x)
{
    i32 t = fx_div(x - WX0, WSPANX);
    int c = CV_X + (int)(((i64)t * (CV_W - 1)) >> FXBITS);
    if (c < CV_X) c = CV_X;
    if (c > CV_X + CV_W - 1) c = CV_X + CV_W - 1;
    return c;
}

static int wy(i32 y)
{
    i32 t = fx_div(y - WY0, WSPANY);
    int r = CV_Y + CV_H - 1 - (int)(((i64)t * (CV_H - 1)) >> FXBITS);
    if (r < CV_Y) r = CV_Y;
    if (r > CV_Y + CV_H - 1) r = CV_Y + CV_H - 1;
    return r;
}

static void bar(int col, int row, int width, i32 frac, u8 attr)
{
    int n = (int)(((i64)frac * width) >> FXBITS);
    int i;
    if (n < 0) n = 0;
    if (n > width) n = width;
    for (i = 0; i < width; i++)
        vga_cell(col + i, row, i < n ? (char)CH_FULL : (char)CH_LIGHT, attr);
}

static char task_state_char(int state)
{
    if (state == TASK_RUNNING) return 'R';
    if (state == TASK_READY) return 'r';
    if (state == TASK_BLOCKED) return 'B';
    if (state == TASK_ZOMBIE) return 'Z';
    return '?';
}

static u8 task_pid_color(u32 pid)
{
    if (pid == 1) return C_CYAN;
    if (pid == 2) return C_MAG;
    if (pid == 3) return C_YELLOW;
    return C_GRAY;
}

static void task_panel(void)
{
    char buf[40];
    struct task_info ti;
    int slot, x, p, i;
    int len, first, pad;
    u32 total = task_switch_total();
    u32 now;

    vga_text(45, 18, "TASK SCHED", C_CYAN);
    vga_text(56, 18, "sw", C_GRAY);
    p = 0;
    p += fmt_dec(buf, total);
    buf[p] = 0;
    vga_text(59, 18, buf, C_WHITE);

    len = task_trace_len();
    now = len ? task_trace_pid(len - 1) : 0;

    x = 45;
    for (slot = 0; slot < TASK_MAX; slot++) {
        u8 attr;
        if (!task_snapshot(slot, &ti)) continue;
        p = 0;
        p += fmt_dec(buf + p, (u32)ti.pid);
        buf[p++] = ti.comm[0] ? ti.comm[0] : '?';
        buf[p++] = ti.comm[1] ? ti.comm[1] : ' ';
        buf[p++] = ' ';
        buf[p++] = task_state_char(ti.state);
        buf[p++] = ' ';
        p += fmt_dec(buf + p, ti.stack_used);
        buf[p++] = 'B';
        buf[p++] = ' ';
        buf[p] = 0;
        if ((u32)ti.pid == now)
            attr = (u8)((task_pid_color(now) << 4) | C_WHITE);
        else
            attr = (ti.state == TASK_RUNNING) ? C_GREEN : C_GRAY;
        vga_text(x, 19, buf, attr);
        x += p;
        if (x > 76) break;
    }

    first = len > 35 ? len - 35 : 0;
    pad = 35 - (len > 35 ? 35 : len);
    for (i = 0; i < 35; i++) {
        if (i < pad) {
            vga_cell(45 + i, 20, ' ', C_GRAY);
        } else {
            u32 pid = task_trace_pid(first + i - pad);
            vga_cell(45 + i, 20, (char)CH_FULL, task_pid_color(pid));
        }
    }
}

void arm_render_frame(const struct arm_status *s)
{
    char buf[40];
    int c, r, i, p;
    u8 sc, sp_max;

    vga_clear(C_DGRAY);

    vga_text(1, 0, " 3-DOF Planar Arm  |  Jacobian live demo ", C_WHITE);
    p = 0;
    p += fmt_dec(buf, (u32)s->frame_no);
    buf[p] = 0;
    vga_text(62, 0, buf, C_GRAY);

    for (c = CV_X - 1; c <= CV_X + CV_W; c++) {
        vga_cell(c, CV_Y - 1, (char)CH_H, C_GRAY);
        vga_cell(c, CV_Y + CV_H, (char)CH_H, C_GRAY);
    }
    for (r = CV_Y - 1; r <= CV_Y + CV_H; r++) {
        vga_cell(CV_X - 1, r, (char)CH_V, C_GRAY);
        vga_cell(CV_X + CV_W, r, (char)CH_V, C_GRAY);
    }
    vga_cell(CV_X - 1, CV_Y - 1, (char)CH_TL, C_GRAY);
    vga_cell(CV_X + CV_W, CV_Y - 1, (char)CH_TR, C_GRAY);
    vga_cell(CV_X - 1, CV_Y + CV_H, (char)CH_BL, C_GRAY);
    vga_cell(CV_X + CV_W, CV_Y + CV_H, (char)CH_BR, C_GRAY);

    for (c = CV_X; c <= CV_X + CV_W - 1; c++) vga_cell(c, wy(0), '.', C_GRAY);

    for (i = 0; i < TRACE_N; i++) {
        u16 t = trace[i];
        if (t) vga_cell(t & 0xFF, (int)(t >> 8), '.', C_BLUE);
    }

    vga_cell(wx(s->target.x), wy(s->target.y), 'o', C_YELLOW);

    {
        int c0 = wx(0), r0 = wy(0);
        int c1 = wx(s->points.elbow.x), r1 = wy(s->points.elbow.y);
        int c2 = wx(s->points.wrist.x), r2 = wy(s->points.wrist.y);
        int c3 = wx(s->points.end.x), r3 = wy(s->points.end.y);
        vga_line(c0, r0, c1, r1, (char)CH_FULL, C_CYAN);
        vga_line(c1, r1, c2, r2, (char)CH_FULL, C_CYAN);
        vga_line(c2, r2, c3, r3, (char)CH_FULL, C_MAG);
        vga_cell(c1, r1, 'O', C_WHITE);
        vga_cell(c2, r2, '*', C_WHITE);
        vga_cell(c3, r3, '@', C_GREEN);
        vga_cell(c0, r0, '#', C_WHITE);
    }

    {
        int X = 45;
        vga_text(X, 1, "ARM STATUS", C_CYAN);
        vga_text(X + 22, 1, s->null_on ? "nullsp ON " : "nullsp OFF",
                 s->null_on ? C_GREEN : C_RED);
        for (c = X; c < X + 32; c++) vga_cell(c, 2, (char)CH_H, C_GRAY);

        vga_text(X, 3, "joint angles", C_GRAY);
        for (i = 0; i < ARM_NLINK; i++) {
            int rr = 4 + i;
            int L = 0, k;
            vga_cell(X + 1, rr, 'q', C_GRAY);
            vga_cell(X + 2, rr, (char)('1' + i), C_GRAY);
            fmt_fx(buf, fx_deg(s->q[i]), 1);
            while (buf[L]) L++;
            for (k = 0; k < 6 - L; k++) vga_cell(X + 5 + k, rr, ' ', C_GRAY);
            vga_text(X + 11 - L, rr, buf, C_WHITE);
            vga_cell(X + 12, rr, (char)CH_DEG, C_GRAY);
        }

        vga_text(X, 8, "manipulability w", C_GRAY);
        fmt_fx(buf, s->w_manip, 4);
        vga_text(X + 18, 8, buf, C_WHITE);

        vga_text(X, 9, "weakest dir  smin", C_GRAY);
        fmt_fx(buf, s->sigma_min, 4);
        if (s->sigma_min < 1311)      sc = C_RED;
        else if (s->sigma_min < 6554) sc = C_YELLOW;
        else                          sc = C_GREEN;
        vga_text(X + 18, 9, buf, sc);

        vga_text(X, 10, "lap worst smin", C_GRAY);
        fmt_fx(buf, (s->lap_smin_min == 0x7FFFFFFF) ? s->sigma_min : s->lap_smin_min, 4);
        {
            i32 wmin = (s->lap_smin_min == 0x7FFFFFFF) ? s->sigma_min : s->lap_smin_min;
            u8 wc = (wmin < 1966) ? C_RED : (wmin < 6554 ? C_YELLOW : C_GREEN);
            vga_text(X + 18, 10, buf, wc);
        }

        bar(X, 11, 32, s->sigma_max > 0 ? fx_div(s->sigma_min, s->sigma_max) : 0, sc);

        vga_text(X, 13, "speed  no damping", C_GRAY);
        fmt_fx(buf, s->nodamp_speed, 2);
        vga_text(X + 20, 13, buf, s->nodamp_speed > 196608 ? C_RED : C_YELLOW);
        vga_text(X + 27, 13, "rad/s", C_GRAY);

        vga_text(X, 14, "speed  damped", C_GRAY);
        {
            i32 sp = 0;
            for (i = 0; i < ARM_NLINK; i++) {
                i32 a = s->dq[i] < 0 ? -s->dq[i] : s->dq[i];
                if (a > sp) sp = a;
            }
            fmt_fx(buf, sp, 2);
            sp_max = (sp > 157286) ? C_RED : (sp > 78643 ? C_YELLOW : C_GREEN);
            vga_text(X + 20, 14, buf, sp_max);
            vga_text(X + 27, 14, "rad/s", C_GRAY);
            bar(X, 15, 32, fx_div(sp, 196608), sp_max);
        }

        vga_text(X, 17, "lap peak no damp", C_GRAY);
        fmt_fx(buf, s->lap_nodamp_max, 1);
        vga_text(X + 20, 17, buf, s->lap_nodamp_max > 196608 ? C_RED : C_YELLOW);
        vga_text(X + 27, 17, "rad/s", C_GRAY);

        vga_text(X, 16, "lap peak damped", C_GRAY);
        fmt_fx(buf, s->lap_speed_max, 2);
        vga_text(X + 20, 16, buf, s->lap_speed_max > 157286 ? C_RED : C_GREEN);
        vga_text(X + 27, 16, "rad/s", C_GRAY);

        task_panel();
    }

    for (c = 0; c < VGA_COLS; c++) vga_cell(c, 21, (char)CH_H, C_GRAY);
    vga_text(2, 22, "tip@ elbowO wrist* targeto path. base#  sweep 0.30..0.81m", C_GRAY);
    vga_text(2, 23, "tip", C_GRAY);
    fmt_fx(buf, s->err_mm, 3);
    vga_text(6, 23, buf, C_WHITE);
    vga_text(12, 23, "mm", C_GRAY);
    vga_text(15, 23, "lim", C_GRAY);
    fmt_fx(buf, s->limit_margin, 1);
    vga_text(19, 23, buf, C_WHITE);
    vga_text(25, 23, "deg", C_GRAY);
    vga_text(29, 23, "null", C_GRAY);
    fmt_fx(buf, s->null_share, 3);
    vga_text(34, 23, buf, C_WHITE);
    {
        i32 wmin = (s->lap_smin_min == 0x7FFFFFFF) ? s->sigma_min : s->lap_smin_min;
        i32 wmx = s->lap_speed_max;
        if (wmin < 1966)
            vga_text(2, 24, ">>> smin collapsed: no-damping demand 5+ rad/s -- damping is what bounds it <<<", C_RED);
        else if (wmx > 196608)
            vga_text(2, 24, ">>> no-damping demand exceeds the 3.00 rad/s motor limit; damping contains it <<<", C_YELLOW);
        else if (wmx > 78643)
            vga_text(2, 24, ">>> joint speed demand rises sharply as the arm reaches full extension <<<", C_YELLOW);
        else
            vga_text(2, 24, "OK: joint speed demand stays inside the 3.00 rad/s motor capability", C_GREEN);
    }
}

void arm_render_trace_push(const struct arm_status *s)
{
    trace[trace_i] = (u16)(wx(s->points.end.x) | (wy(s->points.end.y) << 8));
    trace_i = (trace_i + 1) % TRACE_N;
}

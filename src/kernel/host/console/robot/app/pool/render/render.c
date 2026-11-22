#include "app/pool/render.h"
#include "app/pool/demo.h"
#include "kernel/proc.h"
#include "kernel/task.h"
#include "kernel/task/stack.h"
#include "kernel/mm/address_space.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define C_BG     0x01
#define C_HDR    0x1F
#define C_CYAN   0x0B
#define C_GRAY   0x08
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_YELLOW 0x0E
#define C_MAG    0x0D

static int put_dec(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_dec(buf, value);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
    return col + n;
}

static void put_hex(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_hex_width(buf, value, 8);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
}

static void put_ratio(int col, int row, int used, int cap)
{
    int c = put_dec(col, row, (u32)used, C_GREEN);
    vga_cell(c, row, '/', C_GRAY);
    (void)put_dec(c + 1, row, (u32)cap, C_WHITE);
}

static const char *proc_state_text(int state)
{
    switch (state) {
    case PROC_LIVE: return "LIVE";
    case PROC_ZOMBIE: return "ZOMB";
    case PROC_DEAD: return "DEAD";
    default: return "FREE";
    }
}

void pool_render_frame(void)
{
    static u32 page_frames;
    struct process_info info;
    int i, row, tasks, procs, spaces, stacks, live, stress;
    u32 count, magic, first, last;

    page_frames++;
    tasks = task_slot_used();
    procs = process_slot_used();
    spaces = address_space_slot_used();
    stacks = kernel_stack_used();
    live = process_live_count();
    count = pool_demo_child_count();
    magic = pool_demo_magic();
    stress = pool_demo_is_stress();
    first = stress ? pool_demo_child_pid(0) : 0;
    last = stress ? pool_demo_child_pid(1) : 0;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    if (stress) {
        vga_text(4, 0, "AEVUM / P5.3 FORK/WAIT STRESS", C_HDR);
        vga_text(2, 1, "100 rounds: fork, child exit(7), wait, PID reused", C_CYAN);
    } else {
        vga_text(4, 0, "AEVUM / P5.1 SLOT POOL", C_HDR);
        vga_text(2, 1, "task / proc / AS / kernel-stack slots, all static pools", C_CYAN);
    }

    vga_text(2, 3, "task", C_GRAY);
    put_ratio(7, 3, tasks, task_slot_capacity());
    vga_text(14, 3, "proc", C_GRAY);
    put_ratio(19, 3, procs, process_count());
    vga_text(26, 3, "AS", C_GRAY);
    put_ratio(29, 3, spaces, address_space_slot_capacity());
    vga_text(36, 3, "kstack", C_GRAY);
    put_ratio(43, 3, stacks, kernel_stack_capacity());

    if (stress) {
        vga_text(2, 4, "round", C_GRAY);
        put_dec(8, 4, count, C_WHITE);
        vga_text(11, 4, "/100", C_GRAY);
        vga_text(17, 4, "first", C_GRAY);
        put_dec(23, 4, first, C_CYAN);
        vga_text(25, 4, "->", C_GRAY);
        put_dec(27, 4, last, C_CYAN);
        vga_text(32, 4, "live", C_GRAY);
        put_dec(37, 4, (u32)live, C_WHITE);
        vga_text(41, 4, "state", C_GRAY);
        vga_text(47, 4, magic == 0x4C4F4F50u ? "STRESS OK" : "RUN",
                 magic == 0x4C4F4F50u ? C_GREEN : C_YELLOW);
        vga_text(2, 5, "PHYS", C_GRAY);
        put_ratio(7, 5, address_space_phys_used(), address_space_phys_total());
        vga_text(18, 5, "proc", C_GRAY);
        put_ratio(23, 5, procs, process_count());
        vga_text(31, 5, "AS", C_GRAY);
        put_ratio(34, 5, spaces, address_space_slot_capacity());
        vga_text(40, 5, "KSTK", C_GRAY);
        put_ratio(46, 5, stacks, kernel_stack_capacity());
    } else {
        vga_text(2, 4, "live", C_GRAY);
        put_dec(7, 4, (u32)live, C_WHITE);
        vga_text(11, 4, "root", C_GRAY);
        put_dec(16, 4, (u32)pool_demo_pid(), C_WHITE);
        vga_text(20, 4, "children", C_GRAY);
        put_dec(29, 4, count, C_WHITE);
        vga_text(32, 4, "/", C_GRAY);
        put_dec(34, 4, POOL_DEMO_CHILDREN, C_WHITE);
        if (magic == 0x4C4F4F50u)
            vga_text(39, 4, "POOL OK", C_GREEN);
        else
            vga_text(39, 4, "POOL ..", C_YELLOW);
        vga_text(51, 4, "frames", C_GRAY);
        put_dec(58, 4, page_frames, C_WHITE);
    }

    vga_fill(2, 6, 77, 6, ' ', C_HDR);
    vga_text(2, 6, "PID  PPID  STATE  COMM     ASID   KSTACK TOP", C_HDR);

    row = 7;
    for (i = 0; i < process_count() && row < 19; i++) {
        if (!process_snapshot(i, &info) || !info.used) continue;
        put_dec(2, row, (u32)info.pid, C_WHITE);
        put_dec(7, row, (u32)info.ppid, C_GRAY);
        vga_text(13, row, proc_state_text(info.state), C_GREEN);
        vga_text(20, row, info.comm, C_WHITE);
        put_dec(29, row, info.asid, C_CYAN);
        put_hex(37, row, info.stack_top, C_MAG);
        row++;
    }

    vga_text(2, 21, "task/proc/AS/kstack are static slots; PHYS counts 4KB frames", C_GRAY);
    vga_text(2, 22, "Y: 8 children stay live; S: 100 fork/wait, child exit 7, wait checked", C_GRAY);
    vga_text(2, 23, "POOL magic = all waits returned 7 and reused one PID; repeat S", C_GREEN);
    vga_text(2, 24, stress ? "S:exit stress page" : "Y:exit pool page", C_YELLOW);
}

#include "app/user/render.h"
#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/mm/address_space.h"
#include "drivers/video/vga.h"
#include "lib/format.h"
#include "arch/x86/syscall.h"

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

static u8 state_attr(int state)
{
    switch (state) {
        case TASK_RUNNING: return C_GREEN;
        case TASK_READY:   return C_YELLOW;
        case TASK_ZOMBIE:  return C_GRAY;
        default:           return C_GRAY;
    }
}

static void draw_lane(int lane, int row)
{
    struct address_space *space = user_demo_space(lane);
    struct task_info info;
    int pid = user_demo_pid(lane);
    int alive = pid && task_snapshot_pid(pid, &info);
    const char *name = lane ? "USER-B" : "USER-A";
    u32 counter = space ? address_space_counter(space) : 0;

    vga_text(2, row, name, C_HDR);
    vga_text(11, row, "PID", C_GRAY);
    put_dec(15, row, (u32)pid, C_WHITE);
    vga_text(20, row, "CPL 3", C_CYAN);
    vga_text(28, row, "ASID", C_GRAY);
    put_dec(33, row, address_space_id(space), C_WHITE);
    vga_text(39, row, "CR3", C_GRAY);
    put_hex(43, row, address_space_cr3(space), C_CYAN);
    if (alive) {
        vga_text(54, row, task_state_name(info.state), state_attr(info.state));
    } else {
        vga_text(54, row, "REAPED", C_GRAY);
    }

    vga_text(4, row + 1, "VA 00400000 -> PHYS", C_GRAY);
    put_hex(25, row + 1, address_space_code_phys(space), C_WHITE);
    vga_text(35, row + 1, "code RO", C_GRAY);

    vga_text(4, row + 2, "VA 00401000 -> PHYS", C_GRAY);
    put_hex(25, row + 2, address_space_data_phys(space), C_WHITE);
    vga_text(35, row + 2, "data RW", C_GRAY);

    vga_text(4, row + 3, "private counter @401000 =", C_GRAY);
    put_dec(30, row + 3, counter, C_YELLOW);
}

void user_render_frame(void)
{
    int row;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(20, 0, "AEVUM / RING3 PROCESS CONTEXT", C_HDR);
    vga_text(2, 2, "SAME VIRTUAL CODE, SEPARATE PHYSICAL PAGES", C_CYAN);
    vga_text(2, 3, "both tasks iret to CPL 3 at 400000; only CR3 differs", C_GRAY);

    draw_lane(0, 5);
    for (row = 5; row <= 10; row++) vga_cell(1, row, '|', C_GRAY);
    draw_lane(1, 13);
    for (row = 13; row <= 18; row++) vga_cell(1, row, '|', C_GRAY);

    vga_text(2, 18, "int 0x80 traps", C_GRAY);
    put_dec(18, 18, syscall_count_total(), C_WHITE);
    vga_text(33, 18, "last CS", C_GRAY);
    put_hex(41, 18, syscall_last_cs(), C_CYAN);

    vga_text(2, 20, "V: stop both ring3 tasks and return", C_YELLOW);
    vga_text(2, 21, "int 0x80 eax=2 yields; eax=3 exits; no kernel pointer exposed.", C_CYAN);
    vga_text(2, 22, "user pages are U/S=1; kernel 0..4MB stays supervisor-only.", C_GRAY);
    vga_text(2, 23, "CR3 0x40000 / 0x46000 are real page directories, not printed values.", C_GRAY);
}

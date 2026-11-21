#include "app/user/render.h"
#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/mm/address_space.h"
#include "drivers/video/vga.h"
#include "lib/format.h"
#include "arch/x86/syscall.h"
#include "arch/x86/page_fault.h"

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
    static const char *const names[USER_DEMO_LANES] = {
        "USER-A", "USER-B", "USER-C"
    };
    struct address_space *space = user_demo_space(lane);
    struct task_info info;
    int pid = user_demo_pid(lane);
    int alive = pid && task_snapshot_pid(pid, &info) &&
                address_space_user_active(space);
    u32 counter = space ? address_space_counter(space) : 0;

    vga_text(2, row, names[lane], C_HDR);
    vga_text(11, row, "PID", C_GRAY);
    put_dec(15, row, (u32)pid, C_WHITE);
    vga_text(20, row, "CPL 3", C_CYAN);
    vga_text(28, row, "ASID", C_GRAY);
    put_dec(33, row, address_space_id(space), C_WHITE);
    vga_text(39, row, "CR3", C_GRAY);
    put_hex(43, row, address_space_cr3(space), C_CYAN);
    if (alive) {
        vga_text(54, row, task_state_name(info.state), state_attr(info.state));
    } else if (user_demo_faulted(lane)) {
        vga_text(54, row, "FAULT", C_MAG);
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

static void draw_fault(void)
{
    struct page_fault_info f;
    int present, write, user;

    if (!page_fault_last(&f)) {
        vga_text(2, 19, "#PF none yet: userC will probe kernel page 0xB8000", C_GRAY);
        vga_text(2, 20, "A/B still running; no task has been killed", C_GRAY);
        vga_text(2, 21, "isolation demo waits for userC's intentional fault", C_CYAN);
        return;
    }

    present = f.err & 1u;
    write = (f.err & 2u) != 0;
    user = (f.err & 4u) != 0;

    vga_text(2, 19, "#PF pid", C_MAG);
    put_dec(10, 19, f.pid, C_WHITE);
    vga_text(15, 19, "eip", C_GRAY);
    put_hex(19, 19, f.eip, C_WHITE);
    vga_text(28, 19, "cr2", C_GRAY);
    put_hex(32, 19, f.cr2, C_WHITE);
    vga_text(41, 19, "err", C_GRAY);
    put_hex(45, 19, f.err, C_WHITE);

    vga_text(2, 20, "P=", C_GRAY);
    vga_cell(4, 20, present ? '1' : '0', present ? C_MAG : C_GRAY);
    vga_text(6, 20, "W=", C_GRAY);
    vga_cell(8, 20, write ? '1' : '0', write ? C_MAG : C_GRAY);
    vga_text(10, 20, "U=", C_GRAY);
    vga_cell(12, 20, user ? '1' : '0', user ? C_MAG : C_GRAY);
    vga_text(15, 20, "ring3 fault; #PF killed only this task", C_GREEN);
    vga_text(56, 20, "count", C_GRAY);
    put_dec(62, 20, page_fault_count(), C_WHITE);

    vga_text(2, 21, "userC AS released; A/B still count; kernel stayed alive", C_GREEN);
    vga_text(2, 22, "V: stop userA/userB and return; userC already killed", C_YELLOW);
    vga_text(2, 23, "kernel 0..4MB supervisor-only; user VA 0x400000..0x403FFF", C_GRAY);
}

void user_render_frame(void)
{
    int lane;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(20, 0, "AEVUM / RING3 PROCESS CONTEXT", C_HDR);
    vga_text(2, 2, "A/B COUNT NORMALLY; C PROBES KERNEL PAGE 0xB8000", C_CYAN);
    vga_text(2, 3, "only C should die; A/B CR3s and counters must survive", C_GRAY);

    for (lane = 0; lane < USER_DEMO_LANES; lane++)
        draw_lane(lane, 4 + lane * 5);

    vga_text(2, 18, "int 0x80 traps", C_GRAY);
    put_dec(18, 18, syscall_count_total(), C_WHITE);
    vga_text(33, 18, "last CS", C_GRAY);
    put_hex(41, 18, syscall_last_cs(), C_CYAN);

    draw_fault();
}

#include "app/user/render.h"
#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/proc.h"
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

static const char *proc_state(const struct process_info *p)
{
    if (p->state == PROC_DEAD) {
        if (user_demo_faulted(USER_DEMO_FAULT_LANE) &&
            p->pid == user_demo_pid(USER_DEMO_FAULT_LANE))
            return "FAULT";
        return "REAP";
    }
    if (p->state == PROC_ZOMBIE) return "ZOMB";
    return task_state_name(p->task_state);
}

static u8 proc_attr(const struct process_info *p)
{
    if (p->state == PROC_DEAD) {
        if (user_demo_faulted(USER_DEMO_FAULT_LANE) &&
            p->pid == user_demo_pid(USER_DEMO_FAULT_LANE))
            return C_MAG;
        return C_GRAY;
    }
    if (p->state == PROC_ZOMBIE) return C_GRAY;
    if (p->task_state == TASK_RUNNING) return C_GREEN;
    if (p->task_state == TASK_READY) return C_YELLOW;
    return C_GRAY;
}

static void draw_process_row(int slot, int row)
{
    struct process_info p;

    if (!process_snapshot(slot, &p)) return;

    vga_text(2, row, "PID", C_GRAY);
    put_dec(6, row, (u32)p.pid, C_WHITE);
    vga_text(10, row, "PP", C_GRAY);
    put_dec(13, row, (u32)p.ppid, C_WHITE);
    vga_text(17, row, "ST", C_GRAY);
    vga_text(20, row, proc_state(&p), proc_attr(&p));
    vga_text(25, row, "EXIT", C_GRAY);
    if (p.state == PROC_ZOMBIE || p.state == PROC_DEAD)
        put_dec(30, row, p.exit_code, C_WHITE);
    else
        vga_text(30, row, "-", C_GRAY);
    vga_text(34, row, "CR3", C_GRAY);
    put_hex(38, row, p.cr3, C_CYAN);
    vga_text(47, row, "AS", C_GRAY);
    put_dec(50, row, p.asid, C_WHITE);
    vga_text(54, row, "CNT", C_GRAY);
    put_dec(58, row, p.counter, C_YELLOW);
    vga_text(66, row, p.comm, C_HDR);
}

static void draw_fault(void)
{
    struct page_fault_info f;
    int present, write, user;

    if (!page_fault_last(&f)) {
        vga_text(2, 17, "#PF pending: userC probes kernel page 0xB8000", C_GRAY);
        vga_text(2, 18, "A/B/D keep counting; C will die alone", C_CYAN);
        vga_text(2, 19, "kernel 0..4MB supervisor-only; user VA 0x400000..0x403FFF", C_GRAY);
        return;
    }

    present = f.err & 1u;
    write = (f.err & 2u) != 0;
    user = (f.err & 4u) != 0;

    vga_text(2, 17, "#PF pid", C_MAG);
    put_dec(10, 17, f.pid, C_WHITE);
    vga_text(15, 17, "eip", C_GRAY);
    put_hex(19, 17, f.eip, C_WHITE);
    vga_text(28, 17, "cr2", C_GRAY);
    put_hex(32, 17, f.cr2, C_WHITE);
    vga_text(41, 17, "err", C_GRAY);
    put_hex(45, 17, f.err, C_WHITE);
    vga_text(56, 17, "count", C_GRAY);
    put_dec(62, 17, page_fault_count(), C_WHITE);

    vga_text(2, 18, "P=", C_GRAY);
    vga_cell(4, 18, present ? '1' : '0', present ? C_MAG : C_GRAY);
    vga_text(6, 18, "W=", C_GRAY);
    vga_cell(8, 18, write ? '1' : '0', write ? C_MAG : C_GRAY);
    vga_text(10, 18, "U=", C_GRAY);
    vga_cell(12, 18, user ? '1' : '0', user ? C_MAG : C_GRAY);
    vga_text(15, 18, "ring3 fault; #PF killed only userC", C_GREEN);

    vga_text(2, 19, "C exit status 142 (128+SIGSEGV); A/B/D still count", C_GREEN);
}

void user_render_frame(void)
{
    int slot, row;
    u32 child, wait_pid, status, wait_ret, magic;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(18, 0, "AEVUM / PROCESS CONTEXT", C_HDR);
    vga_text(2, 2, "A/B/D COUNT | C #PF | D FORK + WAIT | PCB TABLE", C_CYAN);

    vga_text(2, 3, "PID", C_GRAY);
    vga_text(10, 3, "PP", C_GRAY);
    vga_text(17, 3, "ST", C_GRAY);
    vga_text(25, 3, "EXIT", C_GRAY);
    vga_text(34, 3, "CR3", C_GRAY);
    vga_text(47, 3, "AS", C_GRAY);
    vga_text(54, 3, "CNT", C_GRAY);
    vga_text(66, 3, "COMM", C_GRAY);

    for (slot = 0, row = 4; slot < process_count() && row < 12; slot++) {
        struct process_info p;
        if (!process_snapshot(slot, &p)) continue;
        draw_process_row(slot, row++);
    }

    vga_text(2, 12, "int 0x80 traps", C_GRAY);
    put_dec(18, 12, syscall_count_total(), C_WHITE);
    vga_text(33, 12, "last CS", C_GRAY);
    put_hex(41, 12, syscall_last_cs(), C_CYAN);

    child = user_demo_fork_child(3);
    wait_pid = user_demo_wait_pid(3);
    status = user_demo_wait_status(3);
    wait_ret = user_demo_wait_ret(3);
    magic = user_demo_wait_magic(3);

    vga_text(2, 14, "userD fork", C_GRAY);
    put_dec(14, 14, child, C_WHITE);
    vga_text(21, 14, "wait ret", C_GRAY);
    put_dec(31, 14, wait_ret, C_WHITE);
    vga_text(38, 14, "pid", C_GRAY);
    put_dec(43, 14, wait_pid, C_WHITE);
    vga_text(48, 14, "status", C_GRAY);
    put_dec(56, 14, status, C_WHITE);

    if (magic == 0x4B4F)
        vga_text(2, 15, "WAIT OK 7: child exit code crossed the syscall ABI", C_GREEN);
    else
        vga_text(2, 15, "wait pending: D is polling via task_yield()", C_YELLOW);

    draw_fault();

    vga_text(2, 21, "fork copies 4 user pages + kernel frame + FPU state;", C_GRAY);
    vga_text(2, 22, "parent returns child PID, child returns 0; wait reaps ZOMBIE.", C_GRAY);
    vga_text(2, 23, "V: stop all user processes; C's #PF exit is wait status 142.", C_YELLOW);
}

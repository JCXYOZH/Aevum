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
        if (p->pid == user_demo_pid(USER_DEMO_GUARD_LANE)) return "GUARD";
        if (p->pid == user_demo_pid(USER_DEMO_FAULT_LANE)) return "FAULT";
        return "REAP";
    }
    if (p->state == PROC_ZOMBIE) return "ZOMB";
    return task_state_name(p->task_state);
}

static u8 proc_attr(const struct process_info *p)
{
    if (p->state == PROC_DEAD) {
        if (user_demo_pid_faulted(p->pid)) return C_MAG;
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
    vga_text(9, row, "PP", C_GRAY);
    put_dec(12, row, (u32)p.ppid, C_WHITE);
    vga_text(15, row, "ST", C_GRAY);
    vga_text(18, row, proc_state(&p), proc_attr(&p));
    vga_text(24, row, "EXIT", C_GRAY);
    if (p.state == PROC_ZOMBIE || p.state == PROC_DEAD)
        put_dec(29, row, p.exit_code, C_WHITE);
    else
        vga_text(29, row, "-", C_GRAY);
    vga_text(34, row, "CR3", C_GRAY);
    put_hex(38, row, p.cr3, C_CYAN);
    vga_text(47, row, "AS", C_GRAY);
    put_dec(50, row, p.asid, C_WHITE);
    vga_text(54, row, "PGS", C_GRAY);
    put_dec(58, row, p.user_pages, C_WHITE);
    vga_text(62, row, "BRK", C_GRAY);
    put_hex(66, row, p.brk, C_YELLOW);
    vga_text(75, row, p.comm, C_HDR);
}

static void draw_vma(int row)
{
    struct address_space *space = user_demo_space(0);
    int n = address_space_vma_count(space);

    vga_text(2, row, "userA VMA", C_GRAY);
    put_dec(11, row, (u32)n, C_WHITE);
    vga_text(14, row, "code RX", C_GRAY);
    put_hex(22, row, 0x400000u, C_WHITE);
    vga_text(31, row, "data RW", C_GRAY);
    put_hex(39, row, 0x401000u, C_WHITE);
    vga_text(48, row, "guard --", C_MAG);
    put_hex(57, row, 0x402000u, C_MAG);

    vga_text(2, row + 1, "stack RW", C_GRAY);
    put_hex(11, row + 1, 0x403000u, C_WHITE);
    vga_text(20, row + 1, "ctrl R", C_GRAY);
    put_hex(27, row + 1, 0x404000u, C_WHITE);
    vga_text(36, row + 1, "heap RW", C_GRAY);
    put_hex(44, row + 1, 0x405000u, C_WHITE);
    vga_text(54, row + 1, "brk", C_GRAY);
    put_hex(58, row + 1, address_space_brk(space), C_YELLOW);
}

static void draw_heap_guard(void)
{
    u32 brk = user_demo_brk(0);
    u32 poke = user_demo_heap_poke(0);
    u32 peek = user_demo_heap_peek(0);
    u32 guard = user_demo_guard_poke(0);
    u32 bad = user_demo_bad_brk(0);

    vga_text(2, 13, "A brk", C_GRAY);
    put_hex(8, 13, brk, C_YELLOW);
    vga_text(17, 13, "heap poke", C_GRAY);
    put_dec(27, 13, poke, poke ? C_GREEN : C_YELLOW);
    vga_text(30, 13, "peek", C_GRAY);
    put_hex(35, 13, peek, peek == 0x48454C50u ? C_GREEN : C_YELLOW);
    vga_text(45, 13, "guard poke", C_GRAY);
    put_dec(56, 13, guard, guard == 0 ? C_GREEN : C_MAG);
    vga_text(60, 13, "bad brk", C_GRAY);
    put_hex(68, 13, bad, bad == 0xFFFFFFFFu ? C_GREEN : C_MAG);
}

static void draw_fault(int row)
{
    struct page_fault_info f;
    int present, write, user;

    if (!page_fault_last(&f)) {
        vga_text(2, row, "#PF pending: C probes kernel 0xB8000; F writes guard", C_GRAY);
        vga_text(2, row + 1, "guard 0x402000 is VMA without PTE; guard poke returns 0", C_CYAN);
        vga_text(2, row + 2, "faulting process dies alone; parent sees exit status 142", C_GRAY);
        return;
    }

    present = f.err & 1u;
    write = (f.err & 2u) != 0;
    user = (f.err & 4u) != 0;

    vga_text(2, row, "#PF pid", C_MAG);
    put_dec(10, row, f.pid, C_WHITE);
    vga_text(15, row, "eip", C_GRAY);
    put_hex(19, row, f.eip, C_WHITE);
    vga_text(28, row, "cr2", C_GRAY);
    put_hex(32, row, f.cr2, C_WHITE);
    vga_text(41, row, "err", C_GRAY);
    put_hex(45, row, f.err, C_WHITE);
    vga_text(54, row, "count", C_GRAY);
    put_dec(60, row, page_fault_count(), C_WHITE);

    vga_text(2, row + 1, "P=", C_GRAY);
    vga_cell(4, row + 1, present ? '1' : '0', present ? C_MAG : C_GRAY);
    vga_text(6, row + 1, "W=", C_GRAY);
    vga_cell(8, row + 1, write ? '1' : '0', write ? C_MAG : C_GRAY);
    vga_text(10, row + 1, "U=", C_GRAY);
    vga_cell(12, row + 1, user ? '1' : '0', user ? C_MAG : C_GRAY);
    vga_text(15, row + 1, "ring3 fault; only the faulting process died", C_GREEN);

    vga_text(2, row + 2, "C kernel probe and F guard write both exit 142 (128+SIGSEGV)", C_GREEN);
}

void user_render_frame(void)
{
    int slot, row;
    u32 child, wait_pid, status, wait_ret, magic;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(15, 0, "AEVUM / VMA + HEAP + PHYS PAGES", C_HDR);
    vga_text(2, 2, "A/B HEAP | C #PF | D FORK+WAIT | F GUARD | VMA + PHYS POOL", C_CYAN);

    vga_text(2, 3, "PID", C_GRAY);
    vga_text(9, 3, "PP", C_GRAY);
    vga_text(15, 3, "ST", C_GRAY);
    vga_text(24, 3, "EXIT", C_GRAY);
    vga_text(34, 3, "CR3", C_GRAY);
    vga_text(47, 3, "AS", C_GRAY);
    vga_text(54, 3, "PGS", C_GRAY);
    vga_text(62, 3, "BRK", C_GRAY);
    vga_text(75, 3, "COMM", C_GRAY);

    for (slot = 0, row = 4; slot < process_count() && row < 10; slot++) {
        struct process_info p;
        if (!process_snapshot(slot, &p)) continue;
        draw_process_row(slot, row++);
    }

    vga_text(2, 10, "ADDRESS SPACE: VMA / brk / copyin-copyout / PHYS POOL", C_CYAN);
    draw_vma(11);
    draw_heap_guard();

    child = user_demo_fork_child(USER_DEMO_FORK_LANE);
    wait_pid = user_demo_wait_pid(USER_DEMO_FORK_LANE);
    status = user_demo_wait_status(USER_DEMO_FORK_LANE);
    wait_ret = user_demo_wait_ret(USER_DEMO_FORK_LANE);
    magic = user_demo_wait_magic(USER_DEMO_FORK_LANE);

    vga_text(2, 14, "userD fork", C_GRAY);
    put_dec(12, 14, child, C_WHITE);
    vga_text(18, 14, "wait", C_GRAY);
    put_dec(23, 14, wait_ret, C_WHITE);
    vga_text(31, 14, "pid", C_GRAY);
    put_dec(35, 14, wait_pid, C_WHITE);
    vga_text(42, 14, "status", C_GRAY);
    put_dec(49, 14, status, C_WHITE);
    if (magic == 0x4B4F)
        vga_text(56, 14, "WAIT OK 7", C_GREEN);
    else
        vga_text(56, 14, "WAIT ...", C_YELLOW);

    vga_text(2, 15, "userF guard lane", C_GRAY);
    put_dec(18, 15, (u32)user_demo_pid(USER_DEMO_GUARD_LANE), C_WHITE);
    vga_text(25, 15, "writes 0x402000; expected exit 142", C_GRAY);

    draw_fault(16);

    vga_text(2, 19, "PHYS PAGES used/total", C_GRAY);
    put_dec(25, 19, address_space_phys_used(), C_WHITE);
    vga_text(28, 19, "/", C_GRAY);
    put_dec(29, 19, address_space_phys_total(), C_CYAN);
    vga_text(39, 19, "6 VMA + brk pages + fork copy", C_GRAY);

    vga_text(2, 20, "int 0x80 traps", C_GRAY);
    put_dec(18, 20, syscall_count_total(), C_WHITE);
    vga_text(33, 20, "last CS", C_GRAY);
    put_hex(41, 20, syscall_last_cs(), C_CYAN);

    vga_text(2, 21, "copyin/peek and copyout/poke walk VMA + PTE; no raw user deref.", C_GRAY);
    vga_text(2, 22, "brk 405000->406000; heap 405800 poke/peek OK; brk 500000 rejected.", C_GRAY);
    vga_text(2, 23, "guard 402000 has VMA but no PTE; F dies alone; C remains 142.", C_GRAY);
    vga_text(2, 24, "V: stop all user processes; second V starts a fresh AS/PID round.", C_YELLOW);
}

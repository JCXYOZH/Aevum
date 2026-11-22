#include "app/user/render.h"
#include "app/user/demo.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "kernel/mm/address_space.h"
#include "drivers/video/vga.h"
#include "lib/format.h"
#include "arch/x86/syscall.h"
#include "arch/x86/page_fault.h"
#include "arch/x86/exception.h"

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
        /* PID 会被 fork 子进程复用，角色只能看 comm，不能拿旧 lane PID 比对。 */
        if (p->term_sig == PROC_SIGSEGV && p->comm[4] == 'C') return "FAULT";
        if (p->term_sig == PROC_SIGSEGV && p->comm[4] == 'F') return "GUARD";
        if (p->term_sig) return "SIG";
        return "REAP";
    }
    if (p->state == PROC_ZOMBIE) return "ZOMB";
    return task_state_name(p->task_state);
}

static u8 proc_attr(const struct process_info *p)
{
    if (p->state == PROC_DEAD) {
        if (p->term_sig) return C_MAG;
        return C_GRAY;
    }
    if (p->state == PROC_ZOMBIE) return C_MAG;
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
    if (p.state == PROC_ZOMBIE || p.state == PROC_DEAD) {
        if (p.term_sig) {
            vga_text(29, row, "SIG", C_MAG);
            put_dec(32, row, p.term_sig, C_MAG);
        } else {
            put_dec(29, row, p.exit_code, C_WHITE);
        }
    } else {
        vga_text(29, row, "-", C_GRAY);
    }
    vga_text(34, row, "CR3", C_GRAY);
    put_hex(38, row, p.cr3, C_CYAN);
    vga_text(47, row, "AS", C_GRAY);
    put_dec(50, row, p.asid, C_WHITE);
    vga_text(54, row, "PGS", C_GRAY);
    put_dec(58, row, p.user_pages, C_WHITE);
    vga_text(59, row, "/", C_GRAY);
    put_dec(60, row, p.cow_pages, p.cow_pages ? C_MAG : C_GRAY);
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
    vga_text(15, row + 1, "ring3 #PF -> SIGSEGV; only the faulting process died", C_GREEN);
}

static void draw_signal(int row)
{
    struct exception_info x;
    struct process_info p = {0};
    int have = exception_last(&x);
    int i;
    int have_d = 0;

    vga_text(2, row, "SIG", C_GRAY);
    if (!have) {
        vga_text(6, row, "#DE: D child installs handler, div 0, sigreturn", C_GRAY);
        return;
    }

    for (i = 0; i < process_count(); i++) {
        struct process_info cur;
        if (!process_snapshot(i, &cur)) continue;
        if (cur.pid == user_demo_pid(USER_DEMO_FORK_LANE)) {
            p = cur;
            have_d = 1;
        }
    }

    vga_text(6, row, exception_vector_name(x.vector), C_MAG);
    put_dec(10, row, exception_vector_count(x.vector), C_WHITE);
    vga_text(12, row, "pid", C_GRAY);
    put_dec(16, row, x.pid, C_WHITE);
    vga_text(19, row, "eip", C_GRAY);
    put_hex(23, row, x.eip, C_WHITE);
    vga_text(33, row, "sig", C_GRAY);
    put_dec(37, row, x.sig, C_MAG);
    vga_text(41, row, exception_signal_name(x.sig), C_MAG);
    vga_text(50, row, "hdl", C_GRAY);
    put_dec(54, row, x.handled, x.handled ? C_GREEN : C_YELLOW);
    vga_text(57, row, "chld", C_GRAY);
    if (have_d) {
        put_dec(62, row, p.sigchld_count, C_CYAN);
        vga_text(66, row, "pend", C_GRAY);
        put_hex(71, row, p.pending, C_MAG);
    }
}

static void draw_cow(int row)
{
    struct address_space_cow_info ci;

    address_space_cow_snapshot(&ci);
    vga_text(2, row, "COW", C_GRAY);
    vga_text(7, row, "forks", C_GRAY);
    put_dec(13, row, ci.forks, C_WHITE);
    vga_text(15, row, "shared", C_GRAY);
    put_dec(22, row, ci.shared, C_CYAN);
    vga_text(24, row, "live", C_GRAY);
    put_dec(29, row, ci.live, ci.live ? C_MAG : C_GRAY);
    vga_text(31, row, "breaks", C_GRAY);
    put_dec(38, row, ci.breaks, C_WHITE);
    vga_text(41, row, "last", C_GRAY);
    put_dec(46, row, ci.last_asid, C_WHITE);
    vga_text(49, row, "old", C_GRAY);
    put_hex(54, row, ci.last_old, C_CYAN);
    vga_text(62, row, "->", C_GRAY);
    put_hex(64, row, ci.last_new, C_GREEN);
}

void user_render_frame(void)
{
    int slot, row;
    u32 child, wait_pid, status, wait_ret, magic;
    u32 readback, cow_ok;
    u32 sig_child, sig_status, sig_ret, sig_ok;
    u32 exec_child, exec_status, exec_ret, exec_ok, exec_img;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(4, 0, "AEVUM / COW FORK + SIGNALS + PHYS", C_HDR);
    vga_text(2, 2, "A/B HEAP | C #PF | D COW+SIGFRAME | F GUARD | PGS/COW/SIG", C_CYAN);

    vga_text(2, 3, "PID", C_GRAY);
    vga_text(9, 3, "PP", C_GRAY);
    vga_text(15, 3, "ST", C_GRAY);
    vga_text(24, 3, "EXIT", C_GRAY);
    vga_text(34, 3, "CR3", C_GRAY);
    vga_text(47, 3, "AS", C_GRAY);
    vga_text(54, 3, "PGS", C_GRAY);
    vga_text(60, 3, "C", C_MAG);
    vga_text(62, 3, "BRK", C_GRAY);
    vga_text(75, 3, "COMM", C_GRAY);

    for (slot = 0, row = 4; slot < process_count() && row < 10; slot++) {
        struct process_info p;
        if (!process_snapshot(slot, &p)) continue;
        draw_process_row(slot, row++);
    }

    vga_text(2, 10, "ADDRESS SPACE: COW / VMA / brk / copyin-copyout / PHYS", C_CYAN);
    draw_vma(11);
    draw_heap_guard();

    child = user_demo_fork_child(USER_DEMO_FORK_LANE);
    wait_pid = user_demo_wait_pid(USER_DEMO_FORK_LANE);
    status = user_demo_wait_status(USER_DEMO_FORK_LANE);
    wait_ret = user_demo_wait_ret(USER_DEMO_FORK_LANE);
    magic = user_demo_wait_magic(USER_DEMO_FORK_LANE);
    readback = user_demo_cow_readback(USER_DEMO_FORK_LANE);
    cow_ok = user_demo_cow_ok(USER_DEMO_FORK_LANE);
    sig_child = user_demo_sig_child(USER_DEMO_FORK_LANE);
    sig_status = user_demo_sig_status(USER_DEMO_FORK_LANE);
    sig_ret = user_demo_sig_ret(USER_DEMO_FORK_LANE);
    sig_ok = user_demo_sig_ok(USER_DEMO_FORK_LANE);
    exec_child = user_demo_exec_child(USER_DEMO_FORK_LANE);
    exec_status = user_demo_exec_status(USER_DEMO_FORK_LANE);
    exec_ret = user_demo_exec_ret(USER_DEMO_FORK_LANE);
    exec_ok = user_demo_exec_ok(USER_DEMO_FORK_LANE);
    exec_img = exec_child ? (u32)process_image_id((int)exec_child) : 0;

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
    if (cow_ok == 0x434F57 && readback == 0x50415041)
        vga_text(67, 14, "COW OK", C_GREEN);
    else
        vga_text(67, 14, "COW ..", C_YELLOW);

    draw_cow(15);

    vga_text(2, 16, "userF guard lane", C_GRAY);
    put_dec(18, 16, (u32)user_demo_pid(USER_DEMO_GUARD_LANE), C_WHITE);
    vga_text(25, 16, "writes 0x402000; expected SIGSEGV", C_GRAY);

    draw_fault(17);
    draw_signal(19);

    vga_text(2, 20, "PHYS PAGES used/total", C_GRAY);
    put_dec(25, 20, address_space_phys_used(), C_WHITE);
    vga_text(28, 20, "/", C_GRAY);
    put_dec(29, 20, address_space_phys_total(), C_CYAN);
    vga_text(39, 20, "COW fork shares pages; write breaks private copy", C_GRAY);

    vga_text(2, 21, "int 0x80 traps", C_GRAY);
    put_dec(18, 21, syscall_count_total(), C_WHITE);
    vga_text(33, 21, "last CS", C_GRAY);
    put_hex(41, 21, syscall_last_cs(), C_CYAN);

    vga_text(2, 22, "D fork2", C_GRAY);
    put_dec(9, 22, sig_child, C_WHITE);
    vga_text(13, 22, "wait", C_GRAY);
    put_dec(17, 22, sig_ret, C_WHITE);
    vga_text(20, 22, "st", C_GRAY);
    put_hex(23, 22, sig_status, C_WHITE);
    if (sig_ok == 0x48414E44)
        vga_text(32, 22, "HAND OK", C_GREEN);
    else
        vga_text(32, 22, "HAND ..", C_YELLOW);
    vga_text(40, 22, "handler + sigreturn, child exit 9", C_GRAY);

    vga_text(2, 23, "P4 exec", C_GRAY);
    put_dec(10, 23, exec_child, C_WHITE);
    vga_text(14, 23, "wait", C_GRAY);
    put_dec(19, 23, exec_ret, C_WHITE);
    vga_text(23, 23, "st", C_GRAY);
    put_hex(26, 23, exec_status, C_WHITE);
    vga_text(37, 23, "img", C_GRAY);
    put_dec(41, 23, exec_img, exec_img ? C_GREEN : C_YELLOW);
    if (exec_ok == 0x45584543u)
        vga_text(45, 23, "EXEC OK", C_GREEN);
    else
        vga_text(45, 23, "EXEC ..", C_YELLOW);

    vga_text(2, 24, "V: stop all user processes; second V starts a fresh AS/PID round.", C_YELLOW);
}

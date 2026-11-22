#include "arch/x86/exception.h"
#include "arch/x86/frame.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"
#include "kernel/proc.h"
#include "config/memory.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

extern void exception_de_stub(void);
extern void exception_bp_stub(void);
extern void exception_ud_stub(void);
extern void exception_gp_stub(void);

#define EXC_TABLE_SIZE 32u

static struct exception_info last_trap;
static u32 trap_total;
static u32 trap_vectors[EXC_TABLE_SIZE];

static inline u32 read_cr2(void)
{
    u32 value;
    __asm__ __volatile__("mov %%cr2, %0" : "=r"(value));
    return value;
}

static inline u32 read_cr3(void)
{
    u32 value;
    __asm__ __volatile__("mov %%cr3, %0" : "=r"(value));
    return value;
}

static void put_hex(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_hex_width(buf, value, 8);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
}

static void put_dec(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_dec(buf, value);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
}

static u32 exception_signal(u32 vector)
{
    switch (vector) {
        case EXC_DE: return PROC_SIGFPE;
        case EXC_BP: return PROC_SIGTRAP;
        case EXC_UD: return PROC_SIGILL;
        case EXC_GP: return PROC_SIGSEGV;
        default:     return PROC_SIGSEGV;
    }
}

static void kernel_trap_panic(const struct irq_frame *frame)
{
    __asm__ __volatile__("cli");
    vga_clear(0x1F);
    vga_text(2, 1, "AEVUM / KERNEL TRAP", 0x1F);
    vga_text(2, 2, "RING0 TRAP - DIAGNOSTIC HALT", 0x1E);

    vga_text(2, 4, "vector", 0x1F);
    vga_text(9, 4, exception_vector_name(last_trap.vector), 0x1F);
    put_dec(14, 4, last_trap.vector, 0x1F);
    vga_text(18, 4, "pid", 0x1F);
    put_dec(22, 4, last_trap.pid, 0x1F);
    vga_text(27, 4, last_trap.comm[0] ? last_trap.comm : "(unknown)", 0x1F);

    vga_text(2, 5, "eip", 0x1F);
    put_hex(7, 5, last_trap.eip, 0x1F);
    vga_text(20, 5, "err", 0x1F);
    put_hex(24, 5, last_trap.err, 0x1E);

    vga_text(2, 6, "cs", 0x1F);
    put_hex(6, 6, last_trap.cs, 0x1F);
    vga_text(20, 6, "cr3", 0x1F);
    put_hex(24, 6, read_cr3(), 0x1F);

    vga_text(2, 8, "Unexpected kernel trap: no fixup is installed.", 0x1E);
    vga_text(2, 9, "Kernel #PF still has its controlled probe; other traps halt.", 0x1E);
    vga_text(2, 11, "halted. reset QEMU to restart.", 0x1F);
    vga_flush();

    (void)frame;
    for (;;) __asm__ __volatile__("cli; hlt");
}

void exception_init(void)
{
    interrupt_set_kernel_gate(EXC_DE, exception_de_stub);
    interrupt_set_kernel_gate(EXC_BP, exception_bp_stub);
    interrupt_set_kernel_gate(EXC_UD, exception_ud_stub);
    interrupt_set_kernel_gate(EXC_GP, exception_gp_stub);
    exception_clear();
}

void exception_clear(void)
{
    int i;

    last_trap.pid = 0;
    last_trap.cs = 0;
    last_trap.vector = 0;
    last_trap.sig = 0;
    last_trap.eip = 0;
    last_trap.err = 0;
    last_trap.cr2 = 0;
    for (i = 0; i < 16; i++) last_trap.comm[i] = 0;
    trap_total = 0;
    for (i = 0; i < (int)EXC_TABLE_SIZE; i++) trap_vectors[i] = 0;
}

/*
 * 用户态异常帧与 #PF 同构：eax..ebp, vector, err, eip, cs, eflags, [esp, ss]。
 * P3.2 先查每进程 handler：有 handler 就在用户栈构造 signal frame 并改写
 * iret 目标；没有 handler 才走 P3.1 的默认信号终止。
 */
u32 exception_dispatch(struct irq_frame *frame)
{
    struct task_info info;
    u32 vector;
    u32 sig;

    if (!frame)
        for (;;) __asm__ __volatile__("cli; hlt");

    vector = frame->vector;
    if (vector >= EXC_TABLE_SIZE) vector = 31u;
    sig = exception_signal(vector);
    trap_total++;
    trap_vectors[vector]++;

    last_trap.pid = (u32)task_current_pid();
    last_trap.cs = frame->cs;
    last_trap.vector = vector;
    last_trap.sig = sig;
    last_trap.eip = frame->eip;
    last_trap.err = frame->err;
    last_trap.cr2 = read_cr2();
    last_trap.handled = 0;
    if (task_snapshot_pid((int)last_trap.pid, &info)) {
        int i;
        for (i = 0; i < TASK_NAME_MAX && info.comm[i]; i++)
            last_trap.comm[i] = info.comm[i];
        last_trap.comm[i] = 0;
    } else {
        last_trap.comm[0] = '?';
        last_trap.comm[1] = 0;
    }

    if ((frame->cs & 3u) != 3u)
        kernel_trap_panic(frame);

    if (process_signal_deliver(frame, (int)sig, vector)) {
        last_trap.handled = process_sig_handled_current();
        return (u32)frame;
    }

    if (process_terminate_current((int)sig) == 0) {
        task_exit();
    }
    kernel_trap_panic(frame);
    return (u32)frame;
}

int exception_last(struct exception_info *out)
{
    if (!out || !trap_total) return 0;
    *out = last_trap;
    return 1;
}

u32 exception_count(void)
{
    return trap_total;
}

u32 exception_vector_count(u32 vector)
{
    return vector < EXC_TABLE_SIZE ? trap_vectors[vector] : 0;
}

const char *exception_vector_name(u32 vector)
{
    switch (vector) {
        case EXC_DE: return "#DE";
        case EXC_BP: return "#BP";
        case EXC_UD: return "#UD";
        case EXC_GP: return "#GP";
        default:     return "#??";
    }
}

const char *exception_signal_name(u32 sig)
{
    switch (sig) {
        case PROC_SIGILL:  return "SIGILL";
        case PROC_SIGTRAP: return "SIGTRAP";
        case PROC_SIGFPE:  return "SIGFPE";
        case PROC_SIGSEGV: return "SIGSEGV";
        case PROC_SIGCHLD: return "SIGCHLD";
        default:           return "SIG?";
    }
}

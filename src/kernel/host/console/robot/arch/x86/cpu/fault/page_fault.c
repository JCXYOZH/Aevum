#include "arch/x86/page_fault.h"
#include "arch/x86/frame.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"
#include "config/memory.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define PF_VECTOR 14u
/* 页表只恒等映射 0..4MB；4MB 正好落在未映射的 PDE 1，适合做内核态故障探针。 */
#define PF_PROBE_ADDR 0x00400000u

extern void page_fault_stub(void);

static struct page_fault_info last_fault;
static u32 fault_total;
static volatile int panic_active;

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

/* 内核态 #PF 不再尝试调度：直接留下现场并停机，避免二次 fault。 */
static void kernel_fault_panic(const struct irq_frame *frame, u32 cr2) __attribute__((noreturn));

static void kernel_fault_panic(const struct irq_frame *frame, u32 cr2)
{
    u32 err;
    u32 cr3;
    u32 cs;
    u32 cpl;

    __asm__ __volatile__("cli");
    if (panic_active)
        for (;;) __asm__ __volatile__("cli; hlt");
    panic_active = 1;

    err = frame ? frame->err : 0;
    cs = frame ? frame->cs : 0;
    cpl = cs & 3u;
    cr3 = read_cr3();

    vga_clear(0x1F);
    vga_text(2, 1, "AEVUM / KERNEL PAGE FAULT", 0x1F);
    vga_text(2, 2, "RING0 FAULT - DIAGNOSTIC HALT", 0x1E);

    vga_text(2, 4, "task", 0x1F);
    put_dec(9, 4, last_fault.pid, 0x1F);
    vga_text(14, 4, last_fault.comm[0] ? last_fault.comm : "(unknown)", 0x1F);

    vga_text(30, 4, "cs", 0x1F);
    put_hex(33, 4, cs, 0x1F);
    vga_text(43, 4, "cpl", 0x1F);
    put_dec(47, 4, cpl, 0x1E);

    vga_text(2, 5, "eip", 0x1F);
    put_hex(7, 5, last_fault.eip, 0x1F);
    vga_text(20, 5, "cr2", 0x1F);
    put_hex(24, 5, cr2, 0x1E);

    vga_text(2, 6, "err", 0x1F);
    put_hex(7, 6, err, 0x1F);
    vga_text(20, 6, "cr3", 0x1F);
    put_hex(24, 6, cr3, 0x1F);

    vga_text(2, 8, "P", 0x1F);
    put_dec(4, 8, err & 1u, 0x1F);
    vga_text(8, 8, "W/R", 0x1F);
    put_dec(12, 8, (err >> 1) & 1u, 0x1F);
    vga_text(16, 8, "U/S", 0x1F);
    put_dec(20, 8, (err >> 2) & 1u, 0x1F);
    vga_text(24, 8, "RSVD", 0x1F);
    put_dec(29, 8, (err >> 3) & 1u, 0x1F);
    vga_text(33, 8, "I/D", 0x1F);
    put_dec(37, 8, (err >> 4) & 1u, 0x1F);

    vga_text(2, 10, "fault count", 0x1F);
    put_dec(14, 10, fault_total, 0x1E);
    vga_text(2, 11, "kernel image", 0x1F);
    vga_text(15, 11, "0x", 0x1F);
    put_hex(17, 11, AEVUM_KERNEL_BASE, 0x1F);
    vga_text(26, 11, "..", 0x1F);
    vga_text(28, 11, "0x", 0x1F);
    put_hex(30, 11, AEVUM_KERNEL_END, 0x1F);

    vga_text(2, 13, "The fault address is outside the 0..4MB identity map.", 0x1E);
    vga_text(2, 14, "Kernel-mode #PF is not recoverable; no task_exit() is called.", 0x1E);
    vga_text(2, 15, "User tasks are not scheduled after this point.", 0x1E);
    vga_text(2, 17, "halted. reset QEMU to restart.", 0x1F);

    vga_flush();
    for (;;) __asm__ __volatile__("cli; hlt");
}

void page_fault_init(void)
{
    interrupt_set_kernel_gate(PF_VECTOR, page_fault_stub);
    page_fault_clear();
}

void page_fault_clear(void)
{
    last_fault.pid = 0;
    last_fault.cs = 0;
    last_fault.eip = 0;
    last_fault.err = 0;
    last_fault.cr2 = 0;
    {
        int i;
        for (i = 0; i < 16; i++) last_fault.comm[i] = 0;
    }
    fault_total = 0;
    panic_active = 0;
}

/*
 * #PF 帧: eax..ebp, vector, err(CPU 已压), eip, cs, eflags, [user_esp, ss]。
 * 用户态故障只记录现场，然后走 task_exit()；调度器会把当前任务置 ZOMBIE，
 * 只释放它自己的地址空间，其他用户进程继续运行。
 */
u32 page_fault_dispatch(struct irq_frame *frame)
{
    u32 cr2;
    u32 pid;
    struct task_info info;

    if (!frame)
        for (;;) __asm__ __volatile__("cli; hlt");

    cr2 = read_cr2();
    pid = (u32)task_current_pid();
    fault_total++;
    last_fault.pid = pid;
    last_fault.cs = frame->cs;
    last_fault.eip = frame->eip;
    last_fault.err = frame->err;
    last_fault.cr2 = cr2;
    if (task_snapshot_pid((int)pid, &info)) {
        int i;
        for (i = 0; i < TASK_NAME_MAX && info.comm[i]; i++)
            last_fault.comm[i] = info.comm[i];
        last_fault.comm[i] = 0;
    } else {
        last_fault.comm[0] = '?';
        last_fault.comm[1] = 0;
    }

    /* ring3 的错误地址/权限错误：只杀当前进程，不把内核拖下水。 */
    if ((frame->cs & 3u) == 3u) {
        task_exit();
    }

    kernel_fault_panic(frame, cr2);
    return (u32)frame;
}

/*
 * 受控内核态故障探针：从 kernel task 写 4MB 边界，触发 CPL0 #PF。
 * 只用于验证 panic 页；它不会返回，QEMU 需要重新启动。
 */
void page_fault_probe(void)
{
    volatile u32 *probe = (volatile u32 *)PF_PROBE_ADDR;
    *probe = 0xDEADBEEFu;
    for (;;) __asm__ __volatile__("cli; hlt");
}

int page_fault_last(struct page_fault_info *out)
{
    if (!out || !fault_total) return 0;
    *out = last_fault;
    return 1;
}

u32 page_fault_count(void)
{
    return fault_total;
}

#include "arch/x86/page_fault.h"
#include "arch/x86/frame.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"
#include "config/memory.h"
#include "drivers/video/vga.h"
#include "drivers/input/keyboard.h"
#include "lib/format.h"

#define PF_VECTOR 14u
#define PF_PRESENT 0x1u
#define PF_RW      0x2u

#define KEY_R 0x13u
#define KEY_H 0x23u

extern void page_fault_stub(void);

static struct page_fault_info last_fault;
static u32 fault_total;
static u32 recover_total;
static volatile int panic_active;
static volatile int probe_armed;
static volatile int probe_faulted;
static volatile int probe_mapped;

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

static inline void flush_probe_tlb(void)
{
    __asm__ __volatile__("invlpg (%0)" : : "r"(AEVUM_PF_PROBE_VA) : "memory");
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

/* 恢复页只属于受控探针；诊断页内容不需要清零，写操作会覆盖首字。 */
static void probe_pt_reset(void)
{
    u32 *pt = (u32 *)AEVUM_KERNEL_PF_PT;
    u32 *pd = (u32 *)AEVUM_KERNEL_PD;
    int i;

    for (i = 0; i < 1024; i++) pt[i] = 0;
    pd[1] = 0;
    flush_probe_tlb();
    probe_mapped = 0;
}

static int probe_page_map(void)
{
    u32 *pd = (u32 *)AEVUM_KERNEL_PD;
    u32 *pt = (u32 *)AEVUM_KERNEL_PF_PT;

    /* 只允许在共享内核地址空间里修 PDE 1；用户地址空间有自己的 PDE 1。 */
    if (read_cr3() != AEVUM_KERNEL_PD) return 0;
    if (probe_mapped) return 1;
    if (pd[1] != 0) return 0;

    pt[0] = AEVUM_KERNEL_PF_PAGE | PF_PRESENT | PF_RW;
    pd[1] = AEVUM_KERNEL_PF_PT | PF_PRESENT | PF_RW;
    flush_probe_tlb();
    probe_mapped = 1;
    return 1;
}

static void probe_page_unmap(void)
{
    u32 *pd = (u32 *)AEVUM_KERNEL_PD;
    u32 *pt = (u32 *)AEVUM_KERNEL_PF_PT;

    if (probe_mapped) {
        pt[0] = 0;
        pd[1] = 0;
        flush_probe_tlb();
        probe_mapped = 0;
    }
    probe_armed = 0;
    probe_faulted = 0;
    panic_active = 0;
}

static int probe_fault_recoverable(const struct irq_frame *frame, u32 cr2)
{
    return probe_armed &&
           cr2 == AEVUM_PF_PROBE_VA &&
           frame &&
           (frame->cs & 3u) == 0u &&
           (frame->err & 1u) == 0u &&
           read_cr3() == AEVUM_KERNEL_PD;
}

/*
 * 内核态 #PF 页。受控探针允许按 R 修复 PDE 1、执行完出错指令并 iret 返回；
 * 其他内核态 fault 仍只打印现场后停机，避免把未知的内核损坏伪装成可恢复。
 */
static void kernel_fault_panic(const struct irq_frame *frame, u32 cr2, int recoverable)
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
    vga_text(2, 2, recoverable ? "RING0 FAULT - CONTROLLED PROBE" : "RING0 FAULT - DIAGNOSTIC HALT", 0x1E);

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
    vga_text(30, 10, "recoveries", 0x1F);
    put_dec(42, 10, recover_total, 0x1E);

    vga_text(2, 11, "kernel image", 0x1F);
    vga_text(15, 11, "0x", 0x1F);
    put_hex(17, 11, AEVUM_KERNEL_BASE, 0x1F);
    vga_text(26, 11, "..", 0x1F);
    vga_text(28, 11, "0x", 0x1F);
    put_hex(30, 11, AEVUM_KERNEL_END, 0x1F);

    if (recoverable) {
        vga_text(2, 13, "Controlled probe: the address is intentionally unmapped.", 0x1E);
        vga_text(2, 14, "R maps one diagnostic page, executes the store, then iret.", 0x1E);
        vga_text(2, 15, "The mapping is removed after return; K can be fired again.", 0x1E);
        vga_text(2, 17, "R = recover + re-arm", 0x1F);
        vga_text(31, 17, "H = halt", 0x1E);
        vga_flush();

        for (;;) {
            u8 key = keyboard_poll();
            if (key == KEY_R) {
                if (probe_page_map()) {
                    recover_total++;
                    probe_faulted = 1;
                    return;
                }
                vga_text(2, 19, "RECOVERY FAILED: PDE 1 is busy", 0x1E);
                vga_flush();
            }
            if (key == KEY_H) break;
            __asm__ __volatile__("pause");
        }
    } else {
        vga_text(2, 13, "Unexpected kernel fault: fail-stop, no fixup is installed.", 0x1E);
        vga_text(2, 14, "Kernel-mode #PF is not recoverable; no task_exit() is called.", 0x1E);
        vga_text(2, 15, "User tasks are not scheduled after this point.", 0x1E);
        vga_text(2, 17, "halted. reset QEMU to restart.", 0x1F);
        vga_flush();
    }

    for (;;) __asm__ __volatile__("cli; hlt");
}

void page_fault_init(void)
{
    interrupt_set_kernel_gate(PF_VECTOR, page_fault_stub);
    probe_armed = 0;
    probe_faulted = 0;
    probe_mapped = 0;
    probe_pt_reset();
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
    recover_total = 0;
    panic_active = 0;
    probe_armed = 0;
    probe_faulted = 0;
    probe_page_unmap();
}

/*
 * #PF 帧: eax..ebp, vector, err(CPU 已压), eip, cs, eflags, [user_esp, ss]。
 * 用户态故障只记录现场，然后走 task_exit()；受控内核态探针可以恢复，
 * 其他内核态故障进入 panic 页后停机。
 */
u32 page_fault_dispatch(struct irq_frame *frame)
{
    u32 cr2;
    u32 pid;
    struct task_info info;
    int recoverable;

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

    recoverable = probe_fault_recoverable(frame, cr2);
    kernel_fault_panic(frame, cr2, recoverable);

    /* 只有受控探针按 R 后才会走到这里；异常帧由 stub 原样恢复并 iret。 */
    return (u32)frame;
}

/*
 * 受控内核态故障探针：从 kernel task 写 4MB 边界，触发 CPL0 #PF。
 * panic 页按 R 后临时建立 PDE 1 并 iret，写操作完成后本函数撤销映射并返回。
 */
void page_fault_probe(void)
{
    volatile u32 *probe = (volatile u32 *)AEVUM_PF_PROBE_VA;

    probe_armed = 1;
    probe_faulted = 0;
    *probe = 0xDEADBEEFu;

    if (probe_faulted) {
        probe_page_unmap();
    } else {
        /* 地址已被意外映射时不销毁别人的映射，只解除探针武装。 */
        probe_armed = 0;
    }
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

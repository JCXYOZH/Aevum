#include "arch/x86/page_fault.h"
#include "arch/x86/frame.h"
#include "arch/x86/interrupt.h"
#include "kernel/task.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define PF_VECTOR 14u

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
    if (panic_active)
        for (;;) __asm__ __volatile__("cli; hlt");
    panic_active = 1;

    vga_clear(0x4F);
    vga_text(2, 1, "AEVUM / KERNEL PAGE FAULT", 0x4F);
    vga_text(2, 3, "fault did not come from ring3; system halted", 0x4E);
    if (frame) {
        vga_text(2, 5, "eip", 0x4F);
        put_hex(7, 5, frame->eip, 0x4F);
        vga_text(21, 5, "cs", 0x4F);
        put_hex(24, 5, frame->cs, 0x4F);
        vga_text(36, 5, "err", 0x4F);
        put_hex(40, 5, frame->err, 0x4F);
    }
    vga_text(2, 6, "cr2", 0x4F);
    put_hex(7, 6, cr2, 0x4F);
    vga_text(2, 8, "kernel 0..4MB is identity mapped; a kernel fault is a bug,", 0x4E);
    vga_text(2, 9, "not something task_exit() can safely recover.", 0x4E);
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

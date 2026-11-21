#include "arch/x86/tss.h"

struct tss32 {
    u32 prev;
    u32 esp0, ss0, esp1, ss1, esp2, ss2;
    u32 cr3, eip, eflags;
    u32 eax, ecx, edx, ebx, esp, ebp, esi, edi;
    u32 es, cs, ss, ds, fs, gs, ldt;
    u16 trap;
    u16 iomap;
} __attribute__((packed));

#define TSS_SELECTOR 0x28
#define TSS_LIMIT    (sizeof(struct tss32) - 1)

extern u8 gdt_new[];

static struct tss32 tss;

static void desc_write(u32 base)
{
    u8 *d = gdt_new + 5 * 8;
    d[0] = (u8)(TSS_LIMIT & 0xFF);
    d[1] = (u8)((TSS_LIMIT >> 8) & 0xFF);
    d[2] = (u8)(base & 0xFF);
    d[3] = (u8)((base >> 8) & 0xFF);
    d[4] = (u8)((base >> 16) & 0xFF);
    d[5] = 0x89;                 /* present, DPL0, 32-bit available TSS */
    d[6] = 0x00;                 /* byte granularity, limit 16..19 = 0 */
    d[7] = (u8)((base >> 24) & 0xFF);
}

void tss_init(void)
{
    u32 i;
    u8 *p = (u8 *)&tss;
    for (i = 0; i < sizeof(tss); i++) p[i] = 0;
    tss.ss0 = 0x10;
    tss.iomap = (u16)sizeof(tss);
    desc_write((u32)&tss);
    __asm__ __volatile__("ltr %0" : : "rm"((u16)TSS_SELECTOR));
}

void tss_set_esp0(u32 esp0)
{
    tss.esp0 = esp0;
}

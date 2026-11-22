#ifndef AEVUM_ARCH_X86_PAGE_FAULT_H
#define AEVUM_ARCH_X86_PAGE_FAULT_H

#include "kernel/types.h"

struct irq_frame;

/* 最近一次 #PF 的只读记录；渲染层只读，不直接碰 CR2/页表。 */
struct page_fault_info {
    u32 pid;
    u32 cs;
    u32 eip;
    u32 err;
    u32 cr2;
    char comm[16];
};

/* #PF 是 arch/x86 异常入口的唯一 owner：装 IDT 14、记录故障、杀死用户任务。 */
void page_fault_init(void);
void page_fault_clear(void);
u32 page_fault_dispatch(struct irq_frame *frame);
int page_fault_last(struct page_fault_info *out);
u32 page_fault_count(void);

/* 受控 CPL0 故障探针：写 4MB 未映射边界；panic 页按 R 修复并返回。 */
void page_fault_probe(void);

#endif

#ifndef AEVUM_KERNEL_MM_ADDRESS_SPACE_H
#define AEVUM_KERNEL_MM_ADDRESS_SPACE_H

#include "kernel/types.h"

struct address_space;

/*
 * 地址空间的唯一 owner。任务只持有指针，页目录、页表、VMA、用户页、
 * 物理页分配和 CR3 切换都由本模块维护；其他模块不得直接改页表项。
 */

enum address_space_vma_kind {
    ADDRESS_SPACE_VMA_CODE = 1,
    ADDRESS_SPACE_VMA_DATA = 2,
    ADDRESS_SPACE_VMA_GUARD = 3,
    ADDRESS_SPACE_VMA_STACK = 4,
    ADDRESS_SPACE_VMA_CONTROL = 5,
    ADDRESS_SPACE_VMA_HEAP = 6
};

#define ADDRESS_SPACE_VMA_READ   0x1u
#define ADDRESS_SPACE_VMA_WRITE  0x2u
#define ADDRESS_SPACE_VMA_EXEC   0x4u

struct address_space_vma_info {
    u32 start;
    u32 end;
    u32 flags;
    u32 kind;
};

struct address_space_cow_info {
    u32 live;       /* 所有活地址空间里仍处于 COW 的 PTE 数 */
    u32 breaks;     /* 累计 COW 拆分次数 */
    u32 forks;      /* 累计 COW fork 次数 */
    u32 shared;     /* 累计在 fork 时共享、未立即复制的用户页数 */
    u32 last_asid;  /* 最近一次拆分的地址空间 */
    u32 last_old;   /* 拆分前共享物理页 */
    u32 last_new;   /* 拆分后私有物理页 */
};

void address_space_boot(void);
struct address_space *address_space_kernel(void);
struct address_space *address_space_create_user(const u8 *code, u32 code_size);
struct address_space *address_space_clone(const struct address_space *src);
void address_space_release(struct address_space *space);

/* 切到目标地址空间；内核地址空间和当前空间相同时不重复写 CR3。 */
void address_space_switch(struct address_space *space);

u32 address_space_cr3(const struct address_space *space);
u32 address_space_id(const struct address_space *space);
u32 address_space_code_phys(const struct address_space *space);
u32 address_space_data_phys(const struct address_space *space);
u32 address_space_counter(const struct address_space *space);
void address_space_set_stop(struct address_space *space, u32 stop);
void address_space_set_mode(struct address_space *space, u32 mode);
int address_space_user_active(const struct address_space *space);

/* 用户堆：brk 只能落在 [HEAP_VA, HEAP_MAX]；增长时按 VMA 零填新页。 */
u32 address_space_brk(const struct address_space *space);
int address_space_set_brk(struct address_space *space, u32 new_brk);

int address_space_vma_count(const struct address_space *space);
int address_space_vma_snapshot(const struct address_space *space, int slot,
                               struct address_space_vma_info *out);
u32 address_space_user_pages(const struct address_space *space);
u32 address_space_cow_pages(const struct address_space *space);
void address_space_cow_snapshot(struct address_space_cow_info *out);
u32 address_space_phys_total(void);
u32 address_space_phys_used(void);

/*
 * 用户态缺页：只处理 heap VMA 内、尚未建立 PTE 的页；分配零页并重试。
 * 返回 1 表示已修复，调用方应 iret 重试；guard/无 VMA/权限错误返回 0。
 */
int address_space_handle_user_fault(struct address_space *space, u32 va, u32 err);

/* 用户指针校验：按 VMA 和 PTE 双重检查；写操作还要求 VMA.W 与 PTE.RW。 */
int address_space_user_range_ok(const struct address_space *space, u32 va,
                                u32 len, int write);
u32 address_space_user_read32(const struct address_space *space, u32 va);
int address_space_user_write32(struct address_space *space, u32 va, u32 value);

/* copyin/copyout：逐字节翻译用户 VA，失败返回 -1；不再让内核直接解引用用户指针。 */
int address_space_copyin(const struct address_space *space, void *dst,
                         u32 user_va, u32 len);
int address_space_copyout(struct address_space *space, u32 user_va,
                          const void *src, u32 len);

#endif

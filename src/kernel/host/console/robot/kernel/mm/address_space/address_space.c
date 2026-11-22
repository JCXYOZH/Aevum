#include "kernel/mm/address_space.h"
#include "config/memory.h"

#define PAGE_PRESENT 0x1u
#define PAGE_RW      0x2u
#define PAGE_USER    0x4u
#define USER_RW      (PAGE_PRESENT | PAGE_RW | PAGE_USER)
#define USER_RO      (PAGE_PRESENT | PAGE_USER)

struct address_space {
    int used;
    int user;
    u32 id;
    u32 pd;
    u32 pt;
    u32 code;
    u32 data;
    u32 stack;
    u32 control;
};

static struct address_space spaces[AEVUM_AS_MAX];
static struct address_space kernel_space = {
    1, 0, 0, AEVUM_KERNEL_PD, AEVUM_KERNEL_PT, 0, 0, 0, 0
};
static struct address_space *active_space;
static u32 next_id;

static void zero_page(u32 phys)
{
    u32 *p = (u32 *)phys;
    int i;
    for (i = 0; i < 1024; i++) p[i] = 0;
}

static void copy_page(u32 phys, const u8 *src, u32 size)
{
    u8 *dst = (u8 *)phys;
    u32 i = 0;
    for (; i < size && i < AEVUM_PAGE_SIZE; i++) dst[i] = src[i];
}

static void write_cr3(u32 phys)
{
    __asm__ __volatile__("mov %0, %%cr3" : : "r"(phys) : "memory");
}

void address_space_boot(void)
{
    active_space = &kernel_space;
    next_id = 0;
}

struct address_space *address_space_kernel(void)
{
    return &kernel_space;
}

struct address_space *address_space_create_user(const u8 *code, u32 code_size)
{
    struct address_space *space = 0;
    u32 *pd;
    u32 *pt;
    u32 base;
    int i;

    if (!code || !code_size || code_size > AEVUM_TASK_STACK_SIZE) return 0;
    for (i = 0; i < AEVUM_AS_MAX; i++) {
        if (!spaces[i].used) {
            space = &spaces[i];
            break;
        }
    }
    if (!space) return 0;

    base = AEVUM_AS_BASE + (u32)i * AEVUM_AS_STRIDE;
    space->used = 1;
    space->user = 1;
    space->id = ++next_id;
    space->pd = base;
    space->pt = base + 0x1000u;
    space->code = base + 0x2000u;
    space->data = base + 0x3000u;
    space->stack = base + 0x4000u;
    space->control = base + 0x5000u;

    zero_page(space->pd);
    zero_page(space->pt);
    zero_page(space->code);
    zero_page(space->data);
    zero_page(space->stack);
    zero_page(space->control);

    /* 内核 0..4MB 继续由共享页表提供；用户段放在虚拟 4MB 的第二张页表。 */
    pd = (u32 *)space->pd;
    pd[0] = AEVUM_KERNEL_PT | PAGE_PRESENT | PAGE_RW;
    pd[1] = space->pt | USER_RW;

    pt = (u32 *)space->pt;
    pt[0] = space->code | USER_RO;
    pt[1] = space->data | USER_RW;
    pt[2] = space->stack | USER_RW;
    pt[3] = space->control | USER_RO;

    copy_page(space->code, code, code_size);
    return space;
}

void address_space_release(struct address_space *space)
{
    if (!space || space == &kernel_space) return;
    space->used = 0;
    space->user = 0;
}

/*
 * fork 的地址空间：复制父进程的 PD/PT 和四个用户页。P1 是 eager copy，
 * 父写子写互不影响；COW 留到 P2。用户页在低 4MB 恒等映射内，直接 memcpy。
 */
struct address_space *address_space_clone(const struct address_space *src)
{
    struct address_space *space = 0;
    u32 *pd;
    u32 *pt;
    u32 base;
    int i;

    if (!src || !src->used || !src->user) return 0;
    for (i = 0; i < AEVUM_AS_MAX; i++) {
        if (!spaces[i].used) {
            space = &spaces[i];
            break;
        }
    }
    if (!space) return 0;

    base = AEVUM_AS_BASE + (u32)i * AEVUM_AS_STRIDE;
    space->used = 1;
    space->user = 1;
    space->id = ++next_id;
    space->pd = base;
    space->pt = base + 0x1000u;
    space->code = base + 0x2000u;
    space->data = base + 0x3000u;
    space->stack = base + 0x4000u;
    space->control = base + 0x5000u;

    zero_page(space->pd);
    zero_page(space->pt);
    zero_page(space->code);
    zero_page(space->data);
    zero_page(space->stack);
    zero_page(space->control);

    copy_page(space->code, (const u8 *)src->code, AEVUM_PAGE_SIZE);
    copy_page(space->data, (const u8 *)src->data, AEVUM_PAGE_SIZE);
    copy_page(space->stack, (const u8 *)src->stack, AEVUM_PAGE_SIZE);
    copy_page(space->control, (const u8 *)src->control, AEVUM_PAGE_SIZE);

    pd = (u32 *)space->pd;
    pd[0] = AEVUM_KERNEL_PT | PAGE_PRESENT | PAGE_RW;
    pd[1] = space->pt | USER_RW;

    pt = (u32 *)space->pt;
    pt[0] = space->code | USER_RO;
    pt[1] = space->data | USER_RW;
    pt[2] = space->stack | USER_RW;
    pt[3] = space->control | USER_RO;
    return space;
}

int address_space_user_range_ok(const struct address_space *space, u32 va,
                                u32 len, int write)
{
    u32 first, last, i;
    u32 *pt;

    if (!space || !space->used || !space->user || !len) return 0;
    if (va < AEVUM_USER_VA_BASE) return 0;
    if (va > 0xFFFFFFFFu - (len - 1u)) return 0;
    if (va + len - 1u >= AEVUM_USER_VA_BASE + 4u * AEVUM_PAGE_SIZE) return 0;

    first = (va - AEVUM_USER_VA_BASE) / AEVUM_PAGE_SIZE;
    last = (va + len - 1u - AEVUM_USER_VA_BASE) / AEVUM_PAGE_SIZE;
    pt = (u32 *)space->pt;
    for (i = first; i <= last; i++) {
        u32 pte = pt[i];
        if (!(pte & PAGE_PRESENT) || !(pte & PAGE_USER)) return 0;
        if (write && !(pte & PAGE_RW)) return 0;
    }
    return 1;
}

u32 address_space_user_read32(const struct address_space *space, u32 va)
{
    u32 index, pte, phys;

    if (!address_space_user_range_ok(space, va, 4, 0)) return 0;
    index = (va - AEVUM_USER_VA_BASE) / AEVUM_PAGE_SIZE;
    pte = ((u32 *)space->pt)[index];
    phys = (pte & 0xFFFFF000u) + (va & 0xFFFu);
    return *(volatile u32 *)phys;
}

int address_space_user_write32(struct address_space *space, u32 va, u32 value)
{
    u32 index, pte, phys;

    if (!address_space_user_range_ok(space, va, 4, 1)) return 0;
    index = (va - AEVUM_USER_VA_BASE) / AEVUM_PAGE_SIZE;
    pte = ((u32 *)space->pt)[index];
    phys = (pte & 0xFFFFF000u) + (va & 0xFFFu);
    *(volatile u32 *)phys = value;
    return 1;
}

void address_space_switch(struct address_space *space)
{
    if (!space || space == active_space) return;
    active_space = space;
    write_cr3(space->pd);
}

u32 address_space_cr3(const struct address_space *space)
{
    return space ? space->pd : 0;
}

u32 address_space_id(const struct address_space *space)
{
    return space ? space->id : 0;
}

u32 address_space_code_phys(const struct address_space *space)
{
    return space ? space->code : 0;
}

u32 address_space_data_phys(const struct address_space *space)
{
    return space ? space->data : 0;
}

u32 address_space_counter(const struct address_space *space)
{
    return space ? *(volatile u32 *)space->data : 0;
}

void address_space_set_stop(struct address_space *space, u32 stop)
{
    if (space && space->user) *(volatile u32 *)space->control = stop;
}

void address_space_set_mode(struct address_space *space, u32 mode)
{
    if (space && space->user) ((volatile u32 *)space->data)[1] = mode;
}

int address_space_user_active(const struct address_space *space)
{
    return space && space->user && space->used;
}

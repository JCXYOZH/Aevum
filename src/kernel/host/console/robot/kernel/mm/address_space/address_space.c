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

int address_space_user_active(const struct address_space *space)
{
    return space && space->user && space->used;
}

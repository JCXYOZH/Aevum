#ifndef AEVUM_KERNEL_MM_ADDRESS_SPACE_H
#define AEVUM_KERNEL_MM_ADDRESS_SPACE_H

#include "kernel/types.h"

struct address_space;

/*
 * 地址空间的唯一 owner。任务只持有指针，页目录、页表、用户页和 CR3
 * 切换都由本模块维护；其他模块不得直接改页表项。
 */
void address_space_boot(void);
struct address_space *address_space_kernel(void);
struct address_space *address_space_create_user(const u8 *code, u32 code_size);
void address_space_release(struct address_space *space);

/* 切到目标地址空间；内核地址空间和当前空间相同时不重复写 CR3。 */
void address_space_switch(struct address_space *space);

u32 address_space_cr3(const struct address_space *space);
u32 address_space_id(const struct address_space *space);
u32 address_space_code_phys(const struct address_space *space);
u32 address_space_data_phys(const struct address_space *space);
u32 address_space_counter(const struct address_space *space);
void address_space_set_stop(struct address_space *space, u32 stop);
int address_space_user_active(const struct address_space *space);

#endif

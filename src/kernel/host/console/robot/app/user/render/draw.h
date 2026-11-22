#ifndef AEVUM_APP_USER_RENDER_DRAW_H
#define AEVUM_APP_USER_RENDER_DRAW_H

#include "kernel/types.h"
#include "kernel/proc.h"

/* V 页共用配色与格式化；页面文件只描述布局，不重复数字/状态映射。 */
#define C_BG     0x01
#define C_HDR    0x1F
#define C_CYAN   0x0B
#define C_GRAY   0x08
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_YELLOW 0x0E
#define C_MAG    0x0D

int ud_put_dec(int col, int row, u32 value, u8 attr);
int ud_put_hex(int col, int row, u32 value, u8 attr);
const char *ud_proc_state(const struct process_info *p);
u8 ud_proc_attr(const struct process_info *p);
const char *ud_vma_kind(u32 kind);
const char *ud_fd_kind(u32 kind);

#endif

#ifndef AEVUM_DRIVERS_VIDEO_VGA_H
#define AEVUM_DRIVERS_VIDEO_VGA_H

#include "kernel/types.h"

#define VGA_COLS   80
#define VGA_ROWS   25
#define VGA_CELLS  (VGA_COLS * VGA_ROWS)

/* VGA 文本驱动的唯一入口。所有写显存都必须经过这里。 */
void vga_init(void);
void vga_clear(u8 attr);
void vga_cell(int col, int row, char ch, u8 attr);
void vga_text(int col, int row, const char *s, u8 attr);
void vga_fill(int c0, int r0, int c1, int r1, char ch, u8 attr);
void vga_line(int c0, int r0, int c1, int r1, char ch, u8 attr);
void vga_flush(void);
void vga_vsync(void);

/* 只读：串口帧旁路扫描物理显存用，调用方不得写入。 */
const u16 *vga_physical_buffer(void);

#endif

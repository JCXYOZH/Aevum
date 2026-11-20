#include "drivers/video/vga.h"
#include "arch/x86/io.h"
#include "config/memory.h"

static u16 *const shadow = (u16 *)AEVUM_SHADOW;

void vga_init(void)
{
    vga_clear(0x07);
    vga_flush();
}

void vga_clear(u8 attr)
{
    int i;
    for (i = 0; i < VGA_CELLS; i++)
        shadow[i] = (u16)' ' | ((u16)attr << 8);
}

void vga_cell(int col, int row, char ch, u8 attr)
{
    if (col < 0 || col >= VGA_COLS || row < 0 || row >= VGA_ROWS) return;
    shadow[row * VGA_COLS + col] = (u16)(u8)ch | ((u16)attr << 8);
}

void vga_text(int col, int row, const char *s, u8 attr)
{
    while (*s) vga_cell(col++, row, *s++, attr);
}

void vga_fill(int c0, int r0, int c1, int r1, char ch, u8 attr)
{
    int c, r;
    for (r = r0; r <= r1; r++)
        for (c = c0; c <= c1; c++)
            vga_cell(c, r, ch, attr);
}

/* Bresenham 直线，在字符网格上画。 */
void vga_line(int c0, int r0, int c1, int r1, char ch, u8 attr)
{
    int dx = c1 - c0, dy = r1 - r0;
    int sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    int adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
    int err = adx - ady, e2;

    for (;;) {
        vga_cell(c0, r0, ch, attr);
        if (c0 == c1 && r0 == r1) break;
        e2 = 2 * err;
        if (e2 > -ady) { err -= ady; c0 += sx; }
        if (e2 <  adx) { err += adx; r0 += sy; }
    }
}

void vga_flush(void)
{
    u32 *src = (u32 *)shadow;
    u32 *dst = (u32 *)AEVUM_VGA_PHYS;
    int i;
    for (i = 0; i < VGA_CELLS / 2; i++) dst[i] = src[i];
}

void vga_vsync(void)
{
    int guard;
    for (guard = 0; guard < 400000 && (port_inb(0x3DA) & 0x08); guard++) { }
    for (guard = 0; guard < 400000 && !(port_inb(0x3DA) & 0x08); guard++) { }
}

const u16 *vga_physical_buffer(void)
{
    return (const u16 *)AEVUM_VGA_PHYS;
}

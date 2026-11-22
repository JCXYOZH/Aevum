#include "app/console/render.h"
#include "app/console/demo.h"
#include "kernel/proc.h"
#include "drivers/video/vga.h"
#include "drivers/console/console.h"
#include "lib/format.h"

#define C_BG     0x01
#define C_HDR    0x1F
#define C_CYAN   0x0B
#define C_GRAY   0x08
#define C_WHITE  0x0F
#define C_GREEN  0x0A
#define C_YELLOW 0x0E
#define C_MAG    0x0D
#define C_BLACK  0x00

static int put_dec(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_dec(buf, value);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
    return col + n;
}

static void put_hex(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_hex_width(buf, value, 8);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
}

static void put_s32(int col, int row, u32 value, u8 attr)
{
    if (value == 0xFFFFFFFFu) {
        vga_text(col, row, "-1", attr);
        return;
    }
    (void)put_dec(col, row, value, attr);
}

void console_render_frame(void)
{
    static u32 page_frames;
    u32 child, close_read, close_write, parent_read, parent_write;
    u32 magic, i, last, out;
    int pid;

    page_frames++;
    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(4, 0, "AEVUM / CONSOLE FD 0/1", C_HDR);
    vga_text(2, 2, "fd0 <- keyboard scancode -> ASCII | fd1 -> VGA line + COM1", C_CYAN);
    vga_text(2, 3, "scan", C_GRAY);
    put_dec(7, 3, console_scan_total(), C_WHITE);
    vga_text(13, 3, "push", C_GRAY);
    put_dec(18, 3, console_push_total(), C_WHITE);
    vga_text(24, 3, "frames", C_GRAY);
    put_dec(31, 3, page_frames, C_WHITE);

    pid = console_demo_pid();
    child = console_demo_child_pid();
    close_read = console_demo_close_read();
    close_write = console_demo_close_write();
    parent_read = console_demo_parent_read();
    parent_write = console_demo_parent_write();
    magic = console_demo_magic();
    out = console_output_total();

    vga_text(2, 4, "P4.4 pid", C_GRAY);
    put_dec(11, 4, (u32)pid, C_WHITE);
    vga_text(15, 4, "child", C_GRAY);
    put_dec(21, 4, child, C_WHITE);
    vga_text(27, 4, "out", C_GRAY);
    put_dec(31, 4, out, C_WHITE);
    vga_text(35, 4, "child", C_GRAY);
    if (out == 14)
        vga_text(41, 4, "EXIT 14", C_GREEN);
    else
        vga_text(41, 4, "RUN", C_YELLOW);
    if (magic == 0x214E4F43u)
        vga_text(52, 4, "CLOSE OK", C_GREEN);
    else
        vga_text(52, 4, "CLOSE ..", C_YELLOW);

    vga_text(2, 5, "close0", C_GRAY);
    put_dec(9, 5, close_read, C_WHITE);
    vga_text(12, 5, "close1", C_GRAY);
    put_dec(19, 5, close_write, C_WHITE);
    vga_text(23, 5, "r0", C_GRAY);
    put_s32(26, 5, parent_read, C_MAG);
    vga_text(31, 5, "w1", C_GRAY);
    put_s32(34, 5, parent_write, C_MAG);
    vga_text(39, 5, "parent closed; child still owns inherited 0/1", C_CYAN);

    vga_text(2, 6, "in", C_GRAY);
    put_dec(5, 6, console_read_total(), C_WHITE);
    vga_text(8, 6, "last", C_GRAY);
    last = console_last_input();
    if (last >= 32 && last < 127)
        vga_cell(13, 6, (char)last, C_GREEN);
    else
        put_hex(13, 6, last, C_GRAY);
    vga_text(23, 6, "q", C_GRAY);
    put_dec(25, 6, console_queue_count(), C_WHITE);
    vga_text(28, 6, "drop", C_GRAY);
    put_dec(33, 6, console_input_dropped(), C_WHITE);
    vga_text(38, 6, "out", C_GRAY);
    put_dec(42, 6, console_output_total(), C_WHITE);
    vga_text(50, 6, "uart", C_GRAY);
    put_dec(55, 6, console_uart_bytes(), C_WHITE);

    vga_text(2, 8, "CONSOLE OUTPUT", C_CYAN);
    vga_fill(2, 8, 79, 8, ' ', C_HDR);
    vga_text(2, 8, "CONSOLE OUTPUT", C_HDR);
    for (i = 0; i < console_line_count() && i < 8; i++) {
        const char *line = console_line(i);
        if (!line[0]) continue;
        vga_text(3, 9 + (int)i, line, C_WHITE);
    }

    vga_text(2, 18, "fd0: scancode set 1 -> US ASCII queue; read is non-blocking", C_GRAY);
    vga_text(2, 19, "fd1: writes join the VGA line buffer and raw COM1 sink", C_GRAY);
    vga_text(2, 20, "fork copies console endpoints; exec keeps the fd table unchanged", C_GRAY);
    vga_text(2, 21, "parent closed its 0/1; child's inherited handles still read/write", C_GREEN);
    vga_text(2, 22, "close only drops the caller's handle; console object stays global", C_GRAY);

    vga_text(2, 24, "X:exit console", C_YELLOW);
    vga_text(18, 24, "type a key after fork to feed fd0; child writes CON:<key> and FD01 OK", C_CYAN);
}

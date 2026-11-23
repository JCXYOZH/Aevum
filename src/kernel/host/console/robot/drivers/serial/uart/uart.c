#include "drivers/serial/uart.h"
#include "drivers/video/vga.h"
#include "arch/x86/io.h"
#include "config/memory.h"

#define FRAME_SYNC0      0xA5
#define FRAME_SYNC1      0x5A
#define FRAME_TYPE_DELTA 0x01
#define FRAME_TYPE_STATE 0x02
#define FRAME_HDR        4
#define FRAME_STATE_VALS 3
#define FRAME_BUF        (FRAME_HDR + UART_FRAME_MAX_CELLS * 4 + 1)

static u16 *const serial_snapshot = (u16 *)AEVUM_FRAME_SNAP;
static u8 serial_frame[FRAME_BUF];
static u32 serial_scan_count = 0;
static u32 serial_full_request = 0;

void uart_init(void)
{
    port_outb(UART_COM1 + 1, 0x00);
    port_outb(UART_COM1 + 3, 0x80);
    port_outb(UART_COM1 + 0, 0x01);
    port_outb(UART_COM1 + 1, 0x00);
    port_outb(UART_COM1 + 3, 0x03);
    port_outb(UART_COM1 + 2, 0xC7);
    port_outb(UART_COM1 + 4, 0x0B);
}

static void uart_putc(u8 value)
{
    while (!(port_inb(UART_COM1 + 5) & 0x20)) { }
    port_outb(UART_COM1, value);
}

void uart_write(const u8 *buf, u32 len)
{
    u32 i;
    for (i = 0; i < len; i++) uart_putc(buf[i]);
}

int uart_poll_full_request(void)
{
    int requested = 0;
    while (port_inb(UART_COM1 + 5) & 1) {
        u8 value = port_inb(UART_COM1);
        if (value == 'F') {
            serial_full_request = 1;
            requested = 1;
        }
    }
    return requested;
}

static void uart_send_frame(u32 count)
{
    u32 total, i;
    u8 crc = 0;

    if (!count) return;
    serial_frame[3] = (u8)count;
    total = FRAME_HDR + count * 4;
    for (i = 0; i < total; i++) crc ^= serial_frame[i];
    serial_frame[total] = crc;
    uart_write(serial_frame, total + 1);
}

void uart_scan(void)
{
    const u16 *vga = vga_physical_buffer();
    u32 count = 0;
    u32 i;
    u32 full = serial_full_request || (serial_scan_count == 0) ||
               ((serial_scan_count % 120) == 0);
    if (full) serial_full_request = 0;

    serial_frame[0] = FRAME_SYNC0;
    serial_frame[1] = FRAME_SYNC1;
    serial_frame[2] = FRAME_TYPE_DELTA;

    for (i = 0; i < VGA_CELLS; i++) {
        u16 value = vga[i];
        if (!full && value == serial_snapshot[i]) continue;

        if (count >= UART_FRAME_MAX_CELLS) {
            uart_send_frame(count);
            count = 0;
            serial_frame[0] = FRAME_SYNC0;
            serial_frame[1] = FRAME_SYNC1;
            serial_frame[2] = FRAME_TYPE_DELTA;
        }

        {
            u32 p = FRAME_HDR + count * 4;
            serial_frame[p + 0] = (u8)(i / VGA_COLS);
            serial_frame[p + 1] = (u8)(i % VGA_COLS);
            serial_frame[p + 2] = (u8)(value & 0xFF);
            serial_frame[p + 3] = (u8)((value >> 8) & 0xFF);
        }
        serial_snapshot[i] = value;
        count++;
    }
    uart_send_frame(count);
    serial_scan_count++;
}

/*
 * 只读状态帧：A5 5A 02 03 + q0..q2 (i32 LE, Q16.16 rad) + XOR CRC。
 * 与 VGA 差量帧共用 COM1，但类型字节不同；宿主桥只读，不写回内核。
 */
void uart_state_frame(const i32 q[3])
{
    u32 i;
    u32 total = FRAME_HDR + FRAME_STATE_VALS * 4;
    u8 crc = 0;

    serial_frame[0] = FRAME_SYNC0;
    serial_frame[1] = FRAME_SYNC1;
    serial_frame[2] = FRAME_TYPE_STATE;
    serial_frame[3] = FRAME_STATE_VALS;
    for (i = 0; i < FRAME_STATE_VALS; i++) {
        u32 v = (u32)q[i];
        u32 p = FRAME_HDR + i * 4;
        serial_frame[p + 0] = (u8)(v & 0xFF);
        serial_frame[p + 1] = (u8)((v >> 8) & 0xFF);
        serial_frame[p + 2] = (u8)((v >> 16) & 0xFF);
        serial_frame[p + 3] = (u8)((v >> 24) & 0xFF);
    }
    for (i = 0; i < total; i++) crc ^= serial_frame[i];
    serial_frame[total] = crc;
    uart_write(serial_frame, total + 1);
}

#include "stage2_contract.h"

/* ============================================================
 * 实现头内容：只本文件可见（10.2 规则）
 * ============================================================ */

#define VGA_TEXT_BASE       0xB8000
#define VGA_COLS            80
#define VGA_ROWS            25
#define VGA_CELLS           (VGA_COLS * VGA_ROWS)
#define VGA_ATTR_NORMAL     0x07
#define VGA_ATTR_HILIGHT    0x0F

#define STAGE2_STACK_TOP    0x8000
#define STAGE2_STACK_LIMIT  0x4000

#define DELAY_TICKS         0x300000u

/* ---------- 串口 ---------- */
#define SERIAL_COM1         0x3F8

/* ---------- 帧协议 ---------- */
#define FRAME_SYNC0         0xA5
#define FRAME_SYNC1         0x5A
#define FRAME_TYPE_DELTA    0x01
#define FRAME_MAX_CELLS     32
#define FRAME_HDR_SIZE      4                              /* SYNC0 SYNC1 TYPE COUNT */
#define FRAME_PAYLOAD_MAX   (FRAME_MAX_CELLS * 4)          /* row col ch attr */
#define FRAME_BUF_MAX       (FRAME_HDR_SIZE + FRAME_PAYLOAD_MAX + 1)  /* + CRC */

/* ---------- 内联 IO ---------- */
static inline void outb(uint16_t port, uint8_t v) {
    __asm__ volatile ("outb %0, %1" : : "a"(v), "Nd"(port));
}
static inline uint8_t inb(uint16_t port) {
    uint8_t v;
    __asm__ volatile ("inb %1, %0" : "=a"(v) : "Nd"(port));
    return v;
}

/* ---------- VGA ---------- */
static inline void vga_put(int row, int col, char c, uint8_t attr) {
    volatile uint16_t *vga = (volatile uint16_t *)VGA_TEXT_BASE;
    if ((unsigned)row < VGA_ROWS && (unsigned)col < VGA_COLS) {
        vga[row * VGA_COLS + col] = ((uint16_t)attr << 8) | (uint8_t)c;
    }
}
static inline void vga_clear(void) {
    volatile uint16_t *vga = (volatile uint16_t *)VGA_TEXT_BASE;
    for (int i = 0; i < VGA_CELLS; i++) {
        vga[i] = ((uint16_t)VGA_ATTR_NORMAL << 8) | ' ';
    }
}
static inline void vga_puts_at(int row, int col, const char *s, uint8_t attr) {
    while (*s && col < VGA_COLS) vga_put(row, col++, *s++, attr);
}

/* ============================================================
 * R14: 失败汇聚（接管 R8 字段写权）
 * ============================================================ */
static void r14_fail_report(uint32_t err) {
    volatile uint32_t *code  = (volatile uint32_t *)BI_R8_ERROR_CODE;
    volatile uint8_t  *stage = (volatile uint8_t  *)BI_R8_ERROR_STAGE;
    volatile uint8_t  *field = (volatile uint8_t  *)BI_R8_ERROR_FIELD;
    volatile uint8_t  *type  = (volatile uint8_t  *)BI_R8_ERROR_TYPE;
    *code = err;
    *stage = (err >> 16) & 0xFF;
    *field = (err >>  8) & 0xFF;
    *type  =  err        & 0xFF;

    vga_puts_at(0, 0, "[ERR] 0x", VGA_ATTR_HILIGHT);
    const char hex[] = "0123456789ABCDEF";
    for (int i = 0, p = 8; i < 8; i++, p++) {
        vga_put(0, p, hex[(err >> ((7 - i) * 4)) & 0xF], VGA_ATTR_HILIGHT);
    }
    for (;;) __asm__ volatile ("cli; hlt");
}

/* ============================================================
 * R15: 串口输出（唯一碰 outb 的职责）
 * ============================================================ */
static uint32_t r15_serial_init(void) {
    outb(SERIAL_COM1 + 1, 0x00);   /* disable interrupts */
    outb(SERIAL_COM1 + 3, 0x80);   /* enable DLAB */
    outb(SERIAL_COM1 + 0, 0x01);   /* divisor low: 115200 */
    outb(SERIAL_COM1 + 1, 0x00);   /* divisor high */
    outb(SERIAL_COM1 + 3, 0x03);   /* 8N1 */
    outb(SERIAL_COM1 + 2, 0xC7);   /* FIFO on, clear, 14-byte threshold */
    outb(SERIAL_COM1 + 4, 0x0B);   /* RTS/DSR, OUT2 */

    /* 回环自检（MCR bit4=1 测试，读回应为 0xAE） */
    outb(SERIAL_COM1 + 4, 0x1E);
    outb(SERIAL_COM1 + 0, 0xAE);
    if (inb(SERIAL_COM1 + 0) != 0xAE) {
        outb(SERIAL_COM1 + 4, 0x0F);
        return ERR_R15_SERIAL_INIT_FAIL;
    }
    outb(SERIAL_COM1 + 4, 0x0F);
    return 0;
}

static void r15_serial_putc(uint8_t b) {
    while (!(inb(SERIAL_COM1 + 5) & 0x20)) { }
    outb(SERIAL_COM1, b);
}

static void r15_serial_write(const uint8_t *buf, int len) {
    for (int i = 0; i < len; i++) r15_serial_putc(buf[i]);
}

/* ============================================================
 * R16: 帧生成（旁路扫描 VGA 差量，不干扰 R12）
 * 策略：维护上一帧快照，每轮扫描当前 VGA，比出差异后打帧发送
 * ============================================================ */
static uint16_t g_r16_prev[VGA_CELLS];
static uint8_t  g_r16_frame[FRAME_BUF_MAX];

static void r16_init(void) {
    volatile uint16_t *vga = (volatile uint16_t *)VGA_TEXT_BASE;
    for (int i = 0; i < VGA_CELLS; i++) g_r16_prev[i] = vga[i];
}

static void r16_send_one(uint32_t *count) {
    if (*count == 0) return;
    g_r16_frame[3] = (uint8_t)*count;
    int total = FRAME_HDR_SIZE + (int)(*count) * 4;
    uint8_t crc = 0;
    for (int i = 0; i < total; i++) crc ^= g_r16_frame[i];
    g_r16_frame[total] = crc;
    r15_serial_write(g_r16_frame, total + 1);
    *count = 0;
}

static void r16_scan_and_send(void) {
    volatile uint16_t *vga = (volatile uint16_t *)VGA_TEXT_BASE;

    g_r16_frame[0] = FRAME_SYNC0;
    g_r16_frame[1] = FRAME_SYNC1;
    g_r16_frame[2] = FRAME_TYPE_DELTA;

    uint32_t count = 0;
    for (int i = 0; i < VGA_CELLS; i++) {
        uint16_t v = vga[i];
        if (v == g_r16_prev[i]) continue;

        if (count >= FRAME_MAX_CELLS) {
            r16_send_one(&count);
            /* 重置帧头，继续下一批 */
            g_r16_frame[0] = FRAME_SYNC0;
            g_r16_frame[1] = FRAME_SYNC1;
            g_r16_frame[2] = FRAME_TYPE_DELTA;
        }
        int p = FRAME_HDR_SIZE + (int)count * 4;
        g_r16_frame[p + 0] = (uint8_t)(i / VGA_COLS);
        g_r16_frame[p + 1] = (uint8_t)(i % VGA_COLS);
        g_r16_frame[p + 2] = (uint8_t)(v & 0xFF);
        g_r16_frame[p + 3] = (uint8_t)((v >> 8) & 0xFF);
        g_r16_prev[i] = v;
        count++;
    }
    r16_send_one(&count);
}

/* ============================================================
 * R10/R11/R13: 与之前一致
 * ============================================================ */
static uint32_t r10_check_boot_info(void) {
    volatile uint32_t *entry  = (volatile uint32_t *)BI_R7_STAGE2_ENTRY;
    volatile uint32_t *mapped = (volatile uint32_t *)BI_R4_MAPPED_BYTES;
    if (*entry  != 0x1000u)   return ERR_R10_STAGE2_ENTRY_MISMATCH;
    if (*mapped != 0x400000u) return ERR_R10_MAPPED_BYTES_MISMATCH;
    return 0;
}

static uint32_t r11_init_vga(void) {
    volatile uint16_t *vga = (volatile uint16_t *)VGA_TEXT_BASE;
    uint16_t save = vga[0];
    vga[0] = 0x0F2D;
    if (vga[0] != 0x0F2D) return ERR_R11_VGA_INIT_FAIL;
    vga[0] = save;
    vga_clear();
    return 0;
}

static void r13_delay(uint32_t ticks) {
    while (ticks--) __asm__ volatile ("nop");
}

/* ============================================================
 * R12: 渲染循环（保持不变，仅在末尾追加 R16 旁路调用）
 * ============================================================ */
static void r12_render_loop(void) {
    const int row = 12;
    int prev_col = VGA_COLS - 1;
    int col = 0;

    vga_puts_at(0, 0, "[aevum] stage2 ok", VGA_ATTR_NORMAL);

    for (;;) {
        vga_put(row, prev_col, ' ', VGA_ATTR_NORMAL);
        vga_put(row, col,      '-', VGA_ATTR_HILIGHT);

        vga_puts_at(13, 0, "col=", VGA_ATTR_NORMAL);
        char buf[3];
        buf[0] = '0' + (col / 10);
        buf[1] = '0' + (col % 10);
        buf[2] = 0;
        vga_puts_at(13, 4, buf, VGA_ATTR_NORMAL);
        vga_put(13, 6, ' ', VGA_ATTR_NORMAL);

        prev_col = col;
        col = (col + 1) % VGA_COLS;
        r13_delay(DELAY_TICKS);

        r16_scan_and_send();     /* 旁路：不改变 R12 行为 */
    }
}

/* ============================================================
 * stage2 入口
 * ============================================================ */
uint32_t stage2_main(void) {
    __asm__ volatile (
        "movl %0, %%esp\n"
        "movl %0, %%ebp\n"
        : : "r"(STAGE2_STACK_TOP) : "memory"
    );

    uint32_t err;

    err = r10_check_boot_info(); if (err) r14_fail_report(err);
    err = r11_init_vga();        if (err) r14_fail_report(err);

    err = r15_serial_init();     if (err) r14_fail_report(err);

    r16_init();   /* R11 已清屏，此处建立快照，避免第一帧刷爆 */

    r12_render_loop();
    return 0;
}
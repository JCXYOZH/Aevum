#include "kernel/error.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define C_RED    0x0C
#define C_WHITE  0x0F
#define C_GRAY   0x07
#define C_YELLOW 0x0E

static const char hex_digits[] = "0123456789ABCDEF";

static void put_hex6(int col, int row, u32 value)
{
    int i;
    for (i = 0; i < 6; i++)
        vga_cell(col + i, row, hex_digits[(value >> ((5 - i) * 4)) & 0xF], C_WHITE);
}

static void put_hex2(int col, int row, u8 value)
{
    vga_cell(col + 0, row, hex_digits[(value >> 4) & 0xF], C_WHITE);
    vga_cell(col + 1, row, hex_digits[value & 0xF], C_WHITE);
}

static const char *type_name(u8 type)
{
    switch (type) {
        case 0x01: return "field missing";
        case 0x02: return "field conflict";
        case 0x03: return "dependency unmet";
        case 0x04: return "external failure";
        default:   return "unknown";
    }
}

void aevum_fail(const struct aevum_error *err)
{
    u8 type = (u8)(err->code & 0xFF);

    vga_init();
    vga_clear(C_GRAY);
    vga_text(0, 0, "[aevum][ERR] 0x", C_RED);
    put_hex6(16, 0, err->code);

    vga_text(0, 2, "owner   : ", C_GRAY);
    vga_text(11, 2, err->owner ? err->owner : "(null)", C_WHITE);

    vga_text(0, 3, "field   : ", C_GRAY);
    vga_text(11, 3, err->field ? err->field : "(null)", C_WHITE);

    vga_text(0, 4, "type    : 0x", C_GRAY);
    put_hex2(12, 4, type);
    vga_text(16, 4, type_name(type), C_YELLOW);

    vga_text(0, 5, "detail  : ", C_GRAY);
    vga_text(11, 5, err->detail ? err->detail : "(null)", C_WHITE);

    vga_text(0, 6, "at      : ", C_GRAY);
    vga_text(11, 6, err->at ? err->at : "(null)", C_WHITE);

    if (err->dep_code) {
        vga_text(0, 7, "dep     : RR=0x", C_GRAY);
        put_hex2(16, 7, err->dep_rr);
        vga_text(19, 7, " code=0x", C_GRAY);
        put_hex6(27, 7, err->dep_code);
    }

    vga_flush();
    for (;;) __asm__ __volatile__("cli; hlt");
}

#include "kernel/error.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define C_RED    0x0C
#define C_WHITE  0x0F
#define C_GRAY   0x07
#define C_YELLOW 0x0E

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
    char hex6[7];
    char hex2[3];
    u8 type = (u8)(err->code & 0xFF);

    vga_init();
    vga_clear(C_GRAY);
    vga_text(0, 0, "[aevum][ERR] 0x", C_RED);
    fmt_hex_width(hex6, err->code, 6);
    vga_text(16, 0, hex6, C_WHITE);

    vga_text(0, 2, "owner   : ", C_GRAY);
    vga_text(11, 2, err->owner ? err->owner : "(null)", C_WHITE);

    vga_text(0, 3, "field   : ", C_GRAY);
    vga_text(11, 3, err->field ? err->field : "(null)", C_WHITE);

    vga_text(0, 4, "type    : 0x", C_GRAY);
    fmt_hex_width(hex2, (u32)type, 2);
    vga_text(12, 4, hex2, C_WHITE);
    vga_text(16, 4, type_name(type), C_YELLOW);

    vga_text(0, 5, "detail  : ", C_GRAY);
    vga_text(11, 5, err->detail ? err->detail : "(null)", C_WHITE);

    vga_text(0, 6, "at      : ", C_GRAY);
    vga_text(11, 6, err->at ? err->at : "(null)", C_WHITE);

    if (err->dep_code) {
        vga_text(0, 7, "dep     : RR=0x", C_GRAY);
        fmt_hex_width(hex2, (u32)err->dep_rr, 2);
        vga_text(16, 7, hex2, C_WHITE);
        vga_text(19, 7, " code=0x", C_GRAY);
        fmt_hex_width(hex6, err->dep_code, 6);
        vga_text(27, 7, hex6, C_WHITE);
    }

    vga_flush();
    for (;;) __asm__ __volatile__("cli; hlt");
}

#include "kernel/error.h"
#include "drivers/video/vga.h"

#define C_RED    0x0C
#define C_WHITE  0x0F
#define C_GRAY   0x07
#define C_YELLOW 0x0E

static const char *text_or_null(const char *s)
{
    return s ? s : "(null)";
}

void aevum_fail(const struct aevum_error *err)
{
    vga_init();
    vga_clear(C_GRAY);
    vga_text(0, 0, "[aevum][ERR]", C_RED);

    vga_text(0, 2, "owner   : ", C_GRAY);
    vga_text(11, 2, text_or_null(err->owner), C_WHITE);

    vga_text(0, 3, "field   : ", C_GRAY);
    vga_text(11, 3, text_or_null(err->field), C_WHITE);

    vga_text(0, 4, "type    : ", C_GRAY);
    vga_text(11, 4, text_or_null(err->type), C_YELLOW);

    vga_text(0, 5, "detail  : ", C_GRAY);
    vga_text(11, 5, text_or_null(err->detail), C_WHITE);

    vga_text(0, 6, "at      : ", C_GRAY);
    vga_text(11, 6, text_or_null(err->at), C_WHITE);

    vga_flush();
    for (;;) __asm__ __volatile__("cli; hlt");
}

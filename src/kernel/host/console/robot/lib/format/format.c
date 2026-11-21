#include "lib/format.h"
#include "lib/fixed.h"

int fmt_dec(char *out, u32 value)
{
    char tmp[12];
    int n = 0, i;
    do {
        tmp[n++] = (char)('0' + (value % 10));
        value /= 10;
    } while (value);
    for (i = 0; i < n; i++) out[i] = tmp[n - 1 - i];
    return n;
}

int fmt_hex(char *out, u32 value)
{
    int width = 1;
    u32 probe = value;

    while (probe >= 16u) {
        width++;
        probe >>= 4;
    }
    return fmt_hex_width(out, value, width);
}

int fmt_hex_width(char *out, u32 value, int width)
{
    int i;

    if (width < 1) width = 1;
    if (width > 8) width = 8;
    for (i = 0; i < width; i++) {
        int shift = (width - 1 - i) * 4;
        u32 nibble = (value >> shift) & 0xFu;
        out[i] = (char)(nibble < 10u ? ('0' + nibble) : ('A' + (nibble - 10u)));
    }
    out[width] = 0;
    return width;
}

int fmt_fx(char *out, i32 value, int decimals)
{
    u32 scale = 1, abs_value, integer_part, fraction_part;
    int i, p = 0, negative = 0;

    for (i = 0; i < decimals; i++) scale *= 10;
    if (value < 0) {
        negative = 1;
        abs_value = (u32)(-(i64)value);
    } else {
        abs_value = (u32)value;
    }
    integer_part = abs_value >> FXBITS;
    fraction_part = (u32)(((u64)(abs_value & 0xFFFF) * scale) >> FXBITS);
    if (fraction_part >= scale) {
        fraction_part -= scale;
        integer_part++;
    }

    if (negative) out[p++] = '-';
    p += fmt_dec(out + p, integer_part);
    if (decimals) {
        out[p++] = '.';
        for (i = decimals - 1; i >= 0; i--) {
            out[p + i] = (char)('0' + (fraction_part % 10));
            fraction_part /= 10;
        }
        p += decimals;
    }
    out[p] = 0;
    return p;
}

#ifndef AEVUM_LIB_FORMAT_H
#define AEVUM_LIB_FORMAT_H

#include "kernel/types.h"

int fmt_dec(char *out, u32 value);
int fmt_hex(char *out, u32 value);
int fmt_hex_width(char *out, u32 value, int width);
int fmt_fx(char *out, i32 value, int decimals);

#endif

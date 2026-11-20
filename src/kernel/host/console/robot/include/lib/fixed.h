#ifndef AEVUM_LIB_FIXED_H
#define AEVUM_LIB_FIXED_H

#include "kernel/types.h"

#define FXBITS 16
#define FXONE  65536

static inline i32 fx_mul(i32 a, i32 b)
{
    return (i32)(((i64)a * (i64)b) >> FXBITS);
}
i32 fx_div(i32 a, i32 b);
u32 isqrt64(u64 n);
i32 fx_sqrt(i32 x);

#endif

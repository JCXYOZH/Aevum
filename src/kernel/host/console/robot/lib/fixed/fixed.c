#include "lib/fixed.h"

/* (a/b) 的 Q16.16 表示 = (a<<16)/b，用移位减法实现，避开 64 位除法例程。 */
i32 fx_div(i32 a, i32 b)
{
    u32 ua, ub, q = 0, r = 0;
    int i, neg = 0, ovf = 0;

    if (b == 0)
        return (a < 0) ? (i32)0x80000000 : (i32)0x7FFFFFFF;

    if ((a < 0) != (b < 0)) neg = 1;
    ua = (a < 0) ? (u32)(-(i64)a) : (u32)a;
    ub = (b < 0) ? (u32)(-(i64)b) : (u32)b;

    for (i = 46; i >= 0; i--) {
        u32 bit = (i >= FXBITS) ? ((ua >> (i - FXBITS)) & 1u) : 0u;
        r = (r << 1) | bit;
        if (r >= ub) {
            r -= ub;
            if (i < 32) q |= (1u << i);
            else        ovf = 1;
        }
    }
    if (ovf) return neg ? (i32)0x80000000 : (i32)0x7FFFFFFF;
    return neg ? -(i32)q : (i32)q;
}

u32 isqrt64(u64 n)
{
    u64 res = 0, bit = (u64)1 << 62;
    while (bit > n) bit >>= 2;
    while (bit) {
        if (n >= res + bit) {
            n -= res + bit;
            res = (res >> 1) + bit;
        } else {
            res >>= 1;
        }
        bit >>= 2;
    }
    return (u32)res;
}

i32 fx_sqrt(i32 x)
{
    if (x <= 0) return 0;
    return (i32)isqrt64((u64)(u32)x << FXBITS);
}

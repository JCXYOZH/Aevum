#include "lib/trig.h"
#include "lib/fixed.h"

static const i32 sin_tab[91] = {
         0,   1144,   2287,   3430,   4572,   5712,   6850,
      7987,   9121,  10252,  11380,  12505,  13626,  14742,
     15855,  16962,  18064,  19161,  20252,  21336,  22415,
     23486,  24550,  25607,  26656,  27697,  28729,  29753,
     30767,  31772,  32768,  33754,  34729,  35693,  36647,
     37590,  38521,  39441,  40348,  41243,  42126,  42995,
     43852,  44695,  45525,  46341,  47143,  47930,  48703,
     49461,  50203,  50931,  51643,  52339,  53020,  53684,
     54332,  54963,  55578,  56175,  56756,  57319,  57865,
     58393,  58903,  59396,  59870,  60326,  60764,  61183,
     61584,  61966,  62328,  62672,  62997,  63303,  63589,
     63856,  64104,  64332,  64540,  64729,  64898,  65048,
     65177,  65287,  65376,  65446,  65496,  65526,  65536,
};

static i32 sin_quad(i32 rem)
{
    i32 idx = rem >> FXBITS;
    i32 f   = rem & (FXONE - 1);
    if (idx >= 90) return sin_tab[90];
    return sin_tab[idx] + (i32)(((i64)(sin_tab[idx + 1] - sin_tab[idx]) * f) >> FXBITS);
}

i32 fx_sin_deg(i32 deg)
{
    i32 d = deg % DEG360;
    i32 quad, rem;
    if (d < 0) d += DEG360;
    quad = d / DEG90;
    rem  = d - quad * DEG90;
    switch (quad) {
        case 0:  return  sin_quad(rem);
        case 1:  return  sin_quad(DEG90 - rem);
        case 2:  return -sin_quad(rem);
        default: return -sin_quad(DEG90 - rem);
    }
}


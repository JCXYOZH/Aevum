#ifndef AEVUM_LIB_TRIG_H
#define AEVUM_LIB_TRIG_H

#include "kernel/types.h"
#include "lib/fixed.h"

#define DEG90      5898240
#define DEG360     23592960
#define FX_180_PI  3754936

i32 fx_sin_deg(i32 deg);

static inline i32 fx_sin(i32 rad) { return fx_sin_deg(fx_mul(rad, FX_180_PI)); }
static inline i32 fx_cos(i32 rad) { return fx_sin_deg(fx_mul(rad, FX_180_PI) + DEG90); }
static inline i32 fx_deg(i32 rad) { return fx_mul(rad, FX_180_PI); }
static inline i32 fx_rad(i32 deg) { return fx_div(deg, FX_180_PI); }

#endif

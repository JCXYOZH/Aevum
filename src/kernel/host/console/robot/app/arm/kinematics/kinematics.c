#include "app/arm/kinematics.h"
#include "lib/fixed.h"
#include "lib/trig.h"

static const i32 L0 = 19661;   /* 0.30 m */
static const i32 L1 = 19661;   /* 0.30 m */
static const i32 L2 = 13107;   /* 0.20 m */

void arm_fk(const i32 q[ARM_NLINK], struct arm_points *out)
{
    i32 t1 = q[0];
    i32 t2 = q[0] + q[1];
    i32 t3 = q[0] + q[1] + q[2];
    i32 c1 = fx_cos(t1), s1 = fx_sin(t1);
    i32 c2 = fx_cos(t2), s2 = fx_sin(t2);
    i32 c3 = fx_cos(t3), s3 = fx_sin(t3);

    out->elbow.x = fx_mul(L0, c1);
    out->elbow.y = fx_mul(L0, s1);
    out->wrist.x = out->elbow.x + fx_mul(L1, c2);
    out->wrist.y = out->elbow.y + fx_mul(L1, s2);
    out->end.x   = out->wrist.x + fx_mul(L2, c3);
    out->end.y   = out->wrist.y + fx_mul(L2, s3);
}

void arm_jacobian(const i32 q[ARM_NLINK], i32 J[2][ARM_NLINK])
{
    i32 t1 = q[0];
    i32 t2 = q[0] + q[1];
    i32 t3 = q[0] + q[1] + q[2];
    i32 s1 = fx_sin(t1), c1 = fx_cos(t1);
    i32 s2 = fx_sin(t2), c2 = fx_cos(t2);
    i32 s3 = fx_sin(t3), c3 = fx_cos(t3);
    i32 a1 = fx_mul(L0, s1), a2 = fx_mul(L1, s2), a3 = fx_mul(L2, s3);
    i32 b1 = fx_mul(L0, c1), b2 = fx_mul(L1, c2), b3 = fx_mul(L2, c3);

    J[0][0] = -(a1 + a2 + a3);
    J[0][1] = -(a2 + a3);
    J[0][2] = -a3;
    J[1][0] =  (b1 + b2 + b3);
    J[1][1] =  (b2 + b3);
    J[1][2] =  b3;
}

void arm_solve(const i32 q[ARM_NLINK], struct arm_points *out,
               i32 J[2][ARM_NLINK])
{
    i32 t1 = q[0];
    i32 t2 = q[0] + q[1];
    i32 t3 = q[0] + q[1] + q[2];
    i32 c1 = fx_cos(t1), s1 = fx_sin(t1);
    i32 c2 = fx_cos(t2), s2 = fx_sin(t2);
    i32 c3 = fx_cos(t3), s3 = fx_sin(t3);
    i32 a1 = fx_mul(L0, s1), a2 = fx_mul(L1, s2), a3 = fx_mul(L2, s3);
    i32 b1 = fx_mul(L0, c1), b2 = fx_mul(L1, c2), b3 = fx_mul(L2, c3);

    out->elbow.x = b1;
    out->elbow.y = a1;
    out->wrist.x = b1 + b2;
    out->wrist.y = a1 + a2;
    out->end.x   = b1 + b2 + b3;
    out->end.y   = a1 + a2 + a3;

    J[0][0] = -(a1 + a2 + a3);
    J[0][1] = -(a2 + a3);
    J[0][2] = -a3;
    J[1][0] =  (b1 + b2 + b3);
    J[1][1] =  (b2 + b3);
    J[1][2] =  b3;
}

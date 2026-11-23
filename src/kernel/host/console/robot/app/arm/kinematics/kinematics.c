#include "app/arm/kinematics.h"
#include "lib/fixed.h"
#include "lib/trig.h"

void arm_solve(const struct body_desc *body,
               const i32 q[AEVUM_BODY_MAX_JOINTS],
               struct arm_points *out,
               i32 J[2][AEVUM_BODY_MAX_JOINTS])
{
    i32 a[AEVUM_BODY_MAX_JOINTS];
    i32 b[AEVUM_BODY_MAX_JOINTS];
    i32 angle = 0;
    struct arm_vec2 p;
    int i, j, n;

    if (!body || !out || !J) return;
    n = body->n;
    if (n < AEVUM_BODY_MIN_JOINTS || n > AEVUM_BODY_MAX_JOINTS) return;

    p.x = 0;
    p.y = 0;
    out->p[0] = p;

    for (i = 0; i < n; i++) {
        i32 s, c;
        angle += q[i];
        s = fx_sin(angle);
        c = fx_cos(angle);
        a[i] = fx_mul(body->joints[i].length, s);
        b[i] = fx_mul(body->joints[i].length, c);
        p.x += b[i];
        p.y += a[i];
        out->p[i + 1] = p;
    }

    for (j = 0; j < n; j++) {
        i32 sx = 0;
        i32 sy = 0;
        for (i = j; i < n; i++) {
            sx += a[i];
            sy += b[i];
        }
        J[0][j] = -sx;
        J[1][j] = sy;
    }
}

void arm_fk(const struct body_desc *body,
            const i32 q[AEVUM_BODY_MAX_JOINTS],
            struct arm_points *out)
{
    i32 J[2][AEVUM_BODY_MAX_JOINTS];
    arm_solve(body, q, out, J);
}

void arm_jacobian(const struct body_desc *body,
                  const i32 q[AEVUM_BODY_MAX_JOINTS],
                  i32 J[2][AEVUM_BODY_MAX_JOINTS])
{
    struct arm_points points;
    arm_solve(body, q, &points, J);
}

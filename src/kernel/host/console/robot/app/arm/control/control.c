#include "app/arm/control.h"
#include "app/arm/kinematics.h"
#include "lib/fixed.h"
#include "lib/trig.h"

#define KP          393216
#define LAM2        419
#define K_NULL      16384
#define DT          1092
#define Q_LIMIT     193986
#define STEPS_PER_SIN 200
#define TGT_SPEED   18529

static const i32 q_pref[ARM_NLINK] = { 17157, 34315, 34315 };

static i32 q[ARM_NLINK];
static i32 dq[ARM_NLINK];
static struct arm_points points;
static struct arm_vec2 target;
static struct arm_vec2 target_velocity;
static struct arm_vec2 target_prev;
static i32 w_manip;
static i32 sigma_min;
static i32 sigma_max;
static i32 err_mm;
static i32 limit_margin;
static i32 null_share;
static int null_on = 1;
static i32 lap_smin_min;
static i32 lap_speed_max;
static i32 nodamp_speed;
static i32 lap_nodamp_max;
static int frame_no;
static i32 phase;

u32 arm_control_init(void)
{
    q[0] = 17157;
    q[1] = 34315;
    q[2] = 34315;

    target.x = 34734 + 17433;
    target.y = 9830;
    target_prev.x = target.x;
    target_prev.y = target.y;
    target_velocity.x = 0;
    target_velocity.y = 0;

    phase = 0;
    null_on = 1;
    frame_no = 0;
    w_manip = 0;
    sigma_min = 0;
    sigma_max = 0;
    err_mm = 0;
    limit_margin = 200 * FXONE;
    null_share = 0;
    lap_smin_min = 0x7FFFFFFF;
    lap_speed_max = 0;
    nodamp_speed = 0;
    lap_nodamp_max = 0;

    arm_fk(q, &points);
    return 0;
}

void arm_control_toggle_nullspace(void)
{
    null_on = !null_on;
}

void arm_control_status(struct arm_status *out)
{
    int i;
    for (i = 0; i < ARM_NLINK; i++) {
        out->q[i] = q[i];
        out->dq[i] = dq[i];
    }
    out->points = points;
    out->target = target;
    out->w_manip = w_manip;
    out->sigma_min = sigma_min;
    out->sigma_max = sigma_max;
    out->err_mm = err_mm;
    out->limit_margin = limit_margin;
    out->null_share = null_share;
    out->lap_smin_min = lap_smin_min;
    out->lap_speed_max = lap_speed_max;
    out->lap_nodamp_max = lap_nodamp_max;
    out->nodamp_speed = nodamp_speed;
    out->null_on = null_on;
    out->frame_no = frame_no;
}

void arm_control_step(void)
{
    i32 J[2][ARM_NLINK], Jt[2], Ai[2][2], det, inv;
    i32 a, b, c, a0, b0, c0, tr, disc, lam_min, t;
    i32 dqn[ARM_NLINK], z[ARM_NLINK], JtAi[ARM_NLINK][2];
    i32 nrm = 0, nrm_null = 0;
    int i, j;

    arm_solve(q, &points, J);

    {
        i32 ex = target.x - points.end.x;
        i32 ey = target.y - points.end.y;
        i32 exum = (i32)(((i64)ex * 1000000) >> FXBITS);
        i32 eyum = (i32)(((i64)ey * 1000000) >> FXBITS);
        i64 sq = (i64)exum * exum + (i64)eyum * eyum;
        i32 r_um = (i32)isqrt64((u64)sq);
        err_mm = fx_div(r_um, 1000);
        Jt[0] = fx_mul(KP, ex) + target_velocity.x;
        Jt[1] = fx_mul(KP, ey) + target_velocity.y;
    }

    a0 = fx_mul(J[0][0], J[0][0]) + fx_mul(J[0][1], J[0][1]) + fx_mul(J[0][2], J[0][2]);
    b0 = fx_mul(J[0][0], J[1][0]) + fx_mul(J[0][1], J[1][1]) + fx_mul(J[0][2], J[1][2]);
    c0 = fx_mul(J[1][0], J[1][0]) + fx_mul(J[1][1], J[1][1]) + fx_mul(J[1][2], J[1][2]);
    a = a0 + LAM2;
    b = b0;
    c = c0 + LAM2;

    det = fx_mul(a, c) - fx_mul(b, b);
    inv = fx_div(FXONE, det);
    Ai[0][0] =  fx_mul(c, inv);
    Ai[0][1] = -fx_mul(b, inv);
    Ai[1][1] =  fx_mul(a, inv);
    Ai[1][0] =  Ai[0][1];

    {
        i32 x0 = fx_mul(Ai[0][0], Jt[0]) + fx_mul(Ai[0][1], Jt[1]);
        i32 x1 = fx_mul(Ai[1][0], Jt[0]) + fx_mul(Ai[1][1], Jt[1]);
        for (i = 0; i < ARM_NLINK; i++)
            dq[i] = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
    }
    for (i = 0; i < ARM_NLINK; i++)
        nrm += (dq[i] < 0 ? -dq[i] : dq[i]);

    for (i = 0; i < ARM_NLINK; i++) {
        JtAi[i][0] = fx_mul(J[0][i], Ai[0][0]) + fx_mul(J[1][i], Ai[1][0]);
        JtAi[i][1] = fx_mul(J[0][i], Ai[0][1]) + fx_mul(J[1][i], Ai[1][1]);
    }
    for (i = 0; i < ARM_NLINK; i++)
        z[i] = -fx_mul(K_NULL, q[i] - q_pref[i]);

    for (i = 0; i < ARM_NLINK; i++) {
        i32 acc = 0;
        for (j = 0; j < ARM_NLINK; j++) {
            i32 nij = ((i == j) ? FXONE : 0)
                    - (fx_mul(JtAi[i][0], J[0][j]) + fx_mul(JtAi[i][1], J[1][j]));
            acc += fx_mul(nij, z[j]);
        }
        dqn[i] = null_on ? acc : 0;
        dq[i] += dqn[i];
        nrm_null += (dqn[i] < 0 ? -dqn[i] : dqn[i]);
    }

    null_share = (nrm + nrm_null > 0) ? fx_div(nrm_null, nrm + nrm_null) : 0;

    tr = a0 + c0;
    disc = fx_mul(tr, tr) - 4 * (fx_mul(a0, c0) - fx_mul(b0, b0));
    if (disc < 0) disc = 0;
    t = fx_sqrt(disc);
    lam_min = (tr - t) / 2;
    sigma_min = fx_sqrt(lam_min);
    sigma_max = fx_sqrt((tr + t) / 2);
    {
        i32 d2 = fx_mul(a0, c0) - fx_mul(b0, b0);
        w_manip = (d2 > 0) ? fx_sqrt(d2) : 0;
    }

    {
        i32 dn = fx_mul(a0, c0) - fx_mul(b0, b0);
        i32 iv = fx_div(FXONE, dn);
        i32 i00 =  fx_mul(c0, iv), i01 = -fx_mul(b0, iv), i11 = fx_mul(a0, iv);
        i32 x0 = fx_mul(i00, Jt[0]) + fx_mul(i01, Jt[1]);
        i32 x1 = fx_mul(i01, Jt[0]) + fx_mul(i11, Jt[1]);
        i32 m = 0;
        for (i = 0; i < ARM_NLINK; i++) {
            i32 v = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
            if (v < 0) v = -v;
            if (v > m) m = v;
        }
        nodamp_speed = m;
        if (nodamp_speed > lap_nodamp_max) lap_nodamp_max = nodamp_speed;
    }

    {
        i32 sp = 0;
        for (i = 0; i < ARM_NLINK; i++) {
            i32 v = dq[i] < 0 ? -dq[i] : dq[i];
            if (v > sp) sp = v;
        }
        if (sp > lap_speed_max) lap_speed_max = sp;
        if (sigma_min < lap_smin_min) lap_smin_min = sigma_min;
    }

    limit_margin = 200 * FXONE;
    for (i = 0; i < ARM_NLINK; i++) {
        i32 lim;
        q[i] += fx_mul(dq[i], DT);
        lim = fx_deg(Q_LIMIT - (q[i] < 0 ? -q[i] : q[i]));
        if (lim < limit_margin) limit_margin = lim;
    }

    {
        i32 t = phase;
        i32 s;
        if (t < 100) s = FXONE - (t * 2 * FXONE) / 100;
        else         s = ((t - 100) * 2 * FXONE) / 100 - FXONE;

        target_prev.x = target.x;
        target_prev.y = target.y;

        target.x = 34734 + fx_mul(17433, s);
        target.y = 9830 + fx_mul(1311, fx_sin(phase * 2059));

        target_velocity.x = (i32)((i64)(target.x - target_prev.x) * 60);
        target_velocity.y = (i32)((i64)(target.y - target_prev.y) * 60);

        phase++;
        if (phase >= STEPS_PER_SIN) {
            phase = 0;
            frame_no++;
            lap_smin_min = 0x7FFFFFFF;
            lap_speed_max = 0;
            lap_nodamp_max = 0;
        }
    }
}

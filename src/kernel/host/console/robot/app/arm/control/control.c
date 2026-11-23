#include "app/arm/control.h"
#include "app/arm/kinematics.h"
#include "kernel/task.h"
#include "lib/fixed.h"
#include "lib/trig.h"

#define KP          393216
#define LAM2        419
#define K_NULL      16384
#define DT          655
#define STEPS_PER_SIN 200
#define TGT_SPEED   18529
#define KP_MANUAL   393216
#define MANUAL_SPEED 131072
#define BODY_MAX_LINK 131072   /* 2.00 m */
#define BODY_MAX_REACH 1048576 /* 16.00 m */
#define BODY_Q_ABS   209715    /* 3.20 rad */
/* 5 秒保持窗口：PIT 100 Hz，500 tick。不能用 control step 计数，
 * control 任务可以在一秒内跑数千步，会把窗口缩成 2 秒以内。 */
#define MANUAL_TIMEOUT_TICKS 500u

static struct body_desc body;
static i32 q[AEVUM_BODY_MAX_JOINTS];
static i32 dq[AEVUM_BODY_MAX_JOINTS];
static i32 q_target[AEVUM_BODY_MAX_JOINTS];
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
static int mode;
static int manual_ticks;
static u32 manual_deadline;

static void body_default(void)
{
    int i;
    body.n = 3;
    for (i = 0; i < AEVUM_BODY_MAX_JOINTS; i++) {
        body.joints[i].length = 0;
        body.joints[i].q_min = -BODY_Q_ABS;
        body.joints[i].q_max = BODY_Q_ABS;
        body.joints[i].q_home = 0;
    }
    body.joints[0].length = 19661;  /* 0.30 m */
    body.joints[1].length = 19661;
    body.joints[2].length = 13107;  /* 0.20 m */
    body.joints[0].q_home = 17157;  /* 15 deg */
    body.joints[1].q_home = 34315;  /* 30 deg */
    body.joints[2].q_home = 34315;
}

static void reset_state(void)
{
    i64 reach = 0;
    int i;

    for (i = 0; i < AEVUM_BODY_MAX_JOINTS; i++) {
        if (i < body.n) {
            q[i] = body.joints[i].q_home;
            q_target[i] = q[i];
            reach += body.joints[i].length;
        } else {
            q[i] = 0;
            q_target[i] = 0;
        }
        dq[i] = 0;
    }

    {
        i32 r = (i32)reach;
        i32 amp = fx_mul(r, 16384);   /* 0.25 reach */
        target.x = fx_mul(r, 42598) + amp;
        target.y = fx_mul(r, 11796);
        target_prev.x = target.x;
        target_prev.y = target.y;
        target_velocity.x = 0;
        target_velocity.y = 0;
    }

    phase = 0;
    null_on = 1;
    frame_no = 0;
    mode = 0;
    manual_ticks = 0;
    manual_deadline = 0;
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
    arm_fk(&body, q, &points);
}

u32 arm_control_init(void)
{
    body_default();
    reset_state();
    return 0;
}

int arm_control_set_body(const struct body_desc *in)
{
    i64 reach = 0;
    int i;

    if (!in) return 0;
    if (in->n < AEVUM_BODY_MIN_JOINTS || in->n > AEVUM_BODY_MAX_JOINTS)
        return 0;
    for (i = 0; i < in->n; i++) {
        i32 len = in->joints[i].length;
        i32 lo = in->joints[i].q_min;
        i32 hi = in->joints[i].q_max;
        i32 home = in->joints[i].q_home;
        if (len <= 0 || len > BODY_MAX_LINK) return 0;
        if (lo < -BODY_Q_ABS || hi > BODY_Q_ABS || lo >= hi) return 0;
        if (home < lo || home > hi) return 0;
        reach += len;
    }
    if (reach <= 0 || reach > BODY_MAX_REACH) return 0;

    body.n = in->n;
    for (i = 0; i < AEVUM_BODY_MAX_JOINTS; i++) {
        if (i < in->n) body.joints[i] = in->joints[i];
        else {
            body.joints[i].length = 0;
            body.joints[i].q_min = -BODY_Q_ABS;
            body.joints[i].q_max = BODY_Q_ABS;
            body.joints[i].q_home = 0;
        }
    }
    reset_state();
    return 1;
}

void arm_control_toggle_nullspace(void)
{
    null_on = !null_on;
}

/*
 * 宿主手动命令：只改关节目标，不直接改 q。
 * 命令每次刷新 manual_ticks；超过保持窗口没有新命令就回 auto，
 * 避免桥接断开后内核一直停在最后一条目标。
 */
int arm_control_set_joint_targets(const i32 q_in[AEVUM_BODY_MAX_JOINTS], int n)
{
    int i;
    if (n != body.n) return 0;
    for (i = 0; i < body.n; i++) {
        i32 v = q_in[i];
        if (v > body.joints[i].q_max) v = body.joints[i].q_max;
        if (v < body.joints[i].q_min) v = body.joints[i].q_min;
        q_target[i] = v;
    }
    mode = 1;
    manual_deadline = task_tick_total() + MANUAL_TIMEOUT_TICKS;
    manual_ticks = (int)MANUAL_TIMEOUT_TICKS;
    return 1;
}

void arm_control_release_manual(void)
{
    int i;
    mode = 0;
    manual_ticks = 0;
    target_velocity.x = 0;
    target_velocity.y = 0;
    for (i = 0; i < body.n; i++)
        q_target[i] = q[i];
}

void arm_control_status(struct arm_status *out)
{
    int i, n = body.n;
    out->n = n;
    for (i = 0; i < AEVUM_BODY_MAX_JOINTS; i++) {
        if (i < n) {
            out->q[i] = q[i];
            out->dq[i] = dq[i];
            out->q_target[i] = q_target[i];
        } else {
            out->q[i] = 0;
            out->dq[i] = 0;
            out->q_target[i] = 0;
        }
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
    out->mode = mode;
    out->manual_ticks = manual_ticks;
    out->frame_no = frame_no;
}

static void update_limit_margin(void)
{
    int i;
    limit_margin = 200 * FXONE;
    for (i = 0; i < body.n; i++) {
        i32 lo = q[i] - body.joints[i].q_min;
        i32 hi = body.joints[i].q_max - q[i];
        i32 lim = fx_deg(lo < hi ? lo : hi);
        if (lim < limit_margin) limit_margin = lim;
    }
}

static void update_metrics(const i32 J[2][AEVUM_BODY_MAX_JOINTS])
{
    int i;
    i32 a0 = 0, b0 = 0, c0 = 0;

    for (i = 0; i < body.n; i++) {
        a0 += fx_mul(J[0][i], J[0][i]);
        b0 += fx_mul(J[0][i], J[1][i]);
        c0 += fx_mul(J[1][i], J[1][i]);
    }
    {
        i32 tr = a0 + c0;
        i32 disc = fx_mul(tr, tr) - 4 * (fx_mul(a0, c0) - fx_mul(b0, b0));
        i32 t;
        if (disc < 0) disc = 0;
        t = fx_sqrt(disc);
        sigma_min = fx_sqrt((tr - t) / 2);
        sigma_max = fx_sqrt((tr + t) / 2);
    }
    {
        i32 d2 = fx_mul(a0, c0) - fx_mul(b0, b0);
        w_manip = (d2 > 0) ? fx_sqrt(d2) : 0;
    }
}

void arm_control_step(void)
{
    i32 J[2][AEVUM_BODY_MAX_JOINTS], Jt[2], Ai[2][2], det, inv;
    i32 dqn[AEVUM_BODY_MAX_JOINTS], z[AEVUM_BODY_MAX_JOINTS];
    i32 JtAi[AEVUM_BODY_MAX_JOINTS][2];
    i32 nrm = 0, nrm_null = 0;
    int i, j, n = body.n;

    if (mode == 1 && (i32)(task_tick_total() - manual_deadline) >= 0) {
        mode = 0;
        manual_ticks = 0;
        target_velocity.x = 0;
        target_velocity.y = 0;
    }

    if (mode == 1) {
        struct arm_points tgt;
        i32 ex, ey, exum, eyum;
        i64 sq;
        i32 r_um;

        arm_solve(&body, q, &points, J);
        arm_fk(&body, q_target, &tgt);
        target.x = tgt.p[n].x;
        target.y = tgt.p[n].y;
        target_velocity.x = 0;
        target_velocity.y = 0;

        ex = target.x - points.p[n].x;
        ey = target.y - points.p[n].y;
        exum = (i32)(((i64)ex * 1000000) >> FXBITS);
        eyum = (i32)(((i64)ey * 1000000) >> FXBITS);
        sq = (i64)exum * exum + (i64)eyum * eyum;
        r_um = (i32)isqrt64((u64)sq);
        err_mm = fx_div(r_um, 1000);

        update_metrics(J);
        null_share = 0;

        for (i = 0; i < n; i++) {
            i32 v = fx_mul(KP_MANUAL, q_target[i] - q[i]);
            if (v > MANUAL_SPEED) v = MANUAL_SPEED;
            if (v < -MANUAL_SPEED) v = -MANUAL_SPEED;
            dq[i] = v;
            q[i] += fx_mul(v, DT);
            if (q[i] > body.joints[i].q_max) {
                q[i] = body.joints[i].q_max;
                dq[i] = 0;
            }
            if (q[i] < body.joints[i].q_min) {
                q[i] = body.joints[i].q_min;
                dq[i] = 0;
            }
        }
        update_limit_margin();

        target_prev.x = target.x;
        target_prev.y = target.y;
        manual_ticks = (int)(manual_deadline - task_tick_total());
        if (manual_ticks < 0) manual_ticks = 0;
        arm_fk(&body, q, &points);
        return;
    }

    arm_solve(&body, q, &points, J);

    {
        i32 ex = target.x - points.p[n].x;
        i32 ey = target.y - points.p[n].y;
        i32 exum = (i32)(((i64)ex * 1000000) >> FXBITS);
        i32 eyum = (i32)(((i64)ey * 1000000) >> FXBITS);
        i64 sq = (i64)exum * exum + (i64)eyum * eyum;
        i32 r_um = (i32)isqrt64((u64)sq);
        err_mm = fx_div(r_um, 1000);
        Jt[0] = fx_mul(KP, ex) + target_velocity.x;
        Jt[1] = fx_mul(KP, ey) + target_velocity.y;
    }

    update_metrics(J);
    {
        i32 a0 = fx_mul(J[0][0], J[0][0]);
        i32 b0 = fx_mul(J[0][0], J[1][0]);
        i32 c0 = fx_mul(J[1][0], J[1][0]);
        for (i = 1; i < n; i++) {
            a0 += fx_mul(J[0][i], J[0][i]);
            b0 += fx_mul(J[0][i], J[1][i]);
            c0 += fx_mul(J[1][i], J[1][i]);
        }
        {
            i32 a = a0 + LAM2;
            i32 b = b0;
            i32 c = c0 + LAM2;
            det = fx_mul(a, c) - fx_mul(b, b);
            inv = fx_div(FXONE, det);
            Ai[0][0] = fx_mul(c, inv);
            Ai[0][1] = -fx_mul(b, inv);
            Ai[1][1] = fx_mul(a, inv);
            Ai[1][0] = Ai[0][1];
        }
    }
    {
        i32 x0 = fx_mul(Ai[0][0], Jt[0]) + fx_mul(Ai[0][1], Jt[1]);
        i32 x1 = fx_mul(Ai[1][0], Jt[0]) + fx_mul(Ai[1][1], Jt[1]);
        for (i = 0; i < n; i++)
            dq[i] = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
    }
    for (i = 0; i < n; i++)
        nrm += (dq[i] < 0 ? -dq[i] : dq[i]);

    for (i = 0; i < n; i++) {
        JtAi[i][0] = fx_mul(J[0][i], Ai[0][0]) + fx_mul(J[1][i], Ai[1][0]);
        JtAi[i][1] = fx_mul(J[0][i], Ai[0][1]) + fx_mul(J[1][i], Ai[1][1]);
        z[i] = -fx_mul(K_NULL, q[i] - body.joints[i].q_home);
    }

    for (i = 0; i < n; i++) {
        i32 acc = 0;
        for (j = 0; j < n; j++) {
            i32 nij = ((i == j) ? FXONE : 0)
                    - (fx_mul(JtAi[i][0], J[0][j]) + fx_mul(JtAi[i][1], J[1][j]));
            acc += fx_mul(nij, z[j]);
        }
        dqn[i] = null_on ? acc : 0;
        dq[i] += dqn[i];
        nrm_null += (dqn[i] < 0 ? -dqn[i] : dqn[i]);
    }

    null_share = (nrm + nrm_null > 0) ? fx_div(nrm_null, nrm + nrm_null) : 0;

    {
        i32 a0 = 0, b0 = 0, c0 = 0;
        i32 tr, disc, t, lam_min;
        for (i = 0; i < n; i++) {
            a0 += fx_mul(J[0][i], J[0][i]);
            b0 += fx_mul(J[0][i], J[1][i]);
            c0 += fx_mul(J[1][i], J[1][i]);
        }
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
    }

    {
        i32 a0 = 0, b0 = 0, c0 = 0;
        i32 dn, iv, i00, i01, i11, x0, x1, m;
        for (i = 0; i < n; i++) {
            a0 += fx_mul(J[0][i], J[0][i]);
            b0 += fx_mul(J[0][i], J[1][i]);
            c0 += fx_mul(J[1][i], J[1][i]);
        }
        dn = fx_mul(a0, c0) - fx_mul(b0, b0);
        iv = fx_div(FXONE, dn);
        i00 =  fx_mul(c0, iv);
        i01 = -fx_mul(b0, iv);
        i11 = fx_mul(a0, iv);
        x0 = fx_mul(i00, Jt[0]) + fx_mul(i01, Jt[1]);
        x1 = fx_mul(i01, Jt[0]) + fx_mul(i11, Jt[1]);
        m = 0;
        for (i = 0; i < n; i++) {
            i32 v = fx_mul(J[0][i], x0) + fx_mul(J[1][i], x1);
            if (v < 0) v = -v;
            if (v > m) m = v;
        }
        nodamp_speed = m;
        if (nodamp_speed > lap_nodamp_max) lap_nodamp_max = nodamp_speed;
    }

    {
        i32 sp = 0;
        for (i = 0; i < n; i++) {
            i32 v = dq[i] < 0 ? -dq[i] : dq[i];
            if (v > sp) sp = v;
        }
        if (sp > lap_speed_max) lap_speed_max = sp;
        if (sigma_min < lap_smin_min) lap_smin_min = sigma_min;
    }

    for (i = 0; i < n; i++) {
        q[i] += fx_mul(dq[i], DT);
        if (q[i] > body.joints[i].q_max) { q[i] = body.joints[i].q_max; dq[i] = 0; }
        if (q[i] < body.joints[i].q_min) { q[i] = body.joints[i].q_min; dq[i] = 0; }
        q_target[i] = q[i];
    }
    update_limit_margin();

    {
        i32 t = phase;
        i32 s;
        i32 reach = 0;
        i32 amp;
        for (i = 0; i < n; i++) reach += body.joints[i].length;
        if (t < 100) s = FXONE - (t * 2 * FXONE) / 100;
        else         s = ((t - 100) * 2 * FXONE) / 100 - FXONE;

        target_prev.x = target.x;
        target_prev.y = target.y;

        amp = fx_mul(reach, 16384);
        target.x = fx_mul(reach, 42598) + fx_mul(amp, s);
        target.y = fx_mul(reach, 11796) + fx_mul(fx_mul(reach, 1311), fx_sin(phase * 2059));

        target_velocity.x = (i32)((i64)(target.x - target_prev.x) * 100);
        target_velocity.y = (i32)((i64)(target.y - target_prev.y) * 100);

        phase++;
        if (phase >= STEPS_PER_SIN) {
            phase = 0;
            frame_no++;
            lap_smin_min = 0x7FFFFFFF;
            lap_speed_max = 0;
            lap_nodamp_max = 0;
        }
    }
    arm_fk(&body, q, &points);
}

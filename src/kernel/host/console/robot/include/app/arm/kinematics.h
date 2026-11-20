#ifndef AEVUM_APP_ARM_KINEMATICS_H
#define AEVUM_APP_ARM_KINEMATICS_H

#include "kernel/types.h"

#define ARM_NLINK  3
#define ARM_REACH  52429   /* 0.30 + 0.30 + 0.20 m，Q16.16 */

struct arm_vec2 {
    i32 x;
    i32 y;
};

struct arm_points {
    struct arm_vec2 elbow;
    struct arm_vec2 wrist;
    struct arm_vec2 end;
};

/* 纯函数：只读 q，写 out，不碰全局状态。 */
void arm_fk(const i32 q[ARM_NLINK], struct arm_points *out);
void arm_jacobian(const i32 q[ARM_NLINK], i32 J[2][ARM_NLINK]);
/* 一次算完末端位姿与雅可比，复用同一组 sin/cos，给控制步用。 */
void arm_solve(const i32 q[ARM_NLINK], struct arm_points *out,
               i32 J[2][ARM_NLINK]);

#endif

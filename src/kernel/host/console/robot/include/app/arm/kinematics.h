#ifndef AEVUM_APP_ARM_KINEMATICS_H
#define AEVUM_APP_ARM_KINEMATICS_H

#include "kernel/types.h"
#include "app/body/body.h"

struct arm_vec2 {
    i32 x;
    i32 y;
};

/* p[0] 是 base，p[i+1] 是第 i 个 link 末端；n <= AEVUM_BODY_MAX_JOINTS。 */
struct arm_points {
    struct arm_vec2 p[AEVUM_BODY_MAX_JOINTS + 1];
};

/* 纯函数：只读 body/q，写 out/J，不碰控制全局状态。 */
void arm_fk(const struct body_desc *body,
            const i32 q[AEVUM_BODY_MAX_JOINTS],
            struct arm_points *out);
void arm_jacobian(const struct body_desc *body,
                  const i32 q[AEVUM_BODY_MAX_JOINTS],
                  i32 J[2][AEVUM_BODY_MAX_JOINTS]);
/* 一次算完末端位姿与雅可比，复用同一组 sin/cos，给控制步用。 */
void arm_solve(const struct body_desc *body,
               const i32 q[AEVUM_BODY_MAX_JOINTS],
               struct arm_points *out,
               i32 J[2][AEVUM_BODY_MAX_JOINTS]);

#endif

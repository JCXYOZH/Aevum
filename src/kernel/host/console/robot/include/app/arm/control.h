#ifndef AEVUM_APP_ARM_CONTROL_H
#define AEVUM_APP_ARM_CONTROL_H

#include "kernel/types.h"
#include "app/arm/kinematics.h"

/*
 * 控制器快照：控制模块是这些字段的唯一写者；
 * 渲染模块只拿快照，不直接读控制模块的静态变量。
 */
struct arm_status {
    i32 q[ARM_NLINK];
    i32 dq[ARM_NLINK];
    i32 q_target[ARM_NLINK];
    struct arm_points points;
    struct arm_vec2 target;
    i32 w_manip;
    i32 sigma_min;
    i32 sigma_max;
    i32 err_mm;
    i32 limit_margin;
    i32 null_share;
    i32 lap_smin_min;
    i32 lap_speed_max;
    i32 lap_nodamp_max;
    i32 nodamp_speed;
    int null_on;
    int mode;          /* 0 = auto sine, 1 = manual joint target */
    int manual_ticks;  /* remaining hold ticks; 0 releases to auto */
    int frame_no;
};

u32 arm_control_init(void);
void arm_control_step(void);
void arm_control_toggle_nullspace(void);
/* Host command: joint targets in Q16.16 radians; enters manual mode. */
void arm_control_set_joint_targets(const i32 q[ARM_NLINK]);
void arm_control_status(struct arm_status *out);

#endif

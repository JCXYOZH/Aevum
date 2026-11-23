#ifndef AEVUM_APP_BODY_BODY_H
#define AEVUM_APP_BODY_BODY_H

#include "kernel/types.h"

/*
 * 平面串联身体描述：每个关节绕 Z 轴旋转，link 从上一关节末端沿 +X 延伸。
 * 内核只接受这个子集；更复杂的 3D/分支拓扑以后再加类型。
 */
#define AEVUM_BODY_MIN_JOINTS 2
#define AEVUM_BODY_MAX_JOINTS 8
#define AEVUM_BODY_WIRE_BYTES (1 + AEVUM_BODY_MAX_JOINTS * 16)

struct body_joint {
    i32 length;   /* Q16.16 m */
    i32 q_min;    /* Q16.16 rad */
    i32 q_max;
    i32 q_home;
};

struct body_desc {
    int n;
    struct body_joint joints[AEVUM_BODY_MAX_JOINTS];
};

#endif

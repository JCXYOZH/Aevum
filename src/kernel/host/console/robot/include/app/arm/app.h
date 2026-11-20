#ifndef AEVUM_APP_ARM_APP_H
#define AEVUM_APP_ARM_APP_H

#include "kernel/types.h"

/* 装配 control/render/idle 三个常驻任务；失败时返回 ARM_APP 职责码，并保留上游 dep_code。 */
u32 arm_app_init(void);
void arm_app_start(void);
u32 arm_app_dep_code(void);
u32 arm_app_spawn_probe(void);
u32 arm_app_start_duel(void);

#endif

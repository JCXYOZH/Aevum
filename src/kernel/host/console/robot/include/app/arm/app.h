#ifndef AEVUM_APP_ARM_APP_H
#define AEVUM_APP_ARM_APP_H

#include "kernel/types.h"

/* 装配 control/render/idle 三个常驻任务；成功返回 0，失败返回失败字段名。 */
const char *arm_app_init(void);
void arm_app_start(void);
const char *arm_app_spawn_probe(void);
const char *arm_app_start_duel(void);

#endif

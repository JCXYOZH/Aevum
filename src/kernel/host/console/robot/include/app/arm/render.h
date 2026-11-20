#ifndef AEVUM_APP_ARM_RENDER_H
#define AEVUM_APP_ARM_RENDER_H

#include "app/arm/control.h"

void arm_render_init(void);
void arm_render_frame(const struct arm_status *status);
void arm_render_trace_push(const struct arm_status *status);

/* 抢占决斗全屏：两个 CPU 密集型任务各自刷新一条 lane。 */
void arm_render_duel_init(void);
void arm_render_duel_lane(int lane, u32 step, int pid);
void arm_render_duel_status(u32 a_steps, u32 b_steps, const u8 *tape, u32 tape_head);

/* CPU 时间统计全屏：按任务显示 priority/CPU%/PIT ticks。 */
void arm_render_cpu_init(void);
void arm_render_cpu_frame(void);

#endif

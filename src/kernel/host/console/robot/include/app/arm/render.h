#ifndef AEVUM_APP_ARM_RENDER_H
#define AEVUM_APP_ARM_RENDER_H

#include "app/arm/control.h"

void arm_render_init(void);
void arm_render_frame(const struct arm_status *status);
void arm_render_trace_push(const struct arm_status *status);

#endif

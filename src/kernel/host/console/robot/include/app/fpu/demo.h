#ifndef AEVUM_APP_FPU_DEMO_H
#define AEVUM_APP_FPU_DEMO_H

#include "kernel/types.h"

/*
 * FPU context lab 的唯一写者：两个任务各自在 XMM0 里维护不同的标签和计数。
 * render 只读 fpu_lane 快照，不碰任务栈或 XMM 寄存器。
 */
struct fpu_lane {
    u32 pid;
    u32 count;
    u32 tag;
    u32 ok;
    u32 seq;
};

u32 fpu_demo_start(void);
void fpu_demo_stop(void);
int fpu_demo_live(void);
int fpu_demo_read(int lane, struct fpu_lane *out);

#endif

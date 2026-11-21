#ifndef AEVUM_APP_TREE_DEMO_H
#define AEVUM_APP_TREE_DEMO_H

#include "kernel/types.h"

/*
 * 家族树演示的唯一起点：famP 创建 famA / famB，随后 famP 主动退出，
 * 两个直接子进程由 family.c 重挂到 reaper(idle)。渲染层不创建任务。
 */
u32 tree_demo_start(void);
void tree_demo_stop(void);
int tree_demo_alive(void);
u32 tree_demo_error(void);

#endif

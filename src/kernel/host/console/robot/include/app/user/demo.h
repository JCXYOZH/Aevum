#ifndef AEVUM_APP_USER_DEMO_H
#define AEVUM_APP_USER_DEMO_H

#include "kernel/types.h"

struct address_space;

#define USER_DEMO_LANES      3
#define USER_DEMO_NORMAL     2
#define USER_DEMO_FAULT_LANE 2

/*
 * 三个 ring3 用户进程共用同一段虚拟代码。
 * userA/userB 正常计数；userC 计数后探测内核页，用来验证 #PF 故障隔离。
 */
u32 user_demo_start(void);
void user_demo_stop(void);
int user_demo_alive(void);
u32 user_demo_error(void);
int user_demo_pid(int lane);
struct address_space *user_demo_space(int lane);
int user_demo_faulted(int lane);

#endif

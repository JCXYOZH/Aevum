#ifndef AEVUM_APP_USER_DEMO_H
#define AEVUM_APP_USER_DEMO_H

#include "kernel/types.h"

struct address_space;

/* 两个 ring3 用户进程，共用同一段虚拟代码，数据页各自独立。 */
u32 user_demo_start(void);
void user_demo_stop(void);
int user_demo_alive(void);
u32 user_demo_error(void);
int user_demo_pid(int lane);
struct address_space *user_demo_space(int lane);

#endif

#ifndef AEVUM_APP_USER_DEMO_H
#define AEVUM_APP_USER_DEMO_H

#include "kernel/types.h"

struct address_space;

#define USER_DEMO_LANES      4
#define USER_DEMO_FAULT_LANE 2

/*
 * 四个 ring3 用户进程共用同一段虚拟代码。
 * userA/userB 正常计数；userC 计数后探测内核页，用来验证 #PF 故障隔离；
 * userD 先 fork 出 userE，再 wait 子进程退出码 7。
 */
u32 user_demo_start(void);
void user_demo_stop(void);
int user_demo_alive(void);
u32 user_demo_error(void);
int user_demo_pid(int lane);
struct address_space *user_demo_space(int lane);
int user_demo_faulted(int lane);
int user_demo_lane_count(void);

/* userD 的数据页是 fork/wait 的证据：child pid、wait pid/status/ret、WAIT 魔数。 */
u32 user_demo_fork_child(int lane);
u32 user_demo_wait_pid(int lane);
u32 user_demo_wait_status(int lane);
u32 user_demo_wait_ret(int lane);
u32 user_demo_wait_magic(int lane);

#endif

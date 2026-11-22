#ifndef AEVUM_APP_CONSOLE_DEMO_H
#define AEVUM_APP_CONSOLE_DEMO_H

#include "kernel/types.h"

/* X 控制台页唯一 owner：一条父进程 + fork 子进程共享 console fd 0/1。 */
const char *console_demo_start(void);
void console_demo_stop(void);
void console_demo_cleanup(void);
int console_demo_alive(void);
const char *console_demo_error(void);

int console_demo_pid(void);
u32 console_demo_child_pid(void);
u32 console_demo_close_read(void);
u32 console_demo_close_write(void);
u32 console_demo_parent_read(void);
u32 console_demo_parent_write(void);
u32 console_demo_magic(void);

#endif

#ifndef AEVUM_APP_POOL_DEMO_H
#define AEVUM_APP_POOL_DEMO_H

#include "kernel/types.h"

#define POOL_DEMO_CHILDREN 8
#define POOL_STRESS_ROUNDS 100

const char *pool_demo_start(int stress);
void pool_demo_stop(void);
void pool_demo_cleanup(void);
int pool_demo_alive(void);
int pool_demo_is_stress(void);
const char *pool_demo_error(void);
int pool_demo_pid(void);
u32 pool_demo_child_count(void);
u32 pool_demo_child_pid(int index);
u32 pool_demo_magic(void);

#endif

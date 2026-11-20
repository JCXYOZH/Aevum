#ifndef AEVUM_DRIVERS_INPUT_KEYBOARD_H
#define AEVUM_DRIVERS_INPUT_KEYBOARD_H

#include "kernel/types.h"

/* 返回一个扫描码；没有按键返回 0。键盘驱动只读端口，不解释业务含义。 */
u8 keyboard_poll(void);

#endif

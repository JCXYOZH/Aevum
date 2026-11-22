#ifndef AEVUM_APP_USER_PAGE_H
#define AEVUM_APP_USER_PAGE_H

#include "kernel/types.h"
#include "kernel/proc.h"

/*
 * P5.2 V 页导航的唯一样本：页面模式、选中槽、滚动窗口。
 * render 只读本模块状态；按键解释不散落在 app/arm 或 render 里。
 */
#define USER_PAGE_COUNT 4
#define USER_PAGE_ROWS  10

enum user_page_mode {
    USER_PAGE_SLOTS = 0,
    USER_PAGE_TREE,
    USER_PAGE_ADDRESS,
    USER_PAGE_FD
};

void user_page_reset(void);
/* 返回 1 表示该扫描码已由 V 页消费，调用方必须跳过本轮其它按键分支。 */
int user_page_key(u8 key);
int user_page_mode(void);
int user_page_selected_slot(void);
int user_page_first_slot(void);
const char *user_page_name(int mode);

#endif

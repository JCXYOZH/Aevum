#ifndef AEVUM_APP_USER_RENDER_PAGES_H
#define AEVUM_APP_USER_RENDER_PAGES_H

/* 每个页面只负责自己的行布局；公共标题/页签/底栏归 render.c。 */
void ur_render_slots(void);
void ur_render_tree(void);
void ur_render_address(void);
void ur_render_fd(void);

#endif

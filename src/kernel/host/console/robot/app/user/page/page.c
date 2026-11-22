#include "app/user/page.h"
#include "kernel/proc.h"

#define KEY_TAB   0x0F
#define KEY_UP    0x48
#define KEY_PGUP  0x49
#define KEY_HOME  0x47
#define KEY_END   0x4F
#define KEY_DOWN  0x50
#define KEY_PGDN  0x51
#define KEY_E0    0xE0

static int page_mode;
static int page_slot;
static int page_first;

static void page_clamp(void)
{
    int last_first = PROC_MAX - USER_PAGE_ROWS;

    if (last_first < 0) last_first = 0;
    if (page_slot < 0) page_slot = 0;
    if (page_slot >= PROC_MAX) page_slot = PROC_MAX - 1;
    if (page_first < 0) page_first = 0;
    if (page_first > last_first) page_first = last_first;
    if (page_slot < page_first) page_first = page_slot;
    if (page_slot >= page_first + USER_PAGE_ROWS)
        page_first = page_slot - USER_PAGE_ROWS + 1;
}

void user_page_reset(void)
{
    struct process_info info;
    int i;

    page_mode = USER_PAGE_SLOTS;
    page_slot = 0;
    page_first = 0;
    for (i = 0; i < PROC_MAX; i++) {
        if (process_snapshot(i, &info)) {
            page_slot = i;
            break;
        }
    }
    page_clamp();
}

int user_page_key(u8 key)
{
    if (key == KEY_E0) return 1;

    if (key == KEY_TAB) {
        page_mode = (page_mode + 1) % USER_PAGE_COUNT;
        return 1;
    }
    if (key >= 0x02 && key < 0x02 + USER_PAGE_COUNT) {
        page_mode = (int)key - 0x02;
        return 1;
    }

    if (key == KEY_UP) {
        page_slot--;
        page_clamp();
        return 1;
    }
    if (key == KEY_DOWN) {
        page_slot++;
        page_clamp();
        return 1;
    }
    if (key == KEY_PGUP) {
        page_slot -= USER_PAGE_ROWS;
        page_first -= USER_PAGE_ROWS;
        page_clamp();
        return 1;
    }
    if (key == KEY_PGDN) {
        page_slot += USER_PAGE_ROWS;
        page_first += USER_PAGE_ROWS;
        page_clamp();
        return 1;
    }
    if (key == KEY_HOME) {
        page_slot = 0;
        page_first = 0;
        page_clamp();
        return 1;
    }
    if (key == KEY_END) {
        page_slot = PROC_MAX - 1;
        page_first = PROC_MAX - USER_PAGE_ROWS;
        page_clamp();
        return 1;
    }
    return 0;
}

int user_page_mode(void)
{
    return page_mode;
}

int user_page_selected_slot(void)
{
    return page_slot;
}

int user_page_first_slot(void)
{
    return page_first;
}

const char *user_page_name(int mode)
{
    switch (mode) {
    case USER_PAGE_SLOTS:   return "SLOTS";
    case USER_PAGE_TREE:    return "TREE";
    case USER_PAGE_ADDRESS: return "ADDRESS";
    case USER_PAGE_FD:      return "FD/SIG";
    default:                return "?";
    }
}

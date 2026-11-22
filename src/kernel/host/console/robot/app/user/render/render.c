#include "app/user/render.h"
#include "app/user/page.h"
#include "app/user/pages.h"
#include "app/user/render/draw.h"
#include "kernel/proc.h"
#include "drivers/video/vga.h"

static void tab(int col, const char *label, int mode)
{
    vga_text(col, 1, label, user_page_mode() == mode ? C_HDR : C_GRAY);
}

static int selected_pid(void)
{
    struct process_info p;

    if (!process_snapshot(user_page_selected_slot(), &p)) return 0;
    return p.pid;
}

void user_render_frame(void)
{
    int mode = user_page_mode();
    int pid = selected_pid();
    int c;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(6, 0, "AEVUM / V PAGE OBSERVABILITY / P5.2", C_HDR);

    tab(2, "1 SLOT", USER_PAGE_SLOTS);
    tab(11, "2 TREE", USER_PAGE_TREE);
    tab(20, "3 AS", USER_PAGE_ADDRESS);
    tab(27, "4 FD/SIG", USER_PAGE_FD);

    vga_text(2, 2, "slot", C_GRAY);
    ud_put_dec(7, 2, (u32)user_page_selected_slot(), C_WHITE);
    vga_text(10, 2, "pid", C_GRAY);
    ud_put_dec(14, 2, (u32)pid, pid ? C_WHITE : C_GRAY);
    vga_text(19, 2, "page", C_GRAY);
    ud_put_dec(24, 2, (u32)(mode + 1), C_WHITE);
    vga_cell(25, 2, '/', C_GRAY);
    ud_put_dec(26, 2, (u32)USER_PAGE_COUNT, C_CYAN);
    vga_text(29, 2, user_page_name(mode), C_HDR);
    if (mode == USER_PAGE_SLOTS) {
        vga_text(39, 2, "window", C_GRAY);
        c = ud_put_dec(46, 2, (u32)(user_page_first_slot() + 1), C_WHITE);
        vga_cell(c, 2, '-', C_GRAY);
        c = ud_put_dec(c + 1, 2, (u32)(user_page_first_slot() + USER_PAGE_ROWS), C_WHITE);
        vga_cell(c, 2, '/', C_GRAY);
        ud_put_dec(c + 1, 2, (u32)PROC_MAX, C_CYAN);
    }

    switch (mode) {
    case USER_PAGE_SLOTS:   ur_render_slots(); break;
    case USER_PAGE_TREE:    ur_render_tree(); break;
    case USER_PAGE_ADDRESS: ur_render_address(); break;
    case USER_PAGE_FD:      ur_render_fd(); break;
    default: break;
    }

    vga_text(2, 23, "TAB page", C_CYAN);
    vga_text(12, 23, "1-4 direct", C_GRAY);
    vga_text(23, 23, "UP/DOWN slot", C_GRAY);
    vga_text(36, 23, "PGUP/PGDN win", C_GRAY);
    vga_text(50, 23, "HOME/END", C_GRAY);
    vga_text(61, 23, "V:exit", C_YELLOW);

    vga_text(2, 24, "P5.2 reads PCB/AS/fd snapshots only; page state is UI-owned", C_GRAY);
}

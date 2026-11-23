#include "app/user/pages.h"
#include "app/user/page.h"
#include "app/user/render/draw.h"
#include "kernel/proc.h"
#include "kernel/task.h"
#include "drivers/video/vga.h"

static int tree_visited[PROC_MAX];

static int slot_of_pid(int pid)
{
    int i;
    struct process_info p;

    if (pid <= 0) return -1;
    for (i = 0; i < process_count(); i++)
        if (process_snapshot(i, &p) && p.pid == pid) return i;
    return -1;
}

static void child_counts(int pid, int *live, int *zomb, int *dead)
{
    int i;
    struct process_info p;

    *live = 0;
    *zomb = 0;
    *dead = 0;
    for (i = 0; i < process_count(); i++) {
        if (!process_snapshot(i, &p) || p.ppid != pid) continue;
        if (p.state == PROC_LIVE) (*live)++;
        else if (p.state == PROC_ZOMBIE) (*zomb)++;
        else (*dead)++;
    }
}

static int pid_is_root(int ppid)
{
    if (ppid == 0) return 1;
    return slot_of_pid(ppid) < 0;
}

static void draw_node(int pid, int depth, int *rowp)
{
    struct process_info p;
    int slot = slot_of_pid(pid);
    int row = *rowp;
    int live, zomb, dead;
    int selected = 0;
    struct process_info sel;

    if (slot < 0 || tree_visited[slot] || row > 19) return;
    if (!process_snapshot(slot, &p)) return;
    tree_visited[slot] = 1;
    (*rowp)++;

    if (process_snapshot(user_page_selected_slot(), &sel) && sel.pid == p.pid)
        selected = 1;
    if (selected)
        vga_cell(0, row, '>', C_GREEN);

    vga_cell(2, row, depth ? '+' : 'R', depth ? C_CYAN : C_GREEN);
    ud_put_dec(3, row, (u32)depth, C_GRAY);
    vga_text(5, row, "PID", C_GRAY);
    ud_put_dec(9, row, (u32)p.pid, C_WHITE);
    vga_text(12, row, "PP", C_GRAY);
    ud_put_dec(15, row, (u32)p.ppid, C_WHITE);
    vga_text(18, row, "ST", C_GRAY);
    vga_text(21, row, ud_proc_state(&p), ud_proc_attr(&p));
    vga_text(28, row, "TK", C_GRAY);
    vga_text(31, row, task_state_name(p.task_state), ud_proc_attr(&p));

    child_counts(p.pid, &live, &zomb, &dead);
    vga_text(39, row, "CH", C_GRAY);
    ud_put_dec(42, row, (u32)(live + zomb + dead), C_WHITE);
    vga_text(45, row, "W", C_GRAY);
    ud_put_dec(47, row, (u32)zomb, zomb ? C_MAG : C_GRAY);
    vga_text(50, row, "PEND", C_GRAY);
    ud_put_hex(55, row, p.pending, p.pending ? C_MAG : C_GRAY);
    vga_text(64, row, p.comm, C_HDR);

    {
        int i;
        struct process_info child;
        for (i = 0; i < process_count(); i++) {
            if (!process_snapshot(i, &child) || child.ppid != p.pid) continue;
            draw_node(child.pid, depth + 1, rowp);
        }
    }
}

static void draw_orphan_event(void)
{
    struct proc_orphan_event e;
    int i, col;

    if (!process_last_orphan(&e)) {
        vga_text(2, 20, "ORPHAN none yet", C_GRAY);
        return;
    }

    vga_text(2, 20, "ORPHAN", C_GRAY);
    vga_text(9, 20, "from", C_GRAY);
    col = 14;
    col += ud_put_dec(col, 20, (u32)e.from, C_MAG);
    vga_text(col, 20, " to", C_GRAY);
    col += 3;
    col += ud_put_dec(col, 20, (u32)e.to, C_GREEN);
    vga_text(col, 20, " children", C_GRAY);
    col += 9;
    col += ud_put_dec(col, 20, (u32)e.child_count, C_WHITE);

    vga_text(2, 21, "kids", C_GRAY);
    col = 7;
    for (i = 0; i < e.child_count && i < PROC_ORPHAN_CHILDREN; i++) {
        if (i) {
            vga_cell(col, 21, ',', C_GRAY);
            col++;
            vga_cell(col, 21, ' ', C_GRAY);
            col++;
        }
        col += ud_put_dec(col, 21, (u32)e.children[i], C_WHITE);
    }
    if (e.child_count > PROC_ORPHAN_CHILDREN) {
        vga_text(col, 21, " +", C_YELLOW);
        col += 2;
        col += ud_put_dec(col, 21,
                          (u32)(e.child_count - PROC_ORPHAN_CHILDREN),
                          C_YELLOW);
        vga_text(col, 21, " more", C_YELLOW);
    }
}

void ur_render_tree(void)
{
    int i, row = 4;
    int roots = 0, used = 0, live = 0, zomb = 0, dead = 0;
    struct process_info p;

    vga_text(2, 3, "D", C_GRAY);
    vga_text(5, 3, "PID", C_GRAY);
    vga_text(12, 3, "PP", C_GRAY);
    vga_text(18, 3, "ST", C_GRAY);
    vga_text(28, 3, "TK", C_GRAY);
    vga_text(39, 3, "CH", C_GRAY);
    vga_text(45, 3, "W", C_GRAY);
    vga_text(50, 3, "PEND", C_GRAY);
    vga_text(64, 3, "COMM", C_GRAY);

    for (i = 0; i < PROC_MAX; i++) tree_visited[i] = 0;

    for (i = 0; i < process_count(); i++) {
        if (!process_snapshot(i, &p)) continue;
        used++;
        if (p.state == PROC_LIVE) live++;
        else if (p.state == PROC_ZOMBIE) zomb++;
        else dead++;
        if (pid_is_root(p.ppid)) {
            roots++;
            draw_node(p.pid, 0, &row);
        }
    }
    /* 防御异常父子环：未访问节点仍以 root 补画，避免 V 页漏项。 */
    for (i = 0; i < process_count(); i++) {
        if (!process_snapshot(i, &p)) continue;
        if (!tree_visited[i]) {
            roots++;
            draw_node(p.pid, 0, &row);
        }
    }

    vga_text(2, 22, "TREE roots", C_GRAY);
    ud_put_dec(13, 22, (u32)roots, C_GREEN);
    vga_text(16, 22, "used", C_GRAY);
    ud_put_dec(21, 22, (u32)used, C_WHITE);
    vga_cell(23, 22, '/', C_GRAY);
    ud_put_dec(24, 22, (u32)PROC_MAX, C_CYAN);
    vga_text(27, 22, "live", C_GRAY);
    ud_put_dec(32, 22, (u32)live, C_GREEN);
    vga_text(35, 22, "zomb", C_GRAY);
    ud_put_dec(40, 22, (u32)zomb, zomb ? C_MAG : C_GRAY);
    vga_text(43, 22, "dead", C_GRAY);
    ud_put_dec(48, 22, (u32)dead, C_GRAY);
    vga_text(51, 22, "W=ZOMBIE kids", C_GRAY);
    draw_orphan_event();
}

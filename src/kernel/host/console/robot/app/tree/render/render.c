#include "app/tree/render.h"
#include "kernel/task/family.h"
#include "kernel/task.h"
#include "drivers/video/vga.h"
#include "lib/format.h"

#define C_BG      0x01
#define C_HDR     0x1F
#define C_TREE    0x0B
#define C_GRAY    0x08
#define C_WHITE   0x0F
#define C_GREEN   0x0A
#define C_YELLOW  0x0E
#define C_RED     0x0C
#define C_MAG     0x0D
#define C_FLASH   0x3B

static struct family_entry entries[AEVUM_FAMILY_MAX];
static int entry_count;
static u32 seen_event;
static int flash;

static int text_len(const char *s)
{
    int n = 0;
    while (s[n]) n++;
    return n;
}

static u8 state_attr(int state)
{
    switch (state) {
        case TASK_RUNNING: return C_GREEN;
        case TASK_READY:   return C_YELLOW;
        case TASK_BLOCKED: return C_RED;
        case TASK_ZOMBIE:  return C_GRAY;
        default:           return C_GRAY;
    }
}

static int find_entry(int pid)
{
    int i;
    for (i = 0; i < entry_count; i++)
        if (entries[i].pid == pid) return i;
    return -1;
}

static int child_count_of(int pid)
{
    int i, n = 0;
    for (i = 0; i < entry_count; i++)
        if (entries[i].ppid == pid) n++;
    return n;
}

/* 按登记顺序取下一个直接子进程，保证树形页不会因扫描顺序抖动。 */
static int next_child(int pid, u32 after_order)
{
    int i, best = -1;
    u32 best_order = 0;

    for (i = 0; i < entry_count; i++) {
        if (entries[i].ppid != pid || entries[i].order <= after_order) continue;
        if (best < 0 || entries[i].order < best_order) {
            best = i;
            best_order = entries[i].order;
        }
    }
    return best;
}

static int pid_in_event(int pid)
{
    struct family_event event;
    int i;

    if (!family_last_event(&event)) return 0;
    for (i = 0; i < event.child_count && i < AEVUM_FAMILY_EVENT_CHILDREN; i++)
        if (event.children[i] == pid) return 1;
    return 0;
}

static int put_dec(int col, int row, u32 value, u8 attr)
{
    char buf[12];
    int n = fmt_dec(buf, value);
    buf[n] = 0;
    vga_text(col, row, buf, attr);
    return col + n;
}

static void draw_node(int idx, int depth, int is_last, u8 *branch, int *row)
{
    struct family_entry *entry = &entries[idx];
    struct task_info info;
    const char *name;
    const char *state;
    u8 attr;
    int col, i;

    if (*row >= 19) return;

    for (i = 1; i < depth; i++)
        vga_text(2 + (i - 1) * 4, *row, branch[i] ? "|  " : "   ", C_GRAY);
    if (depth > 0)
        vga_text(2 + (depth - 1) * 4, *row, is_last ? "`- " : "+- ", C_GRAY);

    col = 2 + depth * 4;
    if (entry->pid == 0) {
        name = "init";
        state = "ROOT";
        attr = C_HDR;
    } else if (task_snapshot_pid(entry->pid, &info)) {
        name = info.comm;
        state = task_state_name(info.state);
        attr = state_attr(info.state);
    } else {
        name = "?";
        state = "GONE";
        attr = C_GRAY;
    }

    if (flash > 0 && pid_in_event(entry->pid)) {
        vga_fill(col, *row, col + 36, *row, ' ', C_FLASH);
        attr = C_FLASH;
    }

    vga_cell(col, *row, '[', attr);
    col++;
    vga_text(col, *row, name, attr);
    col += text_len(name);
    vga_cell(col, *row, ' ', attr);
    col++;
    col = put_dec(col, *row, (u32)entry->pid, attr);
    vga_text(col, *row, "] ", attr);
    col += 2;
    vga_text(col, *row, state, attr);
    col += text_len(state);

    if (entry->pid == 0) {
        vga_text(col, *row, "  kernel", attr);
    } else {
        u32 total = task_cpu_total();
        u32 pct = 0;
        if (task_snapshot_pid(entry->pid, &info) && total)
            pct = (info.cpu_ticks * 100u) / total;
        vga_text(col, *row, "  ", attr);
        col += 2;
        col = put_dec(col, *row, pct, attr);
        vga_text(col, *row, "% k", attr);
        col += 3;
        col = put_dec(col, *row, (u32)child_count_of(entry->pid), attr);
        if (entry->pid == family_reaper_pid())
            vga_text(col, *row, " REAPER", C_MAG);
    }

    branch[depth] = is_last ? 0 : 1;
    {
        int child = next_child(entry->pid, 0);
        while (child >= 0) {
            int next = next_child(entry->pid, entries[child].order);
            (*row)++;
            draw_node(child, depth + 1, next < 0, branch, row);
            child = next;
        }
    }
}

static void draw_event(void)
{
    struct family_event event;
    struct task_info info;
    u8 attr = flash > 0 ? C_FLASH : C_WHITE;
    char buf[12];
    int i, p, row;

    vga_text(50, 4, "LAST REPARENT", C_HDR);
    if (flash > 0)
        vga_fill(50, 5, 79, 13, ' ', C_FLASH);

    if (!family_last_event(&event)) {
        vga_text(50, 6, "no orphan event yet", C_GRAY);
        vga_text(50, 8, "famP exits after 1.5s", C_TREE);
        vga_text(50, 9, "its direct children move", C_TREE);
        return;
    }

    p = 0;
    p += fmt_dec(buf, (u32)event.from);
    buf[p] = 0;
    vga_text(50, 5, "parent ", attr);
    vga_text(57, 5, buf, attr);
    vga_text(50, 6, "exited", attr);

    p = 0;
    p += fmt_dec(buf, (u32)event.child_count);
    buf[p] = 0;
    vga_text(50, 7, "children ", attr);
    vga_text(59, 7, buf, attr);

    row = 8;
    for (i = 0; i < event.child_count && i < AEVUM_FAMILY_EVENT_CHILDREN && row < 12; i++) {
        const char *name = "?";
        if (task_snapshot_pid(event.children[i], &info)) name = info.comm;
        vga_text(50, row, "  ", attr);
        vga_text(52, row, name, attr);
        vga_text(52 + text_len(name) + 1, row, "->", attr);
        p = 0;
        p += fmt_dec(buf, (u32)event.to);
        buf[p] = 0;
        vga_text(55 + text_len(name), row, buf, attr);
        row++;
    }

    if (event.child_count > AEVUM_FAMILY_EVENT_CHILDREN) {
        p = 0;
        p += fmt_dec(buf, (u32)(event.child_count - AEVUM_FAMILY_EVENT_CHILDREN));
        buf[p] = 0;
        vga_text(50, 13, "  +", attr);
        vga_text(53, 13, buf, attr);
        vga_text(53 + p, 13, " more", attr);
    }

    vga_text(50, 12, "reaper ", attr);
    p = 0;
    p += fmt_dec(buf, (u32)event.to);
    buf[p] = 0;
    vga_text(57, 12, buf, attr);
}

void tree_render_frame(void)
{
    struct family_event event;
    int row = 5;

    vga_clear(C_BG);
    vga_fill(0, 0, 79, 0, ' ', C_HDR);
    vga_text(21, 0, "AEVUM / PROCESS FAMILY TREE", C_HDR);
    vga_text(2, 2, "kernel-owned parent links; only direct children move", C_TREE);
    vga_text(2, 3, "root PID 0 is init / boot context", C_GRAY);

    entry_count = family_snapshot(entries, AEVUM_FAMILY_MAX);
    vga_text(2, 4, "TASK TREE", C_HDR);
    for (row = 4; row <= 19; row++) vga_cell(49, row, '|', C_GRAY);

    row = 5;
    {
        int root = find_entry(0);
        if (root >= 0) {
            u8 branch[AEVUM_FAMILY_MAX];
            int i;
            for (i = 0; i < AEVUM_FAMILY_MAX; i++) branch[i] = 0;
            draw_node(root, 0, 1, branch, &row);
        } else {
            vga_text(2, 5, "family table is empty", C_RED);
        }
    }

    if (family_last_event(&event) && event.seq != seen_event) {
        seen_event = event.seq;
        if (event.seq) flash = 80;
    }
    if (flash > 0) flash--;
    draw_event();

    vga_text(2, 20, "G: stop and return to arm", C_YELLOW);
    vga_text(2, 21, "Only direct children are re-parented; grandchildren keep their parent.", C_GRAY);
    vga_text(2, 22, "Reparent is a real family_exit() write, not a printed animation.", C_TREE);
    vga_text(2, 23, "Aevum reaps PID immediately: no exit-status zombie queue yet.", C_GRAY);
}

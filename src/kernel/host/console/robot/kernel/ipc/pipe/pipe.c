#include "kernel/ipc/pipe.h"

struct pipe {
    u32 head;
    u32 tail;
    u32 count;
    u32 refs;
    u32 readers;
    u32 writers;
    u32 used;
    u8 buf[PIPE_CAPACITY];
};

static struct pipe pipes[PIPE_MAX];

struct pipe *pipe_create(void)
{
    int i;

    for (i = 0; i < PIPE_MAX; i++) {
        struct pipe *p = &pipes[i];
        if (p->used) continue;
        p->head = 0;
        p->tail = 0;
        p->count = 0;
        p->refs = 0;
        p->readers = 0;
        p->writers = 0;
        p->used = 1;
        return p;
    }
    return 0;
}

/* 新建对象 refs=0；fd 表每装入一个端点 acquire 一次。 */
void pipe_acquire(struct pipe *p, int write_end)
{
    if (!p || !p->used) return;
    p->refs++;
    if (write_end) p->writers++;
    else p->readers++;
}

void pipe_release(struct pipe *p, int write_end)
{
    if (!p || !p->used) return;
    if (write_end) {
        if (p->writers) p->writers--;
    } else {
        if (p->readers) p->readers--;
    }
    if (p->refs) p->refs--;
    if (!p->refs) {
        p->used = 0;
        p->head = 0;
        p->tail = 0;
        p->count = 0;
        p->readers = 0;
        p->writers = 0;
    }
}

int pipe_read(struct pipe *p, void *buf, u32 len)
{
    u8 *out = (u8 *)buf;
    u32 i;
    u32 n;

    if (!p || !p->used || !buf) return -1;
    if (!len) return 0;
    if (!p->count)
        return p->writers ? -1 : 0;

    n = len < p->count ? len : p->count;
    for (i = 0; i < n; i++) {
        out[i] = p->buf[p->tail];
        p->tail = (p->tail + 1u) % PIPE_CAPACITY;
    }
    p->count -= n;
    return (int)n;
}

int pipe_write(struct pipe *p, const void *buf, u32 len)
{
    const u8 *in = (const u8 *)buf;
    u32 i;

    if (!p || !p->used || !buf) return -1;
    if (!len) return 0;
    if (!p->readers) return -1;
    if (len > PIPE_CAPACITY - p->count) return -1;

    for (i = 0; i < len; i++) {
        p->buf[p->head] = in[i];
        p->head = (p->head + 1u) % PIPE_CAPACITY;
    }
    p->count += len;
    return (int)len;
}

u32 pipe_live_count(void)
{
    int i;
    u32 n = 0;

    for (i = 0; i < PIPE_MAX; i++)
        if (pipes[i].used) n++;
    return n;
}

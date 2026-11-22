#ifndef AEVUM_KERNEL_PROC_FD_H
#define AEVUM_KERNEL_PROC_FD_H

#include "kernel/types.h"

struct address_space;
struct pipe;

/*
 * P4.3 每进程 fd 表的唯一 owner。0/1 预留给后续 console，pipe 从 2 起分配；
 * 表内只保存 pipe 端点引用，read/write/close 的用户指针校验也在这里完成。
 */
#define PROC_FD_MAX   8
#define PROC_FD_FIRST 2

enum proc_fd_kind {
    PROC_FD_CLOSED = 0,
    PROC_FD_PIPE_READ = 1,
    PROC_FD_PIPE_WRITE = 2
};

struct proc_fd_entry {
    struct pipe *pipe;
    u32 kind;
};

struct proc_fd_table {
    struct proc_fd_entry entries[PROC_FD_MAX];
};

void proc_fd_table_init(struct proc_fd_table *table);
void proc_fd_table_close_all(struct proc_fd_table *table);

/* fork：复制引用并 acquire；exec 不调用本函数，因此 fd 表原样保留。 */
int proc_fd_table_copy(struct proc_fd_table *dst,
                       const struct proc_fd_table *src);
u32 proc_fd_count(const struct proc_fd_table *table);

/* 系统调用语义：pipe 写两个 u32 fd；read/write 返回字节数或 -1。 */
int proc_fd_pipe(struct proc_fd_table *table, struct address_space *space,
                 u32 user_fds);
int proc_fd_read(struct proc_fd_table *table, struct address_space *space,
                 u32 fd, u32 user_buf, u32 len);
int proc_fd_write(struct proc_fd_table *table, struct address_space *space,
                  u32 fd, u32 user_buf, u32 len);
int proc_fd_close(struct proc_fd_table *table, u32 fd);

#endif

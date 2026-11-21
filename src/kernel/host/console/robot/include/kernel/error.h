#ifndef AEVUM_KERNEL_ERROR_H
#define AEVUM_KERNEL_ERROR_H

#include "kernel/types.h"

/*
 * 错误码格式：0xRRFFTT
 *   RR = 职责号，FF = 职责内字段号，TT = 错误类型
 *   0x01 字段缺失 / 0x02 字段冲突 / 0x03 依赖未满足 / 0x04 外部操作失败
 *
 * 本文件是唯一错误码常量表。新增错误码必须先在这里登记，再在失败点使用。
 */
#define AEVUM_RR_KERNEL_MAIN   0x20
#define AEVUM_RR_TASK          0x21
#define AEVUM_RR_ARM_APP       0x22
#define AEVUM_RR_ARM_CONTROL   0x23
#define AEVUM_RR_ARM_RENDER    0x24
#define AEVUM_RR_VGA           0x25
#define AEVUM_RR_UART          0x26
#define AEVUM_RR_KEYBOARD      0x27
#define AEVUM_RR_MM            0x28

#define AEVUM_ERR(rr, ff, tt)  ((((u32)(rr)) << 16) | (((u32)(ff)) << 8) | ((u32)(tt)))

/* 内核入口 */
#define ERR_KERNEL_MAIN_ARM_APP        AEVUM_ERR(AEVUM_RR_KERNEL_MAIN, 0x00, 0x04)

/* 任务模块：字段 0 槽位 / 1 入口 / 2 栈 / 3 PID / 4 状态 / 5 出参 / 6 优先级 */
#define ERR_TASK_SLOT_FULL             AEVUM_ERR(AEVUM_RR_TASK, 0x00, 0x04)
#define ERR_TASK_ENTRY_MISSING         AEVUM_ERR(AEVUM_RR_TASK, 0x01, 0x01)
#define ERR_TASK_STACK_INVALID         AEVUM_ERR(AEVUM_RR_TASK, 0x02, 0x03)
#define ERR_TASK_PID_DUP               AEVUM_ERR(AEVUM_RR_TASK, 0x03, 0x02)
#define ERR_TASK_BAD_STATE             AEVUM_ERR(AEVUM_RR_TASK, 0x04, 0x03)
#define ERR_TASK_OUT_MISSING           AEVUM_ERR(AEVUM_RR_TASK, 0x05, 0x01)
#define ERR_TASK_PRIORITY              AEVUM_ERR(AEVUM_RR_TASK, 0x06, 0x02)
#define ERR_TASK_PID_EXHAUSTED         AEVUM_ERR(AEVUM_RR_TASK, 0x08, 0x03)

/* 地址空间模块：字段 0 槽位 / 1 页表 / 2 用户页 */
#define ERR_MM_NO_SPACE                AEVUM_ERR(AEVUM_RR_MM, 0x00, 0x04)

/* 应用装配：任务创建是跨模块依赖 */
#define ERR_ARM_APP_TASK_CREATE        AEVUM_ERR(AEVUM_RR_ARM_APP, 0x00, 0x04)
#define ERR_ARM_APP_SWITCH             AEVUM_ERR(AEVUM_RR_ARM_APP, 0x00, 0x03)

struct aevum_error {
    u32 code;
    const char *owner;
    const char *field;
    const char *detail;
    const char *at;
    u32 dep_code;   /* 0 表示没有上游依赖明细 */
    u8  dep_rr;
};

void aevum_fail(const struct aevum_error *err) __attribute__((noreturn));

#endif

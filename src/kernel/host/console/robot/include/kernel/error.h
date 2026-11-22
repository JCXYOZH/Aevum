#ifndef AEVUM_KERNEL_ERROR_H
#define AEVUM_KERNEL_ERROR_H

#include "kernel/types.h"

/*
 * 错误身份 = (owner, field) 字符串对，不再分配 0xRRFFTT 数字码。
 *
 * type 只是分类标签：
 *   "missing"    字段缺失
 *   "conflict"   字段冲突
 *   "dependency" 依赖未满足
 *   "external"   外部操作失败
 *   "state"      状态不合法
 *
 * 失败点必须同时写清 at；禁止用同一个 field 覆盖多个不同失败点。
 */
struct aevum_error {
    const char *owner;
    const char *field;
    const char *type;
    const char *detail;
    const char *at;
};

void aevum_fail(const struct aevum_error *err) __attribute__((noreturn));

#endif

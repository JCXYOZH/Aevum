#include "kernel/task/stack.h"
#include "config/memory.h"

/*
 * 位图槽池：bit i 对应 [BASE+i*4KB, BASE+(i+1)*4KB)，top 为区间上界。
 * 分配/释放都清整个 4KB，避免复用栈时把上一个进程的内核帧、FXSAVE 区
 * 或局部变量泄露给下一个进程。池大小与 PROC_MAX/AS_MAX 独立，三者
 * 的使用量由 P5.1 页面分别观测。
 */
static u16 stack_map;

static void stack_zero(u32 top)
{
    u32 *p = (u32 *)(top - AEVUM_TASK_STACK_SIZE);
    u32 *end = (u32 *)top;

    while (p < end) *p++ = 0;
}

void kernel_stack_reset(void)
{
    stack_map = 0;
}

u32 kernel_stack_alloc(void)
{
    int i;

    for (i = 0; i < AEVUM_KSTACK_COUNT; i++) {
        u16 mask = (u16)(1u << i);
        if (!(stack_map & mask)) {
            u32 top = AEVUM_KSTACK_BASE +
                      (u32)(i + 1) * AEVUM_TASK_STACK_SIZE;

            stack_map |= mask;
            stack_zero(top);
            return top;
        }
    }
    return 0;
}

void kernel_stack_free(u32 top)
{
    int i;

    for (i = 0; i < AEVUM_KSTACK_COUNT; i++) {
        u32 slot_top = AEVUM_KSTACK_BASE +
                       (u32)(i + 1) * AEVUM_TASK_STACK_SIZE;
        if (slot_top == top) {
            stack_zero(top);
            stack_map &= (u16)~(1u << i);
            return;
        }
    }
}

int kernel_stack_used(void)
{
    u16 map = stack_map;
    int n = 0;

    while (map) {
        n += (int)(map & 1u);
        map = (u16)(map >> 1);
    }
    return n;
}

int kernel_stack_capacity(void)
{
    return AEVUM_KSTACK_COUNT;
}

#ifndef AEVUM_DRIVERS_SERIAL_UART_H
#define AEVUM_DRIVERS_SERIAL_UART_H

#include "kernel/types.h"

#define UART_COM1          0x3F8
#define UART_FRAME_MAX_CELLS 32

/* COM1 的唯一实现入口：初始化、发送、收 F 请求、扫描 VGA 差量帧。 */
void uart_init(void);
void uart_write(const u8 *buf, u32 len);
int uart_poll_full_request(void);
void uart_scan(void);
/* 只读关节状态帧：3 个 Q16.16 弧度值，供宿主桥接观测，不反向控制内核。 */
void uart_state_frame(const i32 q[3]);

#endif

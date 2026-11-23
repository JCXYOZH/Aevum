#ifndef AEVUM_DRIVERS_SERIAL_UART_H
#define AEVUM_DRIVERS_SERIAL_UART_H

#include "kernel/types.h"

#define UART_COM1          0x3F8
#define UART_FRAME_MAX_CELLS 32

/* COM1 的唯一实现入口：初始化、发送、收 F/R/J 命令、扫描 VGA 差量帧。 */
void uart_init(void);
void uart_write(const u8 *buf, u32 len);
int uart_poll_release_request(void);
int uart_poll_joint_command(i32 q[3]);
void uart_scan(void);
/* 完整状态帧：任意个 i32/Q16.16 值 + XOR CRC；由 app 层组装字段。 */
void uart_status_frame(const i32 *values, u32 count);

#endif

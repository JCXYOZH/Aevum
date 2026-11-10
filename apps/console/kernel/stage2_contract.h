#ifndef STAGE2_CONTRACT_H
#define STAGE2_CONTRACT_H

#include <stdint.h>

/* ---------- boot info 基址（与 boot.asm 一致） ---------- */
#define AEVUM_BOOT_INFO_BASE        0x0500

/* ---------- R4 字段（stage2 只读） ---------- */
#define BI_R4_OFFSET                0x30
#define BI_R4_PD_PHYS               (AEVUM_BOOT_INFO_BASE + BI_R4_OFFSET + 0)
#define BI_R4_PT0_PHYS              (AEVUM_BOOT_INFO_BASE + BI_R4_OFFSET + 4)
#define BI_R4_MAPPED_BYTES          (AEVUM_BOOT_INFO_BASE + BI_R4_OFFSET + 8)

/* ---------- R7 字段（stage2 只读） ---------- */
#define BI_R7_OFFSET                0x60
#define BI_R7_STAGE2_ENTRY          (AEVUM_BOOT_INFO_BASE + BI_R7_OFFSET + 0)
#define BI_R7_IDT_READY             (AEVUM_BOOT_INFO_BASE + BI_R7_OFFSET + 4)

/* ---------- R8 字段（stage2 接管后由 R14 写） ---------- */
#define BI_R8_OFFSET                0x70
#define BI_R8_ERROR_CODE            (AEVUM_BOOT_INFO_BASE + BI_R8_OFFSET + 0)
#define BI_R8_ERROR_STAGE           (AEVUM_BOOT_INFO_BASE + BI_R8_OFFSET + 4)
#define BI_R8_ERROR_FIELD           (AEVUM_BOOT_INFO_BASE + BI_R8_OFFSET + 5)
#define BI_R8_ERROR_TYPE            (AEVUM_BOOT_INFO_BASE + BI_R8_OFFSET + 6)

/* ---------- stage2 职责编号 ---------- */
#define R10_CHECK_BOOT_INFO         10
#define R11_INIT_VGA                11
#define R12_RENDER_LOOP             12
#define R13_DELAY                   13
#define R14_FAIL_REPORT             14
#define R15_SERIAL_OUTPUT           15
#define R16_FRAME_GENERATE          16

/* ---------- stage2 错误码 0xRRFFTT ---------- */
#define ERR_R10_STAGE2_ENTRY_MISMATCH   0x0A0003
#define ERR_R10_MAPPED_BYTES_MISMATCH   0x0A0103
#define ERR_R11_VGA_INIT_FAIL           0x0B0004
#define ERR_R15_SERIAL_INIT_FAIL        0x0F0004
#define ERR_R16_FRAME_OVERFLOW          0x100002

/* ---------- 函数声明 ---------- */
uint32_t stage2_main(void);

#endif
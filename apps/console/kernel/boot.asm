; ============================================================
; aevum boot.asm (v3)
; 遵循: AEVUM BOOT 契约规则文档 v3
; 方针: 归属唯一、定位有码
; 关键变更 vs v2:
;   [1] R2 字段前置到 lgdt 之前写入 (第四节: 写入时机规则)
;   [2] R8 拆 R8_rm / R8_pm 两个入口 (第二节: 双入口说明)
;   [3] PML4 改名 PD (第三节/第六节/第十一节)
; ============================================================
[bits 16]
[org 0x7c00]

; ---------- boot info 基址 ----------
%define BOOT_INFO_BASE                      0x0500

; ---------- R1 ----------
%define R1_READ_DISK_OFF                    0x0000
%define R1_READ_DISK_STAGE2_SECTORS_READ    (BOOT_INFO_BASE + R1_READ_DISK_OFF + 0)
%define R1_READ_DISK_ERROR_CODE             (BOOT_INFO_BASE + R1_READ_DISK_OFF + 1)

; ---------- R2 ----------
%define R2_BUILD_GDT_OFF                    0x0010
%define R2_BUILD_GDT_PHYS                   (BOOT_INFO_BASE + R2_BUILD_GDT_OFF + 0)
%define R2_BUILD_GDT_LIMIT                  (BOOT_INFO_BASE + R2_BUILD_GDT_OFF + 4)
%define R2_BUILD_GDT_TEMPORARY              (BOOT_INFO_BASE + R2_BUILD_GDT_OFF + 6)

; ---------- R3 ----------
%define R3_ENTER_PM_OFF                     0x0020
%define R3_ENTER_PM_ENABLED                 (BOOT_INFO_BASE + R3_ENTER_PM_OFF + 0)

; ---------- R4 ----------
%define R4_BUILD_PAGETABLE_OFF              0x0030
%define R4_BUILD_PAGETABLE_PD_PHYS          (BOOT_INFO_BASE + R4_BUILD_PAGETABLE_OFF + 0)
%define R4_BUILD_PAGETABLE_PT0_PHYS         (BOOT_INFO_BASE + R4_BUILD_PAGETABLE_OFF + 4)
%define R4_BUILD_PAGETABLE_MAPPED_BYTES     (BOOT_INFO_BASE + R4_BUILD_PAGETABLE_OFF + 8)

; ---------- R5 ----------
%define R5_ENABLE_PAGING_OFF                0x0040
%define R5_ENABLE_PAGING_ENABLED            (BOOT_INFO_BASE + R5_ENABLE_PAGING_OFF + 0)

; ---------- R6 ----------
%define R6_SETUP_STACK_OFF                  0x0050
%define R6_SETUP_STACK_TOP                  (BOOT_INFO_BASE + R6_SETUP_STACK_OFF + 0)
%define R6_SETUP_STACK_LIMIT                (BOOT_INFO_BASE + R6_SETUP_STACK_OFF + 4)

; ---------- R7 ----------
%define R7_HANDOFF_OFF                      0x0060
%define R7_HANDOFF_STAGE2_ENTRY             (BOOT_INFO_BASE + R7_HANDOFF_OFF + 0)
%define R7_HANDOFF_IDT_READY                (BOOT_INFO_BASE + R7_HANDOFF_OFF + 4)
%define R7_HANDOFF_REGS_STATE_MASK          (BOOT_INFO_BASE + R7_HANDOFF_OFF + 5)

; ---------- R8 ----------
%define R8_FAIL_REPORT_OFF                  0x0070
%define R8_FAIL_REPORT_ERROR_CODE           (BOOT_INFO_BASE + R8_FAIL_REPORT_OFF + 0)
%define R8_FAIL_REPORT_ERROR_STAGE          (BOOT_INFO_BASE + R8_FAIL_REPORT_OFF + 4)
%define R8_FAIL_REPORT_ERROR_FIELD          (BOOT_INFO_BASE + R8_FAIL_REPORT_OFF + 5)
%define R8_FAIL_REPORT_ERROR_TYPE           (BOOT_INFO_BASE + R8_FAIL_REPORT_OFF + 6)

; ---------- R9 ----------
%define R9_A20_STATE_OFF                    0x0090
%define R9_A20_STATE_VALUE                  (BOOT_INFO_BASE + R9_A20_STATE_OFF + 0)

; ============================================================
; 错误码 (0xRRFFTT)
; ============================================================
%define ERR_R1_STAGE2_SECTORS_READ_EXT_FAIL  0x010004
%define ERR_R1_STAGE2_SECTORS_READ_DEP_UNMET 0x010003
%define ERR_R2_GDT_PHYS_DEP_UNMET            0x020003
%define ERR_R3_PM_ENABLED_EXT_FAIL           0x030004
%define ERR_R4_PD_PHYS_CONFLICT              0x040002
%define ERR_R5_PAGING_ENABLED_EXT_FAIL       0x050004
%define ERR_R6_STACK_LIMIT_DEP_UNMET         0x060003
%define ERR_R7_STAGE2_ENTRY_DEP_UNMET        0x070003
%define ERR_R9_A20_STATE_MISSING             0x090001

; ============================================================
; 布局常量
; ============================================================
%define R1_READ_DISK_STAGE2_LOAD_ADDR        0x1000
%define R1_READ_DISK_STAGE2_SECTORS          16
%define R1_READ_DISK_START_SECTOR            2

%define R2_BUILD_GDT_CODE_SEL                0x08
%define R2_BUILD_GDT_DATA_SEL                0x10

%define R4_BUILD_PAGETABLE_PD_ADDR           0x10000
%define R4_BUILD_PAGETABLE_PT0_ADDR          0x11000
%define R4_BUILD_PAGETABLE_PT_ENTRIES        1024
%define R4_BUILD_PAGETABLE_MAPPED_BYTES_VAL  (R4_BUILD_PAGETABLE_PT_ENTRIES * 0x1000)

%define R6_SETUP_STACK_TOP_VAL               0x7C00
%define R6_SETUP_STACK_LIMIT_VAL             0x7000

%define R9_A20_STATE_NOT_TESTED              0x03

%define R7_HANDOFF_REGS_STATE_EIP_VALID      0x02
%define R7_HANDOFF_IDT_NOT_READY             0x00

; ============================================================
; 实模式入口
; ============================================================
start:
    xor ax, ax
    mov ds, ax
    mov es, ax

    ; --- R9: A20 状态 (NOT_TESTED, 非假设) ---
    mov byte [R9_A20_STATE_VALUE], R9_A20_STATE_NOT_TESTED

    ; --- R2: 建立临时 GDT 字段 ---
    ; 依据 v3 第四节: R2 字段先于 lgdt 写入
    ; 理由: lgdt 之后 GDT 即被使用; 事后补写会让记录失真
    mov eax, R2_build_gdt_start
    mov [R2_BUILD_GDT_PHYS], eax
    mov eax, (R2_build_gdt_end - R2_build_gdt_start - 1)
    mov [R2_BUILD_GDT_LIMIT], eax
    mov byte [R2_BUILD_GDT_TEMPORARY], 1

    ; --- R1: 读盘加载 stage2 ---
    mov bx, R1_READ_DISK_STAGE2_LOAD_ADDR
    mov ah, 0x02
    mov al, R1_READ_DISK_STAGE2_SECTORS
    mov ch, 0
    mov cl, R1_READ_DISK_START_SECTOR
    mov dh, 0
    int 0x13
    jc R1_read_disk_external_fail
    mov [R1_READ_DISK_STAGE2_SECTORS_READ], al
    cmp al, R1_READ_DISK_STAGE2_SECTORS
    jb R1_read_disk_dep_unmet

    ; --- R3: 切换到保护模式 ---
    cli
    lgdt [R2_build_gdt_descriptor]
    mov eax, cr0
    or eax, 1
    mov cr0, eax
    jmp R2_BUILD_GDT_CODE_SEL:R3_enter_pm_entry

R1_read_disk_external_fail:
    mov [R1_READ_DISK_ERROR_CODE], ah
    mov eax, ERR_R1_STAGE2_SECTORS_READ_EXT_FAIL
    jmp R8_fail_report_rm

R1_read_disk_dep_unmet:
    mov eax, ERR_R1_STAGE2_SECTORS_READ_DEP_UNMET
    jmp R8_fail_report_rm

; ============================================================
; R8_rm: 实模式失败汇聚入口 (16 位指令)
; 入参: EAX = 0x00RRFFTT
; 数据布局与 R8_pm 完全相同
; ============================================================
R8_fail_report_rm:
    ; 32 位错误码分两次写 (实模式不能 A3 吃 4 字节偏移)
    mov [R8_FAIL_REPORT_ERROR_CODE], ax
    mov ebx, eax
    shr ebx, 16
    mov [R8_FAIL_REPORT_ERROR_CODE + 2], bx
    ; 拆分: AL=TT, AH=FF, BL=RR
    mov [R8_FAIL_REPORT_ERROR_TYPE], al
    mov [R8_FAIL_REPORT_ERROR_FIELD], ah
    mov [R8_FAIL_REPORT_ERROR_STAGE], bl
    cli
    hlt

; ============================================================
; 保护模式入口
; ============================================================
[bits 32]
R3_enter_pm_entry:
    mov ax, R2_BUILD_GDT_DATA_SEL
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov esp, R6_SETUP_STACK_TOP_VAL

    ; --- R3: 标记保护模式已完成 ---
    ; 动作成功后写 (见文末"语义澄清")
    mov byte [R3_ENTER_PM_ENABLED], 1

    ; --- R6: 栈契约字段 ---
    mov dword [R6_SETUP_STACK_TOP], R6_SETUP_STACK_TOP_VAL
    mov dword [R6_SETUP_STACK_LIMIT], R6_SETUP_STACK_LIMIT_VAL

    ; --- R4: 建立初始页表 (先于开分页写入) ---
    mov edi, R4_BUILD_PAGETABLE_PD_ADDR
    mov ecx, 1024
    xor eax, eax
    rep stosd

    mov dword [R4_BUILD_PAGETABLE_PD_ADDR], (R4_BUILD_PAGETABLE_PT0_ADDR | 0x03)

    mov edi, R4_BUILD_PAGETABLE_PT0_ADDR
    mov ecx, 1024
    xor eax, eax
    rep stosd

    mov ebx, R4_BUILD_PAGETABLE_PT0_ADDR
    mov eax, 0x00000003
    mov ecx, R4_BUILD_PAGETABLE_PT_ENTRIES
R4_build_pagetable_fill_pt:
    mov [ebx], eax
    add ebx, 4
    add eax, 0x1000
    loop R4_build_pagetable_fill_pt

    mov dword [R4_BUILD_PAGETABLE_PD_PHYS], R4_BUILD_PAGETABLE_PD_ADDR
    mov dword [R4_BUILD_PAGETABLE_PT0_PHYS], R4_BUILD_PAGETABLE_PT0_ADDR
    mov dword [R4_BUILD_PAGETABLE_MAPPED_BYTES], R4_BUILD_PAGETABLE_MAPPED_BYTES_VAL

    ; --- R5: 开启分页 ---
    mov eax, R4_BUILD_PAGETABLE_PD_ADDR
    mov cr3, eax
    mov eax, cr0
    or eax, 0x80000000
    mov cr0, eax
    ; 动作成功后写
    mov byte [R5_ENABLE_PAGING_ENABLED], 1

    ; --- R7: 交接 ---
    mov dword [R7_HANDOFF_STAGE2_ENTRY], R1_READ_DISK_STAGE2_LOAD_ADDR
    mov byte [R7_HANDOFF_IDT_READY], R7_HANDOFF_IDT_NOT_READY
    mov byte [R7_HANDOFF_REGS_STATE_MASK], R7_HANDOFF_REGS_STATE_EIP_VALID

    jmp R2_BUILD_GDT_CODE_SEL:R1_READ_DISK_STAGE2_LOAD_ADDR

; ============================================================
; R8_pm: 保护模式失败汇聚入口 (32 位指令)
; 入参: EAX = 0x00RRFFTT
; 数据布局与 R8_rm 完全相同
; ============================================================
R8_fail_report_pm:
    mov [R8_FAIL_REPORT_ERROR_CODE], eax
    mov ebx, eax
    shr ebx, 16
    mov [R8_FAIL_REPORT_ERROR_STAGE], bl
    mov ebx, eax
    shr ebx, 8
    mov [R8_FAIL_REPORT_ERROR_FIELD], bl
    mov [R8_FAIL_REPORT_ERROR_TYPE], al
    cli
    hlt

; ============================================================
; R2 静态数据: 临时 GDT
; 失效点: stage2 重建 GDT 并重载 CS/DS/ES/SS 后, 0x7C00 附近可覆盖
; ============================================================
R2_build_gdt_start:
    dq 0
R2_build_gdt_code:
    dw 0xffff
    dw 0
    db 0
    db 0x9a
    db 0xcf
    db 0
R2_build_gdt_data:
    dw 0xffff
    dw 0
    db 0
    db 0x92
    db 0xcf
    db 0
R2_build_gdt_end:

R2_build_gdt_descriptor:
    dw R2_build_gdt_end - R2_build_gdt_start - 1
    dd R2_build_gdt_start

times 510 - ($ - $$) db 0
dw 0xaa55
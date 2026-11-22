; ============================================================
; Aevum boot common
; boot.asm 的公共引导实现：
;   - 临时 GDT
;   - 16 位 -> 32 位保护模式切换
;   - 0x10000 页目录 + 0x11000 页表，0..4MB 恒等映射
; 读盘方式、失败消息由 boot.asm 自己负责。
; 调用者必须在文件末尾展开 BOOT_GDT_DATA / BOOT_PRINT_RM。
; ============================================================

%define BOOT_GDT_CODE_SEL   0x08
%define BOOT_GDT_DATA_SEL   0x10

%define BOOT_STACK_TOP      0x7C00
%define BOOT_PD_ADDR        0x10000
%define BOOT_PT0_ADDR       0x11000
%define BOOT_PT_ENTRIES     1024
%define BOOT_MAPPED_BYTES   (BOOT_PT_ENTRIES * 0x1000)

; 从 16 位实模式进入保护模式，建立数据段和栈。
; 展开后当前段变为 32 位；调用者继续写自己的字段/页表。
%macro BOOT_ENTER_PM 0
    cli
    lgdt [boot_gdt_descriptor]
    mov eax, cr0
    or eax, 1
    mov cr0, eax
    jmp BOOT_GDT_CODE_SEL:%%pm_entry
[bits 32]
%%pm_entry:
    mov ax, BOOT_GDT_DATA_SEL
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov esp, BOOT_STACK_TOP
%endmacro

; 建立 0x10000 页目录 + 0x11000 页表，映射 0..4MB 恒等。
%macro BOOT_BUILD_PAGETABLE 0
    mov edi, BOOT_PD_ADDR
    mov ecx, 1024
    xor eax, eax
    rep stosd

    mov dword [BOOT_PD_ADDR], (BOOT_PT0_ADDR | 0x03)

    mov edi, BOOT_PT0_ADDR
    mov ecx, 1024
    xor eax, eax
    rep stosd

    mov ebx, BOOT_PT0_ADDR
    mov eax, 0x00000003
    mov ecx, BOOT_PT_ENTRIES
%%fill_pt:
    mov [ebx], eax
    add ebx, 4
    add eax, 0x1000
    loop %%fill_pt
%endmacro

%macro BOOT_ENABLE_PAGING 0
    mov eax, BOOT_PD_ADDR
    mov cr3, eax
    mov eax, cr0
    or eax, 0x80000000
    mov cr0, eax
%endmacro

; GDT 数据：调用者放在文件末尾，避免执行流落入数据。
%macro BOOT_GDT_DATA 0
align 4
boot_gdt_start:
    dq 0
boot_gdt_code:
    dw 0xffff
    dw 0
    db 0
    db 0x9a
    db 0xcf
    db 0
boot_gdt_data:
    dw 0xffff
    dw 0
    db 0
    db 0x92
    db 0xcf
    db 0
boot_gdt_end:
boot_gdt_descriptor:
    dw boot_gdt_end - boot_gdt_start - 1
    dd boot_gdt_start
%endmacro

; BIOS teletype 打印，DS:SI 指向 0 结尾字符串。
; 这段代码必须按 16 位汇编，调用点必须仍在实模式。
%macro BOOT_PRINT_RM 0
[bits 16]
boot_print_rm:
    mov ah, 0x0E
    mov bx, 0x0007
%%next:
    lodsb
    test al, al
    jz %%done
    int 0x10
    jmp %%next
%%done:
    ret
%endmacro

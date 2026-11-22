; boot.asm 主引导扇区 512字节
[bits 16]
[org 0x7c00]

start:
    mov ax, 0
    mov ds, ax
    mov es, ax
    ; 76 个扇区一次 LBA 读到 0x80000。内核不再落在 BIOS 低内存暂存区，
    ; 也不会覆盖正在执行的 boot 代码。
    mov ah, 0x42
    mov si, dap
    mov dl, 0x80
    int 0x13
    jc disk_error       ; 读盘失败跳转


    cli 
    lgdt [gdt_desc]

    mov eax, cr0
    or eax, 1
    mov cr0, eax

    jmp 0x08:pm_entry   ; 远跳转，刷新CS进入保护模式

[bits 32]
pm_entry:
    mov ax, 0x10
    mov ds, ax
    mov es, ax
    mov ss, ax
    mov esp, 0x7c00

    ; 清空页目录 0x10000
    mov edi, 0x10000
    mov ecx, 1024
    xor eax, eax
    rep stosd

    ; 页目录第0项：指向页表0x11000，Present+RW
    mov dword [0x10000], 0x11003

    ; 清空页表 0x11000
    mov edi, 0x11000
    mov ecx, 1024
    xor eax, eax
    rep stosd

    ; 填充页表：映射虚拟地址0~4MB 到物理地址0~4MB
    mov ebx, 0x11000
    mov eax, 0x00000003
    mov ecx, 1024
fill_pt:
    mov [ebx], eax
    add ebx, 4
    add eax, 0x1000
    loop fill_pt

    mov eax, 0x10000
    mov cr3, eax        ; CR3 = 页目录物理地址

    mov eax, cr0
    or eax, 0x80000000
    mov cr0, eax        ; 开启分页

    jmp dword 0x08:0x80000 ; 跳到 0x80000 的内核入口

disk_error:
    cli
    hlt

align 4
dap:
    db 0x10, 0
    dw 76
    dw 0x0000
    dw 0x8000
    dq 1

gdt_start:
    dq 0
gdt_code:
    dw 0xffff
    dw 0
    db 0
    db 0x9a
    db 0xcf
    db 0
gdt_data:
    dw 0xffff
    dw 0
    db 0
    db 0x92
    db 0xcf
    db 0
gdt_end:

gdt_desc:
    dw gdt_end - gdt_start - 1
    dd gdt_start

times 510 - ($-$$) db 0
dw 0xaa55
; boot.asm 主引导扇区 512字节
[bits 16]
[org 0x7c00]

start:
    mov ax, 0
    mov es, ax
    mov bx, 0x1000      ; 把第二阶段加载到物理地址0x1000
    mov ah, 0x02        ; BIOS读扇区
    mov al, 40          ; 读取40个扇区(20KB)，内核镜像上限0x6000
    mov ch, 0           ; 磁道0
    mov cl, 2           ; 从第2扇区读取（扇区1是当前引导扇区）
    mov dh, 0           ; 磁头0
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

    jmp 0x08:0x1000     ; 跳到第二阶段内核代码！

disk_error:
    cli
    hlt

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
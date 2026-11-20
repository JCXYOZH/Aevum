; loader.asm [bits 32]
[bits 32]
global start
global irq0_stub
global int40_stub
extern kernel_main
extern task_schedule_irq
extern __bss_start
extern __bss_end

section .text
start:
    ; BSS 可能越过 boot 读取的扇区窗口，加载后必须由内核自己清零。
    cld
    mov edi, __bss_start
    mov ecx, __bss_end
    sub ecx, edi
    xor eax, eax
    rep stosb

    ; 任务栈从 0x7000 起，会覆盖引导扇区 0x7c97 的 GDT；先搬到 0x12800 再加载。
    mov esi, 0x7c97
    mov edi, 0x12800
    mov ecx, 24
    rep movsb
    lgdt [gdtr_new]

    ; 设置C代码栈
    mov esp, 0xB000
    call kernel_main

; 死循环，内核返回就停机
hang_loop:
    hlt
    jmp hang_loop

; IRQ0：CPU 已压入 EFLAGS/CS/EIP，这里补 error 和 vector。
irq0_stub:
    push dword 0
    push dword 0x20
    jmp irq_common

; 软件调度门：task_yield/task_block/task_exit/task_start 共用。
int40_stub:
    push dword 0
    push dword 0x40
    jmp irq_common

; 统一帧布局（低地址到高地址）：
; eax ebx ecx edx esi edi ebp vector err eip cs eflags
; task_schedule_irq 返回下一个任务的帧指针，恢复后 iret 进入该任务。
irq_common:
    push ebp
    push edi
    push esi
    push edx
    push ecx
    push ebx
    push eax
    mov eax, esp
    push eax
    call task_schedule_irq
    add esp, 4
    mov esp, eax
    pop eax
    pop ebx
    pop ecx
    pop edx
    pop esi
    pop edi
    pop ebp
    add esp, 8
    iret

; 新 GDT 位于 IDT(0x12000..0x127FF) 之后的 0x12800。
section .data
gdtr_new:
    dw 0x17
    dd 0x12800

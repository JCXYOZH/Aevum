; loader.asm [bits 32]
[bits 32]
global start
extern kernel_main
extern __bss_start
extern __bss_end

section .text
start:
    ; BSS 可能越过 boot 读取的 32 扇区窗口，加载后必须由内核自己清零。
    cld
    mov edi, __bss_start
    mov ecx, __bss_end
    sub ecx, edi
    xor eax, eax
    rep stosb

    ; 设置C代码栈
    mov esp, 0xA000
    call kernel_main

; 死循环，内核返回就停机
hang_loop:
    hlt
    jmp hang_loop

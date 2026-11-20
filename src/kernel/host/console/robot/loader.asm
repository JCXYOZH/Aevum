; loader.asm [bits 32]
[bits 32]
global start
extern kernel_main   ; 改成下划线版本！

section .text
start:
    ; 设置C代码栈
    mov esp, 0x9000
    call kernel_main

; 死循环，内核返回就停机
hang_loop:
    hlt
    jmp hang_loop

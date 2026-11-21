; ring3.asm：被复制进每个用户地址空间 0x400000 的同一段代码。
; 它只使用固定虚拟地址：0x401000 计数器、0x403000 停止字。
[bits 32]
section .text
global user_program_start
global user_program_end

user_program_start:
    mov eax, [0x401000]
    inc eax
    mov [0x401000], eax
    cmp dword [0x403000], 0
    jne .done
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp user_program_start

.done:
    mov eax, 3              ; syscall: exit
    int 0x80
.hang:
    jmp .hang

user_program_end:

; ring3.asm：被复制进每个用户地址空间 0x400000 的同一段代码。
; 固定虚拟地址：0x401000 计数器，0x401004 模式，0x403000 停止字。
; 模式 0：正常计数并让出；模式 1：计数到 20000 后故意写内核显存 0xB8000，
; 由 #PF 只杀死这个进程，其他用户进程继续运行。
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

    cmp dword [0x401004], 0
    je .yield
    cmp eax, 20000
    jb .yield

    mov eax, 0xB8000
    mov dword [eax], 0xDEADBEEF

.yield:
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp user_program_start

.done:
    mov eax, 3              ; syscall: exit
    int 0x80
.hang:
    jmp .hang

user_program_end:

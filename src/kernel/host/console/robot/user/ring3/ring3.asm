; ring3.asm：被复制进每个用户地址空间 0x400000 的同一段代码。
; 固定虚拟地址：0x401000 计数器，0x401004 模式，0x401008 fork 状态，
; 0x40100C child pid，0x401010 wait status，0x401014 wait 返回值，
; 0x401018 status 副本，0x40101C "OK" 魔数，0x403000 停止字。
; 模式 0：正常计数并让出。
; 模式 1：计数到 20000 后写内核显存 0xB8000，由 #PF 只杀死这个进程。
; 模式 2：fork 一个子进程，子进程 exit(7)，父进程 wait 并记录 status。
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

    cmp dword [0x401004], 1
    je .fault_mode
    cmp dword [0x401004], 2
    je .fork_mode

.yield:
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp user_program_start

.fault_mode:
    cmp eax, 20000
    jb .yield
    mov eax, 0xB8000
    mov dword [eax], 0xDEADBEEF
    jmp .yield

.fork_mode:
    cmp dword [0x401008], 0
    jne .yield              ; fork/wait 只做一次，之后继续计数

    mov dword [0x401008], 1
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child

    ; 父进程：保存 child pid，wait(child_pid, &status@0x401010)
    mov [0x40100C], eax
    mov ebx, eax
    mov ecx, 0x401010
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x401014], eax

    mov eax, [0x401010]
    mov [0x401018], eax
    cmp eax, 7
    jne .yield
    mov dword [0x40101C], 0x4B4F   ; "OK"
    jmp .yield

.child:
    mov eax, 3              ; syscall: exit
    mov ebx, 7
    int 0x80
.hang_child:
    jmp .hang_child

.done:
    mov eax, 3              ; syscall: exit
    xor ebx, ebx
    int 0x80
.hang:
    jmp .hang

user_program_end:

; exec_pipe.asm：P4.3 的 pipe 写端镜像，固定运行在 0x400000。
; argv={"pipe","writer","FD=3"}，从 FD= 后解析一个十进制 fd，写入 4 字节 "PIPE"。
; 成功 exit(12)；父进程 wait 12 并从自己的读端读回 PIPE，证明 fd 跨过 exec。
[bits 32]
section .text
global user_pipe_exec_start
global user_pipe_exec_end

user_pipe_exec_start:
    mov eax, 5              ; syscall: getpid
    int 0x80
    mov [0x401000], eax
    mov dword [0x401004], 0x45505049   ; "PIPE"
    mov [0x401014], esp

    mov eax, [esp]
    mov [0x401018], eax
    cmp eax, 3
    jne .bad_argc

    mov ebx, [esp + 4]      ; argv[0] = "pipe"
    test ebx, ebx
    jz .bad_argv0
    cmp dword [ebx], 0x65706970       ; "pipe"
    jne .bad_argv0
    cmp byte [ebx + 4], 0
    jne .bad_argv0

    mov ebx, [esp + 8]      ; argv[1] = "writer"
    test ebx, ebx
    jz .bad_argv1
    cmp dword [ebx], 0x74697277       ; "writ"
    jne .bad_argv1
    cmp word [ebx + 4], 0x7265        ; "er"
    jne .bad_argv1
    cmp byte [ebx + 6], 0
    jne .bad_argv1

    mov ebx, [esp + 12]     ; argv[2] = "FD=3"
    test ebx, ebx
    jz .bad_argv2
    cmp dword [ebx], 0x333D4446       ; "FD=3"
    jne .bad_argv2
    cmp byte [ebx + 4], 0
    jne .bad_argv2
    movzx eax, byte [ebx + 3]
    sub eax, 0x30
    cmp eax, 9
    ja .bad_fd
    mov [0x401008], eax

    mov dword [0x401020], 0x45505049  ; "PIPE" payload
    mov eax, 16             ; syscall: write(fd, "PIPE", 4)
    mov ebx, [0x401008]
    mov ecx, 0x401020
    mov edx, 4
    int 0x80
    mov [0x40100C], eax
    cmp eax, 4
    jne .bad_write
    mov dword [0x401010], 0x45505049

    mov eax, 3              ; syscall: exit(12)
    mov ebx, 12
    int 0x80
    jmp $

.bad_argc:
    mov ebx, 26
    jmp .bad_exit
.bad_argv0:
    mov ebx, 27
    jmp .bad_exit
.bad_argv1:
    mov ebx, 28
    jmp .bad_exit
.bad_argv2:
    mov ebx, 29
    jmp .bad_exit
.bad_fd:
    mov ebx, 30
    jmp .bad_exit
.bad_write:
    mov ebx, 31
.bad_exit:
    mov dword [0x401004], 0x424144    ; "BAD"
    mov eax, 3
    int 0x80
    jmp $

user_pipe_exec_end:

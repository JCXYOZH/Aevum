; exec.asm：P4.1 的第二个用户镜像，固定运行在 0x400000。
; 只验证 exec 后新地址空间、用户栈和 PID：写 EXEC 魔数、记录 esp，再让出若干次
; 给 V 页观察窗口，最后 exit(10)。父进程用 wait status 10 验收。
[bits 32]
section .text
global user_exec_start
global user_exec_end

user_exec_start:
    mov eax, 5              ; syscall: getpid
    int 0x80
    mov [0x401000], eax     ; 新镜像自己的 PID
    mov dword [0x401004], 0x45584543   ; "EXEC"
    mov [0x401008], esp     ; exec 后的用户栈顶应接近 0x404000

    mov ebx, 300
.exec_yield:
    mov eax, 2              ; syscall: yield
    int 0x80
    dec ebx
    jnz .exec_yield

    mov eax, 3              ; syscall: exit(10)
    mov ebx, 10
    int 0x80
    jmp $

user_exec_end:

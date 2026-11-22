; exec.asm：P4.2 的第二个用户镜像，固定运行在 0x400000。
; 新栈布局：argc, argv[], NULL, envp[], NULL, 字符串区。
; 镜像逐字节校验 alpha/beta 与 MODE=p42/LEVEL=2，全部匹配才 exit(10)；
; 父进程 wait 10 即证明 argv/envp 真跨过了 exec。
[bits 32]
section .text
global user_exec_start
global user_exec_end

user_exec_start:
    mov eax, 5              ; syscall: getpid
    int 0x80
    mov [0x401000], eax     ; 新镜像自己的 PID
    mov dword [0x401004], 0x45584543   ; "EXEC"
    mov [0x401008], esp     ; exec 后的用户栈顶

    mov eax, [esp]          ; argc
    mov [0x40100C], eax
    cmp eax, 2
    jne .bad_argc

    mov ebx, [esp + 4]      ; argv[0] = "alpha"
    test ebx, ebx
    jz .bad_argv0
    mov ecx, [ebx]
    cmp ecx, 0x68706C61               ; "alph"
    jne .bad_argv0
    cmp byte [ebx + 4], 0x61          ; 'a'
    jne .bad_argv0
    cmp byte [ebx + 5], 0
    jne .bad_argv0

    mov ebx, [esp + 8]      ; argv[1] = "beta"
    test ebx, ebx
    jz .bad_argv1
    cmp dword [ebx], 0x61746562       ; "beta"
    jne .bad_argv1
    cmp byte [ebx + 4], 0
    jne .bad_argv1
    cmp dword [esp + 12], 0           ; argv[2] = NULL
    jne .bad_argv1

    lea esi, [esp + eax * 4 + 8]      ; envp 起点 = esp + 4 + 4*(argc+1)
    mov edi, esi
    xor ecx, ecx
.env_count:
    cmp dword [esi], 0
    je .env_counted
    inc ecx
    add esi, 4
    cmp ecx, 4
    ja .bad_envc
    jmp .env_count
.env_counted:
    mov [0x401014], ecx
    cmp ecx, 2
    jne .bad_envc

    mov ebx, [edi]          ; envp[0] = "MODE=p42"
    test ebx, ebx
    jz .bad_env0
    cmp dword [ebx], 0x45444F4D       ; "MODE"
    jne .bad_env0
    cmp dword [ebx + 4], 0x3234703D   ; "=p42"
    jne .bad_env0
    cmp byte [ebx + 8], 0
    jne .bad_env0

    mov ebx, [edi + 4]      ; envp[1] = "LEVEL=2"
    test ebx, ebx
    jz .bad_env1
    cmp dword [ebx], 0x4556454C       ; "LEVE"
    jne .bad_env1
    cmp dword [ebx + 4], 0x00323D4C   ; "L=2\0"
    jne .bad_env1
    cmp dword [edi + 8], 0            ; envp[2] = NULL
    jne .bad_env1

    mov dword [0x401018], 0x41525647  ; "ARGV"
    mov dword [0x40101C], 0x454E5650  ; "ENVP"

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

.bad_argc:
    mov ebx, 20
    jmp .bad_exit
.bad_argv0:
    mov ebx, 21
    jmp .bad_exit
.bad_argv1:
    mov ebx, 22
    jmp .bad_exit
.bad_envc:
    mov ebx, 23
    jmp .bad_exit
.bad_env0:
    mov ebx, 24
    jmp .bad_exit
.bad_env1:
    mov ebx, 25
    jmp .bad_exit
.bad_exit:
    mov dword [0x401018], 0x424144    ; "BAD"
    mov dword [0x40101C], 0x424144    ; "BAD"
    mov eax, 3              ; syscall: exit(code in ebx)
    int 0x80
    jmp $

user_exec_end:

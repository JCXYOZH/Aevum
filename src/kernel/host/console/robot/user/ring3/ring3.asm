; ring3.asm：被复制进每个用户地址空间 0x400000 的同一段代码。
; 固定虚拟地址：0x401000 计数器，0x401004 模式，0x401008 fork 状态，
; 0x40100C child pid，0x401010 wait status，0x401014 wait 返回值，
; 0x401018 status 副本，0x40101C "OK" 魔数，0x401020 brk 返回值，
; 0x401024 heap peek，0x401028 heap poke，0x40102C guard poke，
; 0x401030 heap_once，0x401034 越界 brk 返回值，
; 0x401038 COW 魔数（父写 PAPA，子写 CHLD），0x40103C 父读回值，
; 0x401040 COW 验收字，0x401044 信号子进程 pid，0x401048 信号 wait status，
; 0x40104C SIG 验收字，0x401050 信号 wait 返回值，0x401054 handler 调用计数；
; 0x401058 exec 子进程 pid，0x40105C exec wait status，0x401060 exec 验收字，
; 0x401064 exec wait 返回值，0x401068 exec 只执行一次标记；
; 0x40106C pipe 读 fd，0x401070 pipe 写 fd，0x401074 pipe 返回值，
; 0x401078 父读回 4 字节，0x40107C pipe 验收字，0x401080 pipe 子进程 pid，
; 0x401084 pipe wait status，0x401088 pipe wait 返回值，0x40108C pipe 只执行一次标记，
; 0x401090 父 close 写端返回值，0x401094 父 close 读端返回值，0x401098 父 read 返回值；
; 0x4010A0 console 子进程 pid，0x4010A4 父 close fd0，0x4010A8 父 close fd1，
; 0x4010AC 父 read fd0，0x4010B0 父 write fd1，0x4010B4 console wait status，
; 0x4010B8 console wait 返回值，0x4010BC console 验收字，0x4010F0 console 只执行一次标记，
; 0x401120 console 输入缓冲，0x401130 console 输出构造缓冲；
; 0x4010C0 pool 子进程数量，0x4010C4 "POOL" 魔数，0x4010C8 pool 只执行一次标记，
; 0x4010D0 P5.2 fork/wait 前的 yield 计数，让子进程 ZOMBIE 可被 V 页观察；
; 0x401100..0x40111F pool 8 个子进程 pid；
; 0x404000 停止字。
; 布局：code 0x400000，data 0x401000，guard 0x402000（不映射），
; stack 0x403000，control 0x404000，heap 0x405000 起。
; 模式 0：正常计数、brk 扩堆、用 peek/poke 读写 heap，再 poke guard 失败。
; 模式 1：计数到 5000 后写内核显存 0xB8000，由 #PF 只杀死这个进程。
; 模式 2：fork 子进程1 写 CHLD 后 exit(7)，父 wait 并读回 PAPA；
;         再 fork 子进程2 安装 SIGFPE handler，div 0 后由 sigreturn 返回
;         除零后的指令，写 HAND 并 exit(9)。
; 模式 3：直接写 guard 0x402000，由 #PF 只杀死这个进程。
; 模式 4：父 fork 后先关闭自己的 fd0/fd1，子进程仍用继承端点读键盘并写 console；
;         父 wait 到 14 后写 "CON!" 并 exit(15)。
; 模式 5：池压力；父进程连续 fork 8 个子进程并全部保持存活，pid 写入
;         0x401100..0x40111F，count 0x4010C0，魔数 0x4010C4；停止后父 exit(16)、
;         子 exit(17)。本模式不 wait，仅验证任务/PROC/AS/栈池同时容纳 9 个用户进程。
[bits 32]
section .text
global user_program_start
global user_program_end
global user_sigreturn_trampoline

user_program_start:
    mov eax, [0x401000]
    inc eax
    mov [0x401000], eax

    cmp dword [0x404000], 0
    jne .done

    cmp dword [0x401004], 1
    je .fault_mode
    cmp dword [0x401004], 2
    je .fork_mode
    cmp dword [0x401004], 3
    je .guard_mode
    cmp dword [0x401004], 4
    je .console_mode
    cmp dword [0x401004], 5
    je .pool_mode

    ; 模式 0：只做一次 heap/guard 指针验收。
    cmp dword [0x401030], 0
    jne .yield
    mov dword [0x401030], 1

    mov eax, 8              ; syscall: brk(0x406000)
    mov ebx, 0x406000
    int 0x80
    mov [0x401020], eax

    mov eax, 10             ; syscall: poke(0x405800, "HELP")
    mov ebx, 0x405800
    mov ecx, 0x48454C50
    int 0x80
    mov [0x401028], eax

    mov eax, 9              ; syscall: peek(0x405800)
    mov ebx, 0x405800
    int 0x80
    mov [0x401024], eax

    mov eax, 8              ; syscall: brk(0x500000) must fail
    mov ebx, 0x500000
    int 0x80
    mov [0x401034], eax

    mov eax, 10             ; syscall: poke(guard 0x402000)
    mov ebx, 0x402000
    mov ecx, 0xDEADBEEF
    int 0x80
    mov [0x40102C], eax

.yield:
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp user_program_start

.fault_mode:
    cmp eax, 5000
    jb .yield
    mov eax, 0xB8000
    mov dword [eax], 0xDEADBEEF
    jmp .yield

.guard_mode:
    mov dword [0x402000], 0xB16B00B5
    jmp .yield

.fork_mode:
    cmp dword [0x401008], 0
    jne .yield              ; D 的 fork/wait 流程只进入一次，之后继续计数

    ; 第一轮：fork 前先写父侧魔数；fork 后父子共享同一数据物理页。
    mov dword [0x401038], 0x50415041   ; "PAPA"
    mov dword [0x401008], 1
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_exit

    ; 父进程：wait 前不写数据页，保留 COW 共享，等子进程先写 CHLD。
    ; P5.2：先让出若干轮，使子进程退出后短暂处于 ZOMBIE，供 V 页观察。
    mov ebx, eax
    mov dword [0x4010D0], 262144
.wait_gap:
    mov eax, 2              ; syscall: yield
    int 0x80
    dec dword [0x4010D0]
    jnz .wait_gap
    mov ecx, 0x401010
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x401014], eax

    ; wait 的 status 写回会先把父数据页拆成私有页；再读回 fork 前的 PAPA。
    mov eax, [0x401010]
    mov [0x401018], eax
    mov eax, [0x401038]
    mov [0x40103C], eax
    cmp eax, 0x50415041
    jne .cow_bad
    mov dword [0x401040], 0x434F57   ; "COW"
    mov eax, [0x40100C]
    cmp eax, 0
    jne .cow_bad
    mov [0x40100C], ebx             ; 保存 normal child pid
    cmp dword [0x401010], 7
    jne .no_wait_magic
    mov dword [0x40101C], 0x4B4F     ; "OK"
.no_wait_magic:

    ; 第二轮：fork 第二个子进程，让它安装 SIGFPE handler 后执行 1/0。
    mov dword [0x401008], 2
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_de

    mov ebx, eax
    mov [0x401044], ebx             ; signal child pid
    mov ecx, 0x401048
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x401050], eax

    mov eax, [0x401048]
    cmp eax, 9              ; handler 捕获 #DE 后子进程正常 exit(9)
    jne .sig_bad
    mov dword [0x40104C], 0x48414E44 ; "HAND"
    mov eax, [0x401038]
    cmp eax, 0x50415041
    jne .cow_bad

    ; 第三轮：fork 子进程执行 exec(1)。新镜像写 EXEC 后 yield 若干次，
    ; 最后 exit(10)；父进程 wait 到 10 后写 EXEC 验收字。
    cmp dword [0x401068], 0
    jne .pipe_round
    mov dword [0x401068], 1
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_exec

    mov ebx, eax
    mov [0x401058], ebx             ; exec child pid
    mov ecx, 0x40105C
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x401064], eax
    cmp dword [0x40105C], 10
    jne .exec_bad
    mov dword [0x401060], 0x45584543 ; "EXEC"

    ; 第四轮：父建 pipe，fork 后父留读端、子留写端并 exec(2)。
    ; 新镜像向写端写 PIPE 后 exit(12)，父 wait 后读回并关闭两端。
.pipe_round:
    cmp dword [0x40108C], 0
    jne .yield
    mov dword [0x40108C], 1
    mov eax, 14             ; syscall: pipe(&read_fd)
    mov ebx, 0x40106C
    int 0x80
    mov [0x401074], eax
    test eax, eax
    jnz .pipe_bad
    cmp dword [0x40106C], 2
    jne .pipe_bad
    cmp dword [0x401070], 3
    jne .pipe_bad

    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_pipe_exec

    mov [0x401080], eax             ; pipe child pid
    mov eax, 17             ; 父关闭写端 3
    mov ebx, [0x401070]
    int 0x80
    mov [0x401090], eax

    mov ebx, [0x401080]
    mov ecx, 0x401084
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x401088], eax
    cmp dword [0x401084], 12
    jne .pipe_bad

    mov eax, 15             ; syscall: read(read_fd, buf, 4)
    mov ebx, [0x40106C]
    mov ecx, 0x401078
    mov edx, 4
    int 0x80
    mov [0x401098], eax
    cmp eax, 4
    jne .pipe_bad
    cmp dword [0x401078], 0x45505049 ; "PIPE"
    jne .pipe_bad

    mov eax, 17             ; 父关闭读端
    mov ebx, [0x40106C]
    int 0x80
    mov [0x401094], eax
    test eax, eax
    jnz .pipe_bad
    mov dword [0x40107C], 0x45505049
    jmp .yield

.pipe_bad:
    mov dword [0x40107C], 0x424144   ; "BAD"
    jmp .yield

.exec_bad:
    mov dword [0x401060], 0x424144   ; "BAD"
    jmp .yield

.child_pipe_exec:
    mov eax, 17             ; 子关闭继承来的读端 2
    mov ebx, [0x40106C]
    int 0x80
    mov eax, 13             ; syscall: exec(2, pipe_argv, NULL)
    mov ebx, 2
    mov ecx, pipe_exec_argv - user_program_start + 0x400000
    xor edx, edx
    int 0x80
    mov eax, 3              ; exec 失败 exit(13)
    mov ebx, 13
    int 0x80
    jmp $

.child_exec:
    mov eax, 13             ; syscall: exec(1, argv, envp)
    mov ebx, 1
    mov ecx, exec_argv - user_program_start + 0x400000
    mov edx, exec_envp - user_program_start + 0x400000
    int 0x80
    test eax, eax
    jnz .child_exec_bad
    jmp $                   ; exec 成功不会返回

.child_exec_bad:
    mov eax, 3              ; syscall: exit(11)
    mov ebx, 11
    int 0x80

.cow_bad:
    mov dword [0x401040], 0x424144   ; "BAD"
    jmp .yield

.sig_bad:
    mov dword [0x40104C], 0x424144   ; "BAD"
    jmp .yield

; P4.4：父进程先 fork，再关闭自己的 fd0/fd1；子进程用继承端点继续读 console。
.console_mode:
    cmp dword [0x4010F0], 0
    jne .yield
    mov dword [0x4010F0], 1

    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .console_child

    ; 父进程：关闭自己的 0/1 后，read/write 必须失败，但子句柄不受影响。
    mov [0x4010A0], eax
    mov eax, 17
    xor ebx, ebx
    int 0x80
    mov [0x4010A4], eax

    mov eax, 17
    mov ebx, 1
    int 0x80
    mov [0x4010A8], eax

    mov eax, 15
    xor ebx, ebx
    mov ecx, 0x401120
    mov edx, 1
    int 0x80
    mov [0x4010AC], eax

    mov eax, 16
    mov ebx, 1
    mov ecx, console_text - user_program_start + 0x400000
    mov edx, console_text_end - console_text
    int 0x80
    mov [0x4010B0], eax

    ; 父进程不 wait：关闭自己的 0/1 后保持存活，子进程继续用继承端点。
    mov dword [0x4010BC], 0x214E4F43 ; "CON!"
.console_parent_hold:
    cmp dword [0x404000], 0
    jne .console_parent_stop
    mov eax, 2
    int 0x80
    jmp .console_parent_hold

.console_parent_stop:
    mov eax, 3
    mov ebx, 16
    int 0x80
    jmp .hang

.console_child:
    mov eax, 15             ; syscall: read(fd0, buf, 1)
    xor ebx, ebx
    mov ecx, 0x401120
    mov edx, 1
    int 0x80
    cmp eax, 1
    je .console_child_got
    cmp dword [0x404000], 0
    jne .console_child_stop
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .console_child

.console_child_got:
    mov byte [0x401130], 'C'
    mov byte [0x401131], 'O'
    mov byte [0x401132], 'N'
    mov byte [0x401133], ':'
    mov al, [0x401120]
    mov [0x401134], al
    mov byte [0x401135], 10
    mov eax, 16             ; syscall: write(fd1, "CON:<key>\n", 6)
    mov ebx, 1
    mov ecx, 0x401130
    mov edx, 6
    int 0x80
    cmp eax, 6
    jne .console_child_bad

    mov eax, 16             ; syscall: write(fd1, "FD01 OK\n", 8)
    mov ebx, 1
    mov ecx, console_tail - user_program_start + 0x400000
    mov edx, console_tail_end - console_tail
    int 0x80
    cmp eax, 8
    jne .console_child_bad

    mov eax, 3
    mov ebx, 14
    int 0x80
    jmp .hang

.console_child_bad:
    mov eax, 3
    mov ebx, 15
    int 0x80
    jmp .hang

.console_child_stop:
    mov eax, 3
    mov ebx, 16
    int 0x80
    jmp .hang

; P5.1：一个父进程连续 fork 8 个孩子，全部保持 READY/可调度，
; 用来同时压 task 槽、PROC 槽、AS 槽和内核栈池。
.pool_mode:
    cmp dword [0x4010C8], 0
    jne .yield              ; 父子都只执行一次；孩子 fork 返回后直接进 hold
    mov dword [0x4010C8], 1
    mov dword [0x4010C0], 0

.pool_fork:
    cmp dword [0x4010C0], 8
    jae .pool_parent
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .pool_child
    mov ecx, [0x4010C0]
    mov [0x401100 + ecx * 4], eax
    inc dword [0x4010C0]
    jmp .pool_fork

.pool_parent:
    mov dword [0x4010C4], 0x4C4F4F50 ; "POOL"
.pool_parent_hold:
    cmp dword [0x404000], 0
    jne .pool_parent_stop
    mov eax, 2
    int 0x80
    jmp .pool_parent_hold

.pool_parent_stop:
    mov eax, 3
    mov ebx, 16
    int 0x80
    jmp .hang

.pool_child:
    cmp dword [0x404000], 0
    jne .pool_child_stop
    mov eax, 2
    int 0x80
    jmp .pool_child

.pool_child_stop:
    mov eax, 3
    mov ebx, 17
    int 0x80
    jmp .hang

.child_exit:
    mov dword [0x401038], 0x43484C44   ; "CHLD"，触发子侧 COW 拆分
    mov eax, 3              ; syscall: exit
    mov ebx, 7
    int 0x80
.hang_child:
    jmp .hang_child

.child_de:
    mov dword [0x401038], 0x53494746   ; "SIGF"，写父页后触发 COW
    mov eax, 11             ; syscall: sigaction(SIGFPE, handler, 0)
    mov ebx, 8
    mov ecx, user_fpe_handler - user_program_start + 0x400000
    xor edx, edx
    int 0x80
    test eax, eax
    jnz .sig_install_bad

    xor edx, edx
    mov eax, 1
    xor ecx, ecx
    div ecx                 ; #DE -> 内核投递 signal frame
    cmp dword [0x401054], 1 ; handler 已执行一次
    jne .sig_handler_bad
    mov eax, 3              ; syscall: exit(9)
    mov ebx, 9
    int 0x80
.sig_install_bad:
    mov eax, 3
    mov ebx, 10
    int 0x80
.sig_handler_bad:
    mov eax, 3
    mov ebx, 11
    int 0x80

.done:
    mov eax, 3              ; syscall: exit
    xor ebx, ebx
    int 0x80
.hang:
    jmp .hang

; signal frame 第一个槽是 trampoline 返回地址；handler 用 ret 进入这里。
; 此时用户 ESP 指向 frame 的保存 GPR 区，sigreturn 从这里恢复原 iret 帧。
; 放在所有 user_program_start 本地标签之后，避免改变 .done/.hang 的标签作用域。
user_fpe_handler:
    inc dword [0x401054]
    ret

user_sigreturn_trampoline:
    mov eax, 12             ; syscall: sigreturn
    int 0x80
.hang_sigreturn:
    jmp .hang_sigreturn

; P4.2 参数样本；数组与字符串都在只读 code 页，指针按镜像基址 0x400000 重定位。
exec_argv:
    dd exec_arg0 - user_program_start + 0x400000
    dd exec_arg1 - user_program_start + 0x400000
    dd 0
exec_envp:
    dd exec_env0 - user_program_start + 0x400000
    dd exec_env1 - user_program_start + 0x400000
    dd 0
exec_arg0:
    db "alpha", 0
exec_arg1:
    db "beta", 0
exec_env0:
    db "MODE=p42", 0
exec_env1:
    db "LEVEL=2", 0

; P4.3 pipe 写端样本；FD=3 对应 pipe() 的最低写端分配。
pipe_exec_argv:
    dd pipe_arg0 - user_program_start + 0x400000
    dd pipe_arg1 - user_program_start + 0x400000
    dd pipe_arg2 - user_program_start + 0x400000
    dd 0
pipe_arg0:
    db "pipe", 0
pipe_arg1:
    db "writer", 0
pipe_arg2:
    db "FD=3", 0

; P4.4 console 文本：父 write 到已关闭 fd1 用于验证失败；子写尾标记。
console_text:
    db "PARENT", 10
console_text_end:
console_tail:
    db "FD01 OK", 10
console_tail_end:

user_program_end:

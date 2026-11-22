; ring3.asm：被复制进每个用户地址空间 0x400000 的同一段代码。
; 固定虚拟地址：0x401000 计数器，0x401004 模式，0x401008 fork 状态，
; 0x40100C child pid，0x401010 wait status，0x401014 wait 返回值，
; 0x401018 status 副本，0x40101C "OK" 魔数，0x401020 brk 返回值，
; 0x401024 heap peek，0x401028 heap poke，0x40102C guard poke，
; 0x401030 heap_once，0x401034 越界 brk 返回值，
; 0x401038 COW 魔数（父写 PAPA，子写 CHLD），0x40103C 父读回值，
; 0x401040 COW 验收字，0x401044 信号子进程 pid，0x401048 信号 wait status，
; 0x40104C SIG 验收字，0x401050 信号 wait 返回值，0x401054 handler 调用计数；
; 0x404000 停止字。
; 布局：code 0x400000，data 0x401000，guard 0x402000（不映射），
; stack 0x403000，control 0x404000，heap 0x405000 起。
; 模式 0：正常计数、brk 扩堆、用 peek/poke 读写 heap，再 poke guard 失败。
; 模式 1：计数到 5000 后写内核显存 0xB8000，由 #PF 只杀死这个进程。
; 模式 2：fork 子进程1 写 CHLD 后 exit(7)，父 wait 并读回 PAPA；
;         再 fork 子进程2 安装 SIGFPE handler，div 0 后由 sigreturn 返回
;         除零后的指令，写 HAND 并 exit(9)。
; 模式 3：直接写 guard 0x402000，由 #PF 只杀死这个进程。
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
    jne .yield              ; 两轮 fork/wait 只做一次，之后继续计数

    ; 第一轮：fork 前先写父侧魔数；fork 后父子共享同一数据物理页。
    mov dword [0x401038], 0x50415041   ; "PAPA"
    mov dword [0x401008], 1
    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_exit

    ; 父进程：wait 前不写数据页，保留 COW 共享，等子进程先写 CHLD。
    mov ebx, eax
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
    jmp .yield

.cow_bad:
    mov dword [0x401040], 0x424144   ; "BAD"
    jmp .yield

.sig_bad:
    mov dword [0x40104C], 0x424144   ; "BAD"
    jmp .yield

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

user_program_end:

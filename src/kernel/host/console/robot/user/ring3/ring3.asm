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
; 0x401140 spawn 只执行一次，0x401144 spawn 子 PID，0x401148 spawn wait status，
; 0x40114C spawn wait 返回值，0x401150 spawn 验收字；
; 0x401154 thread 只执行一次，0x401158 thread TID，0x40115C thread join status，
; 0x401160 共享计数器，0x401164 worker TID，0x401168 worker 完成标记，
; 0x40116C thread join 返回值，0x401170 "THRD" 验收字；
; 0x401174 detached worker TID，0x401178 detached 共享计数器，
; 0x40117C detached worker 的 thread_detach 返回值，0x401180 detached 完成标记，
; 0x401184 detached worker gettid，0x401188 detached join 返回值，
; 0x40118C "DETD" 验收字；
; 0x4011BC "EDGE" 非法参数验收字；
; 0x4011C0 P7.3 fork 只执行一次，0x4011C4 "MTHR" 主线程先退验收字；
; 子进程内部：0x401190 主 TID、0x401194 worker TID、0x401198 共享计数、
; 0x40119C 主线程已置退出标记、0x4011A0 worker join 主线程的 status、
; 0x4011A4 join 返回值、0x4011A8 worker gettid、0x4011AC worker 验收字；
; 父进程：0x4011B0 子 PID、0x4011B4 wait status、0x4011B8 wait 返回值；
; 0x401100..0x40111F pool 8 个子进程 pid；
; stress 复用 0x4010C0 round、0x4010C4 "POOL" 完成魔数、0x4010C8 只执行一次，
; 0x401100 first PID、0x401104 last PID、0x401108 wait status；
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
; 模式 6：P5.3 压测；父进程连续 100 轮 fork，子进程 exit(7)，父 wait 校验
;         返回 PID 与 status，首末 PID 应相同（PID 复用），轮次/首末 PID 写 0x4010C0/0x401100/0x401104；
;         完成后保持存活供页面读取，停止时父 exit(18)。
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
    cmp dword [0x401004], 6
    je .stress_mode

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
    jne .spawn_round
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

; P7.0：不经过 fork，直接从当前进程 spawn 一个新进程。
; 参数数组仍复用只读 code 页里的 exec_argv/exec_envp；子进程拿到独立 AS，
; 运行 image 1，校验 alpha/beta 与 MODE=p42/LEVEL=2 后 exit(10)。
.spawn_round:
    cmp dword [0x401140], 0
    jne .thread_round
    mov dword [0x401140], 1
    mov eax, 18             ; syscall: spawn(1, argv, envp)
    mov ebx, 1
    mov ecx, exec_argv - user_program_start + 0x400000
    mov edx, exec_envp - user_program_start + 0x400000
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .spawn_bad
    mov [0x401144], eax
    mov ebx, eax
    mov ecx, 0x401148
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x40114C], eax
    cmp dword [0x401148], 10
    jne .spawn_bad
    mov dword [0x401150], 0x5350574E ; "SPWN"
    jmp .thread_round

.spawn_bad:
    mov dword [0x401150], 0x424144   ; "BAD"
    jmp .thread_round

; P7.1：clone 一个共享 AS/fd 的线程。线程从 eax 拿到共享计数器地址，
; 写一次后 gettid、置完成标记并 thread_exit；主线程 join 后写 "THRD"。
.thread_round:
    cmp dword [0x401154], 0
    jne .yield
    mov dword [0x401154], 1
    mov dword [0x401160], 0
    mov dword [0x401164], 0
    mov dword [0x401168], 0
    mov dword [0x40116C], 0
    mov dword [0x401170], 0

    ; 线程栈放在 heap 第一页：brk(0x406000) 映射 0x405000..0x405FFF。
    mov eax, 8              ; syscall: brk
    mov ebx, 0x406000
    int 0x80
    cmp eax, 0x406000
    jne .thread_bad

    mov eax, 19             ; syscall: clone(entry, stack, flags, arg)
    mov ebx, user_thread_entry - user_program_start + 0x400000
    mov ecx, 0x406000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, 0x401160       ; 共享计数器地址
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .thread_bad
    mov [0x401158], eax

.thread_wait:
    cmp dword [0x401168], 0
    jne .thread_join
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .thread_wait

.thread_join:
    mov ebx, [0x401158]
    mov ecx, 0x40115C
    mov eax, 22             ; syscall: thread_join(TID, &status)
    int 0x80
    mov [0x40116C], eax
    test eax, eax
    jnz .thread_bad
    cmp dword [0x40115C], 0
    jne .thread_bad
    cmp dword [0x401160], 1
    jne .thread_bad
    mov dword [0x401170], 0x54485244 ; "THRD"

; P7.2：第二个 worker 自己 thread_detach，主线程不能 join 它。
.thread_detach_round:
    mov dword [0x401174], 0
    mov dword [0x401178], 0
    mov dword [0x40117C], 0
    mov dword [0x401180], 0
    mov dword [0x401184], 0
    mov dword [0x401188], 0
    mov dword [0x40118C], 0

    mov eax, 19             ; syscall: clone(detached entry, stack, flags, arg)
    mov ebx, user_detached_entry - user_program_start + 0x400000
    mov ecx, 0x406000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, 0x401178       ; detached 共享计数器
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .thread_det_bad
    mov [0x401174], eax

.thread_det_wait:
    cmp dword [0x401180], 0
    jne .thread_det_join
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .thread_det_wait

.thread_det_join:
    mov ebx, [0x401174]
    xor ecx, ecx            ; status 传 0，避免不需要的 copyout
    mov eax, 22             ; syscall: thread_join(detached TID)
    int 0x80
    mov [0x401188], eax
    cmp eax, 0xFFFFFFFF
    jne .thread_det_bad
    cmp dword [0x40117C], 0
    jne .thread_det_bad
    cmp dword [0x401178], 1
    jne .thread_det_bad
    cmp dword [0x401184], 0
    je .thread_det_bad
    mov dword [0x40118C], 0x44544544 ; "DETD"
    jmp .thread_edge_round

.thread_det_bad:
    mov dword [0x40118C], 0x424144 ; "BAD"
    jmp .thread_edge_round

; P7.3：非法参数矩阵。join 0/-1/self/不存在 TID、detach 0/-1/不存在 TID
; 都必须返回 -1，不能把当前线程或线程组弄成异常状态。
.thread_edge_round:
    mov eax, 22             ; thread_join(0, 0)
    xor ebx, ebx
    xor ecx, ecx
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 22             ; thread_join(-1, 0)
    mov ebx, 0xFFFFFFFF
    xor ecx, ecx
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 21             ; gettid
    int 0x80
    mov ebx, eax
    mov eax, 22             ; thread_join(self, 0)
    xor ecx, ecx
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 22             ; thread_join(99, 0)
    mov ebx, 99
    xor ecx, ecx
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 23             ; thread_detach(0)
    xor ebx, ebx
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 23             ; thread_detach(-1)
    mov ebx, 0xFFFFFFFF
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov eax, 23             ; thread_detach(99)
    mov ebx, 99
    int 0x80
    cmp eax, 0xFFFFFFFF
    jne .thread_edge_bad

    mov dword [0x4011BC], 0x45444745 ; "EDGE"
    jmp .main_exit_round

.thread_edge_bad:
    mov dword [0x4011BC], 0x424144 ; "BAD"

; P7.3：fork 一个子进程，在子进程里先让主线程退出，worker 继续运行并
; join 主线程；worker 作为最后活线程 exit(7)，父进程 wait 必须得到 7。
.main_exit_round:
    cmp dword [0x4011C0], 0
    jne .yield
    mov dword [0x4011C0], 1

    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_main_exit

    mov [0x4011B0], eax             ; child pid
    mov ebx, eax
    mov ecx, 0x4011B4
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x4011B8], eax
    cmp dword [0x4011B4], 7
    jne .main_exit_bad
    cmp eax, [0x4011B0]
    jne .main_exit_bad
    mov dword [0x4011C4], 0x4D544852 ; "MTHR"
    jmp .thread_group_round

.main_exit_bad:
    mov dword [0x4011C4], 0x424144 ; "BAD"
    jmp .yield

; P7.4：主线程退出后不 join，两个 worker 继续使用共享 AS。worker A 先退出，
; worker B join A 后作为最后活线程 exit(7)；主线程 ZOMBIE 一直留在组内，
; 直到父进程 wait 触发整组回收。
.thread_group_round:
    cmp dword [0x4011F4], 0
    jne .yield
    mov dword [0x4011F4], 1

    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_group_exit
    cmp eax, 0xFFFFFFFF
    je .thread_group_bad

    mov [0x4011E8], eax             ; child pid
    mov ebx, eax
    mov ecx, 0x4011EC
    mov eax, 4              ; syscall: wait
    int 0x80
    mov [0x4011F0], eax
    cmp dword [0x4011EC], 7
    jne .thread_group_bad
    cmp eax, [0x4011E8]
    jne .thread_group_bad
    mov dword [0x4011F8], 0x4D475250 ; "MGRP"
    jmp .block_round

.thread_group_bad:
    mov dword [0x4011F8], 0x424144 ; "BAD"
    jmp .yield

; P7.5：父 wait 和一个子线程 join 都必须在目标仍 LIVE 时进入 BLOCKED。
; 子进程主线程 clone 一个 worker 后立即 join；worker 先等 start 标记，
; 再做一小段 yield，确保 join 一定先阻塞、随后被退出唤醒。
.block_round:
    cmp dword [0x4011FC], 0
    jne .yield
    mov dword [0x4011FC], 1

    mov eax, 6              ; syscall: fork
    int 0x80
    test eax, eax
    jz .child_block_exit
    cmp eax, 0xFFFFFFFF
    je .block_bad

    mov [0x401220], eax             ; child pid
    mov ebx, eax
    mov ecx, 0x401224
    mov eax, 4              ; syscall: wait，子进程仍在运行时阻塞
    int 0x80
    mov [0x401228], eax
    cmp dword [0x401224], 9
    jne .block_bad
    cmp eax, [0x401220]
    jne .block_bad
    mov dword [0x40122C], 0x57424C4B ; "WBLK"
    jmp .yield

.block_bad:
    mov dword [0x40122C], 0x424144 ; "BAD"
    jmp .yield

; P7.5 子进程：主线程 clone worker 后立刻 thread_join，worker 尚 LIVE。
.child_block_exit:
    mov eax, 8              ; syscall: brk(0x407000)
    mov ebx, 0x407000
    int 0x80
    cmp eax, 0x407000
    jne .child_block_bad

    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x401200], eax

    mov eax, 19             ; clone(worker, 0x407000)
    mov ebx, user_block_worker - user_program_start + 0x400000
    mov ecx, 0x407000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, [0x401200]
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .child_block_bad
    mov [0x401204], eax

    mov dword [0x401208], 1 ; 释放 worker；主线程紧接着 join
    mov ebx, [0x401204]
    mov ecx, 0x401214
    mov eax, 22             ; syscall: thread_join，worker 仍 LIVE -> BLOCKED
    int 0x80
    mov [0x401218], eax
    test eax, eax
    jnz .child_block_bad
    cmp dword [0x401214], 4
    jne .child_block_bad
    mov dword [0x40121C], 0x424C4B35 ; "BLK5"
    mov eax, 20             ; syscall: thread_exit(9)
    mov ebx, 9
    int 0x80
    jmp .hang_block_child

.child_block_bad:
    mov dword [0x40121C], 0x424144 ; "BAD"
    mov eax, 20
    mov ebx, 8
    int 0x80
    jmp .hang_block_child

.hang_block_child:
    jmp .hang_block_child

; P7.4 子进程：主线程 clone A/B 后立即 thread_exit(0)，不等待也不 join。
.child_group_exit:
    mov dword [0x4011C8], 0
    mov dword [0x4011CC], 0
    mov dword [0x4011D0], 0
    mov dword [0x4011D4], 0
    mov dword [0x4011D8], 0
    mov dword [0x4011DC], 0
    mov dword [0x4011E0], 0
    mov dword [0x4011E4], 0

    mov eax, 8              ; syscall: brk(0x407000)，两个 worker 各用一页栈
    mov ebx, 0x407000
    int 0x80
    cmp eax, 0x407000
    jne .child_group_bad

    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x4011C8], eax

    mov eax, 19             ; clone(worker A, 0x406000)
    mov ebx, user_group_first_worker - user_program_start + 0x400000
    mov ecx, 0x406000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, [0x4011C8]
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .child_group_bad
    mov [0x4011CC], eax

    mov eax, 19             ; clone(worker B, 0x407000)
    mov ebx, user_group_last_worker - user_program_start + 0x400000
    mov ecx, 0x407000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, [0x4011C8]
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .child_group_bad
    mov [0x4011D0], eax

    mov dword [0x4011D4], 1 ; 三个任务共享同一 AS，最后一个共享写
    mov eax, 20             ; syscall: thread_exit(0)，主线程不 join
    xor ebx, ebx
    int 0x80
    jmp .hang_group_main

.child_group_bad:
    mov dword [0x4011E4], 0x424144 ; "BAD"
    mov eax, 20             ; 单线程失败路径，父 wait 得到 8
    mov ebx, 8
    int 0x80
    jmp .hang_group_child

.hang_group_main:
    jmp .hang_group_main

.hang_group_child:
    jmp .hang_group_child

.thread_bad:
    mov dword [0x401170], 0x424144   ; "BAD"
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

; P7.3 子进程：主线程 clone worker 后先 thread_exit，worker 继续执行。
.child_main_exit:
    mov dword [0x401190], 0
    mov dword [0x401194], 0
    mov dword [0x401198], 0
    mov dword [0x40119C], 0
    mov dword [0x4011A0], 0
    mov dword [0x4011A4], 0
    mov dword [0x4011A8], 0
    mov dword [0x4011AC], 0

    mov eax, 8              ; syscall: brk(0x406000)，worker 复用 heap 第一页
    mov ebx, 0x406000
    int 0x80
    cmp eax, 0x406000
    jne .child_main_exit_bad

    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x401190], eax

    mov eax, 19             ; syscall: clone(worker, stack, flags, main_tid)
    mov ebx, user_main_first_worker - user_program_start + 0x400000
    mov ecx, 0x406000
    mov edx, 0x00010D00     ; VM|FILES|SIGHAND|THREAD
    mov esi, [0x401190]
    int 0x80
    cmp eax, 0xFFFFFFFF
    je .child_main_exit_bad
    mov [0x401194], eax

    mov dword [0x40119C], 1 ; 最后一道共享写：通知 worker 主线程即将退出
    mov eax, 20             ; syscall: thread_exit(0)
    xor ebx, ebx
    int 0x80
    jmp .hang_main_first

.child_main_exit_bad:
    mov dword [0x4011AC], 0x424144 ; "BAD"
    mov eax, 20             ; 唯一线程直接退出 8，父进程 wait 可判定失败
    mov ebx, 8
    int 0x80

.hang_main_first:
    jmp .hang_main_first

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

; P5.3：100 轮 fork/wait。子进程只 exit(7)；父进程每轮校验 wait 返回的
; 子 PID 和 status，并比较首末 PID 是否复用；完成后保持存活供页面观察。
.stress_mode:
    cmp dword [0x4010C8], 0
    jne .stress_hold
    mov dword [0x4010C8], 1
    mov dword [0x4010C0], 0
    mov dword [0x4010C4], 0
    mov dword [0x401100], 0
    mov dword [0x401104], 0
.stress_loop:
    cmp dword [0x4010C0], 100
    jae .stress_done
    mov eax, 6              ; fork
    int 0x80
    test eax, eax
    jz .stress_child
    mov [0x401104], eax
    mov ebx, eax
    mov ecx, 0x401108
    mov eax, 4              ; wait: return child PID, status in 0x401108
    int 0x80
    cmp eax, ebx
    jne .stress_hold        ; wait did not reap this child
    cmp dword [0x401108], 7
    jne .stress_hold        ; child status must be 7
    cmp dword [0x401100], 0
    jne .stress_pid_check
    mov [0x401100], ebx
.stress_pid_check:
    cmp ebx, [0x401100]     ; all 100 rounds must reuse the first PID
    jne .stress_hold
    inc dword [0x4010C0]
    jmp .stress_loop
.stress_done:
    mov dword [0x4010C4], 0x4C4F4F50 ; POOL magic = 100/100 validated
.stress_hold:
    cmp dword [0x404000], 0
    jne .stress_stop
    mov eax, 2
    int 0x80
    jmp .stress_hold
.stress_stop:
    mov eax, 3
    mov ebx, 18
    int 0x80
    jmp .hang
.stress_child:
    mov eax, 3
    mov ebx, 7
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

; P7.1 线程入口：clone 把 arg 放在 eax；线程只碰共享数据页和 heap 栈，
; 完成后必须 thread_exit，不能 ret 回用户栈。
user_thread_entry:
    mov ebx, eax
    inc dword [ebx]
    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x401164], eax
    mov dword [0x401168], 1
    mov eax, 20             ; syscall: thread_exit(0)
    xor ebx, ebx
    int 0x80
.hang_thread:
    jmp .hang_thread

; P7.2 detached worker：先 detach 自己，再写共享计数和完成标记并 thread_exit。
; edx 保存 clone 传入的共享计数地址；gettid/detach 只改 eax/ebx。
user_detached_entry:
    mov edx, eax
    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x401184], eax
    mov ebx, eax
    mov eax, 23             ; syscall: thread_detach(self)
    int 0x80
    mov [0x40117C], eax
    inc dword [edx]
    mov dword [0x401180], 1
    mov eax, 20             ; syscall: thread_exit(0)
    xor ebx, ebx
    int 0x80
.hang_detached:
    jmp .hang_detached

; P7.3 worker：主线程已经 thread_exit，worker 仍被调度；它 join 主 TID，
; 校验主线程退出码 0 后作为最后活线程 thread_exit(7)。
user_main_first_worker:
    mov [0x401190], eax     ; clone arg = 主线程 TID
    mov eax, 21              ; syscall: gettid
    int 0x80
    mov [0x4011A8], eax
    cmp eax, [0x401190]
    je .main_first_fail

.main_first_wait:
    cmp dword [0x40119C], 1
    je .main_first_join
    mov eax, 2              ; 主线程尚未执行最后的 thread_exit
    int 0x80
    jmp .main_first_wait

.main_first_join:
    mov ebx, [0x401190]     ; 主线程 TID
    mov ecx, 0x4011A0
    mov eax, 22              ; syscall: thread_join(main_tid, &status)
    int 0x80
    mov [0x4011A4], eax
    test eax, eax
    jnz .main_first_fail
    cmp dword [0x4011A0], 0 ; 主线程 thread_exit(0)
    jne .main_first_fail
    mov dword [0x4011AC], 0x4D41494E ; "MAIN"
    mov eax, 20              ; syscall: 最后线程 thread_exit(7)
    mov ebx, 7
    int 0x80
    jmp .hang_main_worker

.main_first_fail:
    mov dword [0x4011AC], 0x424144 ; "BAD"
    mov eax, 20
    mov ebx, 8
    int 0x80
    jmp .hang_main_worker

.hang_main_worker:
    jmp .hang_main_worker

; P7.4 worker A：等主线程退出标记后直接 thread_exit(5)。它不 join 主线程，
; 退出后留在组内成为 ZOMBIE，等待 worker B 回收。
user_group_first_worker:
    mov eax, 21             ; syscall: gettid
    int 0x80
    cmp eax, [0x4011C8]
    je .group_first_fail

.group_first_wait:
    cmp dword [0x4011D4], 1
    je .group_first_exit
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .group_first_wait

.group_first_exit:
    mov eax, 20             ; syscall: thread_exit(5)
    mov ebx, 5
    int 0x80
    jmp .hang_group_first

.group_first_fail:
    mov eax, 20
    mov ebx, 8
    int 0x80
    jmp .hang_group_first

.hang_group_first:
    jmp .hang_group_first

; P7.4 worker B：等主线程退出后 join worker A，确认 status 5；随后作为最后
; 活线程 thread_exit(7)，触发整组 process_exit/reap，包括未 join 的主线程。
user_group_last_worker:
    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x4011E0], eax
    cmp eax, [0x4011C8]
    je .group_last_fail
    cmp eax, [0x4011CC]
    je .group_last_fail

.group_last_wait:
    cmp dword [0x4011D4], 1
    je .group_last_join
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .group_last_wait

.group_last_join:
    mov ebx, [0x4011CC]     ; worker A TID
    mov ecx, 0x4011D8
    mov eax, 22             ; syscall: thread_join(A, &status)
    int 0x80
    mov [0x4011DC], eax
    test eax, eax
    jnz .group_last_fail
    cmp dword [0x4011D8], 5
    jne .group_last_fail
    mov dword [0x4011E4], 0x47525034 ; "GRP4"
    mov eax, 20             ; syscall: 最后线程 thread_exit(7)
    mov ebx, 7
    int 0x80
    jmp .hang_group_last

.group_last_fail:
    mov dword [0x4011E4], 0x424144 ; "BAD"
    mov eax, 20
    mov ebx, 8
    int 0x80
    jmp .hang_group_last

.hang_group_last:
    jmp .hang_group_last

; P7.5 worker：等主线程释放 start 后先 yield 一小段，再 thread_exit(4)。
; 主线程 join 时 worker 仍 LIVE，因此必须走 BLOCKED 而不是直接看到 ZOMBIE。
user_block_worker:
    mov eax, 21             ; syscall: gettid
    int 0x80
    mov [0x401210], eax
    cmp eax, [0x401200]
    je .block_worker_fail

.block_worker_wait:
    cmp dword [0x401208], 1
    je .block_worker_delay
    mov eax, 2              ; syscall: yield
    int 0x80
    jmp .block_worker_wait

.block_worker_delay:
    mov ecx, 1024
.block_worker_loop:
    mov eax, 2              ; syscall: yield
    int 0x80
    dec ecx
    jnz .block_worker_loop
    mov eax, 20             ; syscall: thread_exit(4)
    mov ebx, 4
    int 0x80
    jmp .hang_block_worker

.block_worker_fail:
    mov dword [0x40121C], 0x424144 ; "BAD"
    mov eax, 20
    mov ebx, 8
    int 0x80
    jmp .hang_block_worker

.hang_block_worker:
    jmp .hang_block_worker

user_program_end:


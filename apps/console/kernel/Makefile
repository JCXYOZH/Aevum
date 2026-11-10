# 工具链全部从环境变量取，可在命令行覆盖，例如：
#   make CC=gcc NASM=nasm QEMU=qemu-system-i386
# 命令找不到时，先把对应目录加进 PATH，再运行 make。
CC      ?= gcc
NASM    ?= nasm
OBJCOPY ?= objcopy
DD      ?= dd
QEMU    ?= qemu-system-i386
SHELL   ?= /usr/bin/sh
CFLAGS  ?= -m32 -ffreestanding -fno-pic -fno-stack-protector \
           -fno-asynchronous-unwind-tables -nostdlib -O2 -Wall -Wextra \
           -mno-sse -mno-sse2 -mno-mmx -mno-avx -fno-tree-vectorize \
           -Wno-array-bounds
# -Wno-array-bounds：boot info 与 VGA 都是固定物理地址（0x500 段 / 0xB8000），
# 只能把整数常量直接转成指针去读写。GCC 会把这种“来源是整数”的指针判成
# 零长度数组的越界下标并逐条报警，但这些访问本身是刻意的固定地址访问，
# 不是越界，所以在编译期关掉这一条，其余警告保持开启。
LDFLAGS ?= -m32 -nostdlib -Wl,-T,linker.ld -Wl,--build-id=none \
           -Wl,--section-alignment=4 -Wl,--file-alignment=4
# 关于 ld 的 4 条 "section below image base"：目标格式是 PE，默认 image base 是
# 0x400000，而 linker.ld 把段放在 0x1000 起，所以 ld 每段报一句。试过加
# -Wl,--image-base=0x0 可以消掉警告，但导出的 stage2.bin 内容会变
# （同样 5624 字节，sha256 从 2aef26… 变成 5806cf…），也就是说它不是纯提示。
# 这段代码最终是被 boot.asm 直接跳到 0x1000 执行的，不该为一个警告去动产物，
# 所以保持默认基址，让这 4 行留着。

all: disk.img

entry.o: entry.asm
	$(NASM) -f win32 -o $@ $<

stage2.o: stage2.c stage2_contract.h
	$(CC) $(CFLAGS) -c -o $@ $<

stage2.elf: entry.o stage2.o linker.ld
	$(CC) $(LDFLAGS) -o $@ entry.o stage2.o

stage2.bin: stage2.elf
	$(OBJCOPY) -O binary $< $@
	@size=$$(wc -c < $@); \
	 echo "stage2.bin size = $$size bytes (max 8192)"; \
	 if [ $$size -gt 8192 ]; then \
	   echo "ERROR: stage2.bin $$size bytes > 8192 (16 sectors)"; exit 1; \
	 fi

boot.bin: boot.asm
	$(NASM) -f bin -o $@ $<

disk.img: boot.bin stage2.bin
	$(DD) if=/dev/zero of=$@ bs=512 count=32 2>/dev/null
	$(DD) if=boot.bin of=$@ conv=notrunc 2>/dev/null
	$(DD) if=stage2.bin of=$@ bs=512 seek=1 conv=notrunc 2>/dev/null
	@echo "disk.img ready"

run: disk.img
	$(QEMU) -drive format=raw,file=disk.img -no-reboot \
	    -monitor stdio -serial tcp:127.0.0.1:5555,server=on,wait=off

clean:
	rm -f *.o *.elf *.bin *.img
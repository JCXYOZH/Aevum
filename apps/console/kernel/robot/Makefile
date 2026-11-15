# Makefile —— 32 位裸机内核（加油）
# 依赖：nasm / gcc(支持 -m32 编译) / ld(binutils) / make / qemu-system-i386

CC      = gcc
AS      = nasm
LD      = ld
QEMU    = qemu-system-i386

# freestanding：不连 libc；-m32 生成 32 位代码
# -fno-stack-protector            裸机没有 __stack_chk_fail，必须关掉栈保护
# -fno-asynchronous-unwind-tables 不生成 .eh_frame，减小镜像体积
CFLAGS  = -m32 -ffreestanding -c -Os -g -fno-pic -fno-pie -fno-plt \
          -fno-stack-protector -fno-asynchronous-unwind-tables
ASFLAGS_BIN   = -f bin
ASFLAGS_ELF32 = -f elf32
LDSCRIPT = kernel.ld

OBJS    = loader.o kernel.o
IMG     = os.img

# 所有由构建生成的产物（make clean 时一并删除）
GENERATED = boot.bin loader.o kernel.o kernel.elf kernel.bin $(IMG) disk.img

.PHONY: all clean rebuild run debug

all: disk.img

kernel.bin kernel.elf: $(OBJS) $(LDSCRIPT)
	$(LD) -m elf_i386 -T $(LDSCRIPT) $(OBJS) -o kernel.elf
	$(LD) -m elf_i386 -T $(LDSCRIPT) --oformat binary $(OBJS) -o kernel.bin

loader.o: loader.asm
	$(AS) $(ASFLAGS_ELF32) loader.asm -o loader.o

kernel.o: kernel.c
	$(CC) $(CFLAGS) kernel.c -o kernel.o

boot.bin: boot.asm
	$(AS) $(ASFLAGS_BIN) boot.asm -o boot.bin

$(IMG): boot.bin kernel.bin
	dd if=/dev/zero of=$(IMG) bs=512 count=2880
	dd if=boot.bin of=$(IMG) conv=notrunc
	dd if=kernel.bin of=$(IMG) bs=512 seek=1 conv=notrunc

# 桌面端固定读取 disk.img；和 os.img 内容一致，保留 os.img 便于直接 qemu 调试。
disk.img: $(IMG)
	cp $(IMG) disk.img

# 删除全部编译产物（.o / .bin / .elf / os.img）
clean:
	rm -f $(GENERATED)

# 一步完成：先清干净，再重新编译
rebuild:
	$(MAKE) clean
	$(MAKE) all

# 启动 QEMU 运行内核
run: disk.img
	$(QEMU) -drive format=raw,file=disk.img

# 启动 QEMU 并停在起点等待 gdb 连接（gdb: target remote :1234）
debug: $(IMG)
	$(QEMU) -s -S -drive format=raw,file=$(IMG)
# Makefile —— 32 位裸机内核（模块化目录）
# 依赖：nasm / gcc(支持 -m32 编译) / ld(binutils) / make / qemu-system-i386

CC      = gcc
AS      = nasm
LD      = ld
QEMU    = qemu-system-i386

BUILD   = build
CFLAGS  = -m32 -msse2 -ffreestanding -c -O2 -g -fno-tree-loop-distribute-patterns -fno-pic -fno-pie \
          -fno-stack-protector -fno-asynchronous-unwind-tables -fno-unwind-tables \
          -falign-functions=1 -falign-jumps=1 -falign-loops=1 \
          -Wall -Wextra -Iinclude -I.
ASFLAGS_BIN   = -f bin
ASFLAGS_ELF32 = -f elf32
LDSCRIPT = kernel.ld

SRCS = \
	kernel/main/main.c \
	kernel/error/error.c \
	kernel/task/task.c \
	arch/x86/cpu/interrupt/interrupt.c \
	drivers/video/vga/text/vga.c \
	drivers/serial/uart/uart.c \
	drivers/input/keyboard/keyboard.c \
	lib/fixed/fixed.c \
	lib/math/trig.c \
	lib/format/format.c \
	app/arm/app/app.c \
	app/arm/kinematics/kinematics.c \
	app/arm/control/control.c \
	app/arm/render/render.c \
	app/fpu/demo/demo.c \
	app/fpu/render/render.c

OBJS    = $(addprefix $(BUILD)/,$(SRCS:.c=.o))
IMG     = os.img

GENERATED = boot.bin $(IMG) disk.img kernel.bin kernel.elf $(BUILD)

.PHONY: all clean rebuild run debug size

all: disk.img

$(BUILD)/%.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $< -o $@

$(BUILD)/loader.o: loader.asm
	@mkdir -p $(BUILD)
	$(AS) $(ASFLAGS_ELF32) loader.asm -o $@

kernel.elf: $(OBJS) $(BUILD)/loader.o $(LDSCRIPT)
	$(LD) -m elf_i386 -T $(LDSCRIPT) $(BUILD)/loader.o $(OBJS) -o kernel.elf

# 由同一个 ELF 产出 flat binary，保证 loader 与 C 看到的 __bss_start 完全一致。
kernel.bin: kernel.elf
	objcopy -O binary kernel.elf kernel.bin
	@size=$$(wc -c < kernel.bin); echo "kernel.bin bytes: $$size (limit 24576 / 48 sectors)"; \
	if [ $$size -gt 24576 ]; then echo "ERROR: kernel.bin $$size bytes > 24576"; exit 1; fi

boot.bin: boot.asm
	$(AS) $(ASFLAGS_BIN) boot.asm -o boot.bin

$(IMG): boot.bin kernel.bin
	dd if=/dev/zero of=$(IMG) bs=512 count=2880
	dd if=boot.bin of=$(IMG) conv=notrunc
	dd if=kernel.bin of=$(IMG) bs=512 seek=1 conv=notrunc

# 桌面端固定读 disk.img；和 os.img 内容一致，保留 os.img 便于直接 qemu 调试。
disk.img: $(IMG)
	cp $(IMG) disk.img

size: kernel.bin
	@wc -c kernel.bin

clean:
	rm -rf $(GENERATED)

rebuild:
	$(MAKE) clean
	$(MAKE) all

run: disk.img
	$(QEMU) -drive format=raw,file=disk.img

debug: $(IMG)
	$(QEMU) -s -S -drive format=raw,file=$(IMG)

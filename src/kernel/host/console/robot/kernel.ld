/* kernel.ld 链接脚本
 * 加载窗口 0x1000..0x7000；BSS 可延伸到 0x72A0，由 loader 清零，
 * 任务栈从 0x8000 起，避免和页目录/页表(0x10000/0x11000)冲突。
 */
ENTRY(start);

SECTIONS {
    . = 0x1000; /* 加载到物理地址0x1000，和boot的jmp目标匹配 */

    .text : {
        *(.boot)
        *(.text)
        *(.text.*)
    }

    .rodata : {
        *(.rodata)
        *(.rodata.*)
    }

    .eh_frame : {
        *(.eh_frame)
    }

    .data : {
        *(.data)
        *(.data.*)
    }

    .bss : {
        . = ALIGN(4);
        __bss_start = .;
        *(COMMON)
        *(.bss)
        *(.bss.*)
        . = ALIGN(4);
        __bss_end = .;
    }
}

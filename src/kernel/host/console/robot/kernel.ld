/* kernel.ld 链接脚本
 * 加载窗口 0x1000..0x7BFF（boot 54 扇区）；BSS 由 loader 清零，
 * 当前止于 0x88BC，仍低于 0x9000 的 render 栈；页目录/页表在 0x10000/0x11000。
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

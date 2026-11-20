/* kernel.ld 链接脚本
 * 所有段从 0x1000 开始连续排布，整体保持在 0x4800 以下，
 * 避免和任务栈(0x5000~0x9000)、页目录/页表(0x10000/0x11000)冲突。
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
        *(COMMON)
        *(.bss)
        *(.bss.*)
    }
}

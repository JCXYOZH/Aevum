#include "drivers/input/keyboard.h"
#include "arch/x86/io.h"

u8 keyboard_poll(void)
{
    if (port_inb(0x64) & 1)
        return port_inb(0x60);
    return 0;
}

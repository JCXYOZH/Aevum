[bits 32]
[global _start]
[extern _stage2_main]

section .text
_start:
    call _stage2_main
    cli
    hlt
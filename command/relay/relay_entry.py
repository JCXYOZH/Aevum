#!/usr/bin/env python3
"""PyInstaller entry point for the in-memory relay.

The package itself is still runnable with ``python -m relay`` from
``command/relay``.  This file only gives the freezer a stable, absolute import
target so the desktop installer can ship a standalone ``memoria-relay.exe``.
"""
from relay.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())

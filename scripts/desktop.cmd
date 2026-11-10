@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop.ps1" %*
endlocal

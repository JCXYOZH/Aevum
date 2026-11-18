@echo off
setlocal
set "PS_BIN=pwsh"
where pwsh >nul 2>&1
if errorlevel 1 set "PS_BIN=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%PS_BIN%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1" %*
if "%~1"=="" pause

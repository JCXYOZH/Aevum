param(
  [string]$Qemu = $env:AEVUM_QEMU,
  [int]$SerialPort = $(if ($env:AEVUM_SERIAL_PORT) { [int]$env:AEVUM_SERIAL_PORT } else { 5555 }),
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$robot = Join-Path $repo "src\kernel\host\console\robot"
$disk = Join-Path $robot "disk.img"

if (-not (Test-Path $disk)) {
  throw "disk.img not found: $disk. Build the kernel first: .\scripts\kernel\build-kernel.ps1"
}

$candidates = @()
if ($Qemu) { $candidates += $Qemu }
$onPath = Get-Command qemu-system-i386 -ErrorAction SilentlyContinue
if ($onPath) { $candidates += $onPath.Source }
$candidates += @(
  (Join-Path $env:ProgramFiles "qemu\qemu-system-i386.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "qemu\qemu-system-i386.exe")
)
$qemuExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $qemuExe) {
  throw "qemu-system-i386 not found. Put it on PATH or set AEVUM_QEMU / -Qemu."
}

$qemuArgs = @(
  "-m", "32M",
  "-drive", "format=raw,file=$disk",
  "-display", "gtk,zoom-to-fit=on",
  "-vga", "std",
  "-serial", "tcp:127.0.0.1:$SerialPort,server,nowait",
  "-no-reboot"
)

if ($Check) {
  Write-Output "qemu:  $qemuExe"
  Write-Output "disk:  $disk"
  Write-Output "cmd:   $qemuExe $($qemuArgs -join ' ')"
  exit 0
}

& $qemuExe @qemuArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

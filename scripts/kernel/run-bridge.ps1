param(
  [string]$Python = $env:AEVUM_PYTHON,
  [int]$SerialPort = $(if ($env:AEVUM_SERIAL_PORT) { [int]$env:AEVUM_SERIAL_PORT } else { 5555 }),
  [int]$WsPort = $(if ($env:AEVUM_WS_PORT) { [int]$env:AEVUM_WS_PORT } else { 8765 }),
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$bridge = Join-Path $repo "src\kernel\host\bridge\serial_bridge.py"

if (-not (Test-Path $bridge)) { throw "bridge not found: $bridge" }

$candidates = @()
if ($Python) { $candidates += $Python }
foreach ($name in @("python", "py")) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
}
foreach ($venv in @(".venv", "venv")) {
  $candidates += @((Join-Path $repo "$venv\Scripts\python.exe"), (Join-Path $repo "$venv\bin\python"))
}
$pythonExe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $pythonExe) {
  throw "Python 3 not found. Put it on PATH or set AEVUM_PYTHON / -Python."
}

& $pythonExe -c "import websockets" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Python at $pythonExe cannot import websockets. Run: $pythonExe -m pip install websockets"
}

$env:QEMU_SERIAL_PORT = [string]$SerialPort
$env:BRIDGE_WS_PORT = [string]$WsPort

if ($Check) {
  Write-Output "python: $pythonExe"
  Write-Output "bridge: $bridge"
  Write-Output "ports:  serial=$SerialPort ws=$WsPort"
  exit 0
}

& $pythonExe $bridge
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

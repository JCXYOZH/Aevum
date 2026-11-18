# Build the Python services and the Electron desktop shell in one pass.
# Each service is a PyInstaller one-file executable, so a target machine does
# not need Python. The default Electron target is `dir` (unpacked app), because
# the single-file portable target needs more memory than this host currently has.
# Usage:
#   .\ops\scripts\package-desktop.ps1
#   .\ops\scripts\package-desktop.ps1 -SkipMonitor
#   .\ops\scripts\package-desktop.ps1 -SkipServices -SkipElectron
param(
    [switch]$SkipMonitor,
    [switch]$SkipRelay,
    [switch]$SkipBridge,
    [switch]$SkipElectron,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$python = if ($env:MEMORIA_PYTHON) { $env:MEMORIA_PYTHON } elseif (Test-Path -LiteralPath "D:\venv\Scripts\python.exe") { "D:\venv\Scripts\python.exe" } else { "python" }

function Write-Step([string]$message) {
    Write-Host "== $message" -ForegroundColor Cyan
}

function Invoke-PyInstaller([string]$name, [string]$entry, [string]$dist, [string]$work, [string[]]$extra = @()) {
    if ($Clean) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $dist -Recurse -Force -ErrorAction SilentlyContinue
    }
    $args = @(
        "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onefile", "--console",
        "--name", $name,
        "--distpath", $dist,
        "--workpath", $work,
        "--specpath", $work
    ) + $extra + @($entry)
    & $python @args
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed for $name (exit $LASTEXITCODE)" }
    $exe = Join-Path $dist "$name.exe"
    if (-not (Test-Path -LiteralPath $exe)) { throw "Expected executable was not produced: $exe" }
    Write-Host "$name : $exe" -ForegroundColor Green
    return $exe
}

$monitorDir = Join-Path $repo "archive\backend-python\monitor"
$monitorDist = Join-Path $monitorDir "dist"
$monitorWork = Join-Path $repo "build\pyinstaller\monitor"
$monitorExe = Join-Path $monitorDist "memoria-monitor.exe"

if (-not $SkipMonitor) {
    Write-Step "PyInstaller: monitor"
    # desktop_server.py only imports the standard library.
    $monitorExe = Invoke-PyInstaller "memoria-monitor" (Join-Path $monitorDir "desktop_server.py") $monitorDist $monitorWork
}

$relayDir = Join-Path $repo "control\relay"
$relayDist = Join-Path $relayDir "dist"
$relayWork = Join-Path $repo "build\pyinstaller\relay"
$relayExe = Join-Path $relayDist "memoria-relay.exe"

if (-not $SkipRelay) {
    Write-Step "PyInstaller: relay"
    $relayExe = Invoke-PyInstaller "memoria-relay" (Join-Path $relayDir "relay_entry.py") $relayDist $relayWork @(
        "--paths", $relayDir,
        "--add-data", "$(Join-Path $relayDir 'contracts');contracts"
    )
}

$bridgeDir = Join-Path $repo "src\kernel\host\bridge"
$bridgeDist = Join-Path $bridgeDir "dist"
$bridgeWork = Join-Path $repo "build\pyinstaller\bridge"
$bridgeExe = Join-Path $bridgeDist "memoria-bridge.exe"

if (-not $SkipBridge) {
    Write-Step "PyInstaller: serial bridge"
    $bridgeExe = Invoke-PyInstaller "memoria-bridge" (Join-Path $bridgeDir "serial_bridge.py") $bridgeDist $bridgeWork @("--hidden-import", "websockets")
}

if (-not $SkipElectron) {
    Write-Step "electron-builder: unpacked app"
    $desktopDir = Join-Path $repo "interface\desktop"
    $nodeModules = Join-Path $desktopDir "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        throw "interface\desktop\node_modules is missing; run npm install in interface\desktop first."
    }
    if (-not (Test-Path -LiteralPath $monitorExe)) {
        throw "Monitor executable is missing; package the monitor before the Electron app."
    }
    Push-Location $desktopDir
    try {
        & npm run dist
        if ($LASTEXITCODE -ne 0) {
            throw "electron-builder failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
    Write-Step "unpacked output"
    $unpacked = Join-Path $desktopDir "dist-app\win-unpacked"
    if (Test-Path -LiteralPath $unpacked) {
        Get-ChildItem -LiteralPath $unpacked -Filter "*.exe" |
            ForEach-Object { Write-Host $_.FullName -ForegroundColor Green }
    }
    else {
        Write-Host "expected output directory is missing: $unpacked" -ForegroundColor Yellow
    }
}

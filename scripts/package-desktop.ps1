# Build the Python monitor and the Electron desktop shell in one pass.
# The monitor is a PyInstaller one-file executable; Electron copies it into
# resources/monitor so a target machine does not need a Python installation.
# The default Electron target is `dir` (unpacked app), because the single-file
# portable target needs more memory than this host currently has.
# Usage:
#   .\scripts\package-desktop.ps1
#   .\scripts\package-desktop.ps1 -SkipMonitor
#   .\scripts\package-desktop.ps1 -SkipElectron
param(
    [switch]$SkipMonitor,
    [switch]$SkipElectron,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$python = if ($env:MEMORIA_PYTHON) { $env:MEMORIA_PYTHON } elseif (Test-Path -LiteralPath "D:\venv\Scripts\python.exe") { "D:\venv\Scripts\python.exe" } else { "python" }

function Write-Step([string]$message) {
    Write-Host "== $message" -ForegroundColor Cyan
}

$monitorDir = Join-Path $repo "apps\console\monitor"
$monitorDist = Join-Path $monitorDir "dist"
$monitorWork = Join-Path $repo "build\pyinstaller\monitor"
$monitorExe = Join-Path $monitorDist "memoria-monitor.exe"

if (-not $SkipMonitor) {
    Write-Step "PyInstaller: monitor"
    if ($Clean) {
        Remove-Item -LiteralPath $monitorWork -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $monitorDist -Recurse -Force -ErrorAction SilentlyContinue
    }
    # A one-file monitor keeps the portable app to a single extra process.
    # desktop_server.py only imports the standard library, so no hidden imports
    # or data files are required by the build itself.
    & $python -m PyInstaller `
        --noconfirm `
        --clean `
        --onefile `
        --console `
        --name memoria-monitor `
        --distpath $monitorDist `
        --workpath $monitorWork `
        --specpath $monitorWork `
        (Join-Path $monitorDir "desktop_server.py")
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path -LiteralPath $monitorExe)) {
        throw "Expected monitor executable was not produced: $monitorExe"
    }
    Write-Host "monitor: $monitorExe" -ForegroundColor Green
}

if (-not $SkipElectron) {
    Write-Step "electron-builder: unpacked app"
    $desktopDir = Join-Path $repo "apps\desktop"
    $nodeModules = Join-Path $desktopDir "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        throw "apps\desktop\node_modules is missing; run npm install in apps\desktop first."
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
